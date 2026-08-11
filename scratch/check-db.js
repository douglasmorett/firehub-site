require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const activeOrders = await p.customerOrder.findMany({
    where: {
      NOT: { status: { in: ['ENTREGUE', 'CANCELADO', 'ENCERRADO'] } }
    },
    select: {
      id: true,
      ifoodReference: true,
      openDeliveryReference: true,
      customerName: true,
      status: true,
      deliveryType: true,
      franchiseeId: true,
      createdAt: true
    }
  });

  console.log("\n=== ACTIVE ORDERS IN DB ===");
  console.log(JSON.stringify(activeOrders, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
