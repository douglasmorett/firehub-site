require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, storeName: true, chatbotConfig: true }
  });

  for (const user of users) {
    const config = (user.chatbotConfig || {});
    const history = Array.isArray(config.campaignHistory) ? config.campaignHistory : [];
    console.log(`User: ${user.storeName} (${user.email}) - Total Campaigns: ${history.length}`);
    history.forEach((c, idx) => {
      console.log(`  [${idx}] ID=${c.id} Date=${c.createdAt} Status=${c.status} Sent=${c.sentCount}/${c.targetCount} Msg="${(c.message || '').slice(0, 40)}..."`);
    });
  }

  await prisma.$disconnect();
}

run().catch(console.error);
