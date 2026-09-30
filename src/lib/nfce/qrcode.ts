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

/**
 * Endereço da consulta por QR Code (a "1ª parte" da URL, sem o "?p=").
 * Só as UF que o FireHub atende hoje; UF nova entra aqui com a fonte.
 */
export const URL_DO_QRCODE: Record<string, PorAmbiente> = {
  // Distrito Federal: o mesmo endereço nos dois ambientes; a SEFAZ separa pelo tpAmb do QR.
  DF: { producao: "http://www.fazenda.df.gov.br/nfce/qrcode", homologacao: "http://www.fazenda.df.gov.br/nfce/qrcode" },
  // Rio de Janeiro: consultadfe desde 19/12/2023 (o www4 valeu até 02/09/2024).
  RJ: {
    producao: "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
    homologacao: "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
  },
  // Minas Gerais: portalsped desde 21/03/2022.
  MG: {
    producao: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
    homologacao: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
  },
  PA: {
    producao: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
    homologacao: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
  },
};

/** Endereço de consulta pela chave (urlChave, impresso no DANFE). Schema: 21 a 85 caracteres. */
export const URL_DA_CONSULTA_PELA_CHAVE: Record<string, PorAmbiente> = {
  DF: { producao: "www.fazenda.df.gov.br/nfce/consulta", homologacao: "www.fazenda.df.gov.br/nfce/consulta" },
  RJ: { producao: "www.fazenda.rj.gov.br/nfce/consulta", homologacao: "www.fazenda.rj.gov.br/nfce/consulta" },
  MG: {
    producao: "https://portalsped.fazenda.mg.gov.br/portalnfce",
    homologacao: "https://hportalsped.fazenda.mg.gov.br/portalnfce",
  },
  PA: { producao: "www.sefa.pa.gov.br/nfce/consulta", homologacao: "www.sefa.pa.gov.br/nfce/consulta" },
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
