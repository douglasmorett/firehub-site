/**
 * Gera um certificado A1 de TESTE (auto-assinado, sem valor nenhum) no
 * formato ICP-Brasil de pessoa jurídica, para os testes do emissor de NFC-e
 * (scripts/teste-nfce-*.ts). NÃO serve para a SEFAZ — ela só aceita cadeia
 * ICP-Brasil de verdade; serve para exercitar leitura do .pfx, extração do
 * CNPJ, assinatura XMLDSig e a assinatura RSA do QR v3.
 *
 *   node scripts/nfce-certificado-de-teste.mjs
 *
 * O que imita do certificado real (DOC-ICP-04):
 *  - CN "RAZÃO SOCIAL:CNPJ";
 *  - subjectAltName com otherName 2.16.76.1.3.3 = CNPJ (OCTET STRING, como a
 *    maioria das ACs grava) e 2.16.76.1.3.2 = nome do responsável;
 *  - keyUsage de assinatura e extendedKeyUsage clientAuth (é o que o mTLS da
 *    SEFAZ pede).
 *
 * Grava dois .pfx com a mesma chave:
 *  - nfce-certificado-teste.pfx       — cifra moderna (AES-256, MAC SHA-256), o padrão do OpenSSL 3;
 *  - nfce-certificado-teste-3des.pfx  — 3DES + MAC SHA-1, o formato "antigo" que várias
 *    certificadoras ainda entregam e que o OpenSSL 3 do Node recusa em https.Agent({ pfx }).
 * Senha dos dois: "firehub-teste".
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, "fixtures");
const SENHA = "firehub-teste";
const CNPJ = "64568087000180"; // NIK COMERCIO DE ALIMENTOS LTDA
const RAZAO = "NIK COMERCIO DE ALIMENTOS LTDA";

function acharOpenssl() {
  const candidatos = [
    process.env.OPENSSL,
    "openssl",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  ].filter(Boolean);
  for (const c of candidatos) {
    try {
      execFileSync(c, ["version"], { stdio: "pipe" });
      return c;
    } catch {}
  }
  throw new Error("openssl não encontrado. Defina OPENSSL=<caminho do openssl.exe> (vem com o Git for Windows).");
}

const openssl = acharOpenssl();
const tmp = join(tmpdir(), `nfce-cert-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(destino, { recursive: true });

const cnf = join(tmp, "cert.cnf");
writeFileSync(
  cnf,
  `[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
string_mask = utf8only

[dn]
C = BR
O = ICP-Brasil
OU = Certificado de TESTE - sem valor fiscal
CN = ${RAZAO}:${CNPJ}

[ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation,keyEncipherment
extendedKeyUsage = clientAuth,emailProtection
subjectKeyIdentifier = hash
subjectAltName = @san

[san]
otherName.1 = 2.16.76.1.3.3;FORMAT:ASCII,OCT:${CNPJ}
otherName.2 = 2.16.76.1.3.2;FORMAT:ASCII,OCT:RESPONSAVEL DE TESTE
email.1 = teste@firehub.invalid
`
);

const chave = join(tmp, "chave.pem");
const cert = join(tmp, "cert.pem");
execFileSync(openssl, ["genrsa", "-out", chave, "2048"], { stdio: "pipe" });
// Validade FIXA (01/01/2025 a 31/12/2035): os testes rodam com um "agora" fixo
// (29/09/2026) e um certificado que só começa a valer hoje seria "ainda não
// válido" para eles. -not_before/-not_after existem desde o OpenSSL 3.4; no
// mais antigo, cai para -days (e aí os testes com data fixa podem falhar).
const base = ["req", "-new", "-x509", "-key", chave, "-out", cert, "-sha256", "-config", cnf];
try {
  execFileSync(openssl, [...base, "-not_before", "20250101000000Z", "-not_after", "20351231235959Z"], { stdio: "pipe" });
} catch {
  console.warn("⚠️  openssl sem -not_before: o certificado começa a valer agora.");
  execFileSync(openssl, [...base, "-days", "3650"], { stdio: "pipe" });
}

const moderno = join(destino, "nfce-certificado-teste.pfx");
const antigo = join(destino, "nfce-certificado-teste-3des.pfx");
execFileSync(openssl, ["pkcs12", "-export", "-inkey", chave, "-in", cert, "-out", moderno, "-passout", `pass:${SENHA}`, "-name", RAZAO], { stdio: "pipe" });
execFileSync(
  openssl,
  ["pkcs12", "-export", "-inkey", chave, "-in", cert, "-out", antigo, "-passout", `pass:${SENHA}`, "-name", RAZAO,
    "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1"],
  { stdio: "pipe" }
);

console.log(execFileSync(openssl, ["x509", "-in", cert, "-noout", "-subject", "-enddate", "-ext", "subjectAltName"]).toString());
rmSync(tmp, { recursive: true, force: true });
console.log(`✅ ${moderno}\n✅ ${antigo}\n   senha: ${SENHA}`);
if (!existsSync(moderno) || !existsSync(antigo)) process.exit(1);
