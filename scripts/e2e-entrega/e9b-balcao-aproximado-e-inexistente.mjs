// E9b (extra) — Balcão com endereço que o mapa só acha pelo bairro e com
// endereço que não existe: o atendente é avisado, a taxa é editável, e o
// pedido registra o aviso (R2/R7). Não é um dos 12 cenários pedidos.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, idDaLoja, vigiarRede, ultimoPedido } from "./comum.mjs";

const CASOS = [
  { nome: "aproximado", endereco: "Travessa Canaã, 6 - Boca do Mato", taxaNaMao: null },
  { nome: "inexistente", endereco: "Rua Alecrim Dourado, 77 - Alecrin", taxaNaMao: "7" },
];
const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { casos: [], rede: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("dialog", (d) => d.accept());
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/store/orders/presencial"), r.rede);
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/venda-presencial`, { waitUntil: "domcontentloaded" });
  await page.getByText("X-Burger", { exact: true }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  for (const c of CASOS) {
    await page.getByText("X-Burger", { exact: true }).first().click();
    await dormir(400);
    await page.locator("button").filter({ hasText: "Delivery" }).first().click();
    const n = r.rede.length;
    await page.fill('input[placeholder="Endereço de entrega *"]', c.endereco);
    for (let i = 0; i < 60 && !r.rede.slice(n).some((x) => x.url.includes("/api/delivery-fee")); i++) await dormir(400);
    await dormir(1200);
    const taxa = page.locator('input[type="number"][step="0.50"]');
    const caso = { ...c };
    caso.taxaNoCampo = await taxa.inputValue();
    caso.aviso = await page.getByText(/^(✅|⚠️|❌) /).first().innerText().catch(() => "(sem aviso)");
    if (c.taxaNaMao != null) await taxa.fill(c.taxaNaMao);
    await page.fill('input[placeholder="Nome do cliente"]', `Balcão ${c.nome}`);
    await foto(page, `e9b-${c.nome}-01`);
    await page.locator("button").filter({ hasText: "Finalizar Pedido" }).last().click();
    await page.getByText(/Pedido registrado|❌/).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await dormir(800);
    caso.mensagem = await page.getByText(/Pedido registrado|❌/).first().innerText().catch(() => "(sem mensagem)");
    const post = r.rede.filter((x) => x.url.includes("/api/store/orders/presencial")).pop();
    caso.resposta = post?.corpo;
    const p = await ultimoPedido(prisma, loja);
    caso.pedido = p && { customerName: p.customerName, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes };
    await foto(page, `e9b-${c.nome}-02`);
    r.casos.push(caso);
    await dormir(1500);
  }
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e9b-99-falha").catch(() => {});
} finally {
  gravarResultado("e9b", { casos: r.casos, falha: r.falha });
  console.log(JSON.stringify({ casos: r.casos, falha: r.falha }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
