import { prisma } from "../lib/prisma";

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { contains: "hakim", mode: "insensitive" } },
    select: { id: true, storeName: true, ifoodMerchantId: true, repasseConfig: true },
  });
  console.log("USER:", JSON.stringify(user, null, 2));

  const recent = await prisma.customerOrder.findMany({
    where: { franchiseeId: user!.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, source: true, createdAt: true, ifoodOrderId: true, totalAmount: true },
  });
  console.log("RECENT ORDERS:", JSON.stringify(recent, null, 2));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cancelled = await prisma.customerOrder.count({
    where: {
      franchiseeId: user!.id,
      status: "CANCELADO",
      createdAt: { gte: today },
    },
  });
  console.log(`\nCANCELLED TODAY: ${cancelled}`);

  const total = await prisma.customerOrder.count({
    where: {
      franchiseeId: user!.id,
      createdAt: { gte: today },
    },
  });
  console.log(`TOTAL TODAY: ${total}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
