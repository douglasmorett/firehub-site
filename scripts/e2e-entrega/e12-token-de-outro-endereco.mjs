// E12 — O token da cotação do E3 (Rua Abel Gomes dos Santos, 50 → R$ 12)
// mandado num pedido com OUTRO endereço: o servidor ignora o token e reavalia
// (não cobra a taxa do outro endereço). Casos:
//   a) token do E3 + Rua Beira Alta, 100 (0,4 km → R$ 5)          → R$ 5, 0,4 km
//   b) token do E3 + Av. Teixeira e Souza, 1000 (6,01 km, fora)    → recusa
//   c) token do E3 + mesmo endereço + coordenada de outro lugar     → reavalia pela coordenada
//   d) token adulterado (taxa trocada no corpo, assinatura velha)   → reavalia
//   e) controle: token do E3 + o MESMO endereço                     → aceita R$ 12
//   f) extra R3: "só bairro" (Travessa Canaã) sem pino e sem token → recusa pedindo o mapa
// Se o token do E3 já venceu (30 min), pede um novo para o MESMO endereço do E3.
import fs from "node:fs";
import path from "node:path";
import { BASE, SLUG, SAIDA, banco, idDaLoja, gravarResultado, dormir } from "./comum.mjs";

const prisma = banco();
const loja = await idDaLoja(prisma);
const xburger = await prisma.menuProduct.findFirst({ where: { franchiseeId: loja, name: "X-Burger" } });
const e3 = JSON.parse(fs.readFileSync(path.join(SAIDA, "e3-cotacao.json"), "utf8"));
const r = { casos: {} };
const ler = (t) => JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf8"));

let token = e3.token;
r.tokenDoE3 = token ? { ...ler(token), expiraEm: new Date(ler(token).exp).toISOString() } : null;
if (!token || ler(token).exp < Date.now() + 60_000) {
  const q = new URLSearchParams({ franchiseeId: loja, street: e3.endereco.rua, number: e3.endereco.numero, neighborhood: e3.endereco.bairro, address: `${e3.endereco.rua}, ${e3.endereco.numero} - ${e3.endereco.bairro}, Cabo Frio` });
  const c = await fetch(`${BASE}/api/delivery-fee?${q}`).then((x) => x.json());
  token = c.cotacao;
  r.tokenNovoDoMesmoEndereco = { ...ler(token), expiraEm: new Date(ler(token).exp).toISOString() };
}

async function pedir(nome, end, extra = {}) {
  const corpo = {
    franchiseeId: loja, franchiseeSlug: SLUG, customerName: `E12 ${nome}`, customerPhone: "(22) 99000-1212",
    customerAddress: `${end.rua}, ${end.numero} - ${end.bairro}`, customerStreet: end.rua, customerNumber: end.numero, customerNeighborhood: end.bairro,
    deliveryType: "DELIVERY", paymentMethod: "DINHEIRO", notes: "", deliveryFee: 12, items: [{ menuProductId: xburger.id, quantity: 1 }],
    ...extra,
  };
  const res = await fetch(`${BASE}/api/customer-order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const resposta = await res.json().catch(() => null);
  let pedido = null;
  if (resposta?.orderId) {
    const p = await prisma.customerOrder.findUnique({ where: { id: resposta.orderId } });
    pedido = { deliveryFee: p.deliveryFee, deliveryDistance: p.deliveryDistance, customerLatLng: p.customerLatLng, motoboyFee: p.motoboyFee, totalAmount: p.totalAmount, notes: p.notes };
  }
  await dormir(1500);
  return { status: res.status, resposta, pedido };
}

const E3 = e3.endereco;
r.casos.a_outroEnderecoPerto = await pedir("a", { rua: "Rua Beira Alta", numero: "100", bairro: "Vila Monte Alegre" }, { cotacao: token });
r.casos.b_outroEnderecoLonge = await pedir("b", { rua: "Avenida Teixeira e Souza", numero: "1000", bairro: "Centro" }, { cotacao: token });
r.casos.c_mesmoEnderecoOutraCoordenada = await pedir("c", E3, { cotacao: token, customerCoords: { lat: -22.8559191, lng: -42.0279765 }, customerCoordsOrigem: "gps" });
const [txt, ass] = token.split(".");
const adulterado = Buffer.from(JSON.stringify({ ...ler(token), taxa: 1 }), "utf8").toString("base64url") + "." + ass;
r.casos.d_tokenAdulterado = await pedir("d", E3, { cotacao: adulterado, deliveryFee: 1 });
r.casos.e_controleMesmoEndereco = await pedir("e", E3, { cotacao: token });
r.casos.f_soBairroSemPino = await pedir("f", { rua: "Travessa Canaã", numero: "6", bairro: "Boca do Mato" }, { deliveryFee: 5 });
gravarResultado("e12", r);
console.log(JSON.stringify(r, null, 2));
await prisma.$disconnect();
