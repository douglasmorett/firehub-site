const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const orders = await prisma.customerOrder.findMany({
    where: { OR: [ { ifoodOrderId: 'ifood-test-cenario1-agendado' }, { ifoodOrderId: 'ifood-test-cenario2-imediato' } ] },
    select: { id:true, ifoodOrderId:true, status:true, customerName:true, totalAmount:true, source:true }
  });
  console.log('PEDIDOS ENCONTRADOS:', JSON.stringify(orders, null, 2));
  await prisma.();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
