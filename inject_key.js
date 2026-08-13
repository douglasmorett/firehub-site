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

  const newConfig = {
    ...(user.chatbotConfig || {}),
    geminiApiKey: process.env.GEMINI_API_KEY
  };

  await prisma.user.update({
    where: { email: 'contatohakim@gmail.com' },
    data: { chatbotConfig: newConfig }
  });

  console.log("Updated Hakim's config with Gemini API Key!");
}

require('dotenv').config();
main().finally(() => prisma.$disconnect());
