const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  let retries = 5;
  while (retries > 0) {
    try {
      await prisma.$connect();
      break;
    } catch (e) {
      retries--;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { chatbotConfig: true }
  });

  console.log(JSON.stringify(user.chatbotConfig, null, 2));
}

require('dotenv').config();
main().finally(() => prisma.$disconnect());
