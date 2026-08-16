import { prisma } from "../src/lib/prisma";

async function main() {
  const combos = await prisma.menuProduct.findMany({
    where: {
      name: { contains: "Monte seu Combo", mode: "insensitive" }
    },
    include: {
      comboGroups: {
        include: { items: true }
      },
      orderItems: true,
      _count: {
        select: { orderItems: true }
      }
    }
  });

  console.log("Found combos:", JSON.stringify(combos, null, 2));

  // Count total products for each franchisee
  const totalProducts = await prisma.menuProduct.groupBy({
    by: ['franchiseeId'],
    _count: { id: true }
  });
  console.log("Products by franchisee:", totalProducts);
}

main().catch(console.error).finally(() => prisma.$disconnect());
