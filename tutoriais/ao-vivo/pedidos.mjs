// Os pedidos que "chegam" e "saem" durante a parte B, direto no banco da loja
// de teste (porta 5470). A tela de pedidos do FireHub busca o que mudou a cada
// poucos segundos, a coluna Em Produção muda de número, a extensão lê esse
// número e mexe no iFood.
//
//   node tutoriais/ao-vivo/pedidos.mjs estado | chegar 2 | sair | voltar
import { PrismaClient } from "@prisma/client";
import { urlDoBanco } from "./banco.mjs";

const url = urlDoBanco();
const EMAIL = "demo@tutorial.local";
// Os da semente que estão na cozinha no começo (#6 e #7).
const DA_SEMENTE = { 6: "PREPARANDO", 7: "ACEITO" };
const CLIENTES = [
  ["Rodrigo Alves", "Rua do Comércio, 51 - Centro", [["X-Tudo", 1], ["Coca-Cola lata", 1]]],
  ["Juliana Rocha", "Av. Atlântica, 1200 - Praia", [["Pizza Calabresa", 1]]],
  ["Marcos Pinto", "Rua Ipê Amarelo, 18 - Jardim América", [["X-Bacon", 1], ["Batata Frita", 1]]],
  ["Patrícia Gomes", "Rua São José, 402 - Vila Nova", [["Pizza Marguerita", 1], ["Guaraná 2 L", 1]]],
  ["André Souza", "Rua das Gaivotas, 9 - Praia", [["X-Burger", 2]]],
  ["Camila Nunes", "Rua Bahia, 330 - Centro", [["Batata Frita", 1], ["Coca-Cola lata", 2]]],
];

export function abrir() { return new PrismaClient({ datasources: { db: { url } } }); }
async function loja(prisma) { return prisma.user.findUnique({ where: { email: EMAIL } }); }

export async function estado(prisma) {
  const l = await loja(prisma);
  const lista = await prisma.customerOrder.findMany({ where: { franchiseeId: l.id }, select: { dailyOrderNumber: true, status: true }, orderBy: { dailyOrderNumber: "asc" } });
  const cozinha = lista.filter((o) => ["ACEITO", "PREPARANDO"].includes(o.status)).length;
  return { cozinha, pedidos: lista.map((o) => `#${o.dailyOrderNumber} ${o.status}`) };
}

/** Chegam `n` pedidos de entrega já aceitos (vão direto para Em Produção). */
export async function chegar(prisma, n) {
  const l = await loja(prisma);
  const produtos = Object.fromEntries((await prisma.menuProduct.findMany({ where: { franchiseeId: l.id } })).map((p) => [p.name, p]));
  const maior = (await prisma.customerOrder.aggregate({ where: { franchiseeId: l.id }, _max: { dailyOrderNumber: true } }))._max.dailyOrderNumber || 7;
  for (let i = 0; i < n; i++) {
    const numero = maior + 1 + i;
    const [nome, endereco, linhas] = CLIENTES[(numero - 8) % CLIENTES.length];
    await prisma.customerOrder.create({
      data: {
        franchiseeId: l.id, source: "ONLINE", dailyOrderNumber: numero, status: "ACEITO", acceptedAt: new Date(),
        customerName: nome, customerPhone: `119777700${String(numero).padStart(2, "0")}`, customerAddress: endereco,
        deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6, paymentMethod: "PIX",
        totalAmount: linhas.reduce((t, [p, q]) => t + produtos[p].price * q, 6),
        items: { create: linhas.map(([p, quantity]) => ({ menuProductId: produtos[p].id, productName: p, quantity, price: produtos[p].price })) },
      },
    });
  }
}

/** Tudo o que está na cozinha sai para entrega. */
export async function sair(prisma) {
  const l = await loja(prisma);
  await prisma.customerOrder.updateMany({ where: { franchiseeId: l.id, status: { in: ["ACEITO", "PREPARANDO"] } }, data: { status: "SAIU_ENTREGA", dispatchedAt: new Date() } });
}

/** Volta ao quadro da semente: some com os que chegaram e devolve #6 e #7 à cozinha. */
export async function voltar(prisma) {
  const l = await loja(prisma);
  const novos = await prisma.customerOrder.findMany({ where: { franchiseeId: l.id, dailyOrderNumber: { gt: 7 } }, select: { id: true } });
  const ids = novos.map((o) => o.id);
  if (ids.length) {
    await prisma.customerOrderItem.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await prisma.customerOrder.deleteMany({ where: { id: { in: ids } } });
  }
  for (const [n, status] of Object.entries(DA_SEMENTE)) {
    await prisma.customerOrder.updateMany({ where: { franchiseeId: l.id, dailyOrderNumber: Number(n) }, data: { status, dispatchedAt: null } });
  }
}

if (process.argv[1] && process.argv[1].endsWith("pedidos.mjs")) {
  const prisma = abrir();
  const [acao, arg] = process.argv.slice(2);
  if (acao === "chegar") await chegar(prisma, Number(arg || 1));
  if (acao === "sair") await sair(prisma);
  if (acao === "voltar") await voltar(prisma);
  console.log(JSON.stringify(await estado(prisma)));
  await prisma.$disconnect();
}
