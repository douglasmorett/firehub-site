const { PrismaClient } = require('@prisma/client');
const { parse } = require('dotenv');
const fs = require('fs');

const envConfig = parse(fs.readFileSync('.env.local'));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}
console.log("DB URL starts with:", process.env.DATABASE_URL.substring(0, 15));

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: { id: { endsWith: 'IHLRX7' } },
    include: { items: true, history: true }
  });
  console.log("Order found:", order);
}

main().catch(console.error).finally(() => prisma.$disconnect());
