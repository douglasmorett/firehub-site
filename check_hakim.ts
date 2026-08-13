import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'contatohakim@gmail.com' },
      select: { chatbotConfig: true }
    });
    console.log("HAKIM CONFIG:", JSON.stringify(user?.chatbotConfig, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run().finally(() => prisma.$disconnect());
