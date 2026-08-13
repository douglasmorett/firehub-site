const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    select: { chatbotConfig: true }
  });
  console.log(JSON.stringify(user.chatbotConfig, null, 2));
}

require('dotenv').config();
main().finally(() => prisma.$disconnect());
