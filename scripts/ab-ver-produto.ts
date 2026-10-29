/** Laboratório (SÓ LEITURA): mostra os campos de um produto para ver por que o robô diz que não tem. */
import path from "node:path";
import dotenv from "dotenv";
const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });
async function main() {
  const { prisma } = await import("../src/lib/prisma");
  for (const nome of process.argv.slice(2)) {
    const ps = await prisma.menuProduct.findMany({ where: { name: { contains: nome, mode: "insensitive" } }, select: { name: true, price: true, active: true, activeDelivery: true, apenasEmCombo: true, isCombo: true, availableDays: true, availableHours: true, promoPrice: true, priceDelivery: true, category: true, franchiseeId: true } as any });
    for (const p of ps as any[]) {
      const { description, imageUrl, ...resto } = p;
      console.log(JSON.stringify({ ...resto }, null, 1).slice(0, 1800));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
