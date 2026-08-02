const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== RE-Mapeando JotaJá Merchant 22238 e Pedido Kelly Ventura ===");

  // Buscar os dados das lojas Hakim Rio das Ostras
  const activeStores = await prisma.user.findMany({
    where: {
      email: {
        in: [
          "viniciusmenezes.ofc@gmail.com",
          "franqueado@hakim.com.br",
          "contatohakim@gmail.com"
        ]
      }
    }
  });

  console.log("Lojas ativas encontradas:", activeStores.map(s => ({ id: s.id, name: s.name, email: s.email, jotajaMerchantId: s.jotajaMerchantId })));

  // Vamos atualizar Hakim Centro - Rio das Ostras (cmornm4wd0000l804s0jy0eit) e Franquia (cmo3fnu5r0001emekp3cbzobh)
  const targetStoreId = "cmornm4wd0000l804s0jy0eit"; // Hakim Centro - Rio das Ostras

  // 1. Limpar jotajaMerchantId da conta deletada
  await prisma.user.update({
    where: { id: "cmrxo9qdb0001js04w8fxh2pn" },
    data: { jotajaMerchantId: null, jotajaConnected: false }
  });

  // 2. Definir jotajaMerchantId 22238 na loja ativa do Hakim Centro
  await prisma.user.update({
    where: { id: targetStoreId },
    data: { jotajaMerchantId: "22238", jotajaConnected: true }
  });

  // 3. Atualizar o franchiseeId do pedido de Kelly Ventura para a loja ativa
  const updatedOrder = await prisma.customerOrder.update({
    where: { id: "cmsb27p780007kv04xmpl3non" },
    data: { franchiseeId: targetStoreId }
  });

  console.log("✅ Pedido de Kelly Ventura re-vinculado com sucesso para a loja ativa:", updatedOrder.id);
  console.log("✅ JotaJá Merchant 22238 vinculado à loja Hakim Centro - Rio das Ostras!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
