/**
 * Põe o cupom do caixa na fila de impressão.
 *
 * Um lugar só porque são TRÊS os caminhos que imprimem o mesmo papel — a
 * abertura, o fechamento e o "imprimir de novo" do histórico — e três cópias
 * da mesma gravação é onde uma delas começa a divergir em silêncio.
 *
 * O cupom viaja como `PrintRequest`, a mesma tabela da conta da mesa, e por
 * isso sai nas impressoras que a loja marcou para receber papel de caixa
 * (lib/impressao-da-conta.ts). O Assistente não precisa saber o que é um
 * fechamento: o payload tem cara de pedido (ver lib/cupom-do-caixa.ts).
 *
 * NUNCA lança. Impressão é consequência do caixa, não condição: falhar ao
 * enfileirar não pode impedir a loja de abrir nem de fechar o turno.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CupomDoCaixa } from "@/lib/cupom-do-caixa";

/**
 * O Assistente desta loja está puxando a fila da nuvem agora? (consultou nos
 * últimos 3 min — a mesma tolerância da faixa AvisoImpressaoParada.)
 *
 * O papel do caixa só existe na fila. Quando ninguém a consulta, "enviado para
 * a impressora" era mentira: o Frangoso fechou quatro noites seguidas, a tela
 * respondeu que estava tudo certo, e nenhum fechamento saiu (23/09/2026).
 * `null` = não deu para saber (coluna ausente); quem chama não acusa nada.
 */
export async function assistenteOuvindoAFila(franchiseeId: string): Promise<boolean | null> {
  try {
    const dono = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { printQueuePolledAt: true },
    });
    const em = dono?.printQueuePolledAt ? new Date(dono.printQueuePolledAt).getTime() : 0;
    return em > 0 && Date.now() - em < 3 * 60 * 1000;
  } catch {
    return null;
  }
}

export async function enfileirarCupomDoCaixa(
  franchiseeId: string,
  cupom: CupomDoCaixa,
  operador: string
): Promise<boolean> {
  try {
    await prisma.printRequest.create({
      data: {
        franchiseeId,
        kind: cupom.kind,
        payload: cupom as unknown as Prisma.InputJsonValue,
        requestedBy: operador || null,
      },
    });
    return true;
  } catch (e: any) {
    console.error("[Caixa] Não consegui enfileirar o cupom do caixa:", e?.message);
    return false;
  }
}
