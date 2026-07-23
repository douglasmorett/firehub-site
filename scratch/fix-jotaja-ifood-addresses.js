require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Buscando pedidos ativos sem bairro no endereço...");
  const activeOrders = await prisma.customerOrder.findMany({
    where: {
      status: { in: ["NOVO", "ACEITO", "PREPARANDO", "SAIU_ENTREGA", "PRONTO"] },
    },
    select: { id: true, customerName: true, customerAddress: true, source: true, ifoodOrderId: true, openDeliveryOrderId: true },
  });

  console.log(`📋 ${activeOrders.length} pedido(s) ativo(s) encontrado(s).`);

  for (const o of activeOrders) {
    console.log(`- Pedido #${o.id.slice(-4)} (${o.customerName}) | Endereço atual: "${o.customerAddress}"`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌ Erro:", err);
  prisma.$disconnect();
});
