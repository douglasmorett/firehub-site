import { prisma } from "@/lib/prisma";

/**
 * A consulta ao banco da trava de caixa (lib/caixa-aberto.ts tem o porquê).
 *
 * Mora separado porque aquele arquivo é importado pela tela do PDV, que é
 * componente de cliente — o prisma aqui dentro iria junto para o navegador.
 */

/**
 * Tem caixa aberto nesta loja?
 *
 * Falha de banco devolve `true` de propósito: a trava existe para proteger o
 * fechamento, não para parar a operação. Se a consulta cair, recusar toda
 * venda do balcão seria trocar um furo de caixa por uma loja parada — e a
 * loja parada é o prejuízo maior e imediato.
 */
export async function caixaEstaAberto(franchiseeId: string): Promise<boolean> {
  try {
    const aberto = await prisma.cashSession.findFirst({
      where: { franchiseeId, status: "OPEN" },
      select: { id: true },
    });
    return Boolean(aberto);
  } catch (err) {
    console.error("[Caixa] não consegui conferir se está aberto:", (err as any)?.code || err);
    return true;
  }
}
