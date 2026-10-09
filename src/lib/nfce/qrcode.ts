/**
 * /src/lib/nfce/qrcode.ts
 *
 * A URL do QR Code da NFC-e (grupo infNFeSupl, campos qrCode e urlChave).
 *
 * Fonte: "Manual de Padrões — DANFE NFC-e e QR-Code, versões 2.00 e 3.00",
 * versão 6.0 (março/2025), seções 4.3 (v2) e 4.4 (v3), e a NT 2025.001, que
 * criou o QR v3. As URLs por UF são as publicadas no Portal Nacional da NFC-e
 * (nfce.encat.org → Desenvolvedor → "URL por UF utilizada para consulta chave",
 * páginas baixadas em 29/09/2026).
 *
 *  - v2 ONLINE:  ?p=chave|2|tpAmb|idCSC|SHA1hex(chave|2|tpAmb|idCSC + CSC)
 *  - v2 OFFLINE: ?p=chave|2|tpAmb|dd|vNF|digValHex|idCSC|SHA1hex(chave|2|tpAmb|dd|vNF|digValHex|idCSC + CSC)
 *                (digValHex = os bytes ASCII do DigestValue em base64, em hexadecimal — 56 posições)
 *  - v3 ONLINE:  ?p=chave|3|tpAmb           (sem CSC)
 *  - v3 OFFLINE: ?p=chave|3|tpAmb|dd|vNF|tpIdDest|idDest|assinaturaRSA-SHA1-base64(parâmetros 1 a 7)
 *
 * O v2 é o padrão (a loja cadastra o CSC no portal da SEFAZ); o v3 é opção da
 * empresa (Manual 6.0, "Observação 3") e dispensa o CSC.
 *
 * O schema (leiauteNFe_v4.00.xsd do PL_010f, elemento qrCode) confere cada
 * formato por expressão regular — o teste valida o XML inteiro contra ele.
 */
import { createHash } from "node:crypto";
import { dec2 } from "./xml";

export type Ambiente = 1 | 2;

type PorAmbiente = { producao: string; homologacao: string };

/** O mesmo endereço nos dois ambientes (a SEFAZ separa pelo tpAmb que vai no QR). */
const igual = (url: string): PorAmbiente => ({ producao: url, homologacao: url });

/**
 * Endereço da consulta por QR Code (a "1ª parte" da URL, sem o "?p=").
 *
 * As 27 UF, da tabela "URL por UF utilizada QR code" do portal
 * (nfce.encat.org/desenvolvedor/qrcode, produção e homologação, baixada em
 * 09/10/2026) — o portal escreve "…?" no fim de algumas; o "?p=" é posto
 * aqui na montagem. Onde o portal dá duas datas, vale a vigente em 10/2026
 * (GO: nfeweb desde 16/06/2025; RN: sefaz.rn.gov.br desde 25/05/2026, o
 * set.rn.gov.br valeu até 30/09/2026; PB: sefaz.pb.gov.br; RJ: consultadfe;
 * MG: portalsped). Cruzada com storage/wsnfe_4.00_mod65.xml da NFePHP: as
 * duas fontes batem em todas, menos as três marcadas "conferir" — nelas
 * fica a do portal, e a primeira nota de homologação da UF é que confirma.
 */
export const URL_DO_QRCODE: Record<string, PorAmbiente> = {
  AC: { producao: "http://www.sefaznet.ac.gov.br/nfce/qrcode", homologacao: "http://www.hml.sefaznet.ac.gov.br/nfce/qrcode" },
  AL: igual("http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp"),
  // AM, conferir na 1ª nota: o portal não traz o esquema e a NFePHP usa
  // sistemas.sefaz.am.gov.br/nfceweb-hom para homologação.
  AM: { producao: "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp", homologacao: "https://homnfce.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp" },
  AP: { producao: "https://www.sefaz.ap.gov.br/nfce/nfcep.php", homologacao: "https://www.sefaz.ap.gov.br/nfcehml/nfce.php" },
  BA: { producao: "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx", homologacao: "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx" },
  CE: { producao: "http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html", homologacao: "http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html" },
  DF: igual("http://www.fazenda.df.gov.br/nfce/qrcode"),
  // ES, conferir na 1ª nota: o portal publica a pasta ("ConsultaNFCe/"); a NFePHP, "ConsultaNFCe/qrcode.aspx".
  ES: { producao: "http://app.sefaz.es.gov.br/ConsultaNFCe/", homologacao: "http://homologacao.sefaz.es.gov.br/ConsultaNFCe/" },
  GO: { producao: "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe", homologacao: "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe" },
  // MA, conferir na 1ª nota: o portal não traz o esquema e a NFePHP usa www.nfce / www.hom.nfce.
  MA: { producao: "http://nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp", homologacao: "http://homologacao.sefaz.ma.gov.br/portal/consultarNFCe.jsp" },
  MG: igual("https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml"),
  MS: igual("http://www.dfe.ms.gov.br/nfce/qrcode"),
  MT: { producao: "http://www.sefaz.mt.gov.br/nfce/consultanfce", homologacao: "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce" },
  PA: {
    producao: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
    homologacao: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
  },
  PB: { producao: "http://www.sefaz.pb.gov.br/nfce", homologacao: "http://www.sefaz.pb.gov.br/nfcehom" },
  PE: { producao: "http://nfce.sefaz.pe.gov.br/nfce/consulta", homologacao: "http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta" },
  PI: igual("http://www.sefaz.pi.gov.br/nfce/qrcode"),
  PR: igual("http://www.fazenda.pr.gov.br/nfce/qrcode"),
  RJ: igual("https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode"),
  RN: { producao: "https://nfce.sefaz.rn.gov.br/consultarNFCe.aspx", homologacao: "https://hom.nfce.sefaz.rn.gov.br/consultarNFCe.aspx" },
  RO: igual("http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp"),
  RR: { producao: "https://www.sefaz.rr.gov.br/nfce/servlet/qrcode", homologacao: "http://200.174.88.103:8080/nfce/servlet/qrcode" },
  RS: igual("https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx"),
  SC: { producao: "https://sat.sef.sc.gov.br/nfce/consulta", homologacao: "https://hom.sat.sef.sc.gov.br/nfce/consulta" },
  SE: { producao: "http://www.nfce.se.gov.br/nfce/qrcode", homologacao: "http://www.hom.nfe.se.gov.br/nfce/qrcode" },
  SP: { producao: "https://www.nfce.fazenda.sp.gov.br/qrcode", homologacao: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode" },
  TO: { producao: "http://www.sefaz.to.gov.br/nfce/qrcode", homologacao: "http://homologacao.sefaz.to.gov.br/nfce/qrcode" },
};

/**
 * Endereço de consulta pela chave (urlChave, impresso no DANFE). Schema: 21 a
 * 85 caracteres. A página "URL por UF utilizada para consulta chave" do portal
 * não traz a tabela no HTML (09/10/2026); a lista é a da NFePHP
 * (storage/uri_consulta_nfce.json), que bate com o portal nas quatro UF que
 * já estavam aqui (DF, RJ, MG, PA).
 */
export const URL_DA_CONSULTA_PELA_CHAVE: Record<string, PorAmbiente> = {
  AC: igual("www.sefaznet.ac.gov.br/nfce/consulta"),
  AL: igual("www.sefaz.al.gov.br/nfce/consulta"),
  AM: igual("www.sefaz.am.gov.br/nfce/consulta"),
  AP: igual("www.sefaz.ap.gov.br/nfce/consulta"),
  BA: { producao: "http://www.sefaz.ba.gov.br/nfce/consulta", homologacao: "http://hinternet.sefaz.ba.gov.br/nfce/consulta" },
  CE: igual("www.sefaz.ce.gov.br/nfce/consulta"),
  DF: igual("www.fazenda.df.gov.br/nfce/consulta"),
  ES: igual("www.sefaz.es.gov.br/nfce/consulta"),
  GO: { producao: "www.sefaz.go.gov.br/nfce/consulta", homologacao: "www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao" },
  MA: igual("www.sefaz.ma.gov.br/nfce/consulta"),
  MG: { producao: "https://portalsped.fazenda.mg.gov.br/portalnfce", homologacao: "https://hportalsped.fazenda.mg.gov.br/portalnfce" },
  MS: igual("http://www.dfe.ms.gov.br/nfce/consulta"),
  MT: { producao: "http://www.sefaz.mt.gov.br/nfce/consultanfce", homologacao: "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce" },
  PA: igual("www.sefa.pa.gov.br/nfce/consulta"),
  PB: { producao: "www.sefaz.pb.gov.br/nfce/consulta", homologacao: "www.sefaz.pb.gov.br/nfcehom" },
  PE: igual("nfce.sefaz.pe.gov.br/nfce/consulta"),
  PI: igual("www.sefaz.pi.gov.br/nfce/consulta"),
  PR: igual("http://www.fazenda.pr.gov.br/nfce/consulta"),
  RJ: igual("www.fazenda.rj.gov.br/nfce/consulta"),
  RN: igual("www.set.rn.gov.br/nfce/consulta"),
  RO: igual("www.sefin.ro.gov.br/nfce/consulta"),
  RR: igual("www.sefaz.rr.gov.br/nfce/consulta"),
  RS: igual("www.sefaz.rs.gov.br/nfce/consulta"),
  SC: { producao: "https://sat.sef.sc.gov.br/nfce/consulta", homologacao: "https://hom.sat.sef.sc.gov.br/nfce/consulta" },
  SE: { producao: "http://www.nfce.se.gov.br/nfce/consulta", homologacao: "http://www.hom.nfe.se.gov.br/nfce/consulta" },
  SP: { producao: "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica", homologacao: "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica" },
  TO: { producao: "www.sefaz.to.gov.br/nfce/consulta", homologacao: "http://homologacao.sefaz.to.gov.br/nfce/consulta.jsf" },
};

const doAmbiente = (t: PorAmbiente, ambiente: Ambiente) => (ambiente === 1 ? t.producao : t.homologacao);

export function urlsDaUf(uf: string, ambiente: Ambiente): { qrCode: string; urlChave: string } {
  const sigla = String(uf ?? "").trim().toUpperCase();
  const qr = URL_DO_QRCODE[sigla];
  const consulta = URL_DA_CONSULTA_PELA_CHAVE[sigla];
  if (!qr || !consulta) {
    throw new Error(`Sem endereço de QR Code cadastrado para a UF "${sigla}". Veja nfce.encat.org → Desenvolvedor.`);
  }
  return { qrCode: doAmbiente(qr, ambiente), urlChave: doAmbiente(consulta, ambiente) };
}

/** SHA-1 em hexadecimal MAIÚSCULO, como no exemplo do manual (seção 4.3.6). */
export const sha1Hex = (texto: string): string => createHash("sha1").update(texto, "utf8").digest("hex").toUpperCase();

/**
 * Identificador do CSC "sem os zeros não significativos" (Manual 6.0, tabela 2,
 * parâmetro 4): o portal mostra "000001", o QR leva "1".
 */
export function idCscSemZeros(idCsc: string | number): string {
  const s = String(idCsc ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) throw new Error(`Identificador do CSC inválido: "${s}" (1 a 6 dígitos).`);
  return String(Number(s));
}

function conferirCsc(csc: string): string {
  const c = String(csc ?? "").trim();
  // O manual diz "16 a 36 bytes" (4.3.3), mas o próprio exemplo dele (4.3.6)
  // usa um CSC de 40 caracteres. Só o mínimo é conferido: pega o CSC vazio
  // ou cortado na colagem, que é o erro que acontece de verdade.
  if (c.length < 16) throw new Error(`CSC com ${c.length} caracteres — o CSC tem pelo menos 16.`);
  return c;
}

const conferirChave = (chave: string) => {
  if (!/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(chave)) throw new Error(`Chave de acesso inválida para o QR Code: "${chave}".`);
  return chave;
};

/** Dia da emissão com dois dígitos, tirado do dhEmi JÁ no fuso da loja ("2026-09-02T..." → "02"). */
export const diaDoDhEmi = (dhEmi: string): string => {
  const m = /^\d{4}-\d{2}-(\d{2})T/.exec(dhEmi);
  if (!m) throw new Error(`dhEmi fora do formato: "${dhEmi}".`);
  return m[1];
};

/** Os bytes ASCII do DigestValue (base64) em hexadecimal (Manual 6.0, 4.3.5, passo 1). */
export const digestEmHex = (digestValueBase64: string): string => Buffer.from(digestValueBase64.trim(), "ascii").toString("hex");

export function qrCodeV2Online(p: { urlBase: string; chave: string; ambiente: Ambiente; idCsc: string | number; csc: string }): string {
  const parametros = [conferirChave(p.chave), "2", String(p.ambiente), idCscSemZeros(p.idCsc)].join("|");
  const hash = sha1Hex(parametros + conferirCsc(p.csc));
  return `${p.urlBase}?p=${parametros}|${hash}`;
}

export function qrCodeV2Offline(p: {
  urlBase: string;
  chave: string;
  ambiente: Ambiente;
  /** Dia da emissão, 2 dígitos. */
  dia: string;
  /** vNF em centavos. */
  valorTotalEmCentavos: number;
  /** O DigestValue da assinatura da própria nota (base64, 28 caracteres). */
  digestValue: string;
  idCsc: string | number;
  csc: string;
}): string {
  if (!/^(0[1-9]|[12]\d|3[01])$/.test(p.dia)) throw new Error(`Dia inválido para o QR: "${p.dia}".`);
  const digHex = digestEmHex(p.digestValue);
  if (digHex.length !== 56) throw new Error("DigestValue da nota não tem 28 caracteres (SHA-1 em base64).");
  const parametros = [
    conferirChave(p.chave),
    "2",
    String(p.ambiente),
    p.dia,
    dec2(p.valorTotalEmCentavos),
    digHex,
    idCscSemZeros(p.idCsc),
  ].join("|");
  const hash = sha1Hex(parametros + conferirCsc(p.csc));
  return `${p.urlBase}?p=${parametros}|${hash}`;
}

export function qrCodeV3Online(p: { urlBase: string; chave: string; ambiente: Ambiente }): string {
  return `${p.urlBase}?p=${conferirChave(p.chave)}|3|${p.ambiente}`;
}

/** Tipo do destinatário no QR v3 (Manual 6.0, tabela 7): 1 = CNPJ, 2 = CPF, 3 = estrangeiro. */
export type DestinatarioDoQr = { tipo: 1 | 2 | 3; id?: string } | null;

/**
 * Os parâmetros 1 a 7 do QR v3 offline, na ordem — é ESTE texto que se assina
 * (RSA-SHA1, mesmo certificado da nota). Sem destinatário, "informar apenas o
 * separador" (Manual 6.0, tabela 7).
 */
export function parametrosV3Offline(p: {
  chave: string;
  ambiente: Ambiente;
  dia: string;
  valorTotalEmCentavos: number;
  destinatario?: DestinatarioDoQr;
}): string {
  const d = p.destinatario ?? null;
  const tipo = d ? String(d.tipo) : "";
  // Estrangeiro não leva o identificador ("Caso Destinatário estrangeiro ou não identificado, informar apenas o separador").
  const id = d && d.tipo !== 3 ? String(d.id ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "") : "";
  return [conferirChave(p.chave), "3", String(p.ambiente), p.dia, dec2(p.valorTotalEmCentavos), tipo, id].join("|");
}

export function qrCodeV3Offline(p: {
  urlBase: string;
  chave: string;
  ambiente: Ambiente;
  dia: string;
  valorTotalEmCentavos: number;
  destinatario?: DestinatarioDoQr;
  /** Assina o texto com RSA-SHA1 e devolve base64 (assinatura.ts → assinarTextoRsaSha1). */
  assinar: (texto: string) => string;
}): string {
  const parametros = parametrosV3Offline(p);
  return `${p.urlBase}?p=${parametros}|${p.assinar(parametros)}`;
}
