require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "contatohakim@gmail.com" } });
  if (!user) { console.error("Usuário não encontrado!"); return; }

  // Pedidos que receberam evento DISPATCHED (Saiu para Entrega)
  const dispatchedIds = [
    "e5507d2b-361e-4395-a7ec-a58faba376fa", // Leila Oliveira (#5702)
    "e38f03c3-494f-4194-a03b-f1bddb39d8d1"  // Rômulo Paixão (#8701)
  ];

  // Pedidos que receberam evento CONCLUDED (Entregue / Concluído)
  const concludedIds = [
    "3f0c9a50-1911-448c-806f-182844a99185", // Fabiana Cunha (#6016)
    "052a1387-3b56-40cf-8af6-a122db9c69bd", // Jovane Junior (#3358)
    "11d1102c-d3b4-4ca1-ab51-05fc0af99c7e", // PADRAO ODONTO (#2225)
    "32bc0b16-95bb-4f32-a490-1810cc160b0e", // Jéssica Cristina (#6386)
    "7fda81ca-d028-49aa-b279-dcfce9bb4f27"  // Paulo Texeira (#6811)
  ];

  // Pedidos em preparo
  const prepIds = [
    "9a53a75d-24f0-4262-8bd2-ac5b32d39e85", // Fabiola Chame (#0695)
    "ec047bd1-80e6-4088-987d-b53b78532ddd"  // Amanda Soares Ferraz (#0555)
  ];

  console.log("🔄 Atualizando status dos pedidos com base no histórico do iFood...");

  const resDisp = await prisma.customerOrder.updateMany({
    where: { ifoodOrderId: { in: dispatchedIds } },
    data: { status: "SAIU_ENTREGA", ifoodDriverStatus: "DISPATCHED" }
  });
  console.log(`✅ ${resDisp.count} pedido(s) marcados como SAIU PARA ENTREGA (SAIU_ENTREGA).`);

  const resConc = await prisma.customerOrder.updateMany({
    where: { ifoodOrderId: { in: concludedIds } },
    data: { status: "ENTREGUE", ifoodDriverStatus: "CONCLUDED" }
  });
  console.log(`✅ ${resConc.count} pedido(s) marcados como CONCLUÍDOS / ENTREGUES (ENTREGUE).`);

  const resPrep = await prisma.customerOrder.updateMany({
    where: { ifoodOrderId: { in: prepIds } },
    data: { status: "PREPARANDO" }
  });
  console.log(`✅ ${resPrep.count} pedido(s) marcados como EM PREPARO (PREPARANDO).`);

  // Lista os status atualizados
  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    select: { ifoodOrderId: true, customerName: true, totalAmount: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 12
  });

  console.log("\n📋 Status atual dos últimos 12 pedidos:");
  orders.forEach((o, i) => {
    console.log(`[${i+1}] #${o.ifoodOrderId?.slice(-6)} | ${o.customerName} | R$ ${o.totalAmount} | Status: ${o.status}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
