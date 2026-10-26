/**
 * A ETIQUETA DE VALIDADE: tipo, conservação, prazo, data e hora, vencimento.
 *
 * O que a vigilância lê no pote (RDC 216/2004; Portaria CVS 3/2026 de SP, que
 * vale a partir de 01/02/2027): o nome do produto, a data da manipulação — com
 * a HORA quando o prazo é de horas (arroz temperado, art. 63) —, a validade, o
 * modo de conservação e, no produto aberto, a marca e o fornecedor (art. 37).
 *
 * Antes daqui a conservação saía sempre "congelado": a chave do texto nascia
 * em `conservacaoCongelado` e nada a trocava, nem no molho da geladeira. Agora
 * ela sai do PRODUTO (`KitchenItem.conservacao`) ou da escolha da tela.
 *
 * Sem React e sem Prisma de propósito: roda no node puro, no teste.
 *
 * FUSO: as contas de dia são no fuso de São Paulo, como o resto do sistema
 * (`todayStr` da tela, `diasParaVencer` do lote). Todas recebem `tz` para o
 * teste conseguir fixar.
 */
import { textoDeConservacao, type ChaveDeTexto } from "@/lib/etiqueta-campos";

export const FUSO_PADRAO = "America/Sao_Paulo";

export const TIPOS_DE_ETIQUETA = ["MANIPULADO", "ABERTO", "DESCONGELANDO", "AMOSTRA"] as const;
export type TipoDeEtiqueta = (typeof TIPOS_DE_ETIQUETA)[number];

export const NOME_DO_TIPO: Record<TipoDeEtiqueta, string> = {
  MANIPULADO: "Manipulado / preparado",
  ABERTO: "Produto aberto",
  DESCONGELANDO: "Descongelando",
  AMOSTRA: "Amostra",
};

/** O que vai escrito no papel, na faixa do topo. */
export const FAIXA_DO_TIPO: Record<TipoDeEtiqueta, string> = {
  MANIPULADO: "MANIPULADO",
  ABERTO: "PRODUTO ABERTO",
  DESCONGELANDO: "DESCONGELANDO",
  AMOSTRA: "AMOSTRA",
};

/** A palavra da data, por tipo. No aberto, a data da etiqueta É a da abertura/transferência (art. 37). */
export const ROTULO_DA_DATA: Record<TipoDeEtiqueta, string> = {
  MANIPULADO: "Preparado em",
  ABERTO: "Aberto em",
  DESCONGELANDO: "Descongelando desde",
  AMOSTRA: "Coletada em",
};

export const CONSERVACOES = ["REFRIGERADO", "CONGELADO", "AMBIENTE", "DESCONGELANDO"] as const;
export type Conservacao = (typeof CONSERVACOES)[number];

export const NOME_DA_CONSERVACAO: Record<Conservacao, string> = {
  AMBIENTE: "Temperatura ambiente",
  REFRIGERADO: "Refrigerado",
  CONGELADO: "Congelado",
  DESCONGELANDO: "Descongelando sob refrigeração",
};

/** Qual texto (editável pela loja, em `labelFieldsConfig.textos`) cada conservação usa. */
export const CHAVE_DE_TEXTO_DA_CONSERVACAO: Record<Conservacao, ChaveDeTexto> = {
  AMBIENTE: "conservacaoAmbiente",
  REFRIGERADO: "conservacaoResfriado",
  CONGELADO: "conservacaoCongelado",
  DESCONGELANDO: "conservacaoDescongelando",
};

export type UnidadeDePrazo = "h" | "d";
export type Prazo = { valor: number; unidade: UnidadeDePrazo; temperatura?: string };
export type PrazosDoItem = Partial<Record<Conservacao, Prazo>>;

export function lerTipo(v: unknown): TipoDeEtiqueta {
  const s = String(v || "").trim().toUpperCase();
  return (TIPOS_DE_ETIQUETA as readonly string[]).includes(s) ? (s as TipoDeEtiqueta) : "MANIPULADO";
}

export function lerConservacao(v: unknown): Conservacao | null {
  const s = String(v || "").trim().toUpperCase();
  return (CONSERVACOES as readonly string[]).includes(s) ? (s as Conservacao) : null;
}

/** "Descongelando" é tipo E conservação: escolher o tipo já decide como guardar. */
export function conservacaoDaEtiqueta(tipo: TipoDeEtiqueta, escolhida: Conservacao | null): Conservacao | null {
  return tipo === "DESCONGELANDO" ? "DESCONGELANDO" : escolhida;
}

const LIMITE: Record<UnidadeDePrazo, number> = { h: 720, d: 3650 };

/** Só o que é prazo de verdade passa: número inteiro positivo, "h" ou "d". */
export function sanitizarPrazos(entrada: unknown): PrazosDoItem | null {
  const e = entrada && typeof entrada === "object" ? (entrada as Record<string, any>) : {};
  const limpo: PrazosDoItem = {};
  for (const c of CONSERVACOES) {
    const p = e[c];
    if (!p || typeof p !== "object") continue;
    const unidade: UnidadeDePrazo = p.unidade === "h" ? "h" : "d";
    const valor = Math.floor(Number(p.valor));
    if (!Number.isFinite(valor) || valor <= 0 || valor > LIMITE[unidade]) continue;
    const temperatura = typeof p.temperatura === "string" ? p.temperatura.trim().slice(0, 40) : "";
    limpo[c] = temperatura ? { valor, unidade, temperatura } : { valor, unidade };
  }
  return Object.keys(limpo).length ? limpo : null;
}

/**
 * O prazo que vale para esta conservação.
 *
 * O prazo próprio da conservação vence. Sem ele, o antigo "Validade em dias"
 * (`shelfLifeDays`) só vale para a conservação PADRÃO do item — ou, no item
 * que ainda não tem padrão, para qualquer uma menos "descongelando". Usar os
 * 90 dias do freezer na etiqueta do que está descongelando seria a validade
 * mais perigosa que este programa poderia imprimir; sem prazo, a tela pede a
 * validade à mão.
 */
export function prazoDaConservacao(
  item: { prazos?: unknown; shelfLifeDays?: number | null; conservacao?: string | null } | null | undefined,
  c: Conservacao | null,
): Prazo | null {
  if (!item || !c) return null;
  const proprio = sanitizarPrazos(item.prazos)?.[c];
  if (proprio) return proprio;
  const padrao = lerConservacao(item.conservacao);
  const vale = padrao ? c === padrao : c !== "DESCONGELANDO";
  const dias = Math.floor(Number(item.shelfLifeDays));
  return vale && dias > 0 ? { valor: dias, unidade: "d" } : null;
}

// ── Relógio no fuso da loja ───────────────────────────────────────────────

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number };

function partesNoFuso(d: Date, tz: string): Partes {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) p[x.type] = x.value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, minuto: +p.minute };
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" do instante, no fuso da loja. */
export function diaLocal(d: Date, tz = FUSO_PADRAO): string {
  const p = partesNoFuso(d, tz);
  return `${p.ano}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)}`;
}

/** "YYYY-MM-DDTHH:MM" do instante, no fuso da loja — o valor de um <input type="datetime-local">. */
export function horaLocal(d: Date, tz = FUSO_PADRAO): string {
  const p = partesNoFuso(d, tz);
  return `${diaLocal(d, tz)}T${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`;
}

/** O instante de um relógio de parede ("YYYY-MM-DDTHH:MM") no fuso da loja. */
export function instanteDaHoraLocal(valor: string, tz = FUSO_PADRAO): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(valor || ""));
  if (!m) return null;
  const alvo = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const desvio = (t: number) => {
    const p = partesNoFuso(new Date(t), tz);
    return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto) - t;
  };
  let t = alvo - desvio(alvo);
  t = alvo - desvio(t); // segunda passada: acerta a virada de horário de verão
  return Number.isFinite(t) ? new Date(t) : null;
}

export function somarDias(dia: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return dia;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
}

/** 23:59:59 do dia, no fuso da loja: o prazo em DIAS vale até o fim do dia impresso. */
export function fimDoDiaLocal(dia: string, tz = FUSO_PADRAO): Date | null {
  const i = instanteDaHoraLocal(`${dia}T23:59`, tz);
  return i ? new Date(i.getTime() + 59_999) : null;
}

/**
 * Quando vence, a partir da manipulação.
 *
 * Em HORAS: a hora exata (o molho de 6 h preparado às 14h vence às 20h, e o
 * papel diz a hora). Em DIAS: o fim do dia de calendário — preparado dia 26
 * com 3 dias vale até o fim do dia 29, que é o que "Validade: 29/10" diz.
 */
export function calcularVencimento(manipuladoEm: Date, prazo: Prazo, tz = FUSO_PADRAO): { venceEm: Date; comHora: boolean } {
  if (prazo.unidade === "h") {
    return { venceEm: new Date(manipuladoEm.getTime() + prazo.valor * 3_600_000), comHora: true };
  }
  return { venceEm: fimDoDiaLocal(somarDias(diaLocal(manipuladoEm, tz), prazo.valor), tz)!, comHora: false };
}

export function formatarData(d: Date | null | undefined, tz = FUSO_PADRAO): string {
  if (!d || isNaN(d.getTime())) return "--";
  const [a, m, dd] = diaLocal(d, tz).split("-");
  return `${dd}/${m}/${a}`;
}

export function formatarDataHora(d: Date | null | undefined, tz = FUSO_PADRAO): string {
  if (!d || isNaN(d.getTime())) return "--";
  return `${formatarData(d, tz)} ${horaLocal(d, tz).slice(11)}`;
}

// ── O que vai no papel ────────────────────────────────────────────────────

/** Tudo o que a etiqueta precisa saber da manipulação — igual na primeira impressão e na reimpressão. */
export type DadosDoPapel = {
  tipo: TipoDeEtiqueta;
  conservacao: Conservacao | null;
  manipuladoEm: Date | null;
  /** Lote antigo, de antes da hora: só tinha o dia. */
  manipulacaoComHora: boolean;
  venceEm: Date | null;
  comHora: boolean;
  responsavel: string;
  lote: string;
  marca: string;
  fornecedor: string;
};

export function textosDasDatas(d: DadosDoPapel, opcoes: { paraVenda?: boolean; tz?: string } = {}) {
  const tz = opcoes.tz || FUSO_PADRAO;
  return {
    // Produto embalado para venda continua com o "Fabricado em" de sempre.
    rotuloDaData: d.tipo === "MANIPULADO" && opcoes.paraVenda ? "Fabricado em" : ROTULO_DA_DATA[d.tipo],
    data: d.manipulacaoComHora ? formatarDataHora(d.manipuladoEm, tz) : formatarData(d.manipuladoEm, tz),
    validade: d.comHora ? formatarDataHora(d.venceEm, tz) : formatarData(d.venceEm, tz),
  };
}

/**
 * O texto da conservação no papel. A temperatura cadastrada no PRODUTO vence o
 * texto genérico da loja: o peixe é "até 2 °C", não o "entre 0 e 4 °C" geral.
 */
export function textoDaConservacaoNoPapel(layout: unknown, c: Conservacao | null, temperatura?: string | null): string {
  if (!c) return "";
  const t = String(temperatura || "").trim();
  return t ? `${NOME_DA_CONSERVACAO[c]}: ${t}` : textoDeConservacao(layout, CHAVE_DE_TEXTO_DA_CONSERVACAO[c]);
}

// ── Tabela de referência (Portaria CVS 3/2026, art. 44) ──────────────────

/**
 * Prazos padrão da Portaria CVS 3/2026 (SP), art. 44: valem na falta de
 * instrução do fabricante e para o que é preparado na loja. É SUGESTÃO — a
 * tela diz que a loja confere com a vigilância da sua cidade.
 */
export const PRAZOS_DE_REFERENCIA: { id: string; nome: string; conservacao: Conservacao; prazo: Prazo }[] = [
  { id: "pescado-cru", nome: "Pescados e manipulados crus", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 2 °C" } },
  { id: "pescado-cozido", nome: "Pescados pós-cocção", conservacao: "REFRIGERADO", prazo: { valor: 1, unidade: "d", temperatura: "até 2 °C" } },
  { id: "pos-coccao", nome: "Alimentos pós-cocção (exceto pescados)", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 4 °C" } },
  { id: "carne-crua", nome: "Carnes bovina, suína, aves e manipulados crus", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 4 °C" } },
  { id: "carne-temperada", nome: "Carne moída, temperada crua, espetos mistos, bife rolê", conservacao: "REFRIGERADO", prazo: { valor: 2, unidade: "d", temperatura: "até 4 °C" } },
  { id: "frios", nome: "Frios e embutidos fatiados, picados ou moídos", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 4 °C" } },
  { id: "maionese", nome: "Maionese e misturas com maionese", conservacao: "REFRIGERADO", prazo: { valor: 2, unidade: "d", temperatura: "até 4 °C" } },
  { id: "sobremesa", nome: "Sobremesas, confeitaria com recheio ou cobertura, preparações com laticínios", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 4 °C" } },
  { id: "demais", nome: "Demais preparações", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 4 °C" } },
  { id: "hortifruti", nome: "Frutas, verduras e legumes higienizados ou fracionados; sucos e polpas", conservacao: "REFRIGERADO", prazo: { valor: 3, unidade: "d", temperatura: "até 5 °C" } },
  { id: "congelado-0-5", nome: "Congelado de 0 a −5 °C", conservacao: "CONGELADO", prazo: { valor: 10, unidade: "d", temperatura: "0 a −5 °C" } },
  { id: "congelado-6-10", nome: "Congelado de −6 a −10 °C", conservacao: "CONGELADO", prazo: { valor: 20, unidade: "d", temperatura: "−6 a −10 °C" } },
  { id: "congelado-11-18", nome: "Congelado de −11 a −18 °C", conservacao: "CONGELADO", prazo: { valor: 30, unidade: "d", temperatura: "−11 a −18 °C" } },
  { id: "congelado-18", nome: "Congelado abaixo de −18 °C", conservacao: "CONGELADO", prazo: { valor: 90, unidade: "d", temperatura: "abaixo de −18 °C" } },
];

// ── O lote gravado: reimpressão, vencimento, histórico ───────────────────

/** O lote como a tela recebe da action `listarEtiquetas` (datas podem chegar como string). */
export type LoteDaEtiqueta = {
  code: string;
  productName: string;
  kitchenItemId?: string | null;
  stockItemId?: string | null;
  franchiseeId?: string | null;
  recebidoPorId?: string | null;
  tipoEtiqueta?: string | null;
  conservacao?: string | null;
  manipuladoEm?: Date | string | null;
  venceEm?: Date | string | null;
  validadeComHora?: boolean | null;
  fabricadoEm?: Date | string | null;
  validoAte?: Date | string | null;
  responsavel?: string | null;
  loteRef?: string | null;
  marca?: string | null;
  fornecedor?: string | null;
  impressoes?: number | null;
  status?: string | null;
  quantidadeRestante?: number | null;
  unit?: string | null;
  createdAt?: Date | string | null;
};

const comoData = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** `fabricadoEm`/`validoAte` guardam o DIA como meia-noite UTC: as partes são lidas em UTC. */
const diaGravado = (v: Date | string | null | undefined): string | null => comoData(v)?.toISOString().slice(0, 10) ?? null;

/** O instante em que a etiqueta vence. Lote antigo (só o dia) vence no fim daquele dia. */
export function instanteDoVencimento(lote: LoteDaEtiqueta, tz = FUSO_PADRAO): Date | null {
  const exato = comoData(lote.venceEm);
  if (exato) return exato;
  const dia = diaGravado(lote.validoAte);
  return dia ? fimDoDiaLocal(dia, tz) : null;
}

/**
 * O papel da REIMPRESSÃO: sai do lote gravado e de mais nada.
 *
 * Não recebe o produto nem o relógio — de propósito. A Portaria CVS 3/2026,
 * art. 46, veda revalidar; a autuação clássica é a bisnaga de molho com
 * etiqueta nova "apondo-se novo período de seis horas". Se o prazo do produto
 * mudou depois, a etiqueta reimpressa continua com a validade da primeira.
 */
export function dadosDaReimpressao(lote: LoteDaEtiqueta, tz = FUSO_PADRAO): DadosDoPapel {
  const manipulado = comoData(lote.manipuladoEm);
  const diaAntigo = diaGravado(lote.fabricadoEm);
  return {
    tipo: lerTipo(lote.tipoEtiqueta),
    conservacao: lerConservacao(lote.conservacao),
    // Lote antigo só tem o dia: meio-dia no fuso da loja imprime o dia certo.
    manipuladoEm: manipulado ?? (diaAntigo ? instanteDaHoraLocal(`${diaAntigo}T12:00`, tz) : null),
    manipulacaoComHora: !!manipulado,
    venceEm: instanteDoVencimento(lote, tz),
    comHora: !!lote.validadeComHora,
    responsavel: lote.responsavel || "",
    lote: lote.loteRef || lote.code || "",
    marca: lote.marca || "",
    fornecedor: lote.fornecedor || "",
  };
}

export type SituacaoDoVencimento = "venceu" | "hoje" | "amanha" | "depois" | "semValidade";

export function situacaoDoVencimento(lote: LoteDaEtiqueta, agora = new Date(), tz = FUSO_PADRAO): SituacaoDoVencimento {
  const v = instanteDoVencimento(lote, tz);
  if (!v) return "semValidade";
  // Pela HORA: o molho que venceu às 18h já está vencido às 18h01, no mesmo dia.
  if (v.getTime() <= agora.getTime()) return "venceu";
  const hoje = diaLocal(agora, tz);
  const dia = diaLocal(v, tz);
  if (dia === hoje) return "hoje";
  if (dia === somarDias(hoje, 1)) return "amanha";
  return "depois";
}

/** As três listas da tela, cada uma pelo que vence primeiro. */
export function agruparVencimentos<T extends LoteDaEtiqueta>(lotes: T[], agora = new Date(), tz = FUSO_PADRAO) {
  const grupos = { venceu: [] as T[], hoje: [] as T[], amanha: [] as T[] };
  const quando = (l: T) => instanteDoVencimento(l, tz)?.getTime() ?? 0;
  for (const l of [...lotes].sort((a, b) => quando(a) - quando(b))) {
    if (l.status && l.status !== "ATIVO") continue;
    const s = situacaoDoVencimento(l, agora, tz);
    if (s === "venceu" || s === "hoje" || s === "amanha") grupos[s].push(l);
  }
  return grupos;
}

/**
 * Como fechar o lote no "usei" / "descartei".
 *
 * ESTOQUE: o QR já deu entrada nesta loja — a baixa vai pela rota do QR
 * (/api/lote/<código>), e o descarte vira WASTE, que o Desperdício já conta.
 * SO_ETIQUETA: nada entrou no estoque (sem QR, ou ninguém escaneou) — só o
 * lote muda de situação; o descarte entra no Desperdício sem valor.
 * OUTRA_LOJA: a mercadoria foi recebida por outra loja; quem fecha é ela.
 */
export function comoFechar(lote: LoteDaEtiqueta, lojaId: string): "ESTOQUE" | "SO_ETIQUETA" | "OUTRA_LOJA" {
  if (lote.recebidoPorId && lote.recebidoPorId !== lojaId) return "OUTRA_LOJA";
  if (lote.recebidoPorId === lojaId && lote.stockItemId && Number(lote.quantidadeRestante) > 0) return "ESTOQUE";
  return "SO_ETIQUETA";
}

const SITUACAO_DO_STATUS: Record<string, string> = { CONSUMIDO: "Usada", DESCARTADO: "Descartada", VENCIDO: "Vencida" };

export function situacaoNoHistorico(lote: LoteDaEtiqueta, agora = new Date(), tz = FUSO_PADRAO): string {
  if (lote.status && SITUACAO_DO_STATUS[lote.status]) return SITUACAO_DO_STATUS[lote.status];
  return situacaoDoVencimento(lote, agora, tz) === "venceu" ? "Vencida" : "Em uso";
}

const celula = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * O histórico em CSV para o Excel brasileiro: ponto e vírgula, BOM de UTF-8
 * (sem ele o Excel mostra "Ã§" no lugar de "ç") e quebra de linha CRLF.
 */
export function csvDoHistorico(lotes: LoteDaEtiqueta[], agora = new Date(), tz = FUSO_PADRAO): string {
  const cabecalho = [
    "Emitida em", "Produto", "Tipo", "Conservação", "Manipulação", "Validade", "Responsável",
    "Lote", "Código", "Impressões", "Situação", "Marca", "Fornecedor",
  ];
  const linhas = lotes.map((l) => {
    const d = dadosDaReimpressao(l, tz);
    const t = textosDasDatas(d, { tz });
    return [
      formatarDataHora(comoData(l.createdAt), tz), l.productName, NOME_DO_TIPO[d.tipo],
      d.conservacao ? NOME_DA_CONSERVACAO[d.conservacao] : "", t.data, t.validade, d.responsavel,
      l.loteRef || "", l.code, l.impressoes ?? 1, situacaoNoHistorico(l, agora, tz), d.marca, d.fornecedor,
    ];
  });
  return "﻿" + [cabecalho, ...linhas].map((r) => r.map(celula).join(";")).join("\r\n") + "\r\n";
}
