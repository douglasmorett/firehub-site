/**
 * /src/lib/cancelamento-parcial-no-banco.ts
 *
 * A gravação do corte que o app (iFood/99Food) fez no pedido. As regras são
 * de lib/cancelamento-parcial.ts — separado só porque aquele arquivo também é
 * lido pelo painel, no navegador, e este usa o Prisma.
 */
import { prisma } from "@/lib/prisma";
import { empilharEdicao } from "@/lib/edicao-de-pedido";
import {
  lerCancelamentosParciais,
  registrarCorte,
  type ItemCancelado,
  type RegistroDeCancelamentoParcial,
} from "@/lib/cancelamento-parcial";

/**
 * Grava um corte no pedido: o registro, o total novo e uma linha no histórico
 * de edições. O STATUS NÃO MUDA. Mesmo `id` já gravado não corta de novo (o
 * aceite no painel e o desfecho que o iFood manda depois são o mesmo corte).
 * `totalDepois` explícito também vale para o total gravado.
 */
export async function aplicarCancelamentoParcial(
  pedidoId: string,
  corte: { id: string; canal: string; itens: ItemCancelado[]; valor: number; totalDepois?: number | null; motivo?: string | null }
): Promise<{ aplicado: boolean; registro: RegistroDeCancelamentoParcial | null }> {
  const pedido: any = await (prisma.customerOrder as any).findUnique({
    where: { id: pedidoId },
    select: { id: true, totalAmount: true, cancelamentoParcial: true, editHistory: true },
  });
  if (!pedido) return { aplicado: false, registro: null };
  const r = registrarCorte(lerCancelamentosParciais(pedido.cancelamentoParcial), Number(pedido.totalAmount) || 0, corte);
  if (!r.novo) return { aplicado: false, registro: null };
  const nomes = r.novo.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(", ");
  await (prisma.customerOrder as any).update({
    where: { id: pedidoId },
    data: {
      cancelamentoParcial: r.registros,
      totalAmount: r.totalDepois,
      editHistory: empilharEdicao(pedido.editHistory, {
        quando: r.novo.quando,
        quem: corte.canal,
        acao: "CANCELAMENTO_PARCIAL",
        descricao: `Cancelamento parcial feito pelo ${corte.canal}${nomes ? `: ${nomes}` : ""}`,
        totalAntes: r.novo.totalAntes,
        totalDepois: r.novo.totalDepois,
      }),
    },
  });
  console.log(`[Cancelamento parcial] ${pedidoId} (${corte.canal}): R$ ${r.novo.totalAntes.toFixed(2)} → R$ ${r.novo.totalDepois.toFixed(2)}${nomes ? ` — ${nomes}` : ""}`);
  return { aplicado: true, registro: r.novo };
}
