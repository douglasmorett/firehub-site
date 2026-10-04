/**
 * A cor da entrega no app do motoboy: a mesma régua do KDS e da tela de
 * pedidos (Alertas de Produção da loja, `User.timeAlertConfig`, lida por
 * `limitesDoAlerta` em lib/relatorios/tempos.ts).
 *
 * O Lucas (Frangoso, 03/10/2026): "a vermelha que está atrasada, uma amarela
 * que está atrasando e normal que está com tempo — acaba deixando claro para
 * eles que tem que entregar logo".
 *
 * A régua é a PREVISÃO DE ENTREGA (lib/previsao-da-entrega.ts), não a hora
 * de saída: na rua, o que importa é quanto falta para o cliente esperar.
 * Como o cartão do painel, os minutos restantes vão arredondados para baixo.
 *
 * SEM IMPORTS: roda no navegador do entregador e é copiada no app nativo
 * (apps/motoboy/src/lib/urgencia.ts).
 */
export type LimitesDaUrgencia = { amareloAtivo: boolean; amareloMin: number; vermelhoAtivo: boolean; vermelhoMin: number };
export type FaixaDaUrgencia = "atrasado" | "vermelho" | "amarelo" | "noPrazo";

export function urgenciaDaEntrega(
  previsaoEm: string | null | undefined,
  agora: number,
  limites: LimitesDaUrgencia | null | undefined,
): { faixa: FaixaDaUrgencia; minutos: number; hora: string } | null {
  if (!previsaoEm) return null;
  const prazo = new Date(previsaoEm).getTime();
  if (!Number.isFinite(prazo)) return null;
  const minutos = Math.floor((prazo - agora) / 60_000);
  const hora = new Date(prazo).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const l = limites || { amareloAtivo: true, amareloMin: 10, vermelhoAtivo: true, vermelhoMin: 5 };
  if (minutos < 0) return { faixa: "atrasado", minutos, hora };
  if (l.vermelhoAtivo && minutos <= l.vermelhoMin) return { faixa: "vermelho", minutos, hora };
  if (l.amareloAtivo && minutos <= l.amareloMin) return { faixa: "amarelo", minutos, hora };
  return { faixa: "noPrazo", minutos, hora };
}

/** O texto curto do selo: "Entregar até 20:45 · faltam 12 min" / "atrasado 7 min". */
export function textoDaUrgencia(u: { faixa: FaixaDaUrgencia; minutos: number; hora: string }): string {
  if (u.faixa === "atrasado") return `Entregar até ${u.hora} · atrasado ${-u.minutos} min`;
  return `Entregar até ${u.hora} · faltam ${u.minutos} min`;
}

/** Fundo, borda e texto de cada faixa (as cores do painel). */
export const CORES_DA_URGENCIA: Record<FaixaDaUrgencia, { fundo: string; borda: string; texto: string }> = {
  atrasado: { fundo: "#FEE2E2", borda: "#DC2626", texto: "#991B1B" },
  vermelho: { fundo: "#FEF2F2", borda: "#EF4444", texto: "#B91C1C" },
  amarelo: { fundo: "#FEF9C3", borda: "#EAB308", texto: "#854D0E" },
  noPrazo: { fundo: "#F0FDF4", borda: "#22C55E", texto: "#166534" },
};
