// E6d (rodada 2) — cópia do e6-gps.mjs com o passo extra E6_RUA (o cliente completa a rua).
// E6 — Cardápio: GPS a ~1 km da loja → cotação sem pedir confirmação →
// mudar só o complemento (e, à parte, digitar o número) → o ponto NÃO se
// perde → pedido com origem "gps". O reverse geocode sai do NAVEGADOR para o
// Nominatim público (preencherPeloPonto).
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja, faixaDaTabela, BASE,
  irParaOCheckout, esperarPainel, botaoFinalizar, ultimoPedido, vigiarDialogos, vigiarRede,
  campoRua, campoNumero, campoBairro, campoComplemento, painelDaEntrega, vis,
} from "./comum.mjs";

const GPS = { latitude: Number(process.env.E6_LAT || -22.8455), longitude: Number(process.env.E6_LNG || -42.0270), accuracy: 20 };
const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { gps: GPS, dialogos: [], rede: [] };
const b = await navegador();
const ctx = await contextoCelular(b, { geolocation: GPS, permissions: ["geolocation"] });
await ctx.grantPermissions(["geolocation"], { origin: BASE });
const page = await ctx.newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/customer-order") || u.includes("nominatim"), r.rede);
const cotacoes = () => r.rede.filter((x) => x.url.includes("/api/delivery-fee"));
const campos = async () => ({ rua: await campoRua(page).inputValue(), numero: await campoNumero(page).inputValue(), bairro: await campoBairro(page).inputValue(), complemento: await campoComplemento(page).inputValue() });
try {
  await irParaOCheckout(page, { nome: "Cliente E6" });
  await vis(page, "button").filter({ hasText: "Usar minha localização atual (GPS)" }).first().click();
  for (let i = 0; i < 60 && cotacoes().length === 0; i++) await dormir(500);
  r.painelGps = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque|Confirme|Não consegui|estimada/ });
  r.camposDepoisDoGps = await campos();
  r.reverse = r.rede.filter((x) => x.url.includes("nominatim")).map((x) => ({ status: x.status, road: x.corpo?.address?.road, house: x.corpo?.address?.house_number, suburb: x.corpo?.address?.suburb }));
  const c1 = cotacoes().pop();
  r.consulta1 = c1 ? Object.fromEntries(new URL(c1.url).searchParams) : null;
  r.cotacao1 = c1?.corpo;
  await foto(page, (process.env.E6_SAIDA || "e6") + "-01-gps");

  // Muda SÓ o complemento.
  const nAntes = cotacoes().length;
  await campoComplemento(page).fill("Fundos, portão azul");
  await campoComplemento(page).press("Tab");
  await dormir(2500);
  r.painelDepoisDoComplemento = await esperarPainel(page);
  r.cotacoesNovasAposComplemento = cotacoes().length - nAntes;
  r.aindaUsaGpsAposComplemento = /Usando a sua localização \(GPS\)/.test(r.painelDepoisDoComplemento);

  // (rodada 2) Se o mapa não escreveu a RUA, o cliente digita — o ponto tem de ficar (D1).
  if (!r.camposDepoisDoGps.rua && process.env.E6_RUA) {
    const nr = cotacoes().length;
    await campoRua(page).fill(process.env.E6_RUA);
    await campoRua(page).press("Tab");
    for (let i = 0; i < 20 && cotacoes().length === nr; i++) await dormir(300);
    await dormir(1500);
    r.painelDepoisDaRua = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque|Confirme|estimada|Preencha/ });
    const cr = cotacoes().slice(nr).pop();
    r.consultaDepoisDaRua = cr ? Object.fromEntries(new URL(cr.url).searchParams) : null;
    r.aindaUsaGpsAposRua = /Usando a sua localização \(GPS\)/.test(r.painelDepoisDaRua);
  }
  // Se o mapa não escreveu o bairro, o cliente digita — o ponto tem de ficar.
  if (!r.camposDepoisDoGps.bairro && process.env.E6_BAIRRO) {
    const n1 = cotacoes().length;
    await campoBairro(page).fill(process.env.E6_BAIRRO);
    await campoBairro(page).press("Tab");
    for (let i = 0; i < 20 && cotacoes().length === n1; i++) await dormir(300);
    await dormir(1500);
    r.painelDepoisDoBairro = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque|Confirme|estimada|Preencha/ });
    const cb = cotacoes().slice(n1).pop();
    r.consultaDepoisDoBairro = cb ? Object.fromEntries(new URL(cb.url).searchParams) : null;
    r.aindaUsaGpsAposBairro = /Usando a sua localização \(GPS\)/.test(r.painelDepoisDoBairro);
  }
  // Se o mapa não escreveu o número, o cliente digita — o ponto tem de ficar.
  if (!r.camposDepoisDoGps.numero) {
    const n2 = cotacoes().length;
    await campoNumero(page).fill("15");
    await campoNumero(page).press("Tab");
    for (let i = 0; i < 20 && cotacoes().length === n2; i++) await dormir(300);
    await dormir(1500);
    r.painelDepoisDoNumero = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque|Confirme|estimada/ });
    const c2 = cotacoes().slice(n2).pop();
    r.consultaDepoisDoNumero = c2 ? Object.fromEntries(new URL(c2.url).searchParams) : null;
    r.aindaUsaGpsAposNumero = /Usando a sua localização \(GPS\)/.test(r.painelDepoisDoNumero);
  }
  await foto(page, (process.env.E6_SAIDA || "e6") + "-02-complemento");

  await botaoFinalizar(page).click();
  await page.getByText(/Acompanhe seu Pedido|Código do Pedido/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await dormir(800);
  await foto(page, (process.env.E6_SAIDA || "e6") + "-03-pedido");
  const post = r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST").pop();
  r.postEnviado = post ? JSON.parse(post.corpoEnviado || "{}") : null;
  r.postResposta = post ? { status: post.status, corpo: post.corpo } : null;
  const p = await ultimoPedido(prisma, loja);
  r.pedido = p && { id: p.id, customerName: p.customerName, customerAddress: p.customerAddress, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes };
  const ultima = cotacoes().pop()?.corpo;
  const f = ultima?.distanceKm != null ? faixaDaTabela(ultima.distanceKm) : null;
  r.conferencia = p && {
    origemGps: p.customerLatLng?.origem === "gps",
    pontoIgualAoGps: Math.abs(p.customerLatLng?.lat - GPS.latitude) < 1e-6 && Math.abs(p.customerLatLng?.lng - GPS.longitude) < 1e-6,
    taxaIgualUltimaCotacao: p.deliveryFee === ultima?.fee, faixaEsperada: f, motoboyIgualTabela: p.motoboyFee === f?.moto,
    pedidoDoE6: p.customerName === "Cliente E6",
  };
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, (process.env.E6_SAIDA || "e6") + "-99-falha").catch(() => {});
} finally {
  if (r.postEnviado?.cotacao) r.postEnviado.cotacao = `(token ${r.postEnviado.cotacao.length})`;
  for (const x of r.rede) if (x.corpo?.cotacao) x.corpo.cotacao = "(token)";
  gravarResultado(process.env.E6_SAIDA || "e6", r);
  console.log(JSON.stringify({ ...r, rede: r.rede.map((x) => `${x.metodo} ${x.status} ${x.url.slice(0, 200)}`) }, null, 2));
  await b.close();
  await prisma.$disconnect();
}
