/**
 * Consulta o STATUS do serviço de NFC-e na SEFAZ com o certificado A1 de
 * VERDADE da loja — o primeiro teste do dia em que a NIK mandar o .pfx.
 * Só lê (consStatServ): não emite, não numera, não gasta nada.
 *
 *   NFCE_PFX="C:\caminho\nik.pfx" NFCE_SENHA="..." npx tsx scripts/nfce-status-sefaz.mjs
 *
 * Variáveis:
 *   NFCE_PFX       caminho do .pfx (obrigatório)
 *   NFCE_SENHA     senha do .pfx (obrigatório)
 *   NFCE_UF        UF do autorizador (padrão DF → SVRS)
 *   NFCE_AMBIENTE  2 = homologação (padrão) | 1 = produção
 *
 * Roda com `npx tsx` (e não `node`) porque importa os módulos TypeScript do
 * emissor. O que cada resultado quer dizer:
 *   [107] Servico em Operacao ........ handshake mTLS OK, cadeia ICP OK, SEFAZ no ar.
 *   "Falha no TLS ..." ............... a cadeia ICP-Brasil embutida não cobre o servidor
 *                                      (atualizar src/lib/nfce/icp-brasil.pem/.ts).
 *   HTTP 403 ......................... a SEFAZ recusou o certificado da loja.
 *   "Senha do certificado" ........... senha errada.
 */
import { readFileSync } from "node:fs";
import { carregarCertificado, diasParaVencer } from "../src/lib/nfce/assinatura.ts";
import { statusDoServico } from "../src/lib/nfce/emissor.ts";
import { urlDoServico } from "../src/lib/nfce/sefaz.ts";

const caminho = process.env.NFCE_PFX;
const senha = process.env.NFCE_SENHA;
const uf = (process.env.NFCE_UF || "DF").toUpperCase();
const ambiente = process.env.NFCE_AMBIENTE === "1" ? 1 : 2;

if (!caminho || senha === undefined) {
  console.error("Defina NFCE_PFX (caminho do .pfx) e NFCE_SENHA.");
  process.exit(2);
}

let cert;
try {
  cert = carregarCertificado(readFileSync(caminho), senha);
} catch (e) {
  console.error(`❌ Certificado: ${e?.message ?? e}`);
  process.exit(1);
}

console.log("Certificado");
console.log(`  titular .... ${cert.titular}`);
console.log(`  CNPJ ....... ${cert.cnpj ?? "(não achei o otherName 2.16.76.1.3.3)"}`);
console.log(`  emissor .... ${cert.emissor}`);
console.log(`  validade ... ${cert.validoDe.toISOString().slice(0, 10)} a ${cert.validoAte.toISOString().slice(0, 10)} (${diasParaVencer(cert)} dias)`);
console.log(`  cadeia ..... ${cert.cadeiaPem.length} AC(s) dentro do .pfx`);
console.log(`\nSEFAZ ${uf}, ${ambiente === 1 ? "PRODUÇÃO" : "homologação"}`);
console.log(`  ${urlDoServico(uf, ambiente, "status")}`);

const inicio = Date.now();
const r = await statusDoServico({ certificado: cert, uf, ambiente });
console.log(`\n${r.ok ? "✅" : "❌"} ${r.mensagem}  (${Date.now() - inicio} ms${r.tempoMedio != null ? `, tMed ${r.tempoMedio}s` : ""})`);
if (r.dhRecbto) console.log(`  dhRecbto ${r.dhRecbto}`);
process.exit(r.ok ? 0 : 1);
