/**
 * URL que veio de fora não pode apontar para dentro do servidor (SSRF) —
 * src/lib/url-externa.ts. O DNS e o fetch são falsos: nada sai para a rede.
 *
 *   npx tsx scripts/teste-url-externa.ts
 *
 * O que trava:
 *  - https público passa (CDN do iFood, WhatsApp);
 *  - loopback, localhost, metadata da nuvem, rede privada, [::1], file:// e
 *    nome que resolve para 127.0.0.1 são recusados;
 *  - redirecionamento para endereço interno é recusado; para público, segue;
 *  - POST não segue 302 (devolve a 3xx), segue 307.
 */
import { garantirUrlExterna, fetchExterno, ipInterno } from "../src/lib/url-externa";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

// DNS falso: nome → IPs.
const dns: Record<string, string[]> = {
  "static-images.ifood.com.br": ["18.164.10.20"],
  "mmg.whatsapp.net": ["157.240.12.60", "2a03:2880:f20d:c5:face:b00c:0:167"],
  "parceiro.com.br": ["200.147.67.142"],
  "interno.ataque.com": ["127.0.0.1"],
  "misto.ataque.com": ["8.8.8.8", "10.0.0.5"],
};
const lookup = async (host: string) => {
  const ips = dns[host];
  if (!ips) throw new Error(`ENOTFOUND ${host}`);
  return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

async function passa(url: string): Promise<boolean> {
  try { await garantirUrlExterna(url, { lookup }); return true; } catch { return false; }
}

async function main() {
  console.log("Endereços:");
  conferir("https público (iFood)", await passa("https://static-images.ifood.com.br/pratos/x.jpg"), true);
  conferir("CDN do WhatsApp (IPv4 + IPv6 públicos)", await passa("https://mmg.whatsapp.net/v/t62/a.enc"), true);
  conferir("http público com porta", await passa("http://parceiro.com.br:8080/hook"), true);
  conferir("http://127.0.0.1", await passa("http://127.0.0.1:3000/api/cron/x"), false);
  conferir("http://localhost", await passa("http://localhost:3000/"), false);
  conferir("http://169.254.169.254 (metadata)", await passa("http://169.254.169.254/latest/meta-data/"), false);
  conferir("http://10.0.0.1", await passa("http://10.0.0.1/"), false);
  conferir("http://172.20.0.3", await passa("http://172.20.0.3/"), false);
  conferir("http://192.168.0.1", await passa("http://192.168.0.1/"), false);
  conferir("http://100.64.0.1 (CGNAT)", await passa("http://100.64.0.1/"), false);
  conferir("http://0.0.0.0", await passa("http://0.0.0.0:3000/"), false);
  conferir("http://[::1]", await passa("http://[::1]:3000/"), false);
  conferir("http://[::ffff:127.0.0.1]", await passa("http://[::ffff:127.0.0.1]/"), false);
  conferir("http://2130706433 (127.0.0.1 em decimal)", await passa("http://2130706433/"), false);
  conferir("file://", await passa("file:///etc/passwd"), false);
  conferir("nome que resolve para 127.0.0.1", await passa("http://interno.ataque.com/"), false);
  conferir("nome com um IP público e um privado", await passa("http://misto.ataque.com/"), false);
  conferir("ipInterno fc00::/7", ipInterno("fd12::1"), true);
  conferir("ipInterno fe80::/10", ipInterno("fe80::1"), true);
  conferir("ipInterno 8.8.8.8", ipInterno("8.8.8.8"), false);

  console.log("Redirecionamento:");
  const chamadas: string[] = [];
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method || "GET"} ${url} redirect=${init?.redirect}`);
    if (url.endsWith("/vai-pra-dentro")) return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    if (url.endsWith("/vai-pra-fora")) return new Response(null, { status: 301, headers: { location: "https://static-images.ifood.com.br/ok.jpg" } });
    if (url.endsWith("/post-302")) return new Response(null, { status: 302, headers: { location: "https://parceiro.com.br/novo" } });
    if (url.endsWith("/post-307")) return new Response(null, { status: 307, headers: { location: "https://parceiro.com.br/novo" } });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  const deps = { lookup, fetch: fetchFalso };

  let recusou = false;
  try { await fetchExterno("https://parceiro.com.br/vai-pra-dentro", {}, deps); } catch { recusou = true; }
  conferir("302 para metadata é recusado", recusou, true);
  conferir("nunca bateu no metadata", chamadas.some((c) => c.includes("169.254")), false);
  conferir("fetch sempre com redirect=manual", chamadas.every((c) => c.endsWith("redirect=manual")), true);

  const r1 = await fetchExterno("https://parceiro.com.br/vai-pra-fora", {}, deps);
  conferir("301 para público segue até o 200", r1.status, 200);

  const r2 = await fetchExterno("https://parceiro.com.br/post-302", { method: "POST", body: "{}" }, deps);
  conferir("POST não segue 302", r2.status, 302);
  const r3 = await fetchExterno("https://parceiro.com.br/post-307", { method: "POST", body: "{}" }, deps);
  conferir("POST segue 307", r3.status, 200);

  console.log(`\n${ok} ok, ${falhou} falhou`);
  if (falhou) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
