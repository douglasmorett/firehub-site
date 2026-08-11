const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== INSPEÇÃO COMPLETA DO PEDIDO KELLY VENTURA ===");

  const kellyOrders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { customerName: { contains: "Kelly", mode: "insensitive" } },
        { customerPhone: { contains: "998715025" } },
      ]
    },
    include: {
      franchisee: {
        select: {
          id: true,
          email: true,
          name: true,
          slug: true,
          ownerId: true
        }
      }
    }
  });

  console.log("Pedidos de Kelly encontrados:", kellyOrders.length);
  for (const o of kellyOrders) {
    console.log({
      id: o.id,
      franchiseeId: o.franchiseeId,
      storeName: o.franchisee?.name,
      storeEmail: o.franchisee?.email,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      status: o.status,
      source: o.source,
      openDeliveryReference: o.openDeliveryReference,
      createdAt: o.createdAt,
      scheduledDatetime: o.scheduledDatetime,
      totalAmount: o.totalAmount,
    });
  }

  // Buscar todas as lojas / franqueados no banco para ver o mapeamento de franquias
  const stores = await prisma.user.findMany({
    where: {
      role: { in: ["FRANQUEADO", "LOJA", "ADMIN"] }
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ownerId: true
    }
  });

  console.log("=== LOJAS E FRANQUEADOS REGISTRADOS ===");
  console.log(JSON.stringify(stores, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
