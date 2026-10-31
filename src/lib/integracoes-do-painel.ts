import { prisma } from "@/lib/prisma";
import { chaveDoCanal } from "@/lib/canal-do-pedido";

/** Os botões de marketplace do "Filtro de integrações" do painel de pedidos. */
export type IntegracaoDoFiltro = "ifood" | "99food" | "keeta" | "jotaja" | "brendi" | "wabiz";

const DO_CANAL: Record<string, IntegracaoDoFiltro> = {
  IFOOD: "ifood",
  "99FOOD": "99food",
  KEETA: "keeta",
  JOTAJA: "jotaja",
  BRENDI: "brendi",
  WABIZ: "wabiz",
};

/**
 * Quais integrações a loja usa: as ligadas no cadastro e as que mandaram
 * pedido nos últimos 60 dias. O filtro do painel mostrava iFood, 99, Keeta,
 * Jotajá e Brendi para toda loja — quem só tem iFood via cinco botões que
 * não filtram nada (Douglas, 31/10/2026).
 *
 * `null` quando a leitura falha: aí a tela mostra todos, como antes.
 */
export async function integracoesDoPainel(lojaIds: string[]): Promise<IntegracaoDoFiltro[] | null> {
  if (lojaIds.length === 0) return [];
  try {
    const usadas = new Set<IntegracaoDoFiltro>();
    const [lojas, ifood, grupos, brendi, keeta] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: lojaIds } },
        select: { ifoodMerchantId: true, ifoodConnected: true, food99MerchantId: true, food99Connected: true, jotajaConnected: true },
      }),
      prisma.ifoodIntegration.count({ where: { userId: { in: lojaIds }, connected: true, active: true } }),
      prisma.customerOrder.groupBy({
        by: ["source", "openDeliveryChannel"],
        where: { franchiseeId: { in: lojaIds }, createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60_000) } },
      }),
      // brendiConnected e a KeetaLoja não estão no client do Prisma.
      prisma.$queryRaw<{ c: boolean | null }[]>`SELECT bool_or("brendiConnected") AS c FROM "User" WHERE id = ANY(${lojaIds})`
        .then((r) => r[0]?.c === true)
        .catch(() => false),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KeetaLoja" WHERE "franchiseeId" = ANY(${lojaIds}) AND "ativa" = true`
        .then((r) => Number(r[0]?.n ?? 0) > 0)
        .catch(() => false),
    ]);
    if (ifood > 0 || lojas.some((l) => l.ifoodConnected || l.ifoodMerchantId)) usadas.add("ifood");
    if (lojas.some((l) => l.food99Connected || l.food99MerchantId)) usadas.add("99food");
    if (lojas.some((l) => l.jotajaConnected)) usadas.add("jotaja");
    if (brendi) usadas.add("brendi");
    if (keeta) usadas.add("keeta");
    for (const g of grupos) {
      const chave = DO_CANAL[chaveDoCanal({ source: g.source, openDeliveryChannel: g.openDeliveryChannel })];
      if (chave) usadas.add(chave);
    }
    return [...usadas];
  } catch (err: any) {
    console.error("[Painel] integrações da loja:", String(err?.message ?? "").slice(0, 200));
    return null;
  }
}
