/**
 * A parte com banco de lib/lojas-no-mesmo-pc.ts: lê o grupo da conta e decide
 * quais lojas o Assistente de `franchiseeId` atende.
 *
 * A fila da nuvem é consultada a cada 3 s por Assistente, então a resposta fica
 * em memória por 30 s. Ligar ou desligar a opção na tela vale em até 30 s, e
 * isso é bem mais barato do que duas consultas ao banco a cada 3 s por loja.
 * Qualquer falha cai na loja sozinha: a regra de sempre, nunca pior.
 */
import { prisma } from "@/lib/prisma";
import { lojasQueOPcAtende } from "@/lib/lojas-no-mesmo-pc";

const VALIDADE_MS = 30_000;
const cache = new Map<string, { ate: number; ids: string[] }>();

export async function lojasQueEstePcAtende(franchiseeId: string): Promise<string[]> {
  const guardado = cache.get(franchiseeId);
  if (guardado && guardado.ate > Date.now()) return guardado.ids;

  let ids = [franchiseeId];
  try {
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { id: true, accountGroupId: true } });
    if (loja) {
      const principal = loja.accountGroupId || loja.id;
      const grupo = await prisma.user.findMany({
        where: { OR: [{ id: principal }, { accountGroupId: principal }] },
        select: { id: true, printerConfig: true },
      });
      ids = lojasQueOPcAtende(franchiseeId, grupo);
    }
  } catch (err) {
    console.error("[PrintQueue] grupo da conta indisponível; atendendo só a própria loja:", (err as any)?.message || err);
  }

  cache.set(franchiseeId, { ate: Date.now() + VALIDADE_MS, ids });
  return ids;
}
