import { calcularContaDaMesa, sanearTaxa, type MesaParaConta } from "@/lib/conta-da-mesa";
import { emCentavos, emReais, lerPagamentos, somarPagamentos } from "@/lib/pagamentos-da-mesa";
import type { DescontoManual } from "@/lib/desconto-manual";
import type { ContextoDaContaDaMesa } from "@/lib/contexto-da-conta-da-mesa";

export type SaldoDaMesa = { total: number; recebido: number; falta: number; troco: number; quitada: boolean };

export function contextoPagoDaMesa(pagamentos: unknown): ContextoDaContaDaMesa | null {
  return lerPagamentos(pagamentos).filter(p => p.uid.startsWith("maquininha-") && p.conta).at(-1)?.conta ?? null;
}

/** Só leitura: as baixas são da conta inteira, nunca de uma rodada isolada. */
export function saldoDaMesa(total: number, pagamentos: unknown): SaldoDaMesa {
  const totalCentavos = Math.max(0, emCentavos(total));
  const recebidoCentavos = emCentavos(somarPagamentos(lerPagamentos(pagamentos)));
  return {
    total: emReais(totalCentavos), recebido: emReais(recebidoCentavos),
    falta: emReais(Math.max(0, totalCentavos - recebidoCentavos)),
    troco: emReais(Math.max(0, recebidoCentavos - totalCentavos)),
    quitada: totalCentavos > 0 && recebidoCentavos >= totalCentavos,
  };
}

export function saldoDaContaDaMesa(
  mesa: MesaParaConta & { paymentMethods?: unknown }, taxa: number,
  gorjeta: number | null = null, desconto: DescontoManual | null = null,
): SaldoDaMesa {
  return saldoDaMesa(calcularContaDaMesa(mesa, [], sanearTaxa(taxa, 0), gorjeta, desconto).total, mesa.paymentMethods);
}

/** A mesma conta do app nativo: consumo vivo + taxa padrão da loja + gorjeta salva.
 * Desconto e taxa editados só no formulário ainda são uma simulação local;
 * a tela de fechamento usa saldoDaContaDaMesa com esses parâmetros explícitos.
 */
export function saldoDaMesaDoQuadro(conta: {
  paymentMethods?: unknown; waiterTip?: number | null;
  orders: { status: string; totalAmount: number | null; dailyOrderNumber?: number | null }[];
  table?: { number?: number; label?: string | null; franchisee?: { taxaServicoPadrao?: number | null } } | null;
}): SaldoDaMesa {
  const contexto = contextoPagoDaMesa(conta.paymentMethods);
  return saldoDaContaDaMesa({
    table: { number: conta.table?.number ?? 0, label: conta.table?.label ?? null },
    waiterTip: conta.waiterTip ?? null, paymentMethods: conta.paymentMethods,
    orders: conta.orders.filter(o => !["CANCELADO", "CANCELED", "CANCELLED"].includes(o.status))
      .map(o => ({ ...o, dailyOrderNumber: o.dailyOrderNumber ?? null, items: [] })),
  }, contexto?.taxa ?? conta.table?.franchisee?.taxaServicoPadrao ?? 10, contexto?.gorjeta ?? null, contexto?.desconto ?? null);
}

/** Evita enviar todas as rodadas da mesma conta em cada card do feed. */
export function anexarSaldoDasMesas<T extends { tableSession?: any }>(pedidos: T[]): T[] {
  for (const pedido of pedidos) {
    const conta = pedido.tableSession;
    if (!conta) continue;
    if (conta.status === "OPEN" && Array.isArray(conta.orders)) conta.saldo = saldoDaMesaDoQuadro(conta);
    delete conta.orders;
    if (conta.table) delete conta.table.franchisee;
  }
  return pedidos;
}
