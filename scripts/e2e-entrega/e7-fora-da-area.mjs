// E7 — Cardápio: endereço a mais de 5 km PELA RUA → "fora da área"; o
// Finalizar não cria pedido; e o POST direto também é recusado.
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja, BASE, SLUG,
  irParaOCheckout, digitarEndereco, esperarPainel, botaoFinalizar, vigiarDialogos, vigiarRede,
} from "./comum.mjs";

const END = { rua: process.env.E7_RUA || "Avenida Teixeira e Souza", numero: process.env.E7_NUM || "1000", bairro: process.env.E7_BAIRRO || "Centro" };
const prisma = banco();
const loja = await idDaLoja(prisma);
const xburger = await prisma.menuProduct.findFirst({ where: { franchiseeId: loja, name: "X-Burger" } });
const r = { endereco: END, dialogos: [], rede: [] };
const b = await navegador();
const page = await (await contextoCelular(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/customer-order"), r.rede);
try {
  const antes = await prisma.customerOrder.count({ where: { franchiseeId: loja } });
  await irParaOCheckout(page, { nome: "Cliente E7" });
  await digitarEndereco(page, END);
  r.painel = await esperarPainel(page, { contem: /Fora|Taxa|Marque|Confirme|Não consegui/ });
  r.cotacao = r.rede.filter((x) => x.url.includes("/api/delivery-fee")).pop()?.corpo;
  r.botaoResumo = await botaoFinalizar(page).innerText();
  await foto(page, "e7-01-fora");
  await botaoFinalizar(page).click();
  await dormir(2000);
  await foto(page, "e7-02-finalizar");
  r.postsPelaTela = r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST").length;
  r.postDireto = await page.evaluate(async ([url, c]) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    return { status: res.status, corpo: await res.json().catch(() => null) };
  }, [`${BASE}/api/customer-order`, {
    franchiseeId: loja, franchiseeSlug: SLUG, customerName: "Cliente E7 direto", customerPhone: "(22) 99888-7744",
    customerAddress: `${END.rua}, ${END.numero} - ${END.bairro}`, customerStreet: END.rua, customerNumber: END.numero, customerNeighborhood: END.bairro,
    deliveryType: "DELIVERY", paymentMethod: "DINHEIRO", deliveryFee: 20, items: [{ menuProductId: xburger.id, quantity: 1 }],
  }]);
  r.pedidosCriados = (await prisma.customerOrder.count({ where: { franchiseeId: loja } })) - antes;
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e7-99-falha").catch(() => {});
} finally {
  gravarResultado("e7", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(22, 140)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
