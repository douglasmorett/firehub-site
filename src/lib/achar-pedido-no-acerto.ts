/**
 * "Qual motoboy entregou o pedido 64?" — a busca do Relatório de Pagamentos.
 *
 * Pedido do Allan (Delícias de Casa, 13/10/2026): para fechar o caixa ele
 * precisava saber quem entregou um pedido e tinha de sair do relatório, ir ao
 * quadro de Pedidos, filtrar o dia e voltar. A busca procura nos pedidos que o
 * relatório já carregou (o período escolhido), pelo nosso número, pelo número
 * no app (iFood/99) ou pelo nome do cliente.
 */

export type PedidoDoAcerto = {
  id: string;
  dailyOrderNumber?: number | string | null;
  ifoodReference?: string | null;
  openDeliveryReference?: string | null;
  customerName?: string | null;
  createdAt?: string | Date | null;
  date?: string | Date | null;
  totalAmount?: number | null;
  status?: string | null;
};

export type AchadoNoAcerto = { pedido: PedidoDoAcerto; entregador: string };

const normaliza = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function acharPedidoNoAcerto(
  relatorio: { motoboy: { name?: string | null }; orders?: PedidoDoAcerto[] }[],
  termo: string,
  limite = 30,
): AchadoNoAcerto[] {
  const t = normaliza(termo).replace(/^#/, "");
  if (!t) return [];
  const soNumero = /^\d+$/.test(t);
  const achados: AchadoNoAcerto[] = [];
  const vistos = new Set<string>();
  for (const r of relatorio) {
    for (const o of r.orders || []) {
      if (vistos.has(o.id)) continue;
      const bate = soNumero
        // Número: igual ao nosso (o 64 não pode achar o 164) ou ao do app.
        ? String(o.dailyOrderNumber ?? "") === t || normaliza(o.ifoodReference) === t || normaliza(o.openDeliveryReference) === t
        : normaliza(o.customerName).includes(t);
      if (!bate) continue;
      vistos.add(o.id);
      achados.push({ pedido: o, entregador: String(r.motoboy?.name || "—") });
    }
  }
  const quando = (o: PedidoDoAcerto) => new Date((o.createdAt || o.date || 0) as any).getTime() || 0;
  return achados.sort((a, b) => quando(b.pedido) - quando(a.pedido)).slice(0, limite);
}
