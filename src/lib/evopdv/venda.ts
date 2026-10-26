/**
 * /src/lib/evopdv/venda.ts
 *
 * A VENDA que o EvoPDV manda para virar NFC-e (POST /api/integracoes/evopdv/notas):
 * a conferência do que chegou, em CENTAVOS inteiros, e a tradução para o
 * pedido da nota (`PedidoParaNota`, lib/fiscal-emissao) — o mesmo
 * `montarCorpoDaNfce` de toda nota do FireHub monta o corpo dela.
 *
 * ── A conferência ───────────────────────────────────────────────────────────
 *
 * Em centavos, sem ponto flutuante (um centavo de diferença é rejeição):
 *   - Σ itens − desconto + acréscimo = total;
 *   - Σ pagamentos − troco = total;
 *   - troco só com UMA linha em dinheiro, e ela cobre o troco;
 *   - cada item: quantidade × unitário = total do item (±1 centavo, o
 *     arredondamento que a SEFAZ tolera no vProd).
 * O cadastro fiscal do item (NCM, CFOP, CSOSN, origem, CEST, PIS, COFINS) vem
 * por produto: o conteúdo é conferido pela emissão (pendenciasDosItens e o
 * XML), aqui só a forma.
 *
 * ── A hora da venda ─────────────────────────────────────────────────────────
 *
 * `dataEmissao` é a hora da venda no caixa. A fila sem internet do EvoPDV
 * manda depois: até 4 minutos de atraso a nota sai normal, com a hora de agora
 * (a SEFAZ recusa a emissão normal com mais de 5 minutos de atraso — rejeição
 * 704); passou disso, a venda foi feita sem conexão e a nota sai em
 * CONTINGÊNCIA OFF-LINE com a hora da venda (dhEmi = dhCont), transmitida em
 * seguida pelo cron — desde que dentro do prazo legal de transmissão da
 * contingência ("até o primeiro dia útil subsequente", Ajuste SINIEF 19/16,
 * cl. 11ª § 1º II; no PA, 24 h — lib/nfce/emissao-da-loja → prazoDaContingencia).
 * Fora do prazo, a venda é recusada aqui.
 *
 * Puro: sem banco, sem rede.
 */
import { createHash } from "node:crypto";
import type { PedidoParaNota } from "../fiscal-emissao";
import { documentoValido } from "../fiscal-validacao";
import { documentoDeVerdade } from "../documento-do-cliente";

export const FORMAS_DE_PAGAMENTO = ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VR", "VA", "CREDIARIO", "OUTRO"] as const;
export type FormaDoEvopdv = (typeof FORMAS_DE_PAGAMENTO)[number];
export const BANDEIRAS = ["VISA", "MASTERCARD", "AMEX", "ELO", "HIPERCARD", "DINERS"] as const;
export type Bandeira = (typeof BANDEIRAS)[number];

export type ItemDaVenda = {
  codigo: string;
  descricao: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  csosn: string;
  origem: number;
  pis: string | null;
  cofins: string | null;
  unidade: string;
  quantidade: number;
  valorUnitarioCentavos: number;
  totalCentavos: number;
};

export type PagamentoDaVenda = { forma: FormaDoEvopdv; valorCentavos: number; descricao: string | null; bandeira: Bandeira | null };

/** A venda conferida — é ela que fica gravada em VendaExterna.venda. */
export type VendaConferida = {
  vendaId: string;
  dataEmissao: string | null;
  itens: ItemDaVenda[];
  descontoCentavos: number;
  acrescimoCentavos: number;
  totalCentavos: number;
  pagamentos: PagamentoDaVenda[];
  trocoCentavos: number;
  cpf: string | null;
  nomeCliente: string | null;
};

export type ErroDaVenda = { campo: string; mensagem: string };

/** Até quanto de atraso a nota ainda sai normal (a SEFAZ tolera 5 min — rejeição 704). */
export const ATRASO_DA_EMISSAO_NORMAL_MS = 4 * 60_000;
/** Relógio do caixa adiantado: até isto é aceito (e a nota sai com a hora de agora). */
const ADIANTAMENTO_ACEITO_MS = 5 * 60_000;
/** NFC-e: até 990 itens (det nItem 1–990). */
const MAXIMO_DE_ITENS = 990;

const texto = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "");
const inteiro = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99_999_999_99 ? v : null);
const opcional = (v: unknown): string | null => {
  const t = texto(v);
  return t ? t : null;
};

/**
 * Confere a venda que chegou. Devolve a venda limpa ou a lista do que está
 * errado (campo e frase) — a rota responde 422 com ela.
 */
export function conferirVenda(bruto: unknown, agora: Date = new Date()): { ok: true; venda: VendaConferida } | { ok: false; erros: ErroDaVenda[] } {
  const erros: ErroDaVenda[] = [];
  const erro = (campo: string, mensagem: string) => erros.push({ campo, mensagem });
  const b = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};

  const vendaId = texto(b.vendaId);
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(vendaId)) erro("vendaId", "vendaId obrigatório: o id da venda no EvoPDV (1 a 100 caracteres: letras, números, . _ : -).");

  let dataEmissao: string | null = null;
  if (b.dataEmissao != null && b.dataEmissao !== "") {
    const t = Date.parse(String(b.dataEmissao));
    if (!Number.isFinite(t)) erro("dataEmissao", "dataEmissao não é uma data ISO 8601 (ex.: 2026-10-25T14:32:00-03:00).");
    else if (t > agora.getTime() + ADIANTAMENTO_ACEITO_MS) erro("dataEmissao", "dataEmissao está no futuro: confira o relógio do caixa.");
    else dataEmissao = new Date(t).toISOString();
  }

  const itensBrutos = Array.isArray(b.itens) ? b.itens : [];
  if (itensBrutos.length === 0) erro("itens", "A venda não tem itens.");
  if (itensBrutos.length > MAXIMO_DE_ITENS) erro("itens", `A NFC-e aceita até ${MAXIMO_DE_ITENS} itens.`);
  const itens: ItemDaVenda[] = [];
  itensBrutos.slice(0, MAXIMO_DE_ITENS).forEach((bi, i) => {
    const x = bi && typeof bi === "object" ? (bi as Record<string, unknown>) : {};
    const c = `itens[${i}]`;
    const item: ItemDaVenda = {
      codigo: texto(x.codigo).slice(0, 60),
      descricao: texto(x.descricao).slice(0, 120),
      ncm: texto(x.ncm).replace(/\D/g, ""),
      cest: opcional(x.cest)?.replace(/\D/g, "") || null,
      cfop: texto(x.cfop).replace(/\D/g, ""),
      csosn: texto(x.csosn).replace(/\D/g, ""),
      origem: Number(x.origem),
      pis: opcional(x.pis)?.replace(/\D/g, "") || null,
      cofins: opcional(x.cofins)?.replace(/\D/g, "") || null,
      unidade: (texto(x.unidade) || "UN").toUpperCase().slice(0, 6),
      quantidade: Number(x.quantidade),
      valorUnitarioCentavos: inteiro(x.valorUnitarioCentavos) ?? -1,
      totalCentavos: inteiro(x.totalCentavos) ?? -1,
    };
    if (!item.codigo) erro(`${c}.codigo`, "Código do produto obrigatório.");
    if (item.descricao.length < 2) erro(`${c}.descricao`, "Descrição do produto obrigatória.");
    if (!/^\d{8}$/.test(item.ncm)) erro(`${c}.ncm`, `NCM de "${item.descricao || item.codigo}" precisa ter 8 dígitos.`);
    if (item.cest && !/^\d{7}$/.test(item.cest)) erro(`${c}.cest`, "CEST tem 7 dígitos.");
    if (!/^5\d{3}$/.test(item.cfop)) erro(`${c}.cfop`, "CFOP da NFC-e é de saída interna: 4 dígitos começando por 5 (ex.: 5102, 5405).");
    if (!/^\d{3}$/.test(item.csosn)) erro(`${c}.csosn`, "CSOSN tem 3 dígitos (ex.: 102, 500).");
    if (!Number.isInteger(item.origem) || item.origem < 0 || item.origem > 8) erro(`${c}.origem`, "Origem da mercadoria de 0 a 8.");
    if (item.pis && !/^\d{2}$/.test(item.pis)) erro(`${c}.pis`, "CST de PIS tem 2 dígitos.");
    if (item.cofins && !/^\d{2}$/.test(item.cofins)) erro(`${c}.cofins`, "CST de COFINS tem 2 dígitos.");
    if (!/^[A-Z0-9]{1,6}$/.test(item.unidade)) erro(`${c}.unidade`, "Unidade comercial: até 6 letras (UN, KG, LT...).");
    if (!(Number.isFinite(item.quantidade) && item.quantidade > 0 && Math.round(item.quantidade * 10_000) === item.quantidade * 10_000)) {
      erro(`${c}.quantidade`, "Quantidade maior que zero, com até 4 casas decimais.");
    }
    if (item.valorUnitarioCentavos <= 0) erro(`${c}.valorUnitarioCentavos`, "Valor unitário em centavos (inteiro maior que zero).");
    if (item.totalCentavos <= 0) erro(`${c}.totalCentavos`, "Total do item em centavos (inteiro maior que zero).");
    if (item.valorUnitarioCentavos > 0 && item.totalCentavos > 0 && Number.isFinite(item.quantidade)) {
      if (Math.abs(Math.round(item.quantidade * item.valorUnitarioCentavos) - item.totalCentavos) > 1) {
        erro(`${c}.totalCentavos`, `Quantidade × unitário (${Math.round(item.quantidade * item.valorUnitarioCentavos)}) não dá o total do item (${item.totalCentavos}).`);
      }
    }
    itens.push(item);
  });

  const descontoCentavos = b.descontoCentavos == null ? 0 : inteiro(b.descontoCentavos) ?? -1;
  const acrescimoCentavos = b.acrescimoCentavos == null ? 0 : inteiro(b.acrescimoCentavos) ?? -1;
  const trocoCentavos = b.trocoCentavos == null ? 0 : inteiro(b.trocoCentavos) ?? -1;
  const totalCentavos = inteiro(b.totalCentavos) ?? -1;
  if (descontoCentavos < 0) erro("descontoCentavos", "Desconto em centavos (inteiro, zero ou mais).");
  if (acrescimoCentavos < 0) erro("acrescimoCentavos", "Acréscimo em centavos (inteiro, zero ou mais).");
  if (trocoCentavos < 0) erro("trocoCentavos", "Troco em centavos (inteiro, zero ou mais).");
  if (totalCentavos <= 0) erro("totalCentavos", "Total da venda em centavos (inteiro maior que zero).");

  const pagBrutos = Array.isArray(b.pagamentos) ? b.pagamentos : [];
  if (pagBrutos.length === 0) erro("pagamentos", "A venda não tem pagamento.");
  if (pagBrutos.length > 100) erro("pagamentos", "Até 100 linhas de pagamento.");
  const pagamentos: PagamentoDaVenda[] = [];
  pagBrutos.slice(0, 100).forEach((bp, i) => {
    const x = bp && typeof bp === "object" ? (bp as Record<string, unknown>) : {};
    const c = `pagamentos[${i}]`;
    const forma = texto(x.forma).toUpperCase() as FormaDoEvopdv;
    const bandeira = opcional(x.bandeira)?.toUpperCase() as Bandeira | undefined;
    const p: PagamentoDaVenda = {
      forma,
      valorCentavos: inteiro(x.valorCentavos) ?? -1,
      descricao: opcional(x.descricao)?.slice(0, 60) ?? null,
      bandeira: bandeira ?? null,
    };
    if (!FORMAS_DE_PAGAMENTO.includes(forma)) erro(`${c}.forma`, `Forma de pagamento: ${FORMAS_DE_PAGAMENTO.join(", ")}.`);
    if (p.valorCentavos <= 0) erro(`${c}.valorCentavos`, "Valor do pagamento em centavos (inteiro maior que zero).");
    if (forma === "OUTRO" && (!p.descricao || p.descricao.length < 2)) erro(`${c}.descricao`, "Forma OUTRO precisa da descrição (ex.: \"Cheque\").");
    if (p.bandeira && !BANDEIRAS.includes(p.bandeira)) erro(`${c}.bandeira`, `Bandeira: ${BANDEIRAS.join(", ")}.`);
    if (p.bandeira && forma !== "CREDITO" && forma !== "DEBITO") erro(`${c}.bandeira`, "Bandeira só em CREDITO ou DEBITO.");
    pagamentos.push(p);
  });

  // ── As contas, em centavos ──
  if (erros.length === 0) {
    const somaItens = itens.reduce((s, i) => s + i.totalCentavos, 0);
    if (descontoCentavos > somaItens) erro("descontoCentavos", "O desconto passa da soma dos itens.");
    if (somaItens - descontoCentavos + acrescimoCentavos !== totalCentavos) {
      erro("totalCentavos", `Itens (${somaItens}) − desconto (${descontoCentavos}) + acréscimo (${acrescimoCentavos}) = ${somaItens - descontoCentavos + acrescimoCentavos}, e o total veio ${totalCentavos}.`);
    }
    const somaPagos = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
    if (somaPagos - trocoCentavos !== totalCentavos) {
      erro("pagamentos", `Pagamentos (${somaPagos}) − troco (${trocoCentavos}) = ${somaPagos - trocoCentavos}, e o total veio ${totalCentavos}.`);
    }
    if (trocoCentavos > 0) {
      const emDinheiro = pagamentos.filter((p) => p.forma === "DINHEIRO");
      if (emDinheiro.length !== 1) erro("trocoCentavos", "Troco só com UMA linha de pagamento em DINHEIRO.");
      else if (emDinheiro[0].valorCentavos < trocoCentavos) erro("trocoCentavos", "O troco é maior que o dinheiro recebido.");
    }
  }

  const doc = documentoDeVerdade(b.cpf);
  if (doc && !documentoValido(doc)) erro("cpf", "CPF/CNPJ do consumidor inválido (os dígitos verificadores não batem).");
  const nomeCliente = opcional(b.nomeCliente)?.slice(0, 60) ?? null;

  if (erros.length > 0) return { ok: false, erros };
  return {
    ok: true,
    venda: { vendaId, dataEmissao, itens, descontoCentavos, acrescimoCentavos, totalCentavos, pagamentos, trocoCentavos, cpf: doc, nomeCliente },
  };
}

/** sha256 da venda conferida: o mesmo vendaId com outro conteúdo é outra venda. */
export function hashDaVenda(v: VendaConferida): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

const NOME_DA_BANDEIRA: Record<Bandeira, string> = { VISA: "Visa", MASTERCARD: "Master", AMEX: "Amex", ELO: "Elo", HIPERCARD: "Hiper", DINERS: "Diners" };

/**
 * O rótulo que a leitura das formas (lib/fiscal-emissao → formaDaNota) entende
 * sem adivinhar: 01 dinheiro, 17 Pix (ou 20 no Pix estático da loja), 03/04
 * cartão com o grupo "não integrado (POS)", 11 vale-refeição, 10
 * vale-alimentação, 99 crediário ("a prazo") e 99 com a descrição em OUTRO
 * (o "(forma propria)" faz a leitura usar o nome, sem reinterpretar).
 */
export function rotuloDaForma(p: PagamentoDaVenda): string {
  const bandeira = p.bandeira ? ` ${NOME_DA_BANDEIRA[p.bandeira]}` : "";
  switch (p.forma) {
    case "DINHEIRO": return "Dinheiro";
    case "PIX": return "Pix";
    case "CREDITO": return `Cartão Crédito${bandeira}`;
    case "DEBITO": return `Cartão Débito${bandeira}`;
    case "VR": return "Vale Refeição";
    case "VA": return "Vale Alimentação";
    case "CREDIARIO": return "Crediário";
    default: return `${p.descricao} (forma propria)`;
  }
}

/** A venda como o pedido da nota (`montarCorpoDaNfce`). Sem canal, sem entrega, sem intermediador: venda presencial no balcão. */
export function vendaParaNota(id: string, v: VendaConferida): PedidoParaNota {
  const reais = (c: number) => c / 100;
  const umaForma = v.pagamentos.length === 1;
  const unica = v.pagamentos[0];
  return {
    id,
    numero: null,
    itens: v.itens.map((i) => ({
      codigo: i.codigo,
      descricao: i.descricao,
      ncm: i.ncm,
      cest: i.cest,
      cfop: i.cfop,
      unidadeComercial: i.unidade,
      quantidade: i.quantidade,
      valorUnitario: reais(i.valorUnitarioCentavos),
      valorTotal: reais(i.totalCentavos),
      origem: i.origem,
      csosn: i.csosn,
      cst: null,
      pis: i.pis,
      cofins: i.cofins,
    })),
    valorTotal: reais(v.totalCentavos),
    desconto: reais(v.descontoCentavos),
    acrescimo: reais(v.acrescimoCentavos),
    taxaEntrega: 0,
    formaDePagamento: umaForma ? rotuloDaForma(unica) : "Dividido",
    // Uma forma só: a linha cobre o total; o dinheiro entregue vira o "troco para".
    pagamentos: umaForma ? null : v.pagamentos.map((p) => ({ forma: rotuloDaForma(p), valor: reais(p.valorCentavos) })),
    trocoPara: umaForma && unica.forma === "DINHEIRO" && v.trocoCentavos > 0 ? reais(unica.valorCentavos) : null,
    documentoDoCliente: v.cpf,
    nomeDoCliente: v.nomeCliente,
    entregaEmDomicilio: false,
    canal: null,
    pagoOnline: false,
  };
}

export type HoraDaNota =
  | { tipo: "normal" }
  | { tipo: "sem_conexao"; em: Date; motivo: string }
  | { tipo: "fora_do_prazo"; vendaEm: Date; prazo: Date };

/**
 * Normal ou contingência pela hora da venda (ver o cabeçalho). `prazo` é o da
 * transmissão da contingência para a UF da loja (prazoDaContingencia).
 */
export function horaDaNota(vendaEm: Date, agora: Date, prazo: (emitidaEm: Date) => Date): HoraDaNota {
  if (agora.getTime() - vendaEm.getTime() <= ATRASO_DA_EMISSAO_NORMAL_MS) return { tipo: "normal" };
  const limite = prazo(vendaEm);
  if (agora.getTime() > limite.getTime()) return { tipo: "fora_do_prazo", vendaEm, prazo: limite };
  return { tipo: "sem_conexao", em: vendaEm, motivo: "Sem conexao com a internet no ponto de venda no momento da venda" };
}
