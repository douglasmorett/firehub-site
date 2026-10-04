/**
 * A parte com banco de lib/lojas-no-mesmo-pc.ts: lê o grupo da conta e decide
 * quais lojas o Assistente de `franchiseeId` atende e quais ele pode confirmar.
 *
 * A fila da nuvem é consultada a cada 3 s por Assistente, então a resposta fica
 * em memória por 30 s. Ligar ou desligar a opção, ou trocar a loja do painel,
 * vale em até 30 s, e isso é bem mais barato do que duas consultas ao banco a
 * cada 3 s por loja. Qualquer falha cai na loja sozinha: a regra de sempre,
 * nunca pior.
 */
import { prisma } from "@/lib/prisma";
import { lojasQueOPcAtende, lojasQueOPcConfirma } from "@/lib/lojas-no-mesmo-pc";

const VALIDADE_MS = 30_000;
type Resolvido = { atende: string[]; confirma: string[] };
const cache = new Map<string, { ate: number; v: Resolvido }>();

async function resolver(franchiseeId: string): Promise<Resolvido> {
  const guardado = cache.get(franchiseeId);
  if (guardado && guardado.ate > Date.now()) return guardado.v;

  let v: Resolvido = { atende: [franchiseeId], confirma: [franchiseeId] };
  try {
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { id: true, accountGroupId: true } });
    if (loja) {
      const principal = loja.accountGroupId || loja.id;
      const grupo = await prisma.user.findMany({
        where: { OR: [{ id: principal }, { accountGroupId: principal }] },
        select: { id: true, accountGroupId: true, printerConfig: true },
      });
      v = { atende: lojasQueOPcAtende(franchiseeId, grupo), confirma: lojasQueOPcConfirma(franchiseeId, grupo) };
    }
  } catch (err) {
    console.error("[PrintQueue] grupo da conta indisponível; atendendo só a própria loja:", (err as any)?.message || err);
  }

  cache.set(franchiseeId, { ate: Date.now() + VALIDADE_MS, v });
  return v;
}

/** As lojas cujas comandas a fila entrega a este Assistente agora. */
export async function lojasQueEstePcAtende(franchiseeId: string): Promise<string[]> {
  return (await resolver(franchiseeId)).atende;
}

/** As lojas cujas comandas este Assistente pode confirmar (/ack). */
export async function lojasQueEstePcConfirma(franchiseeId: string): Promise<string[]> {
  return (await resolver(franchiseeId)).confirma;
}
