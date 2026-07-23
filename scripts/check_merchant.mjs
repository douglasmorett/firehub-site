import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { ifoodMerchantId: { not: null } },
    select: { email: true, storeName: true, ifoodMerchantId: true, ifoodConnected: true }
  });
  console.log("USERS WITH IFOOD MERCHANT ID:", JSON.stringify(users, null, 2));
}

main().finally(() => prisma.$disconnect());
