// E4 — Cardápio: endereço que o mapa só acha pelo BAIRRO → taxa estimada e
// "confirme no mapa"; Finalizar sem confirmar é barrado (abre o mapa, nenhum
// POST); o mapa abre no palpite; tocar a porta → cotação com o pino → taxa
// exata → pedido grava origem "pino".
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja, faixaDaTabela,
  irParaOCheckout, digitarEndereco, esperarPainel, botaoFinalizar, ultimoPedido, vigiarDialogos, vigiarRede, painelDaEntrega,
} from "./comum.mjs";

const END = { rua: process.env.E4_RUA || "Travessa Canaã", numero: process.env.E4_NUM || "6", bairro: process.env.E4_BAIRRO || "Boca do Mato" };
const DESLOCA_PX = Number(process.env.E4_DX || -80);
const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { endereco: END, dialogos: [], rede: [] };
const b = await navegador();
const page = await (await contextoCelular(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/customer-order"), r.rede);
const posts = () => r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST");
try {
  const antes = await prisma.customerOrder.count({ where: { franchiseeId: loja } });
  await irParaOCheckout(page, { nome: "Cliente E4" });
  await digitarEndereco(page, END);
  r.painelAntes = await esperarPainel(page, { contem: /estimada|Confirme|Marque|Taxa|Fora/ });
  r.cotacaoAproximada = r.rede.filter((x) => x.url.includes("/api/delivery-fee")).pop()?.corpo;
  r.botaoResumo = await botaoFinalizar(page).innerText();
  await foto(page, "e4-01-estimada");

  // Tenta finalizar SEM confirmar o pino.
  await botaoFinalizar(page).click();
  await dormir(2500);
  r.postsSemPino = posts().length;
  r.mapaAbriu = await page.getByText(/Onde fica a sua casa\?|O pino está na sua porta\?/).count();
  r.textoDoBotaoDoMapa = await page.getByRole("button", { name: /É aqui, confirmar|Toque no mapa onde você mora/ }).innerText().catch(() => "(sem botão)");
  r.botaoDoMapaDesabilitado = await page.getByRole("button", { name: /É aqui, confirmar|Toque no mapa onde você mora/ }).isDisabled().catch(() => null);
  await dormir(1500);
  await foto(page, "e4-02-mapa-aberto-no-palpite");

  // Onde o pino nasceu: no centro do mapa (setView no palpite)?
  const caixa = page.locator(".leaflet-container").last();
  const bb = await caixa.boundingBox();
  const pino = await page.locator(".leaflet-marker-icon").last().boundingBox();
  r.pinoNoCentroDoMapa = pino && bb ? { dx: Math.round(pino.x + pino.width / 2 - (bb.x + bb.width / 2)), dy: Math.round(pino.y + pino.height / 2 - (bb.y + bb.height / 2)) } : null;

  // Toca a "porta" a DESLOCA_PX px do centro.
  await page.mouse.click(bb.x + bb.width / 2 + DESLOCA_PX, bb.y + bb.height / 2);
  await dormir(600);
  r.textoDoBotaoDepoisDoToque = await page.getByRole("button", { name: /É aqui, confirmar|Toque no mapa onde você mora/ }).innerText();
  const nCot = r.rede.length;
  await page.getByRole("button", { name: /É aqui, confirmar/ }).click();
  for (let i = 0; i < 60 && !r.rede.slice(nCot).some((x) => x.url.includes("/api/delivery-fee")); i++) await dormir(500);
  r.painelDepois = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Não consegui/ });
  const cotPino = r.rede.slice(nCot).filter((x) => x.url.includes("/api/delivery-fee")).pop();
  r.consultaDoPino = cotPino ? Object.fromEntries(new URL(cotPino.url).searchParams) : null;
  r.cotacaoDoPino = cotPino?.corpo;
  if (r.consultaDoPino && r.cotacaoAproximada?.ponto) {
    r.deslocamentoDoPinoEmRelacaoAoPalpite = {
      dLat: +(Number(r.consultaDoPino.lat) - r.cotacaoAproximada.ponto.lat).toFixed(6),
      dLng: +(Number(r.consultaDoPino.lng) - r.cotacaoAproximada.ponto.lng).toFixed(6),
    };
  }
  await foto(page, "e4-03-taxa-do-pino");

  await botaoFinalizar(page).click();
  await page.getByText(/Acompanhe seu Pedido|Código do Pedido/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await dormir(800);
  await foto(page, "e4-04-pedido-feito");
  const post = posts().pop();
  r.postEnviado = post ? JSON.parse(post.corpoEnviado || "{}") : null;
  r.postResposta = post ? { status: post.status, corpo: post.corpo } : null;
  const depois = await prisma.customerOrder.count({ where: { franchiseeId: loja } });
  r.pedidosCriados = depois - antes;
  const p = await ultimoPedido(prisma, loja);
  r.pedido = p && { id: p.id, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes };
  const f = r.cotacaoDoPino?.distanceKm != null ? faixaDaTabela(r.cotacaoDoPino.distanceKm) : null;
  r.conferencia = p && {
    origemPino: p.customerLatLng?.origem === "pino",
    taxaIgualCotacaoDoPino: p.deliveryFee === r.cotacaoDoPino?.fee,
    faixaEsperada: f, motoboyIgualTabela: p.motoboyFee === f?.moto,
    distanciaIgual: p.deliveryDistance === r.cotacaoDoPino?.distanceKm,
    pontoIgualAoPino: p.customerLatLng && r.consultaDoPino && Math.abs(p.customerLatLng.lat - Number(r.consultaDoPino.lat)) < 1e-6,
  };
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e4-99-falha").catch(() => {});
} finally {
  if (r.postEnviado?.cotacao) r.postEnviado.cotacao = `(token ${r.postEnviado.cotacao.length})`;
  for (const x of r.rede) if (x.corpo?.cotacao) x.corpo.cotacao = "(token)";
  gravarResultado("e4", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(22, 200)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
