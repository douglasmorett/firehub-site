const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' }
  });

  if (!user) return;

  const sessions = await prisma.cashSession.findMany({
    where: { franchiseeId: user.id },
    orderBy: { openedAt: 'desc' },
    take: 10
  });

  console.log('=== SESSÕES DE CAIXA DO HAKIM ===');
  sessions.forEach(s => {
    console.log({
      id: s.id,
      status: s.status,
      openedAt: s.openedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      closedAt: s.closedAt ? s.closedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null,
      openingAmount: s.openingAmount
    });
  });
}

main().finally(() => prisma.$disconnect());
