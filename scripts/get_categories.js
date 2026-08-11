const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getCategories() {
  for (let i = 0; i < 3; i++) {
    try {
      const cats = await prisma.menuProduct.findMany({
        where: { franchiseeId: 'cmo3s7b6o0001emls569vwsfl' },
        select: { category: true },
        distinct: ['category']
      });
      console.log(cats);
      return;
    } catch(e) {
      console.log("Retry...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
getCategories().finally(() => prisma.$disconnect());
