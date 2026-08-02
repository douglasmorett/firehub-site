const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== VERIFICANDO QUAL LOJA RECEBEU MAIS PEDIDOS HOJE ===");

  const ordersToday = await prisma.customerOrder.groupBy({
    by: ['franchiseeId'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } }
  });

  console.log("Distribuição de pedidos por franchiseeId:");
  for (const item of ordersToday) {
    const user = await prisma.user.findUnique({
      where: { id: item.franchiseeId },
      select: { name: true, email: true, role: true }
    });
    console.log(`Loja ID: ${item.franchiseeId} | Nome: ${user?.name} | Email: ${user?.email} | Total Pedidos: ${item._count.id}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
