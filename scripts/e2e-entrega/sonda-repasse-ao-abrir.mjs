// Sonda (rodada 2): o rádio "Um valor por faixa" ao abrir a tela, ao longo do
// tempo, com separado:true gravado. Registra o GET /api/store-settings.
// Uso: SONDA_ZERAR=1 zera deliveryZones antes (loja recém-configurada, como na semente).
import { navegador, contextoPainel, entrarNoPainel, BASE, dormir, banco, gravarResultado, EMAIL } from "./comum.mjs";

const prisma = banco();
const antes = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryConfig: true } });
if (process.env.SONDA_ZERAR) await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: [] } });
const r = { configNoBanco: antes.deliveryConfig, zonasNoBanco: process.env.SONDA_ZERAR ? [] : antes.deliveryZones?.length, leituras: [], rede: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("response", async (res) => {
  if (!res.url().includes("/api/store-settings")) return;
  let corpo = null; try { corpo = await res.json(); } catch {}
  r.rede.push({ status: res.status(), metodo: res.request().method(), em: Date.now(), repasse: corpo?.entrega?.repasseDoEntregador ?? "(sem entrega.repasseDoEntregador)", chaves: corpo ? Object.keys(corpo) : null, entregaChaves: corpo?.entrega ? Object.keys(corpo.entrega) : null });
});
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  const t0 = Date.now();
  for (const ms of [0, 500, 1500, 2500, 5000, 10000]) {
    while (Date.now() - t0 < ms) await dormir(100);
    r.leituras.push({ ms, porFaixa: await page.getByRole("radio", { name: "Um valor por faixa" }).getAttribute("aria-checked"), acerto: await page.getByRole("radio", { name: /acerto/i }).first().getAttribute("aria-checked").catch(() => null), camposMotoboy: await page.locator('input[aria-label="Motoboy recebe (R$)"]').count() });
  }
  r.t0 = t0;
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1200);
} finally {
  if (process.env.SONDA_ZERAR) await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: antes.deliveryZones } });
  gravarResultado(process.env.SONDA_SAIDA || "sonda-repasse", r);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
  await prisma.$disconnect();
}
