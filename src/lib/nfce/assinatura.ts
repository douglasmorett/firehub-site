/**
 * /src/lib/nfce/assinatura.ts
 *
 * O certificado A1 da loja e a assinatura digital dos XML que vão à SEFAZ.
 *
 * ── O CERTIFICADO ───────────────────────────────────────────────────────────
 *
 * O A1 chega como .pfx (PKCS#12) com senha. É lido com node-forge, e não pelo
 * `tls`/`crypto` do Node, por um motivo concreto: boa parte dos .pfx emitidos
 * pelas certificadoras ainda vem cifrada com RC2-40 ou 3DES, que o OpenSSL 3
 * (dentro do Node 17+) recusa sem o "legacy provider" — `https.Agent({ pfx })`
 * falha com "unsupported" e a loja fica sem emitir por causa do FORMATO do
 * arquivo. Lido pelo forge, o par vira PEM (chave + certificado), que qualquer
 * OpenSSL aceita.
 *
 * O CNPJ do titular está no subjectAltName, em um otherName de OID
 * 2.16.76.1.3.3 (DOC-ICP-04, "campos otherName" do certificado de pessoa
 * jurídica). É ele que a SEFAZ compara com o emitente (rejeição 213, "CNPJ-Base
 * do Emitente difere do CNPJ-Base do Certificado Digital").
 *
 * ── A ASSINATURA ────────────────────────────────────────────────────────────
 *
 * XMLDSig "enveloped" no padrão exigido pelo MOC 7.0 (item 4.3, "Padrão de
 * Assinatura Digital"):
 *   - CanonicalizationMethod  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 *   - SignatureMethod         http://www.w3.org/2000/09/xmldsig#rsa-sha1
 *   - Transforms              enveloped-signature + c14n 20010315 (nessa ordem)
 *   - DigestMethod            http://www.w3.org/2000/09/xmldsig#sha1
 *   - Reference URI           "#" + o Id do elemento assinado (infNFe, infEvento, infInut)
 *   - KeyInfo/X509Data/X509Certificate só com o certificado do titular
 * A Signature entra como IRMÃ do elemento assinado, logo depois dele, sem
 * prefixo (xmlns="http://www.w3.org/2000/09/xmldsig#"). O schema da SEFAZ
 * (xmldsig-core-schema_v1.01.xsd) fixa esses algoritmos por enumeração — o
 * teste valida contra ele.
 */
import { createSign, createVerify, X509Certificate } from "node:crypto";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { lerXml, primeiro } from "./xml";

export const ALGORITMOS = {
  c14n: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  envelopada: "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
  rsaSha1: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  sha1: "http://www.w3.org/2000/09/xmldsig#sha1",
} as const;

/** OID do CNPJ da pessoa jurídica no otherName do certificado ICP-Brasil. */
export const OID_CNPJ_ICP = "2.16.76.1.3.3";

export type CertificadoCarregado = {
  chavePrivadaPem: string;
  /** Só o certificado do titular — é o que vai no KeyInfo. */
  certificadoPem: string;
  /** Os demais certificados do .pfx (ACs intermediárias), para o handshake TLS. */
  cadeiaPem: string[];
  /** CNPJ do otherName 2.16.76.1.3.3 (ou, na falta, do final do CN "RAZAO:CNPJ"). */
  cnpj: string | null;
  titular: string;
  emissor: string;
  numeroDeSerie: string;
  validoDe: Date;
  validoAte: Date;
};

export class ErroDoCertificado extends Error {}

// ── O .pfx FORJADO ──────────────────────────────────────────────────────────
//
// O PKCS#12 diz DENTRO DELE quantas vezes a senha é derivada: `iterations` do
// macData (a conferência da senha) e o iterationCount de cada parte cifrada
// (PBE do PKCS#12 ou PBES2/PBKDF2). O node-forge é síncrono e obedece ao
// número do arquivo ANTES de saber se a senha confere — e o arquivo é de quem
// envia. 76 bytes com 2^31−1 iterações no MAC travavam o servidor inteiro (o
// event loop, todas as lojas) por ~36 minutos. Certificado de verdade usa de
// 2.000 (Windows, OpenSSL) a 51.200 (BouncyCastle) por derivação, e um A1 faz
// umas 5 derivações (o MAC, a chave e a parte dos certificados).

/** Teto de iterações de UMA derivação (o MAC, ou uma parte cifrada). */
export const MAXIMO_DE_ITERACOES_DO_PFX = 100_000;
/**
 * Teto da SOMA das derivações do arquivo. Sem ele, 500 partes cifradas de
 * 100.000 iterações cada (cabem nos 50 KB) seriam minutos de novo. Cinco
 * derivações de 51.200 (o BouncyCastle) são 256.000: cabem.
 */
export const MAXIMO_DE_ITERACOES_POR_ARQUIVO = 300_000;

const CERTIFICADO_INVALIDO = "Certificado inválido.";

/** INTEGER do DER (sem sinal, como o forge lê) — para no primeiro byte que passa do teto. */
function inteiroDoDer(bytes: string, teto: number): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    n = n * 256 + bytes.charCodeAt(i);
    if (n > teto) return Number.POSITIVE_INFINITY;
  }
  return n;
}

/**
 * As iterações do MAC, lidas do ASN.1 EXTERNO (PFX → macData → iterations),
 * antes de o forge derivar qualquer coisa. Estrutura que não é de PFX passa
 * daqui: o validador do forge a recusa antes de derivar.
 */
function conferirIteracoesDoMac(pfx: forge.asn1.Asn1): void {
  const campos = Array.isArray(pfx.value) ? (pfx.value as forge.asn1.Asn1[]) : [];
  const macData = campos[2];
  const iteracoes = macData && Array.isArray(macData.value) ? (macData.value as forge.asn1.Asn1[])[2] : undefined;
  // Ausente = 1 (o DEFAULT do PKCS#12).
  if (!iteracoes || typeof iteracoes.value !== "string") return;
  if (inteiroDoDer(iteracoes.value, MAXIMO_DE_ITERACOES_DO_PFX) > MAXIMO_DE_ITERACOES_DO_PFX) {
    throw new ErroDoCertificado(CERTIFICADO_INVALIDO);
  }
}

/**
 * Roda a leitura do forge com teto nas derivações que ele faz com números do
 * arquivo. As partes cifradas podem estar DENTRO de outra parte cifrada (a
 * chave privada dentro do conteúdo cifrado), e só aparecem depois de abrir a
 * de fora — por isso o teto fica nas três funções de derivação que o forge
 * chama (o MAC, o PBE do PKCS#12 e o PBKDF2 do PBES2), e não numa leitura
 * prévia do arquivo. A troca vale só durante a chamada, que é síncrona:
 * nenhum outro código do processo roda no meio, e o `finally` devolve as
 * originais.
 */
function comTetoDeIteracoes<T>(ler: () => T): T {
  const f = forge as any;
  const originais = { mac: f.pkcs12.generateKey, pbe: f.pbe.generatePkcs12Key, pbkdf2: f.pkcs5.pbkdf2 };
  let soma = 0;
  const conferir = (iteracoes: unknown) => {
    const n = Number(iteracoes);
    soma += n;
    if (!Number.isFinite(n) || n > MAXIMO_DE_ITERACOES_DO_PFX || soma > MAXIMO_DE_ITERACOES_POR_ARQUIVO) {
      throw new ErroDoCertificado(CERTIFICADO_INVALIDO);
    }
  };
  // generateKey(senha, sal, id, ITERAÇÕES, n, md) e pbkdf2(senha, sal, ITERAÇÕES, dkLen, md).
  f.pkcs12.generateKey = function (this: unknown, ...a: unknown[]) {
    conferir(a[3]);
    return originais.mac.apply(this, a);
  };
  f.pbe.generatePkcs12Key = function (this: unknown, ...a: unknown[]) {
    conferir(a[3]);
    return originais.pbe.apply(this, a);
  };
  f.pkcs5.pbkdf2 = function (this: unknown, ...a: unknown[]) {
    conferir(a[2]);
    return originais.pbkdf2.apply(this, a);
  };
  try {
    return ler();
  } finally {
    f.pkcs12.generateKey = originais.mac;
    f.pbe.generatePkcs12Key = originais.pbe;
    f.pkcs5.pbkdf2 = originais.pbkdf2;
  }
}

/**
 * Lê o .pfx. Senha errada e arquivo que não é PKCS#12 viram mensagens que o
 * lojista entende; .pfx que pede derivação demais (ver "O .pfx forjado")
 * vira "Certificado inválido." sem gastar o servidor.
 */
export function carregarCertificado(pfx: Buffer | Uint8Array, senha: string): CertificadoCarregado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.createBuffer(Buffer.from(pfx).toString("binary"));
    const asn1 = forge.asn1.fromDer(der);
    conferirIteracoesDoMac(asn1);
    p12 = comTetoDeIteracoes(() => forge.pkcs12.pkcs12FromAsn1(asn1, false, senha ?? ""));
  } catch (e: any) {
    if (e instanceof ErroDoCertificado) throw e;
    const msg = String(e?.message ?? e);
    if (/mac could not be verified|invalid password|decrypt/i.test(msg)) {
      throw new ErroDoCertificado("Senha do certificado digital incorreta.");
    }
    throw new ErroDoCertificado(`O arquivo não é um certificado A1 (.pfx) legível: ${msg}`);
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].filter((b) => b.key);
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));

  if (chaves.length === 0) throw new ErroDoCertificado("O .pfx não tem a chave privada — exporte o certificado COM a chave.");
  if (certificados.length === 0) throw new ErroDoCertificado("O .pfx não tem certificado.");

  const chave = chaves[0].key as forge.pki.rsa.PrivateKey;
  // O certificado do titular é o que tem a MESMA chave pública da chave
  // privada — a ordem dos "bags" dentro do .pfx não é garantida.
  const doTitular =
    certificados.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return pub?.n && pub.n.equals(chave.n);
    }) ?? null;
  if (!doTitular) throw new ErroDoCertificado("Nenhum certificado do .pfx corresponde à chave privada.");

  const cn = doTitular.subject.getField("CN")?.value ?? "";
  const cnpj = cnpjDoCertificado(doTitular) ?? (/:([0-9A-Z]{12}[0-9]{2})\s*$/i.exec(String(cn))?.[1]?.toUpperCase() ?? null);

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(doTitular),
    cadeiaPem: certificados.filter((c) => c !== doTitular).map((c) => forge.pki.certificateToPem(c)),
    cnpj,
    titular: String(cn),
    emissor: String(doTitular.issuer.getField("CN")?.value ?? ""),
    numeroDeSerie: doTitular.serialNumber,
    validoDe: doTitular.validity.notBefore,
    validoAte: doTitular.validity.notAfter,
  };
}

/**
 * O CNPJ gravado no otherName 2.16.76.1.3.3 do subjectAltName.
 *
 * Lido do DER cru da extensão, porque o forge não interpreta otherName. O
 * conteúdo aparece como OCTET STRING na maioria das ACs, e como
 * PrintableString/UTF8String em algumas — aceita os três e pega os 14
 * caracteres do CNPJ.
 */
export function cnpjDoCertificado(cert: forge.pki.Certificate): string | null {
  const ext = (cert.extensions ?? []).find((e: any) => e.id === "2.5.29.17" || e.name === "subjectAltName") as any;
  if (!ext?.value) return null;
  try {
    const nomes = forge.asn1.fromDer(forge.util.createBuffer(ext.value));
    for (const nome of (nomes.value as forge.asn1.Asn1[]) ?? []) {
      // otherName = [0] IMPLICIT SEQUENCE { type-id OID, value [0] EXPLICIT ANY }
      if (nome.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || nome.type !== 0 || !Array.isArray(nome.value)) continue;
      const [oid, valor] = nome.value as forge.asn1.Asn1[];
      if (!oid || forge.asn1.derToOid(oid.value as string) !== OID_CNPJ_ICP) continue;
      const interno = Array.isArray(valor?.value) ? (valor.value as forge.asn1.Asn1[])[0] : valor;
      const bruto = typeof interno?.value === "string" ? interno.value : "";
      const cnpj = /[0-9A-Z]{12}[0-9]{2}/.exec(bruto.toUpperCase())?.[0];
      if (cnpj) return cnpj;
    }
  } catch {
    return null;
  }
  return null;
}

/** Faltam quantos dias para vencer (negativo = vencido). */
export function diasParaVencer(cert: CertificadoCarregado, agora: Date = new Date()): number {
  return Math.floor((cert.validoAte.getTime() - agora.getTime()) / 86_400_000);
}

export type ElementoAssinavel = "infNFe" | "infEvento" | "infInut";

/**
 * Assina o elemento (pelo Id dele) e devolve o XML com a Signature logo depois
 * dele. O XML de entrada tem de estar SEM espaços entre as tags: o que é
 * assinado é o que vai, byte a byte, e qualquer reformatação depois disto
 * invalida a assinatura (rejeição 297).
 */
export function assinarXml(xml: string, elemento: ElementoAssinavel, cert: Pick<CertificadoCarregado, "chavePrivadaPem" | "certificadoPem">): string {
  const alvo = `//*[local-name(.)='${elemento}']`;
  const assinatura = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: ALGORITMOS.rsaSha1,
    canonicalizationAlgorithm: ALGORITMOS.c14n,
  });
  assinatura.addReference({
    xpath: alvo,
    transforms: [ALGORITMOS.envelopada, ALGORITMOS.c14n],
    digestAlgorithm: ALGORITMOS.sha1,
  });
  assinatura.computeSignature(xml, { location: { reference: alvo, action: "after" } });
  return assinatura.getSignedXml();
}

/** O DigestValue da (primeira) assinatura — entra no QR offline e no digVal do protocolo. */
export function digestValueDoXml(xmlAssinado: string): string {
  const d = primeiro(lerXml(xmlAssinado), "DigestValue");
  const v = d?.textContent?.trim();
  if (!v) throw new Error("XML sem DigestValue: não está assinado.");
  return v;
}

/**
 * Confere a assinatura (usado nos testes e antes de transmitir uma nota de
 * contingência guardada — se o arquivo foi mexido, melhor saber aqui).
 */
export function verificarAssinatura(xmlAssinado: string, certificadoPem?: string): { ok: boolean; erros: string[] } {
  try {
    const doc = lerXml(xmlAssinado);
    const sig = primeiro(doc, "Signature");
    if (!sig) return { ok: false, erros: ["sem Signature"] };
    const pem =
      certificadoPem ??
      (() => {
        const b64 = primeiro(sig, "X509Certificate")?.textContent?.replace(/\s+/g, "") ?? "";
        return `-----BEGIN CERTIFICATE-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;
      })();
    const verificador = new SignedXml({ publicCert: pem });
    verificador.loadSignature(sig as any);
    const ok = verificador.checkSignature(xmlAssinado);
    return { ok, erros: ok ? [] : ["assinatura não confere"] };
  } catch (e: any) {
    return { ok: false, erros: [String(e?.message ?? e)] };
  }
}

/** RSA-SHA1 em base64 de um texto (assinatura do QR Code v3 offline — Manual QR 6.0, tabela 7). */
export function assinarTextoRsaSha1(texto: string, chavePrivadaPem: string): string {
  return createSign("RSA-SHA1").update(texto, "utf8").sign(chavePrivadaPem, "base64");
}

export function verificarTextoRsaSha1(texto: string, assinaturaBase64: string, certificadoPem: string): boolean {
  const chavePublica = new X509Certificate(certificadoPem).publicKey;
  return createVerify("RSA-SHA1").update(texto, "utf8").verify(chavePublica, assinaturaBase64, "base64");
}
