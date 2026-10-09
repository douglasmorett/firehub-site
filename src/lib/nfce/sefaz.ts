/**
 * /src/lib/nfce/sefaz.ts
 *
 * A conversa com os webservices da SEFAZ: endereços por UF e ambiente,
 * mensagens XML de cada serviço, envelope SOAP 1.2, cliente HTTPS com o
 * certificado da loja (mTLS) e a leitura das respostas.
 *
 * ── O PROTOCOLO (leiaute 4.00) ──────────────────────────────────────────────
 *
 * NT 2016.002, itens 2.2 a 2.4:
 *  - SOAP 1.2, SEM o cabeçalho nfeCabecMsg (eliminado na 4.00 — "será
 *    eliminado o uso de variáveis no SOAP Header");
 *  - corpo `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/<Servico>">`
 *    com a mensagem XML dentro, sem declaração <?xml?>;
 *  - resposta padronizada em `<nfeResultMsg>`;
 *  - serviços NFeAutorizacao4, NFeRetAutorizacao4, NFeConsultaProtocolo4,
 *    NFeStatusServico4, NFeRecepcaoEvento4, NFeInutilizacao4, com os métodos
 *    nfeAutorizacaoLote, nfeRetAutorizacaoLote, nfeConsultaNF,
 *    nfeStatusServicoNF, nfeRecepcaoEvento, nfeInutilizacaoNF.
 * O `action` do Content-Type é "<namespace do serviço>/<método>", o
 * soapAction dos WSDL 4.00.
 *
 * NFC-e é SEMPRE síncrona com uma nota por lote: indSinc=1 (NT 2025.001, 02.3
 * — "para a NFC-e foi tornada obrigatória a solicitação de resposta síncrona
 * para Lote com somente 1 Nota Fiscal").
 *
 * ── OS ENDEREÇOS ────────────────────────────────────────────────────────────
 *
 * Portal Nacional da NFC-e (nfce.encat.org → Desenvolvedor → Web Services,
 * produção e homologação, páginas baixadas em 29/09/2026 e de novo em
 * 09/10/2026, quando as 27 UF entraram). Dezenove UF autorizam na SVRS; AM,
 * GO, MG, MS, MT, PR, RS e SP têm autorizador próprio. A tabela UF →
 * autorizador foi cruzada com a da NFePHP (sped-nfe, storage/autorizadores.json,
 * modelo 65), que bate com o portal nas quatro UF que já estavam no ar.
 *
 * ── O TLS ───────────────────────────────────────────────────────────────────
 *
 * A SEFAZ exige o certificado A1 da loja no handshake (autenticação mútua) e
 * apresenta um certificado ICP-Brasil que o Node não conhece — ver
 * icp-brasil.ts. O par chave/certificado vai em PEM (lido pelo forge em
 * assinatura.ts), nunca como pfx, para não depender da cifra do arquivo.
 */
import https from "node:https";
import tls from "node:tls";
import type { CertificadoCarregado } from "./assinatura";
import { assinarXml } from "./assinatura";
import { codigoDaUf } from "./chave";
import { CADEIA_ICP_BRASIL } from "./icp-brasil";
import { NS_NFE, elementos, filho, grupo, lerXml, primeiro, semDeclaracao, serializar, tag, textoDaSefaz, textoDoFilho } from "./xml";

export type Ambiente = 1 | 2;
export type Servico = "autorizacao" | "retAutorizacao" | "consulta" | "status" | "evento" | "inutilizacao";

/** Nome do serviço no WSDL 4.00 e o método (NT 2016.002, 2.3). */
export const SERVICOS: Record<Servico, { wsdl: string; metodo: string }> = {
  autorizacao: { wsdl: "NFeAutorizacao4", metodo: "nfeAutorizacaoLote" },
  retAutorizacao: { wsdl: "NFeRetAutorizacao4", metodo: "nfeRetAutorizacaoLote" },
  consulta: { wsdl: "NFeConsultaProtocolo4", metodo: "nfeConsultaNF" },
  status: { wsdl: "NFeStatusServico4", metodo: "nfeStatusServicoNF" },
  evento: { wsdl: "NFeRecepcaoEvento4", metodo: "nfeRecepcaoEvento" },
  inutilizacao: { wsdl: "NFeInutilizacao4", metodo: "nfeInutilizacaoNF" },
};

type Autorizador = { nome: string; producao: string; homologacao: string; caminhos: Record<Servico, string> };

/**
 * Os caminhos dos seis serviços 4.00 em cada autorizador, como o portal
 * publica (nfce.encat.org → Desenvolvedor → Webservices Produção /
 * Homologação, 09/10/2026). O portal lista o de GO com "?wsdl" no fim — é o
 * endereço do contrato; a chamada SOAP vai sem ele.
 *
 * Três famílias de nomes: a SVRS/RS (pasta + .asmx), a "asmx na raiz" (SP),
 * e a "nome do serviço na raiz" (MG, PR, MS, GO — com NFeConsultaProtocolo4 e
 * NFeRecepcaoEvento4; MT e AM — com NfeConsulta4 e RecepcaoEvento4).
 */
const CAMINHOS_SVRS: Record<Servico, string> = {
  autorizacao: "NfeAutorizacao/NFeAutorizacao4.asmx",
  retAutorizacao: "NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  consulta: "NfeConsulta/NfeConsulta4.asmx",
  status: "NfeStatusServico/NfeStatusServico4.asmx",
  evento: "recepcaoevento/recepcaoevento4.asmx",
  inutilizacao: "nfeinutilizacao/nfeinutilizacao4.asmx",
};
const CAMINHOS_NOME_DO_SERVICO: Record<Servico, string> = {
  autorizacao: "NFeAutorizacao4",
  retAutorizacao: "NFeRetAutorizacao4",
  consulta: "NFeConsultaProtocolo4",
  status: "NFeStatusServico4",
  evento: "NFeRecepcaoEvento4",
  inutilizacao: "NFeInutilizacao4",
};
const CAMINHOS_NOME_CURTO: Record<Servico, string> = {
  autorizacao: "NfeAutorizacao4",
  retAutorizacao: "NfeRetAutorizacao4",
  consulta: "NfeConsulta4",
  status: "NfeStatusServico4",
  evento: "RecepcaoEvento4",
  inutilizacao: "NfeInutilizacao4",
};

export const AUTORIZADORES: Record<"SVRS" | "MG" | "SP" | "PR" | "RS" | "MS" | "MT" | "GO" | "AM", Autorizador> = {
  SVRS: {
    nome: "SEFAZ Virtual do RS (SVRS)",
    producao: "https://nfce.svrs.rs.gov.br/ws/",
    homologacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/",
    caminhos: CAMINHOS_SVRS,
  },
  MG: {
    nome: "SEFAZ MG",
    producao: "https://nfce.fazenda.mg.gov.br/nfce/services/",
    homologacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/",
    caminhos: CAMINHOS_NOME_DO_SERVICO,
  },
  SP: {
    nome: "SEFAZ SP",
    producao: "https://nfce.fazenda.sp.gov.br/ws/",
    homologacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/",
    caminhos: {
      autorizacao: "NFeAutorizacao4.asmx",
      retAutorizacao: "NFeRetAutorizacao4.asmx",
      consulta: "NFeConsultaProtocolo4.asmx",
      status: "NFeStatusServico4.asmx",
      evento: "NFeRecepcaoEvento4.asmx",
      inutilizacao: "NFeInutilizacao4.asmx",
    },
  },
  PR: {
    nome: "SEFA PR",
    producao: "https://nfce.sefa.pr.gov.br/nfce/",
    homologacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/",
    caminhos: CAMINHOS_NOME_DO_SERVICO,
  },
  RS: {
    nome: "SEFAZ RS",
    producao: "https://nfce.sefazrs.rs.gov.br/ws/",
    homologacao: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/",
    caminhos: CAMINHOS_SVRS,
  },
  MS: {
    nome: "SEFAZ MS",
    producao: "https://nfce.sefaz.ms.gov.br/ws/",
    homologacao: "https://hom.nfce.sefaz.ms.gov.br/ws/",
    caminhos: CAMINHOS_NOME_DO_SERVICO,
  },
  MT: {
    nome: "SEFAZ MT",
    producao: "https://nfce.sefaz.mt.gov.br/nfcews/services/",
    homologacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/",
    caminhos: CAMINHOS_NOME_CURTO,
  },
  GO: {
    nome: "SEFAZ GO",
    producao: "https://nfe.sefaz.go.gov.br/nfe/services/",
    homologacao: "https://homolog.sefaz.go.gov.br/nfe/services/",
    caminhos: CAMINHOS_NOME_DO_SERVICO,
  },
  AM: {
    nome: "SEFAZ AM",
    producao: "https://nfce.sefaz.am.gov.br/nfce-services/services/",
    homologacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/",
    caminhos: CAMINHOS_NOME_CURTO,
  },
};

/**
 * Quem autoriza a NFC-e de cada UF (as 27). Fonte: nfce.encat.org →
 * Desenvolvedor → Webservices (quem tem tabela própria ali tem autorizador
 * próprio; o resto vai na SVRS), cruzada com storage/autorizadores.json da
 * NFePHP (modelo 65) em 09/10/2026 — as duas listas são idênticas. BA, CE,
 * MA e PE têm autorizador próprio para a NF-e (modelo 55), mas a NFC-e deles
 * é SVRS.
 */
export const AUTORIZADOR_DA_UF: Record<string, keyof typeof AUTORIZADORES> = {
  AC: "SVRS",
  AL: "SVRS",
  AM: "AM",
  AP: "SVRS",
  BA: "SVRS",
  CE: "SVRS",
  DF: "SVRS",
  ES: "SVRS",
  GO: "GO",
  MA: "SVRS",
  MG: "MG",
  MS: "MS",
  MT: "MT",
  PA: "SVRS",
  PB: "SVRS",
  PE: "SVRS",
  PI: "SVRS",
  PR: "PR",
  RJ: "SVRS",
  RN: "SVRS",
  RO: "SVRS",
  RR: "SVRS",
  RS: "RS",
  SC: "SVRS",
  SE: "SVRS",
  SP: "SP",
  TO: "SVRS",
};

export function urlDoServico(uf: string, ambiente: Ambiente, servico: Servico): string {
  const sigla = String(uf ?? "").trim().toUpperCase();
  const qual = AUTORIZADOR_DA_UF[sigla];
  if (!qual) throw new Error(`O emissor próprio ainda não tem os webservices de NFC-e da UF "${sigla}".`);
  const a = AUTORIZADORES[qual];
  return (ambiente === 1 ? a.producao : a.homologacao) + a.caminhos[servico];
}

export const namespaceDoServico = (s: Servico) => `http://www.portalfiscal.inf.br/nfe/wsdl/${SERVICOS[s].wsdl}`;

/** O envelope SOAP 1.2 com a mensagem no nfeDadosMsg. */
export function envelopeSoap(servico: Servico, mensagemXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${namespaceDoServico(servico)}">${semDeclaracao(mensagemXml)}</nfeDadosMsg></soap12:Body>` +
    "</soap12:Envelope>"
  );
}

export function cabecalhosSoap(servico: Servico): Record<string, string> {
  return {
    "Content-Type": `application/soap+xml; charset=utf-8; action="${namespaceDoServico(servico)}/${SERVICOS[servico].metodo}"`,
  };
}

// ─── Mensagens ──────────────────────────────────────────────────────────────

/** Lote com UMA NFC-e, síncrono (TEnviNFe). O idLote é nosso (até 15 dígitos). */
export function montarEnviNFe(xmlNFeAssinado: string, idLote: string): string {
  if (!/^\d{1,15}$/.test(idLote)) throw new Error(`idLote inválido: "${idLote}".`);
  return `<enviNFe xmlns="${NS_NFE}" versao="4.00">${tag("idLote", idLote)}${tag("indSinc", "1")}${semDeclaracao(xmlNFeAssinado)}</enviNFe>`;
}

export const montarConsReciNFe = (ambiente: Ambiente, recibo: string): string =>
  `<consReciNFe xmlns="${NS_NFE}" versao="4.00">${tag("tpAmb", ambiente)}${tag("nRec", recibo)}</consReciNFe>`;

export const montarConsSitNFe = (ambiente: Ambiente, chave: string): string =>
  `<consSitNFe xmlns="${NS_NFE}" versao="4.00">${tag("tpAmb", ambiente)}${tag("xServ", "CONSULTAR")}${tag("chNFe", chave)}</consSitNFe>`;

export function montarConsStatServ(ambiente: Ambiente, uf: string): string {
  const cUF = codigoDaUf(uf);
  if (!cUF) throw new Error(`UF desconhecida: "${uf}".`);
  return `<consStatServ xmlns="${NS_NFE}" versao="4.00">${tag("tpAmb", ambiente)}${tag("cUF", cUF)}${tag("xServ", "STATUS")}</consStatServ>`;
}

/** Os dois eventos de cancelamento do emitente da NFC-e. */
export const EVENTO_CANCELAMENTO = "110111";
export const EVENTO_CANCELAMENTO_POR_SUBSTITUICAO = "110112";

/**
 * Evento de CANCELAMENTO assinado, dentro do envEvento — o comum (110111) ou
 * o POR SUBSTITUIÇÃO (110112).
 *
 * MOC 7.0, 5.8 (parte geral do evento) e 5.9 (cancelamento): Id =
 * "ID" + tpEvento + chave + nSeqEvento(2); cOrgao = cUF do emitente; detEvento
 * com descEvento "Cancelamento", nProt da autorização e xJust (15 a 255).
 *
 * 110112 (NT 2018.004; schema e110112_v1.00.xsd do pacote "Evento
 * Cancelamento por Substituição", conferido em
 * scripts/fixtures/nfce-xsd/evento/cancsubst): descEvento "Cancelamento por
 * substituicao", cOrgaoAutor (a UF), tpAutor 1 (empresa emitente), verAplic,
 * nProt, xJust e chNFeRef — a chave da NFC-e de contingência que acobertou a
 * MESMA venda. É o cancelamento da NFC-e "que retornou com Autorização de Uso
 * e cuja operação foi acobertada por NFC-e emitida em contingência" (Ajuste
 * SINIEF 19/16, cl. 12ª I → cl. 15ª-A, até 168 h da autorização; no DF,
 * Portaria SEEC 387/2019, art. 7º § 1º).
 */
export function montarEventoDeCancelamento(
  p: {
    chave: string;
    protocolo: string;
    justificativa: string;
    cnpj: string;
    ambiente: Ambiente;
    dhEvento: string;
    sequencia?: number;
    idLote: string;
    /** Presente = 110112: a chave da NFC-e (de contingência) que substituiu esta. */
    chaveSubstituta?: string | null;
    /** verAplic do 110112 (versão do aplicativo do autor, 1 a 20 caracteres). */
    versaoDoAplicativo?: string;
  },
  cert: Pick<CertificadoCarregado, "chavePrivadaPem" | "certificadoPem">
): { envEvento: string; evento: string } {
  const seq = p.sequencia ?? 1;
  const xJust = textoDaSefaz(p.justificativa, 255);
  if (xJust.length < 15) throw new Error("A justificativa do cancelamento precisa de 15 a 255 caracteres.");
  if (!/^\d{15}$|^\d{17}$/.test(p.protocolo)) throw new Error(`Protocolo de autorização inválido: "${p.protocolo}".`);
  const cOrgao = p.chave.slice(0, 2);
  const substituicao = p.chaveSubstituta != null;
  if (substituicao) {
    if (!/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(String(p.chaveSubstituta))) throw new Error(`Chave da NFC-e substituta inválida: "${p.chaveSubstituta}".`);
    if (p.chaveSubstituta === p.chave) throw new Error("A NFC-e substituta não pode ser a própria nota cancelada.");
  }
  const tpEvento = substituicao ? EVENTO_CANCELAMENTO_POR_SUBSTITUICAO : EVENTO_CANCELAMENTO;
  const verAplic = textoDaSefaz(p.versaoDoAplicativo || "FireHub NFC-e", 20);
  const detEvento = substituicao
    ? [
        tag("descEvento", "Cancelamento por substituicao"),
        tag("cOrgaoAutor", cOrgao),
        tag("tpAutor", "1"),
        tag("verAplic", verAplic),
        tag("nProt", p.protocolo),
        tag("xJust", xJust),
        tag("chNFeRef", String(p.chaveSubstituta)),
      ]
    : [tag("descEvento", "Cancelamento"), tag("nProt", p.protocolo), tag("xJust", xJust)];
  const id = `ID${tpEvento}${p.chave}${String(seq).padStart(2, "0")}`;
  const infEvento = grupo(
    "infEvento",
    [
      tag("cOrgao", cOrgao),
      tag("tpAmb", p.ambiente),
      tag("CNPJ", p.cnpj),
      tag("chNFe", p.chave),
      tag("dhEvento", p.dhEvento),
      tag("tpEvento", tpEvento),
      tag("nSeqEvento", String(seq)),
      tag("verEvento", "1.00"),
      grupo("detEvento", detEvento, { versao: "1.00" }),
    ],
    { Id: id }
  );
  const evento = assinarXml(`<evento xmlns="${NS_NFE}" versao="1.00">${infEvento}</evento>`, "infEvento", cert);
  return { evento, envEvento: `<envEvento xmlns="${NS_NFE}" versao="1.00">${tag("idLote", p.idLote)}${semDeclaracao(evento)}</envEvento>` };
}

/** O cancelamento comum (110111) — ver `montarEventoDeCancelamento`. */
export function montarCancelamento(
  p: { chave: string; protocolo: string; justificativa: string; cnpj: string; ambiente: Ambiente; dhEvento: string; sequencia?: number; idLote: string },
  cert: Pick<CertificadoCarregado, "chavePrivadaPem" | "certificadoPem">
): { envEvento: string; evento: string } {
  return montarEventoDeCancelamento({ ...p, chaveSubstituta: null }, cert);
}

/**
 * Pedido de INUTILIZAÇÃO assinado (TInutNFe). Id = "ID" + cUF + AA + CNPJ +
 * mod + série(3) + nIni(9) + nFim(9) — schema: ID[0-9]{4}[0-9A-Z]{12}[0-9]{25}.
 */
export function montarInutilizacao(
  p: { uf: string; ano: number; cnpj: string; serie: number; numeroInicial: number; numeroFinal: number; justificativa: string; ambiente: Ambiente },
  cert: Pick<CertificadoCarregado, "chavePrivadaPem" | "certificadoPem">
): string {
  const cUF = codigoDaUf(p.uf);
  if (!cUF) throw new Error(`UF desconhecida: "${p.uf}".`);
  const aa = String(p.ano % 100).padStart(2, "0");
  const xJust = textoDaSefaz(p.justificativa, 255);
  if (xJust.length < 15) throw new Error("A justificativa da inutilização precisa de 15 a 255 caracteres.");
  if (!(p.numeroInicial >= 1 && p.numeroFinal >= p.numeroInicial && p.numeroFinal <= 999_999_999)) throw new Error("Faixa de numeração inválida.");
  const id = `ID${cUF}${aa}${p.cnpj}65${String(p.serie).padStart(3, "0")}${String(p.numeroInicial).padStart(9, "0")}${String(p.numeroFinal).padStart(9, "0")}`;
  const infInut = grupo(
    "infInut",
    [
      tag("tpAmb", p.ambiente),
      tag("xServ", "INUTILIZAR"),
      tag("cUF", cUF),
      tag("ano", aa),
      tag("CNPJ", p.cnpj),
      tag("mod", "65"),
      tag("serie", String(p.serie)),
      tag("nNFIni", String(p.numeroInicial)),
      tag("nNFFin", String(p.numeroFinal)),
      tag("xJust", xJust),
    ],
    { Id: id }
  );
  return assinarXml(`<inutNFe xmlns="${NS_NFE}" versao="4.00">${infInut}</inutNFe>`, "infInut", cert);
}

// ─── Respostas ──────────────────────────────────────────────────────────────

export class FalhaSoap extends Error {
  constructor(mensagem: string, public readonly corpo: string) {
    super(mensagem);
  }
}

/** O primeiro elemento dentro de nfeResultMsg (ou do Body). SOAP Fault vira exceção com o motivo. */
export function lerRespostaSoap(texto: string): Element {
  const doc = lerXml(texto);
  const fault = primeiro(doc, "Fault");
  if (fault) {
    const motivo = primeiro(fault, "Text")?.textContent ?? primeiro(fault, "faultstring")?.textContent ?? "SOAP Fault";
    throw new FalhaSoap(`A SEFAZ respondeu com erro SOAP: ${motivo.trim()}`, texto);
  }
  const resultado = primeiro(doc, "nfeResultMsg") ?? primeiro(doc, "Body");
  if (!resultado) {
    // Algumas SEFAZ devolvem a mensagem crua, sem envelope.
    if (doc.documentElement) return doc.documentElement;
    throw new FalhaSoap("Resposta da SEFAZ sem nfeResultMsg.", texto);
  }
  for (let c = resultado.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) return c as Element;
  throw new FalhaSoap("nfeResultMsg vazio.", texto);
}

export type MensagemDaSefaz = { codigo: string | null; texto: string };

export type ProtocoloDaNota = {
  chave: string;
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  dhRecbto: string | null;
  digVal: string | null;
  /**
   * As mensagens da SEFAZ para o emissor (cMsg/xMsg, até 5 — NT 2018.005). É
   * aqui que vem o ALERTA da autorização com alerta (cStat 120, NT 2026.002
   * item 2: "o alerta será retornado em campo específico do protocolo").
   */
  mensagens: MensagemDaSefaz[];
  /** O protNFe inteiro, pronto para o nfeProc. */
  xml: string;
};

function lerProtNFe(prot: Element): ProtocoloDaNota {
  const inf = filho(prot, "infProt") ?? prot;
  // cMsg e xMsg vêm em pares (sequência 0..5 do TProtNFe), na ordem.
  const mensagens: MensagemDaSefaz[] = [];
  for (let c = inf.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const nome = (c as Element).localName || c.nodeName.replace(/^.*:/, "");
    const texto = (c.textContent ?? "").trim();
    if (nome === "cMsg") mensagens.push({ codigo: texto || null, texto: "" });
    else if (nome === "xMsg") {
      const ultima = mensagens[mensagens.length - 1];
      if (ultima && !ultima.texto) ultima.texto = texto;
      else mensagens.push({ codigo: null, texto });
    }
  }
  return {
    chave: textoDoFilho(inf, "chNFe") ?? "",
    cStat: textoDoFilho(inf, "cStat") ?? "",
    xMotivo: textoDoFilho(inf, "xMotivo") ?? "",
    protocolo: textoDoFilho(inf, "nProt"),
    dhRecbto: textoDoFilho(inf, "dhRecbto"),
    digVal: textoDoFilho(inf, "digVal"),
    mensagens: mensagens.filter((m) => m.texto || m.codigo),
    xml: serializar(prot),
  };
}

const cabecalhoDoRetorno = (r: Element) => ({
  cStat: textoDoFilho(r, "cStat") ?? "",
  xMotivo: textoDoFilho(r, "xMotivo") ?? "",
  dhRecbto: textoDoFilho(r, "dhRecbto"),
  tpAmb: textoDoFilho(r, "tpAmb"),
  cUF: textoDoFilho(r, "cUF"),
  verAplic: textoDoFilho(r, "verAplic"),
});

function exigirRaiz(r: Element, nome: string): void {
  const local = r.localName || r.nodeName.replace(/^.*:/, "");
  if (local !== nome) throw new FalhaSoap(`Esperava ${nome} na resposta da SEFAZ e veio ${local}.`, serializar(r));
}

/** retEnviNFe: o lote (cStat 104 = processado; 103 = recebido, assíncrono) e o protNFe da nota. */
export function lerRetEnviNFe(r: Element) {
  exigirRaiz(r, "retEnviNFe");
  const prot = filho(r, "protNFe");
  const infRec = filho(r, "infRec");
  return {
    ...cabecalhoDoRetorno(r),
    recibo: infRec ? textoDoFilho(infRec, "nRec") : null,
    protocolo: prot ? lerProtNFe(prot) : null,
  };
}

/** retConsReciNFe: o resultado do lote assíncrono. */
export function lerRetConsReciNFe(r: Element) {
  exigirRaiz(r, "retConsReciNFe");
  return {
    ...cabecalhoDoRetorno(r),
    recibo: textoDoFilho(r, "nRec"),
    protocolos: elementos(r, "protNFe").map(lerProtNFe),
  };
}

/**
 * retConsSitNFe: a situação da nota (100 autorizada, 101/135/155 cancelada,
 * 217 não consta...).
 *
 * Os eventos vêm como `procEventoNFe` (evento assinado + retEvento — o schema
 * leiauteConsSitNFe_v4.00 põe 0..N deles depois do protNFe). Cada um volta com
 * o documento INTEIRO em `xml`: é o procEventoNFe que prova o cancelamento, e
 * é por aqui que ele é recuperado quando a resposta do próprio evento se
 * perdeu (lib/nfce/emissao-da-loja e lib/nfce/rotina-da-sefaz guardam no cofre).
 */
export function lerRetConsSitNFe(r: Element) {
  exigirRaiz(r, "retConsSitNFe");
  const prot = filho(r, "protNFe");
  const doRetEvento = (e: Element, xml: string | null) => {
    const inf = filho(e, "infEvento") ?? e;
    return {
      tpEvento: textoDoFilho(inf, "tpEvento"),
      cStat: textoDoFilho(inf, "cStat") ?? "",
      xMotivo: textoDoFilho(inf, "xMotivo") ?? "",
      protocolo: textoDoFilho(inf, "nProt"),
      dhRegEvento: textoDoFilho(inf, "dhRegEvento"),
      /** O procEventoNFe inteiro (com declaração), quando veio. */
      xml,
    };
  };
  const procs = elementos(r, "procEventoNFe");
  const eventos = procs
    .map((p) => {
      const ret = primeiro(p, "retEvento");
      return ret ? doRetEvento(ret, comDeclaracao(serializar(p))) : null;
    })
    .filter((e): e is NonNullable<typeof e> => e != null);
  // SEFAZ que devolve o retEvento solto (sem o procEventoNFe em volta): vale a
  // situação, mas não há documento para guardar.
  const soltos = elementos(r, "retEvento").filter((e) => !procs.some((p) => p === e.parentNode));
  for (const e of soltos) eventos.push(doRetEvento(e, null));
  return { ...cabecalhoDoRetorno(r), chave: textoDoFilho(r, "chNFe"), protocolo: prot ? lerProtNFe(prot) : null, eventos };
}

/** retConsStatServ: 107 = em operação; 108 paralisado momentaneamente; 109 sem previsão. */
export function lerRetConsStatServ(r: Element) {
  exigirRaiz(r, "retConsStatServ");
  const tMed = textoDoFilho(r, "tMed");
  return {
    ...cabecalhoDoRetorno(r),
    tempoMedio: tMed != null ? Number(tMed) : null,
    dhRetorno: textoDoFilho(r, "dhRetorno"),
    observacao: textoDoFilho(r, "xObs"),
  };
}

/** retEnvEvento: 128 = lote de evento processado; em cada retEvento, 135/136/155 = registrado. */
export function lerRetEnvEvento(r: Element) {
  exigirRaiz(r, "retEnvEvento");
  return {
    cStat: textoDoFilho(r, "cStat") ?? "",
    xMotivo: textoDoFilho(r, "xMotivo") ?? "",
    tpAmb: textoDoFilho(r, "tpAmb"),
    eventos: elementos(r, "retEvento").map((e) => {
      const inf = filho(e, "infEvento") ?? e;
      return {
        cStat: textoDoFilho(inf, "cStat") ?? "",
        xMotivo: textoDoFilho(inf, "xMotivo") ?? "",
        chave: textoDoFilho(inf, "chNFe"),
        tpEvento: textoDoFilho(inf, "tpEvento"),
        sequencia: textoDoFilho(inf, "nSeqEvento"),
        protocolo: textoDoFilho(inf, "nProt"),
        dhRegEvento: textoDoFilho(inf, "dhRegEvento"),
        xml: serializar(e),
      };
    }),
  };
}

/** retInutNFe: 102 = inutilização homologada. */
export function lerRetInutNFe(r: Element) {
  exigirRaiz(r, "retInutNFe");
  const inf = filho(r, "infInut") ?? r;
  return {
    cStat: textoDoFilho(inf, "cStat") ?? "",
    xMotivo: textoDoFilho(inf, "xMotivo") ?? "",
    tpAmb: textoDoFilho(inf, "tpAmb"),
    protocolo: textoDoFilho(inf, "nProt"),
    dhRecbto: textoDoFilho(inf, "dhRecbto"),
    xml: serializar(r),
  };
}

// ─── Documentos finais (o que se guarda por 5 anos) ─────────────────────────

const DECLARACAO = '<?xml version="1.0" encoding="UTF-8"?>';

/** Um documento final (procEventoNFe lido de uma resposta) com a declaração, como os que montamos. */
export const comDeclaracao = (xml: string): string => `${DECLARACAO}${semDeclaracao(xml)}`;

/** Nota autorizada = NFe assinada + protNFe (TNfeProc). */
export const montarNfeProc = (xmlNFe: string, xmlProtNFe: string): string =>
  `${DECLARACAO}<nfeProc xmlns="${NS_NFE}" versao="4.00">${semDeclaracao(xmlNFe)}${semDeclaracao(xmlProtNFe)}</nfeProc>`;

/** Evento registrado = evento assinado + retEvento (TProcEvento). */
export const montarProcEventoNFe = (xmlEvento: string, xmlRetEvento: string): string =>
  `${DECLARACAO}<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${semDeclaracao(xmlEvento)}${semDeclaracao(xmlRetEvento)}</procEventoNFe>`;

/**
 * Inutilização homologada = pedido assinado + retInutNFe (TProcInutNFe).
 * A raiz é "ProcInutNFe", com P MAIÚSCULO: é assim que o schema oficial
 * declara o elemento (procInutNFe_v4.00.xsd, PL_010d) — diferente do nfeProc
 * e do procEventoNFe.
 */
export const montarProcInutNFe = (xmlInut: string, xmlRetInut: string): string =>
  `${DECLARACAO}<ProcInutNFe xmlns="${NS_NFE}" versao="4.00">${semDeclaracao(xmlInut)}${semDeclaracao(xmlRetInut)}</ProcInutNFe>`;

// ─── Transporte ─────────────────────────────────────────────────────────────

export type PedidoHttp = { url: string; corpo: string; cabecalhos: Record<string, string>; timeoutMs: number };
export type RespostaHttp = { status: number; corpo: string };
/** Quem leva o envelope. Injetável: o teste troca por um que devolve as respostas de exemplo. */
export type Transporte = (pedido: PedidoHttp) => Promise<RespostaHttp>;

/**
 * Falha de transporte. `enviado` diz se o corpo PODE ter chegado à SEFAZ:
 * falso = caiu antes (DNS, conexão recusada, handshake) e o número da nota
 * não foi "tentado"; verdadeiro = o pedido saiu e a resposta não veio
 * (timeout, conexão cortada), e a nota pode estar autorizada lá.
 * O Manual de contingência 2.0 (item 4, "Exemplo prático") depende disso: o
 * número tentado não pode ser reaproveitado na contingência.
 */
export class FalhaDeTransporte extends Error {
  constructor(mensagem: string, public readonly enviado: boolean, public readonly codigo?: string) {
    super(mensagem);
  }
}

/** As ACs em que o cliente confia: a lista do Node + ICP-Brasil. */
export const autoridadesConfiaveis = (): string[] => [
  ...tls.rootCertificates,
  ...CADEIA_ICP_BRASIL.map((c) => c.pem),
];

const agentes = new Map<string, https.Agent>();

/** Agente HTTPS com o certificado da loja. Um por certificado, reaproveitado (keep-alive). */
export function agenteDoCertificado(cert: CertificadoCarregado, autoridadesExtras: string[] = []): https.Agent {
  const chave = `${cert.cnpj}:${cert.numeroDeSerie}:${autoridadesExtras.length}`;
  let agente = agentes.get(chave);
  if (!agente) {
    agente = new https.Agent({
      key: cert.chavePrivadaPem,
      // O certificado do titular primeiro, depois as intermediárias do .pfx
      // (o PEM do forge já termina em quebra de linha).
      cert: [cert.certificadoPem, ...cert.cadeiaPem].join(""),
      ca: [...autoridadesConfiaveis(), ...autoridadesExtras],
      minVersion: "TLSv1.2",
      keepAlive: true,
      maxSockets: 4,
    });
    agentes.set(chave, agente);
  }
  return agente;
}

/**
 * O transporte de verdade: POST HTTPS com mTLS.
 * `autoridadesExtras` existe para o teste (servidor local com certificado
 * próprio); em produção fica vazio — só Node + ICP-Brasil.
 */
export function transporteHttps(cert: CertificadoCarregado, autoridadesExtras: string[] = []): Transporte {
  const agent = agenteDoCertificado(cert, autoridadesExtras);
  return (pedido) =>
    new Promise<RespostaHttp>((resolve, reject) => {
      // "Pode ter chegado" = o handshake TLS terminou E o corpo foi todo
      // entregue ao sistema operacional. Só o "finish" não basta: com o
      // socket ainda negociando o TLS, o Node aceita a escrita num buffer e
      // emite "finish" — e uma falha de handshake (cadeia ICP, certificado)
      // queimaria o número da nota sem nada ter saído.
      let apertouMao = false;
      let corpoSaiu = false;
      const talvezRecebido = () => apertouMao && corpoSaiu;
      const req = https.request(
        pedido.url,
        {
          method: "POST",
          agent,
          headers: { ...pedido.cabecalhos, "Content-Length": Buffer.byteLength(pedido.corpo, "utf8") },
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (d: Buffer) => partes.push(d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
          res.on("error", (e) => reject(new FalhaDeTransporte(`Resposta interrompida: ${e.message}`, true, (e as any).code)));
        }
      );
      req.on("socket", (s: any) => {
        // Socket reaproveitado (keep-alive) já vem com o TLS negociado.
        if (typeof s.getProtocol === "function" && s.getProtocol()) apertouMao = true;
        else s.once("secureConnect", () => (apertouMao = true));
      });
      req.setTimeout(pedido.timeoutMs, () => {
        req.destroy(new FalhaDeTransporte(`A SEFAZ não respondeu em ${Math.round(pedido.timeoutMs / 1000)} s.`, talvezRecebido(), "ETIMEDOUT"));
      });
      req.on("error", (e: any) => {
        if (e instanceof FalhaDeTransporte) return reject(e);
        const codigo = String(e?.code ?? "");
        const doTls = /CERT|UNABLE_TO|SELF_SIGNED|ERR_TLS|ERR_SSL|EPROTO/.test(codigo);
        reject(
          new FalhaDeTransporte(
            doTls
              ? `Falha no TLS com a SEFAZ (${codigo}): confira a cadeia ICP-Brasil embutida (icp-brasil.ts) e o certificado da loja.`
              : `Falha de conexão com a SEFAZ: ${e?.message ?? e}`,
            talvezRecebido(),
            codigo || undefined
          )
        );
      });
      req.on("finish", () => {
        corpoSaiu = true;
      });
      req.end(pedido.corpo, "utf8");
    });
}

/**
 * Chama um serviço e devolve o elemento de resposta (retEnviNFe, retConsSitNFe...).
 * HTTP diferente de 200 sem SOAP legível vira FalhaDeTransporte (enviado=true):
 * a SEFAZ recebeu o pedido e não conseguiu responder.
 */
export async function chamarServico(p: {
  uf: string;
  ambiente: Ambiente;
  servico: Servico;
  mensagem: string;
  transporte: Transporte;
  timeoutMs?: number;
}): Promise<{ resposta: Element; corpo: string; status: number }> {
  const url = urlDoServico(p.uf, p.ambiente, p.servico);
  const r = await p.transporte({
    url,
    corpo: envelopeSoap(p.servico, p.mensagem),
    cabecalhos: cabecalhosSoap(p.servico),
    timeoutMs: p.timeoutMs ?? 30_000,
  });
  if (r.status === 403 || r.status === 401) {
    throw new FalhaDeTransporte(
      `A SEFAZ recusou o certificado digital (HTTP ${r.status}). Confira se o A1 é ICP-Brasil, está dentro da validade e é da loja.`,
      false,
      `HTTP${r.status}`
    );
  }
  try {
    return { resposta: lerRespostaSoap(r.corpo), corpo: r.corpo, status: r.status };
  } catch (e) {
    if (r.status >= 500 || r.status === 0) {
      throw new FalhaDeTransporte(`A SEFAZ respondeu HTTP ${r.status} sem mensagem legível.`, true, `HTTP${r.status}`);
    }
    throw e;
  }
}
