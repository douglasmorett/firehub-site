const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      city: true,
      isFranqueadoHakim: true,
      createdAt: true
    }
  });
  console.log("RECENT USERS:", JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
