require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, ifoodMerchantId: true, ifoodConnected: true } });
  console.log("Users found:", users.length);

  const updated = await prisma.user.updateMany({
    data: {
      ifoodMerchantId: "6a5fb96d-68bd-46af-ada4-456a9a160787",
      ifoodConnected: true
    }
  });
  console.log("✅ DB Updated successfully for", updated.count, "user(s)!");
  await prisma.$disconnect();
}

main().catch(console.error);
