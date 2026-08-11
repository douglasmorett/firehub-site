const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Iniciando cancelamento dos pedidos de simulação de vídeo...");

  const logFilePath = path.join(__dirname, 'video_simulation_orders_created.json');
  let loggedOrderIds = [];
  if (fs.existsSync(logFilePath)) {
    try {
      const content = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
      loggedOrderIds = content.orderIds || [];
    } catch (e) {
      console.warn("Erro ao ler o arquivo de log JSON:", e.message);
    }
  }

  // Buscar todos os pedidos marcados com [SIMULACAO_VIDEO] no campo notes OU presentes no arquivo de log
  const targetOrders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { notes: { contains: '[SIMULACAO_VIDEO]' } },
        { id: { in: loggedOrderIds } }
      ]
    },
    select: { id: true, customerName: true, status: true, franchiseeId: true }
  });

  if (targetOrders.length === 0) {
    console.log("Nenhum pedido de simulação encontrado para cancelar.");
    return;
  }

  console.log(`Encontrados ${targetOrders.length} pedidos de simulação.`);

  // Atualizar o status de todos eles para CANCELADO
  const updateResult = await prisma.customerOrder.updateMany({
    where: {
      id: { in: targetOrders.map(o => o.id) }
    },
    data: {
      status: 'CANCELADO',
      cancelledBy: 'RESTAURANT',
      cancelReason: 'Simulação de vídeo concluída',
      kdsStage: 'FINISHED'
    }
  });

  console.log(`\n✅ ${updateResult.count} pedidos foram cancelados com sucesso no banco de dados!`);

  // Limpa o arquivo de log se existir
  if (fs.existsSync(logFilePath)) {
    fs.unlinkSync(logFilePath);
    console.log("🗑️ Arquivo de log temporário removido.");
  }
}

main()
  .catch(e => {
    console.error("Erro ao cancelar pedidos de simulação:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
