// R5 (extra, determinístico) — limites das faixas pela API pública, com o
// servidor subido com OSRM_URL numa porta fechada: a distância vira
// linha reta × fator da loja (medida "estimada"), que dá para mirar.
// Pinos ao SUL da loja, a uma linha reta calculada para cair em:
//   1,00 km (inclusivo → faixa 1, R$ 5)   1,01 km (→ faixa 1,5, R$ 8)
//   5,00 km (→ R$ 20)   5,05 km (folga da última faixa → R$ 20)   5,06 km (→ FORA)
// Uso: FATOR=<fator que o log "[Taxa de entrega] distância ESTIMADA (… × F …)" mostrou>
import { BASE, banco, idDaLoja, gravarResultado, dormir, LOJA } from "./comum.mjs";

const FATOR = Number(process.env.FATOR || 1.36);
const R = 6371;
const kmPorGrau = (Math.PI / 180) * R;
const prisma = banco();
const loja = await idDaLoja(prisma);
await prisma.$disconnect();
const alvos = [1.003, 1.008, 5.001, 5.048, 5.058];
const r = { fator: FATOR, casos: [] };
for (const alvo of alvos) {
  const reta = alvo / FATOR;
  const lat = LOJA.lat - reta / kmPorGrau;
  const q = new URLSearchParams({ franchiseeId: loja, street: "Rua Teste", number: "1", neighborhood: "Centro", address: "Rua Teste, 1 - Centro, Cabo Frio", lat: lat.toFixed(7), lng: String(LOJA.lng), origem: "pino" });
  const res = await fetch(`${BASE}/api/delivery-fee?${q}`);
  const c = await res.json().catch(() => null);
  r.casos.push({ alvo, status: res.status, distanceKm: c?.distanceKm, medida: c?.medida, available: c?.available, fee: c?.fee, faixaKm: c?.faixaKm, message: c?.message });
  await dormir(400);
}
gravarResultado("r5", r);
console.log(JSON.stringify(r, null, 2));
