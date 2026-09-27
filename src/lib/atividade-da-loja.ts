/**
 * A loja está USANDO o sistema? A resposta é o último pedido.
 *
 * Existe para o acompanhamento de quem entrou por tráfego pago ou orgânico
 * (painel do admin e carteira do vendedor): loja cadastrada que nunca vendeu
 * ou parou de vender é a que precisa de uma ligação. Pedido cancelado não conta
 * — cancelar tudo não é usar.
 */
import { prisma } from "@/lib/prisma";

/** Sem pedido há este tanto de dias = inativa. */
export const DIAS_PARA_INATIVA = 7;

export type AtividadeDaLoja = {
  /** ISO do último pedido não cancelado, ou null se nunca vendeu. */
  ultimoPedidoEm: string | null;
  /** Dias inteiros desde o último pedido; null se nunca vendeu. */
  diasSemPedido: number | null;
  /** Pedidos não cancelados nos últimos 7 dias. */
  pedidos7d: number;
  situacao: "ATIVA" | "INATIVA" | "NUNCA_VENDEU";
};

export async function atividadeDasLojas(ids: string[]): Promise<Map<string, AtividadeDaLoja>> {
  const saida = new Map<string, AtividadeDaLoja>();
  if (ids.length === 0) return saida;

  const seteDiasAtras = new Date(Date.now() - 7 * 86400000);
  // Uma consulta por loja no índice (franchiseeId, createdAt): pegar o último
  // pedido de cada uma em lote, sem varrer a tabela de pedidos inteira.
  const linhas = await prisma.$queryRaw<{ id: string; ultimo: Date | null; semana: bigint }[]>`
    SELECT u.id,
      (SELECT o."createdAt" FROM "CustomerOrder" o
        WHERE o."franchiseeId" = u.id AND o.status <> 'CANCELADO'
        ORDER BY o."createdAt" DESC LIMIT 1) AS ultimo,
      (SELECT count(*) FROM "CustomerOrder" o
        WHERE o."franchiseeId" = u.id AND o.status <> 'CANCELADO' AND o."createdAt" >= ${seteDiasAtras}) AS semana
    FROM "User" u
    WHERE u.id = ANY(${ids})`;

  for (const l of linhas) {
    const ultimo = l.ultimo ? new Date(l.ultimo) : null;
    const dias = ultimo ? Math.max(0, Math.floor((Date.now() - ultimo.getTime()) / 86400000)) : null;
    saida.set(l.id, {
      ultimoPedidoEm: ultimo ? ultimo.toISOString() : null,
      diasSemPedido: dias,
      pedidos7d: Number(l.semana) || 0,
      situacao: dias === null ? "NUNCA_VENDEU" : dias >= DIAS_PARA_INATIVA ? "INATIVA" : "ATIVA",
    });
  }
  return saida;
}

/** "hoje", "ontem", "há 12 dias", "nunca vendeu". */
export function textoDoUltimoPedido(a: Pick<AtividadeDaLoja, "diasSemPedido"> | null | undefined): string {
  if (!a || a.diasSemPedido === null) return "nunca vendeu";
  if (a.diasSemPedido === 0) return "hoje";
  if (a.diasSemPedido === 1) return "ontem";
  return `há ${a.diasSemPedido} dias`;
}
