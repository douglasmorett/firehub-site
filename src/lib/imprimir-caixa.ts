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
import { cupomDeMovimentacaoDeCaixa, type CupomDoCaixa } from "@/lib/cupom-do-caixa";
import { FUSO_PADRAO } from "@/lib/fuso";

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

/**
 * Manda para a fila o comprovante de UMA sangria/suprimento desta loja
 * (lib/cupom-do-caixa.ts → cupomDeMovimentacaoDeCaixa). Serve ao "lançar e
 * imprimir" e ao ícone de impressora da lista de movimentações.
 *
 * O id vem do navegador: a busca leva o franchiseeId junto, e lançamento de
 * outra loja é "não encontrado". NUNCA lança, como o resto deste arquivo.
 */
export async function imprimirMovimentacaoDoCaixa(
  franchiseeId: string,
  movimentacaoId: string,
  operador: string,
  opcoes: { segundaVia?: boolean } = {}
): Promise<{ ok: true; assistenteOuvindo: boolean | null } | { ok: false; erro: string; status: number }> {
  try {
    const mov = await prisma.cashMovement.findFirst({
      where: { id: movimentacaoId, franchiseeId },
      select: { id: true, tipo: true, valor: true, descricao: true, criadoPor: true, createdAt: true, cashSession: { select: { openedAt: true } } },
    });
    if (!mov) return { ok: false, erro: "Lançamento não encontrado.", status: 404 };
    const dono = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, storeTimezone: true } });
    const cupom = cupomDeMovimentacaoDeCaixa({
      movimentacao: mov,
      loja: dono?.storeName || "",
      fuso: dono?.storeTimezone || FUSO_PADRAO,
      operador,
      caixaAbertoEm: mov.cashSession?.openedAt ?? null,
      segundaVia: opcoes.segundaVia,
    });
    // Cada impressão é um pedido de impressão novo: o id do cupom ganha o
    // instante, senão a 2ª via teria o mesmo id da 1ª.
    const ok = await enfileirarCupomDoCaixa(franchiseeId, { ...cupom, id: `${cupom.id}_${Date.now()}` }, operador);
    if (!ok) return { ok: false, erro: "Não consegui enviar para a impressora.", status: 500 };
    return { ok: true, assistenteOuvindo: await assistenteOuvindoAFila(franchiseeId) };
  } catch (e: any) {
    console.error("[Caixa] Não consegui imprimir a movimentação:", e?.message);
    return { ok: false, erro: "Não consegui enviar para a impressora.", status: 500 };
  }
}
