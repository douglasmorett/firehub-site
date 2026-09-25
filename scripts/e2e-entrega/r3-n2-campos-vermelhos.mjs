// R3/N2 (rodada 3) — o aviso "Não salvei" com 9 faixas sem "Motoboy recebe"
// lista 7 e diz "… e mais 2 problemas, nos campos em vermelho abaixo". Confere
// que os campos das faixas que NÃO couberam na lista (4,5 e 5 km) estão mesmo
// marcados (borda/aria-invalid), e que preencher só as 7 listadas ainda barra
// com as 2 restantes nomeadas. Restaura o cadastro no fim.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, EMAIL } from "./comum.mjs";

const prisma = banco();
const original = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryConfig: true } });
await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: original.deliveryZones.map(({ motoboyFee, ...z }) => z) } });
const r = {};
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("dialog", (d) => d.accept());
const aviso = () => page.locator(".fh-painel-aviso");
const moto = () => page.locator('input[aria-label="Motoboy recebe (R$)"]');
const estilo = () => moto().evaluateAll((els) => els.map((e) => {
  const cs = getComputedStyle(e);
  const km = e.closest("div[style*='border-radius']")?.querySelector('input[aria-label="Até quantos km"]')?.value;
  return { km, valor: e.value, invalido: e.getAttribute("aria-invalid"), borda: cs.borderColor, sombra: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 40) : "" };
}));
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(3000);
  r.antesDeSalvar = await estilo();
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await dormir(1500);
  r.aviso1 = await aviso().innerText().catch(() => "(sem aviso)");
  r.depoisDeSalvar = await estilo();
  // Preenche SÓ as 7 que o aviso listou (as 7 primeiras) — as 2 que não couberam ficam vazias.
  const n = await moto().count();
  for (let i = 0; i < n - 2; i++) {
    await moto().nth(i).click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("3");
  }
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(400);
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await dormir(1500);
  r.aviso2 = await aviso().innerText().catch(() => "(sem aviso)");
  r.contador2 = await page.getByText(/sem o valor do motoboy|Todas as faixas com valor/).first().innerText().catch(() => "");
  r.depoisDoSegundoSalvar = await estilo();
  const depois = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true } });
  r.bancoGravouAlgo = depois.deliveryZones.some((z) => z.motoboyFee != null);
  await moto().nth(n - 1).scrollIntoViewIfNeeded();
  await foto(page, "r3-n2-campos-vermelhos");
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
} finally {
  await prisma.user.update({ where: { email: EMAIL }, data: { deliveryZones: original.deliveryZones, deliveryConfig: original.deliveryConfig } });
  r.restaurado = true;
  gravarResultado("r3-n2", r);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
  await prisma.$disconnect();
}
