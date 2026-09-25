// Sonda: pergunta a /api/delivery-fee (rota PÚBLICA, como o cardápio) por uma
// lista de endereços, um a cada 2 s (Nominatim/OSRM públicos: ≤ 1 req/s), e
// guarda as respostas. Serve para escolher o endereço de cada cenário.
//   node scripts/e2e-entrega/sondar-enderecos.mjs "Rua Beira Alta|100|Vila Monte Alegre" ...
import { BASE, banco, idDaLoja, gravarResultado, dormir } from "./comum.mjs";
const prisma = banco();
const loja = await idDaLoja(prisma);
await prisma.$disconnect();
const saida = [];
for (const arg of process.argv.slice(2)) {
  const [street, number, neighborhood] = arg.split("|");
  const q = new URLSearchParams({ franchiseeId: loja, street, number, neighborhood, address: `${street}, ${number} - ${neighborhood}, Cabo Frio` });
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/delivery-fee?${q}`);
  const corpo = await res.json().catch(() => null);
  const ms = Date.now() - t0;
  const { cotacao, ...resto } = corpo || {};
  saida.push({ endereco: arg, status: res.status, ms, temToken: !!cotacao, ...resto });
  console.log(arg, "→", res.status, `${ms} ms`, JSON.stringify({ ...resto, temToken: !!cotacao }));
  await dormir(2000);
}
gravarResultado(`sonda-${Date.now()}`, saida);
