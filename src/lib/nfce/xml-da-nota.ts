/**
 * /src/lib/nfce/xml-da-nota.ts
 *
 * TRADUTOR puro: o corpo que `montarCorpoDaNfce` (lib/fiscal-emissao.ts)
 * monta no formato da Focus NFe → o XML oficial da NFC-e (modelo 65, leiaute
 * 4.00), elemento `<NFe>` com o `<infNFe>` pronto para assinar.
 *
 * Por que traduzir em vez de montar de novo a partir do pedido: TODAS as
 * regras de negócio (rateio de desconto e taxa em centavos, CFOP/CSOSN,
 * presença, destinatário, intermediador, formas de pagamento, troco, cupom
 * pago pela plataforma) já moram em `montarCorpoDaNfce`, com 175 casos
 * testados. Este arquivo NÃO decide nada de negócio: só põe cada campo na tag
 * certa, na ordem do schema, e confere que as somas fecham (a mesma conta que
 * a SEFAZ faz). Se um campo novo aparecer no corpo sem tradução aqui, a nota
 * é RECUSADA com a pendência — melhor que sumir em silêncio.
 *
 * Fontes dos nomes e da ordem das tags: MOC 7.0 Anexo I (leiaute e regras de
 * validação) e o schema PL_010f (leiauteNFe_v4.00.xsd); o teste
 * (scripts/teste-nfce-xml.ts) valida cada nota montada contra o XSD oficial.
 * Mapa Focus → tag conferido em https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html.
 *
 * O que vem de FORA do corpo (o corpo da Focus não tem): UF/cUF, ambiente,
 * série e número, tipo de emissão, cNF, fuso da loja, complemento e telefone
 * do emitente, responsável técnico — tudo no `ContextoDaNota`.
 */
import type { Problema } from "../fiscal-validacao";
import { cnpjValido, cpfValido } from "../fiscal-validacao";
import { codigoDaUf, gerarCodigoNumerico, idDaNota, montarChave } from "./chave";
import { NS_NFE, dec2, emCentavos, grupo, tag, textoDaSefaz } from "./xml";

export const VERSAO_DO_LEIAUTE = "4.00";
/** verProc: "versão do aplicativo emissor" (B27, 1 a 20 caracteres). */
export const VERSAO_DO_EMISSOR = "FireHub NFC-e 1.0";

/** Literais obrigatórias em homologação (MOC 7.0 Anexo I, regras E04 598 e I04-10 373 — NT 2015.002). */
export const NOME_EM_HOMOLOGACAO = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
export const ITEM_EM_HOMOLOGACAO = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/** Fuso de cada UF (IANA). O dhEmi vai na hora LOCAL da loja, com o offset (TDateTimeUTC). */
export const FUSO_DA_UF: Record<string, string> = {
  AC: "America/Rio_Branco", AL: "America/Maceio", AM: "America/Manaus", AP: "America/Belem", BA: "America/Bahia",
  CE: "America/Fortaleza", DF: "America/Sao_Paulo", ES: "America/Sao_Paulo", GO: "America/Sao_Paulo",
  MA: "America/Fortaleza", MG: "America/Sao_Paulo", MS: "America/Campo_Grande", MT: "America/Cuiaba",
  PA: "America/Belem", PB: "America/Fortaleza", PE: "America/Recife", PI: "America/Fortaleza",
  PR: "America/Sao_Paulo", RJ: "America/Sao_Paulo", RN: "America/Fortaleza", RO: "America/Porto_Velho",
  RR: "America/Boa_Vista", RS: "America/Sao_Paulo", SC: "America/Sao_Paulo", SE: "America/Maceio",
  SP: "America/Sao_Paulo", TO: "America/Araguaina",
};

/**
 * Data e hora no fuso informado, no formato do layout: "2026-09-29T20:15:03-03:00"
 * (sem milissegundos; offset calculado pelo Intl, não fixo).
 */
export function dataHoraNoFuso(quando: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(quando);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const nome = p("timeZoneName"); // "GMT-03:00" (ou "GMT" em UTC)
  const offset = nome === "GMT" ? "+00:00" : nome.replace("GMT", "");
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}${offset}`;
}

export type ResponsavelTecnico = { cnpj: string; contato: string; email: string; telefone: string };

export type ContextoDaNota = {
  /** Sigla da UF do emitente ("DF"). Dá o cUF, o fuso e confere a UF do corpo. */
  uf: string;
  /** 1 = produção, 2 = homologação. */
  ambiente: 1 | 2;
  serie: number;
  numero: number;
  /** 1 = normal (padrão); 9 = contingência off-line da NFC-e. */
  tipoDeEmissao?: 1 | 9;
  /** Obrigatório com tipoDeEmissao 9 (B28 dhCont e B29 xJust — Manual de contingência 2.0, item 2). */
  contingencia?: { entradaEm: Date; justificativa: string } | null;
  /** cNF. Sem ele, sorteia. Na retransmissão de contingência é o MESMO da nota original. */
  codigoNumerico?: string;
  /** Momento da emissão. Sem ele, vale o `data_emissao` do corpo. */
  dataDeEmissao?: Date;
  /** Fuso IANA; o padrão é o da UF. */
  fuso?: string;
  verProc?: string;
  /** O que o corpo da Focus não traz do emitente. */
  emitente?: {
    inscricaoEstadual?: string | null;
    complemento?: string | null;
    telefone?: string | null;
  } | null;
  /** infRespTec (ZD01). Facultativo por UF — a UF que exige rejeita com 972. */
  responsavelTecnico?: ResponsavelTecnico | null;
  /**
   * Código IBGE do município do DESTINATÁRIO quando ele mora em outra cidade.
   * O corpo só traz o código quando é a cidade da loja (a Focus completava o
   * resto pelo nome); aqui quem completa é quem chama.
   */
  codigoDoMunicipio?: ((municipio: string, uf: string) => string | null) | null;
};

export type NotaMontada =
  | {
      ok: true;
      /** `<NFe xmlns=...><infNFe ...>...</infNFe></NFe>` — sem Signature e sem infNFeSupl. */
      xml: string;
      chave: string;
      id: string;
      codigoNumerico: string;
      dhEmi: string;
      tipoDeEmissao: 1 | 9;
      totalEmCentavos: number;
      /** Para o QR v3 offline (tipo 1 = CNPJ, 2 = CPF). */
      destinatario: { tipo: 1 | 2; id: string } | null;
    }
  | { ok: false; mensagem: string; pendencias: Problema[] };

// ─── Campos conhecidos do corpo ─────────────────────────────────────────────
// Tudo que montarCorpoDaNfce pode pôr no corpo. Campo fora destas listas =
// pendência: o tradutor não sabe onde ele vai, e não vai jogar fora calado.

const CAMPOS_DA_NOTA = new Set([
  "natureza_operacao", "data_emissao", "tipo_documento", "finalidade_emissao", "local_destino",
  "presenca_comprador", "consumidor_final", "modalidade_frete", "cnpj_transportador", "cpf_transportador",
  "nome_transportador", "inscricao_estadual_transportador", "endereco_transportador", "municipio_transportador",
  "uf_transportador", "indicador_intermediario",
  "cnpj_intermediario", "id_intermediario", "cnpj_emitente", "nome_emitente", "nome_fantasia_emitente",
  "inscricao_estadual_emitente", "regime_tributario_emitente", "logradouro_emitente", "numero_emitente",
  "bairro_emitente", "municipio_emitente", "codigo_municipio_emitente", "uf_emitente", "cep_emitente",
  "serie", "cpf_destinatario", "cnpj_destinatario", "indicador_inscricao_estadual_destinatario",
  "nome_destinatario", "logradouro_destinatario", "numero_destinatario", "complemento_destinatario",
  "bairro_destinatario", "municipio_destinatario", "uf_destinatario", "codigo_municipio_destinatario",
  "cep_destinatario", "valor_produtos", "valor_desconto", "valor_outras_despesas", "valor_total",
  "informacoes_adicionais_contribuinte", "items", "formas_pagamento", "valor_troco",
]);
const CAMPOS_DO_ITEM = new Set([
  "numero_item", "codigo_produto", "descricao", "cfop", "codigo_ncm", "cest", "unidade_comercial",
  "quantidade_comercial", "valor_unitario_comercial", "valor_bruto", "unidade_tributavel",
  "quantidade_tributavel", "valor_unitario_tributavel", "icms_origem", "icms_situacao_tributaria",
  "pis_situacao_tributaria", "cofins_situacao_tributaria", "valor_desconto", "valor_outras_despesas",
  "inclui_no_total",
]);
const CAMPOS_DO_PAGAMENTO = new Set(["forma_pagamento", "valor_pagamento", "descricao_pagamento", "tipo_integracao", "bandeira_operadora"]);

// ─── Formatação ─────────────────────────────────────────────────────────────

/** Quantidade (TDec_1104v): até 4 casas. */
function quantidade(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = n.toFixed(4);
  return Number(s) === 0 ? null : s;
}

/**
 * Valor unitário (TDec_1110v, até 10 casas) que fecha com o vProd.
 *
 * A regra I11-10 (rejeição 629) confere vProd = qCom × vUnCom. O corpo manda o
 * unitário arredondado em centavos; quando 3 × 7,24 não dá o vProd rateado do
 * combo, o unitário vai com as casas que precisar (até 10) — é o próprio
 * layout que prevê as 10 casas para isso.
 */
function valorUnitario(vUnInformado: unknown, qtd: number, vProdCentavos: number): string {
  const informado = Number(vUnInformado);
  const usar =
    Number.isFinite(informado) && informado > 0 && Math.round(informado * qtd * 100) === vProdCentavos
      ? informado
      : vProdCentavos / 100 / qtd;
  // Até 10 casas, sem zeros sobrando, mas nunca menos de 2 ("7.24", "7.2433333333").
  const [inteiro, fracao = ""] = usar.toFixed(10).replace(/0+$/, "").split(".");
  return `${inteiro}.${fracao.padEnd(2, "0")}`;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** Diacríticos combinantes (U+0300–U+036F), montados por código para não esconder caractere invisível no fonte. */
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const semAcento = (s: string) => s.normalize("NFD").replace(DIACRITICOS, "").toLowerCase().trim();

// ─── Montagem ───────────────────────────────────────────────────────────────

export function montarXmlDaNfce(corpoBruto: Record<string, unknown>, ctx: ContextoDaNota): NotaMontada {
  const corpo = corpoBruto as Record<string, any>;
  const pendencias: Problema[] = [];
  const falta = (campo: string, mensagem: string, valor: unknown = null) =>
    pendencias.push({ campo, valor: valor == null ? null : String(valor), mensagem });

  // ── Campos que o tradutor não conhece ────────────────────────────────────
  for (const k of Object.keys(corpo)) if (!CAMPOS_DA_NOTA.has(k)) falta(k, `Campo "${k}" do corpo não tem tradução para o XML.`);
  const itens: Record<string, any>[] = Array.isArray(corpo.items) ? corpo.items : [];
  const pagamentos: Record<string, any>[] = Array.isArray(corpo.formas_pagamento) ? corpo.formas_pagamento : [];
  itens.forEach((it, i) => Object.keys(it).forEach((k) => !CAMPOS_DO_ITEM.has(k) && falta(`items[${i}].${k}`, `Campo "${k}" do item não tem tradução para o XML.`)));
  pagamentos.forEach((p, i) => Object.keys(p).forEach((k) => !CAMPOS_DO_PAGAMENTO.has(k) && falta(`formas_pagamento[${i}].${k}`, `Campo "${k}" do pagamento não tem tradução para o XML.`)));

  // ── Contexto ─────────────────────────────────────────────────────────────
  const uf = String(ctx.uf ?? "").trim().toUpperCase();
  const cUF = codigoDaUf(uf);
  if (!cUF) falta("uf", `UF do emitente desconhecida: "${ctx.uf}".`, ctx.uf);
  if (corpo.uf_emitente && String(corpo.uf_emitente).toUpperCase() !== uf) {
    falta("uf_emitente", `A UF do cadastro fiscal (${corpo.uf_emitente}) não é a UF do emissor (${uf}).`, corpo.uf_emitente);
  }
  if (ctx.ambiente !== 1 && ctx.ambiente !== 2) falta("ambiente", "Ambiente tem de ser 1 (produção) ou 2 (homologação).", ctx.ambiente);
  const homologacao = ctx.ambiente === 2;
  const serie = Number(ctx.serie ?? corpo.serie);
  // Emissão pelo contribuinte (procEmi 0) com emitente CNPJ: série de 0 a 889
  // (MOC 7.0, Anexo I: B26-10, rejeição 244, e C02-30, rejeição 503).
  if (!(Number.isInteger(serie) && serie >= 0 && serie <= 889)) falta("serie", "Série da NFC-e fora de 0–889 (rejeições 244 e 503).", ctx.serie);
  if (corpo.serie != null && Number(corpo.serie) !== serie) falta("serie", `A série do corpo (${corpo.serie}) não é a do contexto (${serie}).`, corpo.serie);
  const numero = Number(ctx.numero);
  if (!(Number.isInteger(numero) && numero >= 1 && numero <= 999_999_999)) falta("numero", "Número da NFC-e fora de 1–999999999.", ctx.numero);

  const tpEmis: 1 | 9 = ctx.tipoDeEmissao === 9 ? 9 : 1;
  const fuso = ctx.fuso || FUSO_DA_UF[uf] || "America/Sao_Paulo";
  let dhCont = "";
  let xJust = "";
  if (tpEmis === 9) {
    if (!ctx.contingencia?.entradaEm) falta("dhCont", "Nota em contingência precisa da data/hora de entrada em contingência (dhCont).");
    else dhCont = dataHoraNoFuso(ctx.contingencia.entradaEm, fuso);
    xJust = textoDaSefaz(ctx.contingencia?.justificativa, 256);
    if (xJust.length < 15) falta("xJust", "Justificativa da contingência com menos de 15 caracteres (B29).", xJust);
  }

  let dhEmi: string;
  if (ctx.dataDeEmissao) dhEmi = dataHoraNoFuso(ctx.dataDeEmissao, fuso);
  else if (typeof corpo.data_emissao === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(corpo.data_emissao)) dhEmi = corpo.data_emissao;
  else dhEmi = dataHoraNoFuso(new Date(), fuso);
  const anoMes = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);

  // ── Emitente ─────────────────────────────────────────────────────────────
  const cnpj = String(corpo.cnpj_emitente ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!cnpjValido(cnpj)) falta("cnpj_emitente", "CNPJ do emitente inválido.", cnpj);
  const xNomeEmit = textoDaSefaz(corpo.nome_emitente, 60);
  if (xNomeEmit.length < 2) falta("nome_emitente", "Razão social do emitente vazia.");
  const xFant = textoDaSefaz(corpo.nome_fantasia_emitente, 60);
  const ie = String(ctx.emitente?.inscricaoEstadual ?? corpo.inscricao_estadual_emitente ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^([0-9]{2,14}|ISENTO)$/.test(ie)) falta("inscricao_estadual_emitente", "Inscrição estadual do emitente inválida (2 a 14 dígitos).", ie);
  const crt = Number(corpo.regime_tributario_emitente);
  if (![1, 2, 3, 4].includes(crt)) falta("regime_tributario_emitente", "Regime tributário (CRT) tem de ser 1, 2, 3 ou 4.", corpo.regime_tributario_emitente);
  const simples = crt === 1 || crt === 4;

  const xLgrEmit = textoDaSefaz(corpo.logradouro_emitente, 60);
  const nroEmit = textoDaSefaz(corpo.numero_emitente, 60) || "SN";
  const xBairroEmit = textoDaSefaz(corpo.bairro_emitente, 60);
  const cMunEmit = soDigitos(corpo.codigo_municipio_emitente);
  const xMunEmit = textoDaSefaz(corpo.municipio_emitente, 60);
  const cepEmit = soDigitos(corpo.cep_emitente);
  if (xLgrEmit.length < 2) falta("logradouro_emitente", "Logradouro do emitente vazio.");
  if (xBairroEmit.length < 2) falta("bairro_emitente", "Bairro do emitente vazio.");
  if (!/^\d{7}$/.test(cMunEmit)) falta("codigo_municipio_emitente", "Código IBGE do município do emitente inválido.", cMunEmit);
  else if (cUF && cMunEmit.slice(0, 2) !== cUF) falta("codigo_municipio_emitente", `O município ${cMunEmit} não é da UF ${uf}.`, cMunEmit);
  if (xMunEmit.length < 2) falta("municipio_emitente", "Município do emitente vazio.");
  if (!/^\d{8}$/.test(cepEmit)) falta("cep_emitente", "CEP do emitente inválido.", cepEmit);
  const foneEmit = soDigitos(ctx.emitente?.telefone);

  // ── Destinatário ─────────────────────────────────────────────────────────
  const cpfDest = soDigitos(corpo.cpf_destinatario);
  const cnpjDest = String(corpo.cnpj_destinatario ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cpfDest && !cpfValido(cpfDest)) falta("cpf_destinatario", "CPF do destinatário inválido.", cpfDest);
  if (cnpjDest && !cnpjValido(cnpjDest)) falta("cnpj_destinatario", "CNPJ do destinatário inválido.", cnpjDest);
  const temEndereco = Boolean(corpo.logradouro_destinatario);
  const temDestinatario = Boolean(cpfDest || cnpjDest || corpo.nome_destinatario || temEndereco);
  let destinatarioXml = "";
  if (temDestinatario) {
    const nome = homologacao ? NOME_EM_HOMOLOGACAO : textoDaSefaz(corpo.nome_destinatario, 60);
    let enderDest = "";
    if (temEndereco) {
      const xLgr = textoDaSefaz(corpo.logradouro_destinatario, 60);
      const nro = textoDaSefaz(corpo.numero_destinatario, 60) || "SN";
      const xCpl = textoDaSefaz(corpo.complemento_destinatario, 60);
      const xBairro = textoDaSefaz(corpo.bairro_destinatario, 60);
      const ufDest = String(corpo.uf_destinatario ?? "").toUpperCase();
      let xMun = textoDaSefaz(corpo.municipio_destinatario, 60);
      let cMun = soDigitos(corpo.codigo_municipio_destinatario);
      if (!cMun && ufDest === "DF") {
        // O DF é um município só (Brasília, 5300108): Sobradinho, Taguatinga
        // e Ceilândia são regiões administrativas, não municípios.
        cMun = "5300108";
        xMun = "Brasilia";
      }
      if (!cMun && ufDest === uf && semAcento(xMun) === semAcento(xMunEmit)) cMun = cMunEmit;
      if (!cMun && ctx.codigoDoMunicipio) cMun = soDigitos(ctx.codigoDoMunicipio(xMun, ufDest) ?? "");
      if (xLgr.length < 2) falta("logradouro_destinatario", "Logradouro do destinatário vazio.");
      if (xBairro.length < 2) falta("bairro_destinatario", "Bairro do destinatário vazio (rejeição 788 na entrega).");
      if (xMun.length < 2) falta("municipio_destinatario", "Município do destinatário vazio.");
      if (!codigoDaUf(ufDest)) falta("uf_destinatario", "UF do destinatário inválida.", ufDest);
      if (!/^\d{7}$/.test(cMun)) {
        falta(
          "codigo_municipio_destinatario",
          `Sem o código IBGE do município "${xMun}/${ufDest}" do cliente. Informe o código (contexto.codigoDoMunicipio) para esta cidade.`,
          xMun
        );
      }
      const cep = soDigitos(corpo.cep_destinatario);
      enderDest = grupo("enderDest", [
        tag("xLgr", xLgr),
        tag("nro", nro),
        tag("xCpl", xCpl),
        tag("xBairro", xBairro),
        tag("cMun", cMun),
        tag("xMun", xMun),
        tag("UF", ufDest),
        tag("CEP", /^\d{8}$/.test(cep) ? cep : null),
        tag("cPais", "1058"),
        tag("xPais", "Brasil"),
      ]);
    }
    const indIEDest = String(corpo.indicador_inscricao_estadual_destinatario ?? 9);
    // NFC-e é venda a consumidor final não contribuinte: indIEDest 9 (MOC 7.0, E16a; NT 2025.001, 02.5).
    if (indIEDest !== "9") falta("indicador_inscricao_estadual_destinatario", "Na NFC-e o destinatário é não contribuinte (indIEDest = 9).", indIEDest);
    destinatarioXml = grupo("dest", [
      cnpjDest ? tag("CNPJ", cnpjDest) : tag("CPF", cpfDest || null),
      tag("xNome", nome.length >= 2 ? nome : null),
      enderDest,
      tag("indIEDest", "9"),
    ]);
  }

  // ── Itens ────────────────────────────────────────────────────────────────
  if (itens.length === 0) falta("items", "Nota sem itens.");
  if (itens.length > 990) falta("items", "A NF-e comporta no máximo 990 itens.");
  let somaProd = 0;
  let somaDesc = 0;
  let somaOutro = 0;
  const detalhes = itens.map((it, i) => {
    const nItem = i + 1;
    const rotulo = `item ${nItem}`;
    const vProd = emCentavos(it.valor_bruto);
    const vDesc = Math.max(0, emCentavos(it.valor_desconto));
    const vOutro = Math.max(0, emCentavos(it.valor_outras_despesas));
    const indTot = String(it.inclui_no_total ?? 1);
    if (indTot === "1") {
      somaProd += vProd;
      somaDesc += vDesc;
      somaOutro += vOutro;
    }
    const qCom = quantidade(it.quantidade_comercial);
    if (!qCom) falta(`${rotulo}.quantidade`, `Quantidade inválida no ${rotulo}.`, it.quantidade_comercial);
    if (!(vProd > 0)) falta(`${rotulo}.valor`, `Valor zerado no ${rotulo}.`, it.valor_bruto);
    if (vDesc > vProd) falta(`${rotulo}.desconto`, `Desconto maior que o valor do ${rotulo}.`, it.valor_desconto);
    const ncm = soDigitos(it.codigo_ncm);
    if (!/^\d{8}$/.test(ncm)) falta(`${rotulo}.ncm`, `NCM do ${rotulo} tem de ter 8 dígitos.`, ncm);
    const cfop = soDigitos(it.cfop);
    if (!/^[1235679]\d{3}$/.test(cfop)) falta(`${rotulo}.cfop`, `CFOP do ${rotulo} inválido.`, cfop);
    const cest = soDigitos(it.cest);
    if (cest && !/^\d{7}$/.test(cest)) falta(`${rotulo}.cest`, `CEST do ${rotulo} tem de ter 7 dígitos.`, cest);
    const descricao = nItem === 1 && homologacao ? ITEM_EM_HOMOLOGACAO : textoDaSefaz(it.descricao, 120);
    if (!descricao) falta(`${rotulo}.descricao`, `Descrição vazia no ${rotulo}.`);
    const uCom = textoDaSefaz(it.unidade_comercial, 6) || "UN";
    const uTrib = textoDaSefaz(it.unidade_tributavel, 6) || uCom;
    const qtdNum = Number(qCom ?? 0);
    const qTrib = quantidade(it.quantidade_tributavel ?? it.quantidade_comercial) ?? qCom;
    const vUnCom = qtdNum > 0 ? valorUnitario(it.valor_unitario_comercial, qtdNum, vProd) : "0";
    const vUnTrib = Number(qTrib) > 0 ? valorUnitario(it.valor_unitario_tributavel ?? it.valor_unitario_comercial, Number(qTrib), vProd) : "0";
    const cProd = textoDaSefaz(it.codigo_produto, 60) || String(nItem);

    const prod = grupo("prod", [
      tag("cProd", cProd),
      // Sem GTIN no cadastro: a literal "SEM GTIN" (NT 2017.001; Anexo I, I03).
      tag("cEAN", "SEM GTIN"),
      tag("xProd", descricao),
      tag("NCM", ncm),
      tag("CEST", cest || null),
      tag("CFOP", cfop),
      tag("uCom", uCom),
      tag("qCom", qCom),
      tag("vUnCom", vUnCom),
      tag("vProd", dec2(vProd)),
      tag("cEANTrib", "SEM GTIN"),
      tag("uTrib", uTrib),
      tag("qTrib", qTrib),
      tag("vUnTrib", vUnTrib),
      // TDec_1302Opc não aceita "0.00": desconto/outras zerados simplesmente não vão.
      tag("vDesc", vDesc > 0 ? dec2(vDesc) : null),
      tag("vOutro", vOutro > 0 ? dec2(vOutro) : null),
      tag("indTot", indTot === "0" ? "0" : "1"),
    ]);

    // SEM o grupo IBSCBS (reforma tributária, NT 2025.002): a regra UB12-10
    // (rejeição 1115, "Grupo IBSCBS não informado") vale em produção desde
    // 03/08/2026 para o CRT 3 — que por isso fica de fora do emissor próprio
    // (lib/nfce/pendencias) — e vale a partir de 04/01/2027 para os CRT 1, 2 e
    // 4 (NT 2025.002 v1.51, cronograma conferido em 30/09/2026). Até lá o
    // grupo tem de entrar aqui, no fim do `imposto` (depois de COFINS e IS, na
    // ordem do schema PL_010f).
    const imposto = grupo("imposto", [icmsDoItem(it, simples, rotulo, falta), pisDoItem(it, rotulo, falta), cofinsDoItem(it, rotulo, falta)]);
    return grupo("det", [prod, imposto], { nItem });
  });

  // ── Totais ───────────────────────────────────────────────────────────────
  // A conta da SEFAZ (Anexo I, W16/W17 e as rejeições 531–535, 564, 610):
  // cada total do cabeçalho é a SOMA dos itens, e vNF fecha com eles.
  const vNF = somaProd - somaDesc + somaOutro;
  const confereTotal = (campo: string, nome: string, somado: number) => {
    const doCorpo = emCentavos(corpo[campo]);
    if (doCorpo !== somado) falta(campo, `${nome} do corpo (${dec2(doCorpo)}) não é a soma dos itens (${dec2(somado)}).`, corpo[campo]);
  };
  confereTotal("valor_produtos", "Valor dos produtos", somaProd);
  confereTotal("valor_desconto", "Desconto", somaDesc);
  confereTotal("valor_outras_despesas", "Outras despesas", somaOutro);
  confereTotal("valor_total", "Total da nota", vNF);
  if (vNF <= 0) falta("valor_total", "Total da nota zero ou negativo.");

  const ICMSTot = grupo("ICMSTot", [
    tag("vBC", "0.00"),
    tag("vICMS", "0.00"),
    tag("vICMSDeson", "0.00"),
    tag("vFCP", "0.00"),
    tag("vBCST", "0.00"),
    tag("vST", "0.00"),
    tag("vFCPST", "0.00"),
    tag("vFCPSTRet", "0.00"),
    tag("vProd", dec2(somaProd)),
    tag("vFrete", "0.00"),
    tag("vSeg", "0.00"),
    tag("vDesc", dec2(somaDesc)),
    tag("vII", "0.00"),
    tag("vIPI", "0.00"),
    tag("vIPIDevol", "0.00"),
    tag("vPIS", "0.00"),
    tag("vCOFINS", "0.00"),
    tag("vOutro", dec2(somaOutro)),
    tag("vNF", dec2(vNF)),
  ]);

  // ── Pagamento ────────────────────────────────────────────────────────────
  if (pagamentos.length === 0) falta("formas_pagamento", "Nota sem forma de pagamento (grupo pag obrigatório).");
  if (pagamentos.length > 100) falta("formas_pagamento", "No máximo 100 formas de pagamento.");
  let somaPag = 0;
  const detPag = pagamentos.map((p, i) => {
    const tPag = String(p.forma_pagamento ?? "").padStart(2, "0");
    const vPag = emCentavos(p.valor_pagamento);
    somaPag += vPag;
    if (!/^\d{2}$/.test(tPag)) falta(`formas_pagamento[${i}]`, "Código de forma de pagamento (tPag) inválido.", p.forma_pagamento);
    const xPag = textoDaSefaz(p.descricao_pagamento, 60);
    // xPag só no 99 — obrigatória nele (441) e proibida nos outros (442) — NT 2020.006.
    if (tPag === "99" && xPag.length < 2) falta(`formas_pagamento[${i}]`, "Forma 99 (Outros) precisa de descrição (rejeição 441).");
    if (tPag !== "99" && xPag) falta(`formas_pagamento[${i}]`, "Descrição só vai na forma 99 (rejeição 442).", xPag);
    const tpIntegra = p.tipo_integracao != null ? String(p.tipo_integracao) : "";
    // Grupo de cartão obrigatório em 03, 04 e 17 (NT 2025.001, YA04-10, rejeição 391).
    if (["03", "04", "17"].includes(tPag) && !tpIntegra) falta(`formas_pagamento[${i}]`, "Cartão/Pix sem o grupo de cartão (rejeição 391).");
    const tBand = soDigitos(p.bandeira_operadora);
    const card = tpIntegra
      ? grupo("card", [tag("tpIntegra", tpIntegra === "1" ? "1" : "2"), tag("tBand", /^\d{2}$/.test(tBand) ? tBand : null)])
      : "";
    return grupo("detPag", [tag("tPag", tPag), tag("xPag", tPag === "99" ? xPag : null), tag("vPag", dec2(vPag)), card]);
  });
  const vTroco = Math.max(0, emCentavos(corpo.valor_troco));
  if (somaPag - vTroco !== vNF) {
    falta("formas_pagamento", `Pagamentos (${dec2(somaPag)}) − troco (${dec2(vTroco)}) não fecham com o total (${dec2(vNF)}) — rejeições 865/866.`);
  }
  const pag = grupo("pag", [...detPag, tag("vTroco", vTroco > 0 ? dec2(vTroco) : null)]);

  // ── Intermediador ────────────────────────────────────────────────────────
  const indIntermed = corpo.indicador_intermediario == null ? null : String(corpo.indicador_intermediario);
  let infIntermed = "";
  if (indIntermed === "1") {
    const cnpjInt = String(corpo.cnpj_intermediario ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    const idCad = textoDaSefaz(corpo.id_intermediario, 60);
    if (!cnpjValido(cnpjInt)) falta("cnpj_intermediario", "CNPJ do intermediador inválido (rejeição 440).", cnpjInt);
    if (idCad.length < 2) falta("id_intermediario", "Identificador da loja no intermediador vazio (rejeição 438).");
    infIntermed = grupo("infIntermed", [tag("CNPJ", cnpjInt), tag("idCadIntTran", idCad)]);
  }

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  const indPres = String(corpo.presenca_comprador ?? "");
  // NT 2026.002 (B25b-20, rejeição 717): na NFC-e só 1, 4 ou 5.
  if (!["1", "4", "5"].includes(indPres)) falta("presenca_comprador", "Na NFC-e a presença só pode ser 1, 4 ou 5 (rejeição 717).", indPres);
  // Contingência de ENTREGA (indPres 4): o Manual de contingência 2.0 (item 3)
  // descreve a off-line com indPres = 1, mas não há regra de validação que a
  // proíba na 4. Não bloqueamos — a primeira entrega em contingência na
  // homologação confirma.
  const natOp = textoDaSefaz(corpo.natureza_operacao, 60) || "Venda ao consumidor";

  // ── Transporte (grupo X) ─────────────────────────────────────────────────
  // Quem decide o transportador é montarCorpoDaNfce (lib/fiscal-emissao →
  // transporteDaNota); aqui ele é conferido contra as regras da SEFAZ que o
  // XSD não pega (MOC 7.0, Anexo I, modelo 65) e traduzido:
  //  - X03-20 (786): entrega (indPres 4) sem o transportador;
  //  - X03-10 (754): transportador fora da entrega;
  //  - X02-10 (753): modFrete diferente de 9 fora da entrega;
  //  - X04-20 (542) / X05-10 (543): CNPJ/CPF do transportador inválido;
  //  - X07-10 (559): IE do transportador sem a UF dele.
  // A taxa de entrega continua em vOutro: o vFrete fica zerado.
  const modFrete = String(corpo.modalidade_frete ?? 9);
  if (!["0", "1", "2", "3", "4", "9"].includes(modFrete)) falta("modalidade_frete", "Modalidade do frete tem de ser 0, 1, 2, 3, 4 ou 9 (X02).", modFrete);
  const cnpjTransp = String(corpo.cnpj_transportador ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const cpfTransp = soDigitos(corpo.cpf_transportador);
  const xNomeTransp = textoDaSefaz(corpo.nome_transportador, 60);
  const ieTransp = String(corpo.inscricao_estadual_transportador ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const xEnderTransp = textoDaSefaz(corpo.endereco_transportador, 60);
  const xMunTransp = textoDaSefaz(corpo.municipio_transportador, 60);
  const ufTransp = String(corpo.uf_transportador ?? "").trim().toUpperCase();
  const temTransportador = Boolean(cnpjTransp || cpfTransp || xNomeTransp || ieTransp || xEnderTransp || xMunTransp || ufTransp);
  if (indPres === "4") {
    if (!(cnpjTransp || cpfTransp || xNomeTransp)) {
      falta("transportador", "NFC-e de entrega sem o transportador (quem leva a mercadoria): rejeição 786 (MOC 7.0, X03-20).");
    }
  } else {
    if (temTransportador) falta("transportador", "Transportador só vai na NFC-e de entrega (indPres 4): rejeição 754 (MOC 7.0, X03-10).");
    if (modFrete !== "9") falta("modalidade_frete", "Fora da entrega a modalidade do frete é 9 (sem transporte): rejeição 753 (MOC 7.0, X02-10).", modFrete);
  }
  if (cnpjTransp && cpfTransp) falta("transportador", "Transportador com CNPJ e CPF ao mesmo tempo: é um ou outro.");
  if (cnpjTransp && !cnpjValido(cnpjTransp)) falta("cnpj_transportador", "CNPJ do transportador inválido (rejeição 542).", cnpjTransp);
  if (cpfTransp && !cpfValido(cpfTransp)) falta("cpf_transportador", "CPF do transportador inválido (rejeição 543).", cpfTransp);
  if (corpo.nome_transportador != null && String(corpo.nome_transportador).trim() !== "" && xNomeTransp.length < 2) {
    falta("nome_transportador", "Nome do transportador com menos de 2 caracteres.", corpo.nome_transportador);
  }
  if (ieTransp && !/^(ISENTO|[0-9]{2,14})$/.test(ieTransp)) falta("inscricao_estadual_transportador", "IE do transportador: 2 a 14 dígitos ou ISENTO.", ieTransp);
  if (ieTransp && !ufTransp) falta("uf_transportador", "Com a IE do transportador, a UF dele é obrigatória (rejeição 559).");
  if (ufTransp && ufTransp !== "EX" && !codigoDaUf(ufTransp)) falta("uf_transportador", "UF do transportador inválida.", ufTransp);
  const transp = grupo("transp", [
    tag("modFrete", modFrete),
    grupo("transporta", [
      cnpjTransp ? tag("CNPJ", cnpjTransp) : tag("CPF", cpfTransp || null),
      tag("xNome", xNomeTransp || null),
      tag("IE", ieTransp || null),
      tag("xEnder", xEnderTransp || null),
      tag("xMun", xMunTransp || null),
      tag("UF", ufTransp || null),
    ]),
  ]);

  let codigoNumerico = ctx.codigoNumerico ?? "";
  let chave = "";
  if (pendencias.length === 0) {
    try {
      codigoNumerico = codigoNumerico || gerarCodigoNumerico(numero);
      chave = montarChave({ uf, anoMes, cnpj, modelo: 65, serie, numero, tipoDeEmissao: tpEmis, codigoNumerico });
    } catch (e: any) {
      falta("chave", String(e?.message ?? e));
    }
  }
  if (pendencias.length > 0) {
    return {
      ok: false,
      mensagem: `${pendencias.length} problema(s) impedem de montar o XML desta NFC-e. Nada foi enviado à SEFAZ.`,
      pendencias,
    };
  }

  const ide = grupo("ide", [
    tag("cUF", cUF),
    tag("cNF", codigoNumerico),
    tag("natOp", natOp),
    tag("mod", "65"),
    tag("serie", String(serie)),
    tag("nNF", String(numero)),
    tag("dhEmi", dhEmi),
    tag("tpNF", String(corpo.tipo_documento ?? 1)),
    tag("idDest", String(corpo.local_destino ?? 1)),
    tag("cMunFG", cMunEmit),
    // 4 = DANFE NFC-e (B21).
    tag("tpImp", "4"),
    tag("tpEmis", String(tpEmis)),
    tag("cDV", chave.slice(-1)),
    tag("tpAmb", String(ctx.ambiente)),
    tag("finNFe", String(corpo.finalidade_emissao ?? 1)),
    tag("indFinal", String(corpo.consumidor_final ?? 1)),
    tag("indPres", indPres),
    tag("indIntermed", indIntermed),
    // 0 = emissão por aplicativo do contribuinte (B26).
    tag("procEmi", "0"),
    tag("verProc", textoDaSefaz(ctx.verProc || VERSAO_DO_EMISSOR, 20)),
    tpEmis === 9 ? tag("dhCont", dhCont) + tag("xJust", xJust) : "",
  ]);

  const emit = grupo("emit", [
    tag("CNPJ", cnpj),
    tag("xNome", xNomeEmit),
    tag("xFant", xFant || null),
    grupo("enderEmit", [
      tag("xLgr", xLgrEmit),
      tag("nro", nroEmit),
      tag("xCpl", textoDaSefaz(ctx.emitente?.complemento, 60) || null),
      tag("xBairro", xBairroEmit),
      tag("cMun", cMunEmit),
      tag("xMun", xMunEmit),
      tag("UF", uf),
      tag("CEP", cepEmit),
      tag("cPais", "1058"),
      tag("xPais", "Brasil"),
      tag("fone", /^\d{6,14}$/.test(foneEmit) ? foneEmit : null),
    ]),
    tag("IE", ie),
    tag("CRT", String(crt)),
  ]);

  const infCpl = textoDaSefaz(corpo.informacoes_adicionais_contribuinte, 5000);
  const rt = ctx.responsavelTecnico;
  const infRespTec = rt
    ? grupo("infRespTec", [
        tag("CNPJ", String(rt.cnpj).replace(/[^0-9A-Z]/gi, "").toUpperCase()),
        tag("xContato", textoDaSefaz(rt.contato, 60)),
        tag("email", textoDaSefaz(rt.email, 60)),
        tag("fone", soDigitos(rt.telefone)),
      ])
    : "";

  const id = idDaNota(chave);
  const infNFe = grupo(
    "infNFe",
    [
      ide,
      emit,
      destinatarioXml,
      ...detalhes,
      grupo("total", ICMSTot),
      // modFrete + transportador (grupo X, conferido acima); a taxa de entrega vai em vOutro.
      transp,
      pag,
      infIntermed,
      grupo("infAdic", tag("infCpl", infCpl || null)),
      infRespTec,
    ],
    { versao: VERSAO_DO_LEIAUTE, Id: id }
  );

  return {
    ok: true,
    xml: `<NFe xmlns="${NS_NFE}">${infNFe}</NFe>`,
    chave,
    id,
    codigoNumerico,
    dhEmi,
    tipoDeEmissao: tpEmis,
    totalEmCentavos: vNF,
    destinatario: cnpjDest ? { tipo: 1, id: cnpjDest } : cpfDest ? { tipo: 2, id: cpfDest } : null,
  };
}

type Falta = (campo: string, mensagem: string, valor?: unknown) => void;

/**
 * O grupo de ICMS pelo CSOSN (Simples, CRT 1 e 4) ou pelo CST (CRT 2 e 3).
 *
 * Só os casos em que o corpo tem TUDO que o grupo pede: 102/103/300/400
 * (ICMSSN102), 500 (ICMSSN500), 900 sem valores (ICMSSN900); no regime normal,
 * 40/41/50 (ICMS40) e 60 (ICMS60). 101 e 201/202/203 exigem crédito do
 * Simples e ST calculados — o corpo não tem esses valores, então recusa em vez
 * de declarar zero.
 */
function icmsDoItem(it: Record<string, any>, simples: boolean, rotulo: string, falta: Falta): string {
  const orig = String(it.icms_origem ?? "0");
  if (!/^[0-8]$/.test(orig)) falta(`${rotulo}.origem`, `Origem da mercadoria inválida no ${rotulo}.`, orig);
  const cod = String(it.icms_situacao_tributaria ?? "").trim();
  if (simples) {
    if (["102", "103", "300", "400"].includes(cod)) return grupo("ICMS", grupo("ICMSSN102", [tag("orig", orig), tag("CSOSN", cod)]));
    if (cod === "500") return grupo("ICMS", grupo("ICMSSN500", [tag("orig", orig), tag("CSOSN", "500")]));
    if (cod === "900") return grupo("ICMS", grupo("ICMSSN900", [tag("orig", orig), tag("CSOSN", "900")]));
    falta(`${rotulo}.csosn`, `CSOSN ${cod || "(vazio)"} no ${rotulo} ainda não é emitido pelo FireHub (exige valores de crédito/ST que o cadastro não tem).`, cod);
    return "";
  }
  if (["40", "41", "50"].includes(cod)) return grupo("ICMS", grupo("ICMS40", [tag("orig", orig), tag("CST", cod)]));
  if (cod === "60") return grupo("ICMS", grupo("ICMS60", [tag("orig", orig), tag("CST", "60")]));
  falta(`${rotulo}.cst`, `CST de ICMS ${cod || "(vazio)"} no ${rotulo} ainda não é emitido pelo FireHub (exige base e alíquota).`, cod);
  return "";
}

/** CSTs que vão no grupo "Outras operações" (schema: PISOutr/COFINSOutr). */
const CST_OUTRAS = new Set(["49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "70", "71", "72", "73", "74", "75", "98", "99"]);
const CST_NAO_TRIBUTADO = new Set(["04", "05", "06", "07", "08", "09"]);

/**
 * PIS (e COFINS, igual): na NFC-e o grupo é opcional (Anexo I: Q01-20 e S01-20
 * obrigam só o modelo 55), mas o corpo sempre traz o CST, e ele vai.
 * 04–09 → PISNT; 49–99 → PISOutr com base, alíquota e valor ZERADOS (o
 * Simples recolhe PIS no DAS, não na nota). 01/02/03 pedem alíquota que o
 * cadastro não tem → recusa.
 */
function contribuicao(nome: "PIS" | "COFINS", cst: unknown, rotulo: string, falta: Falta): string {
  const c = String(cst ?? "").padStart(2, "0");
  if (CST_NAO_TRIBUTADO.has(c)) return grupo(nome, grupo(`${nome}NT`, tag("CST", c)));
  if (CST_OUTRAS.has(c)) {
    const aliq = nome === "PIS" ? "pPIS" : "pCOFINS";
    const valor = nome === "PIS" ? "vPIS" : "vCOFINS";
    return grupo(nome, grupo(`${nome}Outr`, [tag("CST", c), tag("vBC", "0.00"), tag(aliq, "0.00"), tag(valor, "0.00")]));
  }
  falta(`${rotulo}.${nome.toLowerCase()}`, `CST de ${nome} ${c} no ${rotulo} exige alíquota, que o cadastro não tem.`, c);
  return "";
}
const pisDoItem = (it: Record<string, any>, rotulo: string, falta: Falta) => contribuicao("PIS", it.pis_situacao_tributaria, rotulo, falta);
const cofinsDoItem = (it: Record<string, any>, rotulo: string, falta: Falta) => contribuicao("COFINS", it.cofins_situacao_tributaria, rotulo, falta);

/**
 * Põe o infNFeSupl (qrCode + urlChave) entre o infNFe e a Signature — a ordem
 * do schema (TNFe: infNFe, infNFeSupl, Signature). Entra DEPOIS de assinar:
 * a assinatura cobre só o infNFe, e o QR offline precisa do DigestValue dela.
 */
export function inserirInfNFeSupl(xmlAssinado: string, qrCode: string, urlChave: string): string {
  const supl = grupo("infNFeSupl", [tag("qrCode", qrCode), tag("urlChave", urlChave)]);
  const fim = xmlAssinado.indexOf("</infNFe>");
  if (fim < 0) throw new Error("XML sem </infNFe>.");
  if (xmlAssinado.includes("<infNFeSupl>")) throw new Error("A nota já tem infNFeSupl.");
  const depois = fim + "</infNFe>".length;
  return xmlAssinado.slice(0, depois) + supl + xmlAssinado.slice(depois);
}
