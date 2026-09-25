// E9 — Balcão (/store/venda-presencial): pedido de ENTREGA com endereço
// preciso → a cotação aparece (taxa preenchida + aviso com km/faixa/tempo) e
// o pedido grava distância, ponto e motoboyFee iguais aos da cotação.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, idDaLoja, faixaDaTabela, vigiarRede, vigiarDialogos, ultimoPedido } from "./comum.mjs";

const ENDERECO = process.env.E9_END || "Avenida Júlia Kubitschek, 500 - Centro";
const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { endereco: ENDERECO, rede: [], dialogos: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/store/orders/presencial"), r.rede);
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/venda-presencial`, { waitUntil: "domcontentloaded" });
  await page.getByText("X-Burger", { exact: true }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  await page.getByText("X-Burger", { exact: true }).first().click();
  await dormir(500);
  await page.locator("button").filter({ hasText: "Delivery" }).first().click();
  await page.fill('input[placeholder="Endereço de entrega *"]', ENDERECO);
  const taxa = page.locator('input[type="number"][step="0.50"]');
  for (let i = 0; i < 60; i++) {
    const v = await taxa.inputValue().catch(() => "");
    const ph = await taxa.getAttribute("placeholder").catch(() => "");
    if (v && ph !== "calculando...") break;
    await dormir(500);
  }
  await dormir(800);
  r.taxaNoCampo = await taxa.inputValue();
  r.avisoDaTaxa = await page.getByText(/^(✅|⚠️|❌) /).first().innerText().catch(() => "(sem aviso)");
  const cot = r.rede.filter((x) => x.url.includes("/api/delivery-fee")).pop();
  r.cotacao = cot?.corpo ? { ...cot.corpo, cotacao: cot.corpo.cotacao ? "(token)" : null } : null;
  r.consulta = cot ? Object.fromEntries(new URL(cot.url).searchParams) : null;
  await page.fill('input[placeholder="Nome do cliente"]', "Cliente Balcão E9");
  await page.fill('input[placeholder="Telefone"]', "22997776655");
  await foto(page, "e9-01-cotacao-no-balcao");
  const antes = await prisma.customerOrder.count({ where: { franchiseeId: loja } });
  await page.locator("button").filter({ hasText: "Finalizar Pedido" }).last().click();
  await page.getByText(/Pedido registrado|❌/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await dormir(800);
  r.mensagem = await page.getByText(/Pedido registrado|❌/).first().innerText().catch(() => "(sem mensagem)");
  await foto(page, "e9-02-registrado");
  const post = r.rede.filter((x) => x.url.includes("/api/store/orders/presencial")).pop();
  const enviado = post ? JSON.parse(post.corpoEnviado || "{}") : null;
  r.postEnviado = enviado && { ...enviado, cotacao: enviado.cotacao ? `(token ${enviado.cotacao.length})` : null, items: enviado.items?.length };
  r.postResposta = post ? { status: post.status, corpo: post.corpo } : null;
  r.pedidosCriados = (await prisma.customerOrder.count({ where: { franchiseeId: loja } })) - antes;
  const p = await ultimoPedido(prisma, loja);
  r.pedido = p && { id: p.id, source: p.source, customerName: p.customerName, customerAddress: p.customerAddress, deliveryType: p.deliveryType, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes };
  const f = r.cotacao?.distanceKm != null ? faixaDaTabela(r.cotacao.distanceKm) : null;
  r.conferencia = p && {
    distanciaIgualCotacao: p.deliveryDistance === r.cotacao?.distanceKm,
    motoboyIgualCotacao: p.motoboyFee === r.cotacao?.taxaDoEntregador,
    motoboyIgualTabela: p.motoboyFee === f?.moto,
    taxaIgualCotacao: p.deliveryFee === r.cotacao?.fee,
    pontoIgualCotacao: p.customerLatLng && r.cotacao?.ponto && Math.abs(p.customerLatLng.lat - r.cotacao.ponto.lat) < 1e-6,
    totalIgual: Math.abs(p.totalAmount - (20 + p.deliveryFee)) < 0.005,
    tokenNoPost: !!enviado?.cotacao,
  };
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e9-99-falha").catch(() => {});
} finally {
  for (const x of r.rede) { if (x.corpo?.cotacao) x.corpo.cotacao = "(token)"; x.corpoEnviado = undefined; }
  gravarResultado("e9", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(22, 160)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
