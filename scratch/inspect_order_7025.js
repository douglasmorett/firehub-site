const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const order = await prisma.customerOrder.findFirst({
    where: {
      OR: [
        { openDeliveryReference: "7025" },
        { ifoodReference: "7025" },
        { id: { contains: "7025" } }
      ]
    },
    include: {
      franchisee: {
        select: { id: true, email: true, storeName: true, ifoodMerchantId: true, ifoodAccessToken: true }
      }
    }
  });

  console.log("ORDER 7025:", JSON.stringify(order, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
