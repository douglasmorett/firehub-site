const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const store = await prisma.user.findUnique({
    where: { id: "cmrxo9qdb0001js04w8fxh2pn" }
  });
  console.log("=== LOJA DONA DO PEDIDO ===");
  console.log(JSON.stringify(store, null, 2));

  const allStores = await prisma.user.findMany({
    select: { id: true, name: true, email: true, slug: true, role: true }
  });
  console.log("=== TODAS AS LOJAS NO BANCO ===");
  console.log(JSON.stringify(allStores, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
