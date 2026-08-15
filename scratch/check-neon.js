const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://neondb_owner:npg_9C4DXWRhvBUo@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
    }
  }
});

async function main() {
  try {
    const order = await prisma.order.findFirst({
      where: { id: { endsWith: 'IHLRX7' } },
      include: { items: true, history: true }
    });
    console.log(JSON.stringify(order, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
