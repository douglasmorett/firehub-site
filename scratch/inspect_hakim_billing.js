const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    include: {
      billingCycles: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!user) {
    console.log('Usuário contatohakim@gmail.com não encontrado!');
    return;
  }

  console.log('=== DADOS DO USUÁRIO HAKIM ===');
  console.log({
    id: user.id,
    name: user.name,
    email: user.email,
    storeName: user.storeName,
    planPercent: user.planPercent,
    isFranqueadoHakim: user.isFranqueadoHakim,
  });

  console.log('\n=== CICLOS DE FATURAMENTO DA HAKIM ===');
  user.billingCycles.forEach((bc) => {
    console.log({
      id: bc.id,
      month: bc.month,
      status: bc.status,
      calculatedFee: bc.calculatedFee,
      grossRevenue: bc.grossRevenue,
      asaasInvoiceId: bc.asaasInvoiceId,
      asaasPaymentId: bc.asaasPaymentId,
      asaasInvoiceUrl: bc.asaasInvoiceUrl,
      createdAt: bc.createdAt,
    });
  });
}

main().finally(() => prisma.$disconnect());
