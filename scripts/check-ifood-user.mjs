import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { ifoodConnected: true },
        { ifoodMerchantId: { not: null } },
        { role: "ADMIN" }
      ]
    },
    select: {
      id: true,
      email: true,
      storeName: true,
      ifoodMerchantId: true,
      ifoodConnected: true,
      ifoodSyncDeliveryTime: true,
      deliveryZones: true,
      deliveryZoneType: true
    }
  });

  console.log("Users with iFood integration in DB:");
  console.log(JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
