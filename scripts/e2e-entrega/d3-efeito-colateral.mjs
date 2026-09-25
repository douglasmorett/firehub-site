// D3 (rodada 2) — efeito colateral declarado pelo corretor: loja com
// separado:true e faixas SEM "Motoboy recebe". A tela abre em "Um valor por
// faixa" (campos vazios), o Salvar é barrado; trocar para "acerto" e salvar
// grava separado:false e as faixas sem repasse. No fim devolve o cadastro.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, EMAIL } from "./comum.mjs";

const prisma = banco();
const original = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryConfig: true } });
const semRepasse = original.deliveryZones.map(({ motoboyFee, ...z }) => z);
await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: semRepasse } });
const r = { dialogos: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("dialog", async (d) => { r.dialogos.push(d.message()); await d.accept(); });
const aviso = () => page.locator(".fh-painel-aviso");
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(4000);
  r.aoAbrir = {
    porFaixa: await page.getByRole("radio", { name: "Um valor por faixa" }).getAttribute("aria-checked"),
    camposMotoboy: await page.locator('input[aria-label="Motoboy recebe (R$)"]').count(),
    vazios: await page.locator('input[aria-label="Motoboy recebe (R$)"]').evaluateAll((els) => els.filter((e) => !e.value).length),
    contador: await page.getByText(/sem o valor do motoboy|Todas as faixas com valor/).first().innerText().catch(() => ""),
  };
  await foto(page, "d3-01-abriu-sem-repasse");
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await dormir(1500);
  r.salvarBarrado = (await aviso().count()) ? await aviso().innerText() : "(sem aviso)";
  const depois1 = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryConfig: true } });
  r.bancoMudouNoBarrado = JSON.stringify(depois1) !== JSON.stringify({ deliveryZones: semRepasse, deliveryConfig: original.deliveryConfig });
  await foto(page, "d3-02-salvar-barrado");
  // troca para o acerto e salva
  await page.getByRole("radio", { name: /acerto/i }).first().click();
  await dormir(500);
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await page.waitForFunction(() => /salva|Não salvei/i.test(document.querySelector(".fh-painel-aviso")?.textContent || ""), null, { timeout: 30_000 }).catch(() => {});
  await dormir(1000);
  r.salvarComAcerto = (await aviso().count()) ? await aviso().innerText() : "(sem aviso)";
  const depois2 = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryConfig: true } });
  r.bancoDepoisDoAcerto = { separado: depois2.deliveryConfig?.repasseDoEntregador?.separado, marketplace: depois2.deliveryConfig?.repasseDoEntregador?.marketplace, zonasComRepasse: depois2.deliveryZones.filter((z) => z.motoboyFee != null).length, zonas: depois2.deliveryZones.length };
  await foto(page, "d3-03-salvo-no-acerto");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(4000);
  r.depoisDeRecarregar = {
    porFaixa: await page.getByRole("radio", { name: "Um valor por faixa" }).getAttribute("aria-checked"),
    acerto: await page.getByRole("radio", { name: /acerto/i }).first().getAttribute("aria-checked"),
  };
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "d3-99-falha").catch(() => {});
} finally {
  await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: original.deliveryZones, deliveryConfig: original.deliveryConfig } });
  r.restaurado = true;
  gravarResultado("d3", r);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
  await prisma.$disconnect();
}
