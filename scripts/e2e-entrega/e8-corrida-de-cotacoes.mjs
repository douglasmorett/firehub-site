// E8 — Cardápio: troca rápida de endereço/número com duas cotações seguidas.
// A tela tem de ficar com a cotação do ÚLTIMO endereço, mesmo quando a
// resposta do anterior chega depois.
//  (a) troca de endereço: a 1ª resposta é ATRASADA 5 s de propósito (route);
//  (b) troca só do NÚMERO: idem, e o pedido tem de fechar com o token do 2º;
//  (c) corrida natural: 1º endereço fora do cache (Nominatim/OSRM de verdade),
//      2º já no cache.
import {
  navegador, contextoCelular, foto, dormir, banco, gravarResultado, idDaLoja,
  irParaOCheckout, esperarPainel, botaoFinalizar, ultimoPedido, vigiarDialogos, vigiarRede,
  campoRua, campoNumero, campoBairro,
} from "./comum.mjs";

const prisma = banco();
const loja = await idDaLoja(prisma);
const r = { dialogos: [], rede: [], casos: {} };
const b = await navegador();
const page = await (await contextoCelular(b)).newPage();
vigiarDialogos(page, r.dialogos);
vigiarRede(page, (u) => u.includes("/api/delivery-fee") || u.includes("/api/customer-order"), r.rede);
r.pedidas = []; r.canceladas = [];
page.on("request", (q) => { if (q.url().includes("/api/delivery-fee")) r.pedidas.push(`${new URL(q.url()).searchParams.get("street")} ${new URL(q.url()).searchParams.get("number")} @${Date.now()}`); });
page.on("requestfailed", (q) => { if (q.url().includes("/api/delivery-fee")) r.canceladas.push(`${new URL(q.url()).searchParams.get("street")} ${new URL(q.url()).searchParams.get("number")} → ${q.failure()?.errorText} @${Date.now()}`); });
let atrasar = null; // (url) => boolean
await page.route("**/api/delivery-fee**", async (route) => {
  const u = route.request().url();
  if (atrasar && atrasar(u)) { await dormir(5000); }
  await route.continue();
});
const cot = () => r.rede.filter((x) => x.url.includes("/api/delivery-fee"));
const q = (x) => Object.fromEntries(new URL(x.url).searchParams);

async function preencher(rua, numero, bairro) {
  await campoRua(page).fill(rua);
  await campoNumero(page).fill(numero);
  await campoBairro(page).fill(bairro);
}

try {
  await irParaOCheckout(page, { nome: "Cliente E8" });

  // (a) endereço A (R$ 5) atrasado → endereço B (R$ 12)
  atrasar = (u) => u.includes("Passageiros");
  const n0 = cot().length;
  await preencher("Estrada dos Passageiros", "300", "Porto do Carro");
  await dormir(1500); // o timer de 700 ms dispara a cotação de A
  await preencher("Rua Abel Gomes dos Santos", "50", "Jardim Esperança");
  await dormir(1200);
  const painelLogoDepois = await esperarPainel(page, { contem: /Taxa de Entrega|Fora|Marque/ });
  for (let i = 0; i < 30 && cot().length - n0 < 2; i++) await dormir(300);
  await dormir(1500); // A chega depois de B
  r.casos.a = {
    painelLogoDepois, painelDepoisDaRespostaAtrasada: await esperarPainel(page),
    ordemDasRespostas: cot().slice(n0).map((x) => `${q(x).street} ${q(x).number} → R$ ${x.corpo?.fee} @${x.em}`),
  };
  await foto(page, "e8-a-troca-de-endereco");

  // (b) só o número: 50 → 52 (o 52 é o último), a do 52 chega primeiro
  atrasar = (u) => /number=50(&|$)/.test(u) && !u.includes("lat=");
  const n1 = cot().length;
  await campoNumero(page).fill("51");
  await dormir(1500);
  await campoNumero(page).fill("50");
  await dormir(1500);
  await campoNumero(page).fill("52");
  await dormir(1200);
  for (let i = 0; i < 40 && !cot().slice(n1).some((x) => /number=50(&|$)/.test(x.url)); i++) await dormir(300);
  await dormir(1000);
  r.casos.b = {
    painel: await esperarPainel(page),
    ordemDasRespostas: cot().slice(n1).map((x) => `${q(x).number} → R$ ${x.corpo?.fee} @${x.em}`),
  };
  atrasar = null;
  const dialogosAntes = r.dialogos.length;
  await botaoFinalizar(page).click();
  await page.getByText(/Acompanhe seu Pedido|Código do Pedido/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await dormir(800);
  r.casos.b.alertasAoFinalizar = r.dialogos.slice(dialogosAntes);
  const post = r.rede.filter((x) => x.url.includes("/api/customer-order") && x.metodo === "POST").pop();
  const enviado = post ? JSON.parse(post.corpoEnviado || "{}") : null;
  r.casos.b.post = enviado && { numero: enviado.customerNumber, endereco: enviado.customerAddress, taxa: enviado.deliveryFee, temToken: !!enviado.cotacao, status: post.status };
  if (enviado?.cotacao) {
    const corpo = JSON.parse(Buffer.from(enviado.cotacao.split(".")[0], "base64url").toString("utf8"));
    r.casos.b.tokenDoPost = { taxa: corpo.taxa, distanciaKm: corpo.distanciaKm, loja: corpo.loja === loja };
  }
  const p = await ultimoPedido(prisma, loja);
  r.casos.b.pedido = p && { customerAddress: p.customerAddress, deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng };
  await foto(page, "e8-b-pedido");
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e8-99-falha").catch(() => {});
} finally {
  gravarResultado("e8", { ...r, rede: r.rede.map((x) => ({ ...x, corpo: x.corpo ? { fee: x.corpo.fee, distanceKm: x.corpo.distanceKm, available: x.corpo.available } : null, corpoEnviado: undefined })) });
  console.log(JSON.stringify({casos:r.casos,pedidas:r.pedidas,canceladas:r.canceladas}, null, 2), r.falha || "");
  await b.close();
}

// (c) corrida natural, sem atraso artificial, em outra aba limpa.
const r2 = { dialogos: [], rede: [] };
const b2 = await navegador();
const page2 = await (await contextoCelular(b2)).newPage();
vigiarDialogos(page2, r2.dialogos);
vigiarRede(page2, (u) => u.includes("/api/delivery-fee"), r2.rede);
r2.pedidas = []; r2.canceladas = [];
page2.on("request", (q) => { if (q.url().includes("/api/delivery-fee")) r2.pedidas.push(`${new URL(q.url()).searchParams.get("street")} @${Date.now()}`); });
page2.on("requestfailed", (q) => { if (q.url().includes("/api/delivery-fee")) r2.canceladas.push(`${new URL(q.url()).searchParams.get("street")} → ${q.failure()?.errorText}`); });
try {
  await irParaOCheckout(page2, { nome: "Cliente E8c" });
  const A = { rua: process.env.E8_RUA_NOVA || "Rua Barão do Rio Branco", numero: "80", bairro: "Centro" };
  await campoRua(page2).fill(A.rua); await campoNumero(page2).fill(A.numero); await campoBairro(page2).fill(A.bairro);
  await dormir(1100);
  await campoRua(page2).fill("Rua Abel Gomes dos Santos"); await campoNumero(page2).fill("50"); await campoBairro(page2).fill("Jardim Esperança");
  for (let i = 0; i < 60 && r2.rede.length < 2; i++) await dormir(300);
  await dormir(1500);
  r2.painel = await esperarPainel(page2);
  r2.ordem = r2.rede.map((x) => `${new URL(x.url).searchParams.get("street")} → ${x.status} R$ ${x.corpo?.fee} ${x.corpo?.distanceKm ?? ""} km @${x.em}`);
  await foto(page2, "e8-c-corrida-natural");
} catch (e) {
  r2.falha = String(e?.stack || e).slice(0, 1200);
} finally {
  gravarResultado("e8c", { painel: r2.painel, ordem: r2.ordem, pedidas: r2.pedidas, canceladas: r2.canceladas, dialogos: r2.dialogos, falha: r2.falha });
  console.log(JSON.stringify({ painel: r2.painel, ordem: r2.ordem, pedidas: r2.pedidas, canceladas: r2.canceladas, dialogos: r2.dialogos, falha: r2.falha }, null, 2));
  await b2.close();
  await prisma.$disconnect();
}
