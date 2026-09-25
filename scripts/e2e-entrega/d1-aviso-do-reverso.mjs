// D1 (rodada 2) — o aviso quando o GPS não vira o ponto do cliente, com o
// reverse geocode do Nominatim SIMULADO (page.route, nada sai para fora):
//  a) 200 com address só de cidade → "O mapa não tem o nome da rua nem do bairro…" (sem "agora")
//  b) 429                           → "Não consegui ler o nome da rua desse ponto agora…"
//  c) 200 com address.quarter       → bairro preenchido e o GPS vira o ponto (sem alerta)
import { navegador, contextoCelular, dormir, gravarResultado, BASE, irParaOCheckout, vis, campoRua, campoBairro, esperarPainel } from "./comum.mjs";

const GPS = { latitude: -22.8455, longitude: -42.0270, accuracy: 20 };
const CASOS = [
  { nome: "a-sem-nome", status: 200, corpo: { place_id: 1, display_name: "Cabo Frio, RJ, Brasil", address: { city: "Cabo Frio", state: "Rio de Janeiro", country: "Brasil", country_code: "br" } } },
  { nome: "b-429", status: 429, corpo: { error: "Too Many Requests" } },
  { nome: "c-quarter", status: 200, corpo: { place_id: 2, display_name: "Loteamento Teste, Cabo Frio", address: { quarter: "Loteamento Teste", city: "Cabo Frio", country_code: "br" } } },
];
const r = { casos: [] };
const b = await navegador();
for (const c of CASOS) {
  const ctx = await contextoCelular(b, { geolocation: GPS, permissions: ["geolocation"] });
  await ctx.grantPermissions(["geolocation"], { origin: BASE });
  const page = await ctx.newPage();
  const caso = { nome: c.nome, dialogos: [], cotacoes: [] };
  page.on("dialog", async (d) => { caso.dialogos.push(d.message()); await d.accept(); });
  page.on("request", (q) => { if (q.url().includes("/api/delivery-fee")) caso.cotacoes.push(Object.fromEntries(new URL(q.url()).searchParams)); });
  await page.route("https://nominatim.openstreetmap.org/reverse**", (route) =>
    route.fulfill({ status: c.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(c.corpo) }));
  try {
    await irParaOCheckout(page, { nome: `Cliente D1 ${c.nome}` });
    await vis(page, "button").filter({ hasText: "Usar minha localização atual (GPS)" }).first().click();
    await dormir(4000);
    caso.painel = await esperarPainel(page, { ms: 8000 });
    caso.rua = await campoRua(page).inputValue();
    caso.bairro = await campoBairro(page).inputValue();
    caso.usaGps = /Usando a sua localização \(GPS\)/.test(caso.painel);
  } catch (e) {
    caso.falha = String(e?.stack || e).slice(0, 800);
  }
  r.casos.push(caso);
  await ctx.close();
}
gravarResultado("d1-aviso", r);
console.log(JSON.stringify(r, null, 2));
await b.close();
