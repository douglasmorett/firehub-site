const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const franchisees = await prisma.user.findMany({
    where: { role: { in: ['FRANCHISEE', 'ADMIN', 'STAFF'] } },
    select: { id: true, name: true, email: true, role: true, storeName: true, city: true }
  });
  console.log("Found franchisees/users:", franchisees);
}

main().catch(console.error).finally(() => prisma.$disconnect());
