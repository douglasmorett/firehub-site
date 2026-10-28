/** Laboratório (SÓ LEITURA): p1/p2 do ab-do-robo.ts com e sem o filtro do robô, por loja. */
import path from "node:path";
import dotenv from "dotenv";
const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });
async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { SEM_PRODUTO_DE_INTEGRACAO } = await import("../src/lib/cardapio-interno");
  const par = (ps: any[]) => ps.filter((p) => !p.isCombo && !p.isBeverage && p.price > 10 && p.price <= 150).sort((a, b) => b.price - a.price).slice(0, 2).map((p) => `${p.name} (${p.price})`).join(" + ");
  for (const slug of process.argv[2].split(",")) {
    const loja = await prisma.user.findFirst({ where: { slug }, select: { id: true } });
    const sel = { name: true, price: true, isCombo: true, isBeverage: true };
    const velho = await prisma.menuProduct.findMany({ where: { franchiseeId: loja!.id, active: true, apenasEmCombo: false }, select: sel });
    const novo = await prisma.menuProduct.findMany({ where: { franchiseeId: loja!.id, active: true, activeDelivery: true, apenasEmCombo: false, ...SEM_PRODUTO_DE_INTEGRACAO }, select: sel });
    const a = par(velho), b = par(novo);
    console.log(`${a === b ? "  igual " : "MUDOU  "} ${slug}: ${a}${a === b ? "" : `  →  ${b}`}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
