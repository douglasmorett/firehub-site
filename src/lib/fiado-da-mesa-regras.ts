/**
 * /src/lib/fiado-da-mesa-regras.ts
 *
 * A MESA QUE VAI PARA O FIADO — a conta (sem banco, sem Next). Quem grava é
 * lib/fiado-da-mesa.ts; quem fecha a mesa é api/store/table-sessions/[id]/close.
 *
 * ── O pedido ────────────────────────────────────────────────────────────────
 * Allan, Delícia de Casa (decisão do Douglas, 17/10/2026): restaurante lotado,
 * a mesa 9 já pagou mas ninguém deu a baixa (só o computador do caixa dá), e o
 * próximo cliente que senta na 9 é jogado para a 19. "Ele pode jogar a mesa
 * para fiado, deixar a pendência para aquele cliente": o que falta da conta
 * vira dívida de um cliente do Fiado e a mesa é liberada na hora. O acerto é
 * depois, pela tela Fiado (Dar baixa).
 *
 * ── Por que a venda não conta duas vezes ────────────────────────────────────
 * É o mesmo caminho da venda no fiado do balcão: a VENDA é registrada uma vez,
 * na hora, e a baixa depois não é venda.
 *
 *   - A venda são os pedidos da mesa, como em toda mesa (lib/relatorios/
 *     regua-da-venda.ts: a mesa é UMA venda, pelo que foi lançado). Nada de
 *     pedido novo: um pedido "dívida" de R$ 80 somaria R$ 80 a mais no
 *     faturamento, no DRE e na base da mensalidade.
 *   - A forma de pagamento da conta é "Fiado" (uma baixa na própria mesa,
 *     TableSession.paymentMethods). O fechamento do caixa a lê como fiado —
 *     fora da conferência da gaveta (lib/apuracao-do-turno.ts, conferirParte) —
 *     e o relatório Formas de pagamento a põe em "Fiado / Conta funcionário".
 *   - A DÍVIDA mora numa linha de "FiadoDaMesa" (cliente, valor, mesa): é ela
 *     que entra no saldo do cliente, ao lado dos pedidos fiados do balcão e
 *     menos as baixas (`saldoDoFiado`).
 *   - A baixa (EmployeePayment, tela Fiado) só abate o saldo, como hoje.
 */

/** Dinheiro em centavos, sem somar float com float. */
const cent = (v: unknown) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => Math.round(c) / 100;

/** O texto da baixa que a mesa ganha. Tem "Fiado": é por ele que caixa e relatórios a reconhecem. */
export const FORMA_DO_FIADO_NA_MESA = "Fiado";

/**
 * Quanto da conta vai para o fiado: o que falta pagar (a conta menos as baixas
 * já gravadas na mesa). Mesa já paga não vai para o fiado — fecha normal.
 */
export function valorParaOFiado(o: { totalDaConta: number; jaPago: number }): { ok: true; valor: number } | { ok: false; erro: string } {
  const falta = cent(o.totalDaConta) - cent(o.jaPago);
  if (falta <= 1) {
    return { ok: false, erro: "A conta desta mesa já está paga — é só fechar a conta normalmente." };
  }
  return { ok: true, valor: reais(falta) };
}

/** Quem vai ficar devendo: um cliente que já está no fiado, ou um novo (nome obrigatório). */
export type ClienteDoFiado = { tipo: "existente"; id: string } | { tipo: "novo"; nome: string; telefone: string | null };

export function lerClienteDoFiado(bruto: unknown): { ok: true; cliente: ClienteDoFiado } | { ok: false; erro: string } {
  const b = bruto && typeof bruto === "object" ? (bruto as Record<string, any>) : {};
  if (typeof b.clienteId === "string" && b.clienteId.trim()) return { ok: true, cliente: { tipo: "existente", id: b.clienteId.trim() } };
  const nome = String(b.novoCliente?.nome ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (nome.length >= 2) {
    const digitos = String(b.novoCliente?.telefone ?? "").replace(/\D/g, "").slice(0, 13);
    return { ok: true, cliente: { tipo: "novo", nome, telefone: digitos.length >= 8 ? digitos : null } };
  }
  return { ok: false, erro: "Escolha o cliente do fiado ou digite o nome de um novo." };
}

/**
 * O saldo do cliente no fiado: pedidos fiados + contas de mesa no fiado −
 * baixas. Nunca negativo (baixa a mais não vira crédito), como a tela Fiado
 * sempre mostrou.
 */
export function saldoDoFiado(o: { pedidos: number; mesas: number; baixas: number }): number {
  return reais(Math.max(0, cent(o.pedidos) + cent(o.mesas) - cent(o.baixas)));
}

/** "Mesa 9 · 2 lançamentos · 3× Pastel, 2× Coca" — o que o extrato do fiado mostra. */
export function descricaoDaMesaNoFiado(o: { numero: number | null; itens: { nome: string; quantidade: number }[] }): string {
  const juntos = new Map<string, number>();
  for (const i of o.itens) juntos.set(i.nome, (juntos.get(i.nome) || 0) + (Number(i.quantidade) || 1));
  const itens = [...juntos].map(([nome, q]) => `${q}× ${nome}`).join(", ");
  const mesa = o.numero != null ? `Mesa ${o.numero}` : "Mesa";
  return (itens ? `${mesa}: ${itens}` : mesa).slice(0, 500);
}
