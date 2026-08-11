const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const orderId = "cmsov35s30003l704alxkzka6"; // Pedido 9239
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, ifoodOrderId: true, deliveryFee: true }
  });

  const calculatedFee = (order.deliveryFee && order.deliveryFee > 0) ? order.deliveryFee : 9.99;
  const result = {
    available: true,
    quoteId: `quote-${order.id.slice(-6)}`,
    price: calculatedFee,
    estimatedMinutes: 15,
    description: "Entrega individual Sob Demanda",
  };

  console.log("FINAL QUOTE FOR ORDER 9239:", JSON.stringify(result, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
