const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const startOfNight = new Date('2026-08-01T12:00:00-03:00');
  
  // Buscar todos os pedidos criados desde a tarde do dia 1º de agosto até agora, ordenados por data de criação asc
  const orders = await prisma.customerOrder.findMany({
    where: {
      createdAt: { gte: startOfNight }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`=== CORRIGINDO NUMERAÇÃO PERMANENTE DOS PEDIDOS DA NOITE (${orders.length} pedidos) ===`);

  let count = 1;
  for (const o of orders) {
    // Grava o dailyOrderNumber definitivo no banco de dados
    await prisma.customerOrder.update({
      where: { id: o.id },
      data: { dailyOrderNumber: count }
    });

    const localTime = o.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`Pedido #${count} -> ${o.customerName} (Criado às: ${localTime}) - ID: ${o.id}`);
    count++;
  }

  console.log("✅ Todos os pedidos da noite receberam numeração permanente no banco de dados!");
}

main().finally(() => prisma.$disconnect());
