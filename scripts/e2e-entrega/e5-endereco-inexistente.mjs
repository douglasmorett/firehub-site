// E5 — Cardápio: endereço que NÃO existe no mapa → não cobra a faixa mais
// cara, pede o mapa; e o POST direto do pedido (sem pino, sem token) é
// recusado com a mensagem de confirmar no mapa.
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja, BASE, SLUG,
  irParaOCheckout, digitarEndereco, esperarPainel, botaoFinalizar, vigiarDialogos, vigiarRede,
} from "./comum.mjs";

const END = { rua: "Rua Alecrim Dourado", numero: "77", bairro: "Alecrin" };
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
  await irParaOCheckout(page, { nome: "Cliente E5" });
  await digitarEndereco(page, END);
  r.painel = await esperarPainel(page, { contem: /Marque|Confirme|Taxa|Fora|Não consegui|localização/ });
  r.cotacao = r.rede.filter((x) => x.url.includes("/api/delivery-fee")).pop()?.corpo;
  r.botaoResumo = await botaoFinalizar(page).innerText();
  await foto(page, "e5-01-nao-achou");
  await botaoFinalizar(page).click();
  await dormir(2500);
  r.mapaAbriu = await page.getByText(/Onde fica a sua casa\?|O pino está na sua porta\?/).count();
  r.botaoDoMapaDesabilitado = await page.getByRole("button", { name: /É aqui, confirmar|Toque no mapa onde você mora/ }).isDisabled().catch(() => null);
  r.postsPelaTela = r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST").length;
  await foto(page, "e5-02-mapa");

  // POST direto, como um navegador antigo ou alguém no DevTools: sem pino e sem token.
  const corpoBase = {
    franchiseeId: loja, franchiseeSlug: SLUG, customerName: "Cliente E5 direto", customerPhone: "(22) 99888-7755",
    customerAddress: `${END.rua}, ${END.numero} - ${END.bairro}`, customerStreet: END.rua, customerNumber: END.numero, customerNeighborhood: END.bairro,
    deliveryType: "DELIVERY", paymentMethod: "DINHEIRO", notes: "", items: [{ menuProductId: xburger.id, quantity: 1 }],
  };
  const postar = (corpo) => page.evaluate(async ([url, c]) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    return { status: res.status, corpo: await res.json().catch(() => null) };
  }, [`${BASE}/api/customer-order`, corpo]);
  r.postDiretoTaxa5 = await postar({ ...corpoBase, deliveryFee: 5 });
  await dormir(1500);
  r.postDiretoTaxa20 = await postar({ ...corpoBase, deliveryFee: 20 });
  await dormir(1500);
  // Token forjado: não pode abrir a porta.
  r.postDiretoTokenFalso = await postar({ ...corpoBase, deliveryFee: 5, cotacao: "eyJ2IjoxfQ.assinaturafalsa" });
  const depois = await prisma.customerOrder.count({ where: { franchiseeId: loja } });
  r.pedidosCriados = depois - antes;
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e5-99-falha").catch(() => {});
} finally {
  gravarResultado("e5", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(22, 140)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
