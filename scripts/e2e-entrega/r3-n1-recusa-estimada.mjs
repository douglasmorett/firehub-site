// R3/N1 (rodada 3) — com o roteador fora (servidor com OSRM_URL numa porta
// fechada): um pino FORA da área pela distância ESTIMADA (linha reta × fator
// da loja). A frase da cotação (/api/delivery-fee) e a da recusa do pedido do
// site (POST /api/customer-order com o pino, sem token) têm de ser a MESMA
// medida: "~X km estimados até a loja" — nunca "pela rua"/"pelas ruas" numa
// estimativa. Controle: um pino DENTRO da área na mesma fase (grava medida
// "estimada" e a nota).
import { BASE, SLUG, banco, idDaLoja, gravarResultado, dormir, LOJA } from "./comum.mjs";

const FATOR = Number(process.env.FATOR || 1.33);
const kmPorGrau = (Math.PI / 180) * 6371;
const prisma = banco();
const loja = await idDaLoja(prisma);
const xburger = await prisma.menuProduct.findFirst({ where: { franchiseeId: loja, name: "X-Burger" } });
const CASOS = [
  { nome: "fora-estimada", reta: 4.6 },   // ~6,1 km estimados → fora
  { nome: "dentro-estimada", reta: 1.3 }, // ~1,7 km estimados → faixa 2 km
];
const r = { fator: FATOR, casos: [] };
for (const c of CASOS) {
  const lat = +(LOJA.lat - c.reta / kmPorGrau).toFixed(7);
  const lng = LOJA.lng;
  const q = new URLSearchParams({ franchiseeId: loja, street: "Rua Teste", number: "1", neighborhood: "Centro", address: "Rua Teste, 1 - Centro, Cabo Frio", lat: String(lat), lng: String(lng), origem: "pino" });
  const res = await fetch(`${BASE}/api/delivery-fee?${q}`);
  const cot = await res.json().catch(() => null);
  await dormir(600);
  const corpo = {
    franchiseeId: loja, franchiseeSlug: SLUG, customerName: `R3 N1 ${c.nome}`, customerPhone: "(22) 99000-3131",
    customerAddress: "Rua Teste, 1 - Centro", customerStreet: "Rua Teste", customerNumber: "1", customerNeighborhood: "Centro",
    deliveryType: "DELIVERY", paymentMethod: "DINHEIRO", notes: "", deliveryFee: cot?.fee ?? 20, items: [{ menuProductId: xburger.id, quantity: 1 }],
    customerCoords: { lat, lng, origem: "pino" }, customerCoordsOrigem: "pino",
  };
  const post = await fetch(`${BASE}/api/customer-order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const resp = await post.json().catch(() => null);
  let pedido = null;
  if (resp?.orderId) {
    const p = await prisma.customerOrder.findUnique({ where: { id: resp.orderId } });
    pedido = { deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, customerLatLng: p.customerLatLng, notes: p.notes };
  }
  r.casos.push({
    ...c, lat, lng,
    cotacao: cot && { status: res.status, available: cot.available, distanceKm: cot.distanceKm, medida: cot.medida, fee: cot.fee, faixaKm: cot.faixaKm, message: cot.message },
    post: { status: post.status, error: resp?.error, orderId: resp?.orderId },
    pedido,
  });
  await dormir(800);
}
const fora = r.casos[0];
r.conferencia = {
  cotacaoDizEstimados: /estimados até a loja/.test(fora.cotacao?.message || ""),
  recusaDizEstimados: /estimados até a loja/.test(fora.post?.error || ""),
  recusaNaoDizPelaRua: !/pela rua|pelas ruas/.test(fora.post?.error || ""),
  mesmaMedidaNasDuas: (fora.cotacao?.message || "").match(/\(([^;]+);/)?.[1] === (fora.post?.error || "").match(/\(([^;]+);/)?.[1],
};
gravarResultado("r3-n1", r);
console.log(JSON.stringify(r, null, 2));
await prisma.$disconnect();
