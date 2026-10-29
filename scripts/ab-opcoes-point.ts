/** Laboratório (SÓ LEITURA), 29/10/2026: os nomes das opções da Pizza Grande (2 Sabores) da Point e os pedidos do robô com ela. */
import path from "node:path";
import dotenv from "dotenv";
const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });
async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const loja = await prisma.user.findFirst({ where: { slug: "point-da-esfiha" }, select: { id: true } });
  const p: any = await prisma.menuProduct.findFirst({
    where: { franchiseeId: loja!.id, name: "Pizza Grande (2 Sabores)" },
    select: { id: true, price: true, comboGroups: { select: { title: true, minQty: true, maxQty: true, items: { select: { additionalPrice: true, menuProduct: { select: { name: true } } } } } } } as any,
  });
  console.log("base", p.price);
  for (const g of p.comboGroups) console.log(g.title, g.minQty, g.maxQty, g.items.slice(0, 6).map((i: any) => `${JSON.stringify(i.menuProduct?.name)} +${i.additionalPrice}`).join(" | "));
  const itens: any[] = await prisma.customerOrderItem.findMany({
    where: { menuProductId: p.id, order: { createdAt: { gte: new Date("2026-09-01") } } } as any,
    select: { price: true, quantity: true, productName: true, notes: true, comboSelections: true, order: { select: { createdAt: true, source: true, dailyOrderNumber: true, status: true } } } as any,
    orderBy: { order: { createdAt: "desc" } } as any,
    take: 60,
  });
  for (const i of itens) console.log(i.order?.createdAt?.toISOString().slice(0, 10), i.order?.source, i.order?.status, `#${i.order?.dailyOrderNumber}`, i.price, "|", i.productName, "|", (i.notes || "").slice(0, 90));
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 800)); process.exit(1); });
