import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Broadcasting JotaJá orders #4519, #4522, #4525, #4528 to ALL active store users...");

  // 1. Get all active store users for JotaJá merchant 22238 (or active franchisee accounts)
  const activeUsers = await prisma.user.findMany({
    where: {
      OR: [
        { jotajaConnected: true },
        { jotajaMerchantId: "22238" },
        { email: { contains: "hakim" } }
      ],
      NOT: {
        email: { startsWith: "deleted_" }
      }
    },
    select: { id: true, email: true }
  });

  console.log(`Found ${activeUsers.length} active users to receive JotaJá orders.`);

  // 2. Target orders to clone across all active users
  const sourceOrders = await prisma.customerOrder.findMany({
    where: {
      openDeliveryOrderId: {
        in: [
          "5d73ac91-b7aa-4f23-9ff5-9a279b86c9e3", // Veronica (#4519)
          "a687e140-9939-43b0-9cd6-d86af7aa35aa", // Felipe (#4522)
          "4f89c94b-89db-44b1-9d47-d9e6cc100c08", // Mariane (#4525)
          "299e657c-e3fd-4853-93ac-d7dec55c6374"  // Jefter (#4528)
        ]
      }
    },
    include: {
      items: {
        include: { menuProduct: true }
      }
    }
  });

  console.log(`Found ${sourceOrders.length} source orders to broadcast.`);

  for (const src of sourceOrders) {
    for (const u of activeUsers) {
      if (u.id === src.franchiseeId) continue; // Already exists for this user

      const targetOpenId = `${src.openDeliveryOrderId}_${u.id}`;

      // Check if already created for this user
      const existing = await prisma.customerOrder.findFirst({
        where: {
          OR: [
            { openDeliveryOrderId: targetOpenId },
            { franchiseeId: u.id, openDeliveryReference: src.openDeliveryReference }
          ]
        }
      });

      if (existing) continue;

      // Create CustomerOrder for user `u`
      const newOrder = await prisma.customerOrder.create({
        data: {
          franchiseeId: u.id,
          openDeliveryOrderId: targetOpenId,
          openDeliveryReference: src.openDeliveryReference,
          openDeliveryChannel: "JOTAJA",
          source: "JOTAJA",
          customerName: src.customerName,
          customerPhone: src.customerPhone,
          customerAddress: src.customerAddress,
          deliveryType: src.deliveryType,
          paymentMethod: src.paymentMethod,
          totalAmount: src.totalAmount,
          deliveryFee: src.deliveryFee,
          status: "NOVO",
          notes: src.notes,
          scheduledDatetime: src.scheduledDatetime,
          createdAt: src.createdAt
        }
      });

      // Create items
      for (const item of src.items) {
        let menuProd = await prisma.menuProduct.findFirst({
          where: {
            franchiseeId: u.id,
            name: item.menuProduct?.name || "Item Jotajá"
          }
        });

        if (!menuProd) {
          menuProd = await prisma.menuProduct.create({
            data: {
              franchiseeId: u.id,
              name: item.menuProduct?.name || "Item Jotajá",
              description: item.menuProduct?.description || "",
              price: item.price,
              category: item.menuProduct?.category || "JotaJá"
            }
          });
        }

        await prisma.customerOrderItem.create({
          data: {
            orderId: newOrder.id,
            menuProductId: menuProd.id,
            quantity: item.quantity,
            price: item.price,
            comboSelections: item.comboSelections ?? undefined
          }
        });
      }

      console.log(`✅ Cloned Order #${src.openDeliveryReference} (${src.customerName}) for user ${u.email}`);
    }
  }

  console.log("SUCCESS! All JotaJá orders #4519, #4522, #4525, #4528 broadcast to all store accounts!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
