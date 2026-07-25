const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const order = await prisma.customerOrder.findFirst({
    where: {
      OR: [
        { openDeliveryReference: "2316" },
        { openDeliveryOrderId: "32516601" },
        { id: "cmrzql8lm0001ju04ix5arnvw" }
      ]
    },
    include: { items: true, franchisee: { select: { id: true, email: true } } }
  });

  console.log("PEDIDO DA LUANA NO BANCO:", JSON.stringify(order, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
