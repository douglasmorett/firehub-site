import type { prisma } from "@/lib/prisma";
import { calcularContaDaMesa, comissaoDoGarcom, sanearTaxa } from "@/lib/conta-da-mesa";
import { emCentavos, lerPagamentos, type PagamentoDaMesa } from "@/lib/pagamentos-da-mesa";
import { lerContextoDaConta } from "@/lib/contexto-da-conta-da-mesa";
import { empilharEdicao } from "@/lib/edicao-de-pedido";
import { descreverDesconto } from "@/lib/desconto-manual";

export type BaixaPosConfirmada = { pagamentoUid: string; valorCentavos: number; aprovado: boolean };
type Transacao = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Recebimento manual, sobra, falta ou prova inconsistente exigem conferência. */
export function quitadaSomentePorPos(total: number, lista: PagamentoDaMesa[], comprovadas: BaixaPosConfirmada[]): boolean {
  const centavos = emCentavos(total);
  if (centavos <= 0 || lista.length === 0 || new Set(lista.map(p => p.uid)).size !== lista.length) return false;
  const provas = new Map(comprovadas.filter(p => p.aprovado).map(p => [p.pagamentoUid, p.valorCentavos]));
  return lista.every(p => p.uid.startsWith("maquininha-") && provas.get(p.uid) === emCentavos(p.amount))
    && lista.reduce((s, p) => s + emCentavos(p.amount), 0) === centavos;
}

/** Chamado dentro da baixa, depois do FOR UPDATE da sessão e da prova PAGO.
 * Fecha a conta financeira; a cozinha mantém todos os seus estados e itens.
 */
export async function encerrarMesaQuitadaPorPos(
  tx: Transacao,
  c: { tableSessionId: string; franchiseeId: string; dados?: unknown },
  por: string,
): Promise<{ desconto: number } | null> {
  const mesa = await tx.tableSession.findUnique({
    where: { id: c.tableSessionId },
    include: {
      table: { select: { number: true, label: true, franchiseeId: true } },
      waiter: { select: { commissionRate: true } },
      orders: { select: { id: true, status: true, totalAmount: true, dailyOrderNumber: true, editHistory: true } },
    },
  });
  if (!mesa || mesa.status !== "OPEN" || mesa.table.franchiseeId !== c.franchiseeId || mesa.franchiseeId !== c.franchiseeId) return null;
  // A taxa da loja não pode mudar entre a leitura e o fechamento financeiro.
  await tx.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR SHARE', c.franchiseeId);
  const loja = await tx.user.findUnique({ where: { id: c.franchiseeId }, select: { taxaServicoPadrao: true } });
  const contexto = lerContextoDaConta((c.dados as any)?.conta);
  const taxa = contexto?.taxa ?? sanearTaxa(loja?.taxaServicoPadrao, 10);
  const conta = calcularContaDaMesa({
    ...mesa,
    orders: mesa.orders.filter(o => !["CANCELADO", "CANCELED", "CANCELLED"].includes(o.status)).map(o => ({ ...o, items: [] })),
  }, [], taxa, contexto?.gorjeta ?? null, contexto?.desconto ?? null);
  const comprovadas = await tx.$queryRawUnsafe<BaixaPosConfirmada[]>(
    `SELECT "pagamentoUid", "valorCentavos", ("dados"->>'aprovado' = 'true') AS "aprovado"
     FROM "CobrancaDaMesaNaMaquininha" WHERE "tableSessionId" = $1 AND "franchiseeId" = $2 AND "status" = 'PAGO'`,
    c.tableSessionId, c.franchiseeId,
  );
  if (!quitadaSomentePorPos(conta.total, lerPagamentos(mesa.paymentMethods), comprovadas)) return null;
  const fechadaEm = new Date();
  await tx.tableSession.update({
    where: { id: mesa.id },
    data: {
      status: "CLOSED", closedAt: fechadaEm, closedByKind: "maquininha", closedByName: por,
      serviceFee: conta.taxaServico.valor, waiterTip: conta.gorjeta,
      waiterCommission: mesa.waiterId ? comissaoDoGarcom({ consumoCobrado: conta.consumo - conta.desconto.valor, taxaCobradaPct: taxa, comissaoPct: mesa.waiter?.commissionRate, gorjeta: conta.gorjeta }) : 0,
    },
  });
  const rodada = mesa.orders.find(o => !["CANCELADO", "CANCELED", "CANCELLED"].includes(o.status));
  if (conta.desconto.valor > 0 && rodada) {
    await tx.customerOrder.update({ where: { id: rodada.id }, data: {
      editHistory: empilharEdicao(rodada.editHistory, {
        quando: fechadaEm.toISOString(), quem: por, acao: "DESCONTO",
        descricao: `desconto na conta da mesa: ${descreverDesconto(contexto?.desconto, conta.consumo)}`,
        totalAntes: Number(rodada.totalAmount) || 0, totalDepois: Number(rodada.totalAmount) || 0,
        ...(contexto?.desconto?.motivo ? { motivo: contexto.desconto.motivo } : {}),
      }) as any,
    } });
  }
  // A baixa não vira pagamento de cada rodada. Só o relógio do feed muda,
  // para a conta fechada sair do delta de mesas abertas sem esperar o F5.
  await tx.customerOrder.updateMany({ where: { tableSessionId: mesa.id, franchiseeId: c.franchiseeId }, data: { updatedAt: fechadaEm } });
  return { desconto: conta.desconto.valor };
}
