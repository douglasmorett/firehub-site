const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== AJUSTANDO CRIADO_EM DA KELLY VENTURA PARA O FIM DA FILA (EVITA MUDAR NÚMEROS DA COZINHA) ===");

  // Atualizar o createdAt do pedido da Kelly Ventura para a data/hora atual (fim da fila)
  const now = new Date();

  const updated = await prisma.customerOrder.update({
    where: { id: "cmsb27p780007kv04xmpl3non" },
    data: {
      createdAt: now,
      scheduledDatetime: null
    }
  });

  console.log("✅ Pedido Kelly Ventura ajustado para o final da fila:", updated.createdAt);
}

main().catch(console.error).finally(() => prisma.$disconnect());
