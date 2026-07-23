import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { ifoodReference: { contains: '1899' } },
        { customerName: { contains: 'Leandra', mode: 'insensitive' } }
      ]
    }
  });
  console.log('Orders found in DB:', JSON.stringify(orders, null, 2));

  const lastOrders = await prisma.customerOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, customerName: true, ifoodReference: true, status: true, source: true, createdAt: true }
  });
  console.log('Last 10 orders in DB:', JSON.stringify(lastOrders, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
