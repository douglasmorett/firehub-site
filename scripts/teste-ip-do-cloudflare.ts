/**
 * Teste de lib/ip-do-cloudflare.ts e de getClientIp atrás do Cloudflare.
 * Rodar: npx tsx scripts/teste-ip-do-cloudflare.ts
 */
import { ehIpDoCloudflare, ipRealDoSalto } from "../src/lib/ip-do-cloudflare";
import { getClientIp } from "../src/lib/rateLimit";
import { origemDaRequisicao } from "../src/lib/login-throttle";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
};
const req = (h: Record<string, string>) => new Request("https://firehubfood.com.br/x", { headers: h });

confere("borda v4 162.158.x", ehIpDoCloudflare("162.158.10.20"), true);
confere("borda v4 172.71.x", ehIpDoCloudflare("172.71.1.1"), true);
confere("borda v4 104.23.255.255 (fim de /13)", ehIpDoCloudflare("104.23.255.255"), true);
confere("fora: 104.32.0.1", ehIpDoCloudflare("104.32.0.1"), false);
confere("fora: IP da Vivo", ehIpDoCloudflare("191.248.112.112"), false);
confere("fora: Docker 10.0.1.3", ehIpDoCloudflare("10.0.1.3"), false);
confere("v4 mapeado em v6", ehIpDoCloudflare("::ffff:162.158.1.1"), true);
confere("borda v6 2606:4700::", ehIpDoCloudflare("2606:4700:3033::ac43:1"), true);
confere("borda v6 2a06:98c7 (dentro do /29)", ehIpDoCloudflare("2a06:98c7::1"), true);
confere("fora v6 2a06:98d0", ehIpDoCloudflare("2a06:98d0::1"), false);
confere("lixo", ehIpDoCloudflare("abc"), false);
confere("vazio", ehIpDoCloudflare(""), false);

confere("salto do CF + cabeçalho → cliente", ipRealDoSalto("162.158.1.1", "191.248.112.112"), "191.248.112.112");
confere("salto direto + cabeçalho forjado → salto", ipRealDoSalto("45.1.2.3", "1.1.1.1"), "45.1.2.3");

// Atrás do Cloudflare: Traefik carimba a borda como último salto.
confere("getClientIp atrás do CF", getClientIp(req({ "x-forwarded-for": "191.248.112.112, 172.70.5.5", "cf-connecting-ip": "191.248.112.112" })), "191.248.112.112");
confere("getClientIp CF sem cabeçalho → borda", getClientIp(req({ "x-forwarded-for": "172.70.5.5" })), "172.70.5.5");
// Sem Cloudflare (hoje): forjar cf-connecting-ip não muda nada.
confere("getClientIp direto, forjando", getClientIp(req({ "x-forwarded-for": "8.8.8.8, 45.1.2.3", "cf-connecting-ip": "9.9.9.9" })), "45.1.2.3");
confere("getClientIp direto, normal", getClientIp(req({ "x-forwarded-for": "45.1.2.3" })), "45.1.2.3");
confere("origemDaRequisicao atrás do CF", origemDaRequisicao(new Headers({ "x-forwarded-for": "172.64.0.9", "cf-connecting-ip": "200.1.2.3" })), "200.1.2.3");
confere("origemDaRequisicao objeto cru", origemDaRequisicao({ "x-forwarded-for": "45.1.2.3", "cf-connecting-ip": "9.9.9.9" }), "45.1.2.3");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo ok");
process.exit(falhas ? 1 : 0);
