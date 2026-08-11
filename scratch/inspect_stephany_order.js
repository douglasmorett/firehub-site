const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  console.log("=== INSPEÇÃO E CORREÇÃO DO PEDIDO DE STEPHANY (32647444) ===");

  const order = await prisma.customerOrder.findFirst({
    where: {
      OR: [
        { openDeliveryReference: "32647444" },
        { customerName: { contains: "Stephany", mode: "insensitive" } },
        { customerPhone: { contains: "980687997" } }
      ]
    },
    include: {
      items: {
        include: { menuProduct: true }
      }
    }
  });

  if (!order) {
    console.log("Pedido da Stephany não encontrado!");
    return;
  }

  console.log("Pedido encontrado:", {
    id: order.id,
    customerName: order.customerName,
    ref: order.openDeliveryReference,
    subtotalCalculado: order.items.reduce((s, i) => s + i.price * i.quantity, 0),
    totalAmount: order.totalAmount,
    deliveryFee: order.deliveryFee,
  });

  console.log("Itens do pedido:");
  for (const item of order.items) {
    console.log({
      id: item.id,
      name: item.menuProduct?.name,
      price: item.price,
      quantity: item.quantity,
      comboSelections: item.comboSelections,
    });

    // Se for o Combo 6 Esfirras Mix de 26.90, vamos corrigir o preço para 46.78
    if (item.menuProduct?.name.includes("Combo 6 Esfirras Mix") && item.price === 26.9) {
      await prisma.customerOrderItem.update({
        where: { id: item.id },
        data: { price: 46.78 }
      });
      console.log(`✅ Preço do item ${item.id} (${item.menuProduct.name}) corrigido de R$ 26.90 para R$ 46.78!`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
