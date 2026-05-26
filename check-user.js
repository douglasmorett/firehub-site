const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const email = 'paulocoutinhocastilho@gmail.com';
  const user = await p.user.findUnique({
    where: { email },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          items: true
        }
      }
    }
  });
  if (!user) {
    console.log("USER NOT FOUND");
    return;
  }
  console.log("USER DETAILS:");
  console.log({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    city: user.city,
    isFranqueadoHakim: user.isFranqueadoHakim,
    ordersCount: user.orders.length
  });

  console.log("\nRECENT ORDERS:");
  user.orders.forEach(order => {
    console.log({
      id: order.id,
      totalAmount: order.totalAmount,
      status: order.status,
      createdAt: order.createdAt,
      isEmergency: order.isEmergency,
      itemsCount: order.items.length
    });
  });
}

main().catch(console.error).finally(() => p.$disconnect());
