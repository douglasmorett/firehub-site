// E10 — Painel de pedidos: "Corrigir taxa de entrega" no pedido do E3 (R$ 12,
// 2,15 km) → R$ 8 com distância 1,4 km e motivo → total, taxa, distância e
// repasse (seguia a faixa → R$ 7) atualizados no banco e na tela; rastro de
// quem/quando. Sem motivo o Salvar fica desligado.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, vigiarRede, vigiarDialogos } from "./comum.mjs";
import fs from "node:fs";
import path from "node:path";
import { SAIDA } from "./comum.mjs";

const e3 = JSON.parse(fs.readFileSync(path.join(SAIDA, "e3-cotacao.json"), "utf8"));
const prisma = banco();
const r = { pedidoId: e3.pedidoId, rede: [], dialogos: [] };
const antes = await prisma.customerOrder.findUnique({ where: { id: e3.pedidoId } });
r.antes = { deliveryFee: antes.deliveryFee, totalAmount: antes.totalAmount, deliveryDistance: antes.deliveryDistance, motoboyFee: antes.motoboyFee, customerName: antes.customerName, dailyOrderNumber: antes.dailyOrderNumber, editHistory: antes.editHistory };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/taxa-de-entrega"), r.rede);
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/pedidos-clientes`, { waitUntil: "domcontentloaded" });
  await page.getByText(antes.customerName, { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  const cartao = page.locator("div").filter({ hasText: antes.customerName }).filter({ has: page.locator('[title="Ver pedido"]') }).last();
  await cartao.locator('[title="Ver pedido"]').first().click();
  await page.getByRole("button", { name: "Corrigir taxa de entrega" }).waitFor({ timeout: 20_000 });
  r.linhaAntes = await page.getByText(/Taxa de entrega:/).first().innerText().catch(() => "");
  await page.getByRole("button", { name: "Corrigir taxa de entrega" }).click();
  await page.locator('[aria-label="Taxa de entrega certa"]').waitFor({ timeout: 20_000 });
  await dormir(800);
  r.cabecalhoDoFormulario = await page.getByText(/No pedido: taxa/).first().innerText().catch(() => "");
  await page.fill('[aria-label="Taxa de entrega certa"]', "8");
  await page.fill('[aria-label="Distância certa em km"]', "1,4");
  await dormir(500);
  r.sugestaoDaFaixa = await page.getByText(/cai na faixa até/).first().innerText().catch(() => "(sem sugestão)");
  r.salvarSemMotivoDesligado = await page.getByRole("button", { name: /Salvar correção/ }).isDisabled();
  await page.fill('[aria-label="Motivo da correção"]', "cliente mora a 1,4 km, faixa de R$ 8");
  await dormir(300);
  r.salvarComMotivoDesligado = await page.getByRole("button", { name: /Salvar correção/ }).isDisabled();
  await foto(page, "e10-01-formulario");
  await page.getByRole("button", { name: /Salvar correção/ }).click();
  for (let i = 0; i < 40 && !r.rede.some((x) => x.metodo !== "GET"); i++) await dormir(300);
  await dormir(2500);
  await foto(page, "e10-02-depois");
  r.telaDepois = (await page.locator('[role="dialog"], body').first().innerText()).match(/.{0,120}(Taxa de entrega|R\$ 8,00|Total).{0,160}/g)?.slice(0, 8);
  r.linhaDepois = await page.getByText(/Taxa de entrega:/).first().innerText().catch(() => "");
  const gravacao = r.rede.find((x) => x.metodo !== "GET");
  r.requisicao = gravacao ? { metodo: gravacao.metodo, status: gravacao.status, enviado: JSON.parse(gravacao.corpoEnviado || "{}"), resposta: gravacao.corpo } : null;
  const depois = await prisma.customerOrder.findUnique({ where: { id: e3.pedidoId } });
  r.depois = { deliveryFee: depois.deliveryFee, totalAmount: depois.totalAmount, deliveryDistance: depois.deliveryDistance, motoboyFee: depois.motoboyFee, notes: depois.notes, editHistory: depois.editHistory, customerLatLng: depois.customerLatLng };
  r.conferencia = {
    taxa8: depois.deliveryFee === 8,
    total28: Math.abs(depois.totalAmount - 28) < 0.005,
    distancia14: depois.deliveryDistance === 1.4,
    motoboy7: depois.motoboyFee === 7,
    temRastro: JSON.stringify(depois.editHistory || depois.notes || "").includes("motivo") || JSON.stringify(depois.editHistory || "").includes("1,4 km"),
  };
  // A lista do painel depois de recarregar
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(antes.customerName, { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(2000);
  const cartao2 = page.locator("div").filter({ hasText: antes.customerName }).filter({ has: page.locator('[title="Ver pedido"]') }).last();
  r.cartaoDepoisDeRecarregar = (await cartao2.innerText()).slice(0, 400);
  await foto(page, "e10-03-lista-recarregada");
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e10-99-falha").catch(() => {});
} finally {
  gravarResultado("e10", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
