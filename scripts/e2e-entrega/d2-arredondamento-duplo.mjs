// D2 (rodada 2) — com o roteador fora (OSRM_URL numa porta fechada), pinos ao
// SUL da loja numa linha reta escolhida para que arredondar a reta ANTES de
// multiplicar pelo fator mudasse a faixa:
//   reta 0,7553 km × F=1,33 → exata 1,0045 → 1,00 km (R$ 5 / motoboy 4)
//                               arredondada 0,76 × 1,33 = 1,0108 → 1,01 km (R$ 8 / 7) ← defeito
//   reta 1,506 km × 1,33    → exata 2,0030 → 2,00 km (R$ 10 / 9)
//                               arredondada 1,51 × 1,33 = 2,0083 → 2,01 km (R$ 12 / 11) ← defeito
// Confere a cotação E o pedido do site (POST com o pino, sem token → o
// servidor reavalia) no banco.
import { BASE, SLUG, banco, idDaLoja, gravarResultado, dormir, LOJA } from "./comum.mjs";

const FATOR = Number(process.env.FATOR || 1.33);
const kmPorGrau = (Math.PI / 180) * 6371;
const prisma = banco();
const loja = await idDaLoja(prisma);
const xburger = await prisma.menuProduct.findFirst({ where: { franchiseeId: loja, name: "X-Burger" } });
const CASOS = [
  { reta: 0.7553, certo: { km: 1, fee: 5, moto: 4 }, defeito: { km: 1.01, fee: 8, moto: 7 } },
  { reta: 1.506, certo: { km: 2, fee: 10, moto: 9 }, defeito: { km: 2.01, fee: 12, moto: 11 } },
];
const r = { fator: FATOR, casos: [] };
for (const c of CASOS) {
  const lat = +(LOJA.lat - c.reta / kmPorGrau).toFixed(7);
  const lng = LOJA.lng;
  const q = new URLSearchParams({ franchiseeId: loja, street: "Rua Teste", number: "1", neighborhood: "Centro", address: "Rua Teste, 1 - Centro, Cabo Frio", lat: String(lat), lng: String(lng), origem: "pino" });
  const res = await fetch(`${BASE}/api/delivery-fee?${q}`);
  const cot = await res.json().catch(() => null);
  await dormir(500);
  const corpo = {
    franchiseeId: loja, franchiseeSlug: SLUG, customerName: `D2 reta ${c.reta}`, customerPhone: "(22) 99000-2222",
    customerAddress: "Rua Teste, 1 - Centro", customerStreet: "Rua Teste", customerNumber: "1", customerNeighborhood: "Centro",
    deliveryType: "DELIVERY", paymentMethod: "DINHEIRO", notes: "", deliveryFee: cot?.fee ?? 0, items: [{ menuProductId: xburger.id, quantity: 1 }],
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
    cotacao: cot && { distanceKm: cot.distanceKm, medida: cot.medida, fee: cot.fee, faixaKm: cot.faixaKm, message: cot.message },
    postStatus: post.status, pedido,
    passou: cot?.distanceKm === c.certo.km && cot?.fee === c.certo.fee && pedido?.deliveryDistance === c.certo.km && pedido?.deliveryFee === c.certo.fee && pedido?.motoboyFee === c.certo.moto,
  });
  await dormir(800);
}
gravarResultado("d2", r);
console.log(JSON.stringify(r, null, 2));
await prisma.$disconnect();
