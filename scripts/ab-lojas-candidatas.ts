/**
 * Laboratório (SÓ LEITURA): lojas para o A/B do robô — robô ligado, anotando pedido
 * (aiOrderingEnabled != false), com cardápio de verdade e uso do robô nos últimos 30 dias.
 * Imprime slug, nome, se aceita retirada e quantas respostas o robô deu.
 */
import path from "node:path";
import dotenv from "dotenv";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const desde = new Date(Date.now() - 30 * 86400_000);
  const uso = await prisma.usageLog.groupBy({ by: ["franchiseeId"], where: { createdAt: { gte: desde }, category: "GEMINI_CHAT" }, _count: { _all: true } });
  const porLoja = new Map(uso.map((u: any) => [u.franchiseeId, u._count._all]));
  const lojas = await prisma.user.findMany({
    where: { id: { in: [...porLoja.keys()] }, slug: { not: null } },
    select: { id: true, storeName: true, slug: true, storeDeliveryOnly: true, chatbotConfig: true },
  });
  const linhas: any[] = [];
  for (const l of lojas) {
    const c: any = l.chatbotConfig || {};
    if (c.aiOrderingEnabled === false) continue;
    const produtos = await prisma.menuProduct.count({ where: { franchiseeId: l.id, active: true, apenasEmCombo: false, isCombo: false, isBeverage: false, price: { gt: 10 } } });
    if (produtos < 3) continue;
    linhas.push({ slug: l.slug, loja: l.storeName, retirada: !l.storeDeliveryOnly, produtos, respostas30d: porLoja.get(l.id) });
  }
  linhas.sort((a, b) => b.respostas30d - a.respostas30d);
  console.table(linhas.slice(0, 30));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
