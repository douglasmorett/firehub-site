import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { contains: "contatohakim@gmail.com", mode: "insensitive" } },
  });

  for (const u of users) {
    const res = await prisma.franchiseeBillingCycle.updateMany({
      where: { franchiseeId: u.id },
      data: { amountDue: 0, amountPending: 0, status: "PAID" },
    });
    console.log(`[Billing Exemption] Zerados ciclos de cobrança para ${u.email}:`, res);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
