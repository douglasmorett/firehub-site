const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'Sousa-nik@hormail.com' },
    select: { id: true, name: true, role: true, paymentFees: true, deliveryZones: true, storeOrderCount: true, slug: true, storeLogo: true, storeBanner: true, storeHours: true, createdAt: true }
  });
  console.log(JSON.stringify(user, null, 2));
}
main().catch(e => { console.error(e.message); }).finally(() => prisma.$disconnect());
