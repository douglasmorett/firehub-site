// E3 — Cardápio no celular, endereço PRECISO: a taxa e os km aparecem, o
// pedido fecha e grava deliveryFee = taxa mostrada, deliveryDistance,
// customerLatLng {lat,lng,origem,medida}, motoboyFee = repasse da faixa e
// total = itens + taxa. Guarda a cotação (token) para o E12.
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja, faixaDaTabela,
  irParaOCheckout, digitarEndereco, esperarPainel, botaoFinalizar, ultimoPedido, vigiarDialogos, vigiarRede,
} from "./comum.mjs";

const END = { rua: process.env.E3_RUA || "Rua Abel Gomes dos Santos", numero: process.env.E3_NUM || "50", bairro: process.env.E3_BAIRRO || "Jardim Esperança", complemento: "Casa 2" };
const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { endereco: END, dialogos: [], rede: [] };
const b = await navegador();
const page = await (await contextoCelular(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/customer-order"), r.rede);
try {
  await irParaOCheckout(page);
  await digitarEndereco(page, END);
  r.painel = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque|Confirme|estimada|Não consegui/ });
  await foto(page, "e3-01-taxa-na-tela");
  const cot = r.rede.filter((x) => x.url.includes("/api/delivery-fee")).pop();
  r.cotacao = cot?.corpo;
  r.botao = await botaoFinalizar(page).innerText();
  await botaoFinalizar(page).click();
  await page.getByText(/Acompanhe seu Pedido|Código do Pedido/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await dormir(800);
  await foto(page, "e3-02-pedido-feito");
  r.telaFinal = (await page.locator("body").innerText()).slice(0, 400);
  const post = r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST").pop();
  r.postEnviado = post ? JSON.parse(post.corpoEnviado || "{}") : null;
  r.postResposta = post ? { status: post.status, corpo: post.corpo } : null;
  const p = await ultimoPedido(prisma, loja);
  r.pedido = p && {
    id: p.id, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng,
    motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes, customerAddress: p.customerAddress,
    itens: p.items.map((i) => `${i.quantity}x ${i.productName} ${i.price}`),
  };
  const f = r.cotacao?.distanceKm != null ? faixaDaTabela(r.cotacao.distanceKm) : null;
  r.conferencia = p && {
    taxaIgualAMostrada: p.deliveryFee === r.cotacao?.fee,
    taxaDaTabela: f?.taxa, repasseDaTabela: f?.moto,
    motoboyIgualATabela: p.motoboyFee === f?.moto,
    distanciaIgualACotacao: p.deliveryDistance === r.cotacao?.distanceKm,
    totalIgualItensMaisTaxa: Math.abs(p.totalAmount - (p.items.reduce((s, i) => s + i.price * i.quantity, 0) + p.deliveryFee)) < 0.005,
    pontoTemOrigemEMedida: !!(p.customerLatLng && p.customerLatLng.origem && p.customerLatLng.medida),
    tokenFoiNoPost: !!r.postEnviado?.cotacao,
  };
  gravarResultado("e3-cotacao", { token: r.postEnviado?.cotacao || null, endereco: END, pedidoId: p?.id, cotacao: r.cotacao });
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e3-99-falha").catch(() => {});
} finally {
  if (r.postEnviado?.cotacao) r.postEnviado.cotacao = `(token ${r.postEnviado.cotacao.length})`;
  for (const x of r.rede) if (x.corpo?.cotacao) x.corpo.cotacao = "(token)";
  if (r.cotacao?.cotacao) r.cotacao.cotacao = "(token)";
  gravarResultado("e3", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(0, 120)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
