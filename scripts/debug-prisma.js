const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  // Teste a query do store/page.tsx (franchisee branch)
  const user = await prisma.user.findUnique({
    where: { email: 'Sousa-nik@hormail.com' },
    select: { id: true, slug: true, storeLogo: true, storeBanner: true, storeHours: true, paymentFees: true, deliveryZones: true, storeOrderCount: true }
  });
  console.log('User found:', user ? 'YES' : 'NO');
  if (!user) return;

  const since = new Date();
  since.setDate(since.getDate() - 90);

  try {
    const menuCount = await prisma.menuProduct.count({ where: { franchiseeId: user.id } });
    console.log('menuCount:', menuCount);
  } catch(e) { console.error('menuCount error:', e.message); }

  try {
    const orders = await prisma.customerOrder.findMany({
      where: { franchiseeId: user.id, createdAt: { gte: since } },
      include: { items: { include: { menuProduct: { select: { name: true, cost: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 5
    });
    console.log('orders count:', orders.length);
  } catch(e) { console.error('orders error:', e.message); }

  // Teste financeiro
  try {
    const orders2 = await prisma.customerOrder.findMany({
      where: { franchiseeId: user.id },
      include: {
        items: { include: { menuProduct: { select: { name: true, cost: true } } } },
        motoboy: { select: { name: true, paymentType: true, perDeliveryRate: true, dailyRate: true, perKmRate: true } }
      },
      take: 2
    });
    console.log('financeiro orders:', orders2.length);
  } catch(e) { console.error('financeiro orders error:', e.message); }

  // Teste pedidos-clientes
  try {
    const orders3 = await prisma.customerOrder.findMany({
      where: { franchiseeId: user.id },
      include: {
        items: {
          include: {
            menuProduct: { select: { id: true, name: true, price: true, imageUrl: true, category: true, active: true } }
          }
        }
      },
      take: 2
    });
    console.log('pedidos-clientes orders:', orders3.length);
  } catch(e) { console.error('pedidos-clientes error:', e.message); }
}
main().catch(e => console.error('FATAL:', e.message)).finally(() => prisma.$disconnect());
