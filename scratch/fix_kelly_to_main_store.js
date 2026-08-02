const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== VINCULANDO PEDIDO KELLY VENTURA À LOJA PRINCIPAL (Hakim Contato - cmpx96phr0000ujf0sb0qk5vr) ===");

  const mainStoreId = "cmpx96phr0000ujf0sb0qk5vr";

  // 1. Garantir que a loja principal tem o jotajaMerchantId 22238
  await prisma.user.update({
    where: { id: mainStoreId },
    data: { jotajaMerchantId: "22238", jotajaConnected: true }
  });

  // 2. Mover o pedido de Kelly Ventura para a loja principal
  const updated = await prisma.customerOrder.update({
    where: { id: "cmsb27p780007kv04xmpl3non" },
    data: { franchiseeId: mainStoreId }
  });

  console.log("✅ Pedido Kelly Ventura movido para a loja principal:", updated.id);
  console.log("✅ JotaJá Merchant 22238 vinculado com sucesso à conta contatohakim@gmail.com!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
