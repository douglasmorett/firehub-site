require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "contatohakim@gmail.com" } });
  if (!user) { console.error("Usuário não encontrado!"); return; }

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    select: { id: true, ifoodOrderId: true, customerName: true, totalAmount: true, status: true, source: true, notes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log(`\n📋 Últimos pedidos na conta ${user.email} (Total na conta: ${await prisma.customerOrder.count({ where: { franchiseeId: user.id } })}):`);
  orders.forEach((o, i) => {
    console.log(`[${i+1}] Pedido #${o.ifoodOrderId?.slice(-6) || o.id.slice(-6)} | Cliente: ${o.customerName} | Total: R$ ${o.totalAmount} | Status: ${o.status} | Data: ${o.createdAt.toLocaleString('pt-BR')}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
