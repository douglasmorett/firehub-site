// E2 — Simulador da tela de Entrega (modo ROTA, sessão do painel): endereços
// perto, meio, só bairro e longe. Confere rota/faixa/taxa/repasse/prazo/medida
// contra a tabela, e a legenda "círculos em linha reta" do mapa.
// Depende do Nominatim e do OSRM públicos (ou do cache GeocodeCache/RotaCache).
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, gravarResultado, faixaDaTabela } from "./comum.mjs";

const ENDERECOS = [
  { nome: "perto", rua: "Rua Beira Alta", numero: "100", bairro: "Vila Monte Alegre" },
  { nome: "meio", rua: "Rua Abel Gomes dos Santos", numero: "50", bairro: "Jardim Esperança" },
  { nome: "so-bairro", rua: "Travessa Canaã", numero: "6", bairro: "Boca do Mato" },
  { nome: "longe", rua: "Avenida Teixeira e Souza", numero: "1000", bairro: "Centro" },
];

const r = { casos: [], rede: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("dialog", (d) => d.accept());
page.on("response", async (res) => {
  if (!res.url().includes("/api/delivery-fee")) return;
  let corpo = null; try { corpo = await res.json(); } catch {}
  if (corpo?.cotacao) corpo.cotacao = `(token ${corpo.cotacao.length} chars)`;
  r.rede.push({ url: decodeURIComponent(res.url().split("?")[1] || ""), status: res.status(), corpo });
});
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Simular um endereço", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  r.legenda = await page.locator(".fh-legenda-rota").innerText().catch(() => "(sem legenda)");
  r.rotuloDoCirculo = await page.getByText("círculo = linha reta").count();
  for (const e of ENDERECOS) {
    await page.fill('input[aria-label="Rua para simular"]', e.rua);
    await page.fill('input[aria-label="Número para simular"]', e.numero);
    await page.fill('input[aria-label="Bairro para simular"]', e.bairro);
    const antes = r.rede.length;
    await page.locator(".fh-simulador button[type=submit]").click();
    await page.waitForFunction((n) => true, antes);
    for (let i = 0; i < 60 && r.rede.length === antes; i++) await dormir(500);
    await dormir(1200);
    const texto = await page.locator(".fh-sim-resultado").innerText().catch(() => "(sem resultado)");
    const resp = r.rede[r.rede.length - 1]?.corpo || {};
    const esperado = resp.distanceKm != null ? faixaDaTabela(resp.distanceKm) : null;
    r.casos.push({ ...e, tela: texto, resposta: resp, esperadoPelaTabela: esperado });
    await page.locator(".fh-simulador").scrollIntoViewIfNeeded();
    await foto(page, `e2-${e.nome}`);
    await dormir(1500);
  }
} catch (err) {
  r.falha = String(err?.stack || err).slice(0, 1500);
  await foto(page, "e2-99-falha").catch(() => {});
} finally {
  gravarResultado("e2", r);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
}
