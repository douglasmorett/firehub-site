require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStores() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, ifoodMerchantId: true, ifoodAccessToken: true }
    });
    console.log("👥 Usuários no Banco:");
    console.table(users.map(u => ({
      email: u.email,
      merchantId: u.ifoodMerchantId || "NÃO CONECTADO",
      hasToken: !!u.ifoodAccessToken
    })));

    const stores = await prisma.store.findMany({
      select: { id: true, name: true, ifoodMerchantId: true }
    });
    console.log("🏪 Lojas no Banco:");
    console.table(stores);

  } catch (e) {
    console.error("Erro ao ler banco:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkStores();
