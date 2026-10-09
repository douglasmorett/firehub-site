/**
 * "Nome ou quantidade" no campo de pessoas da mesa: o garçom digita "João"
 * para uma pessoa com nome, ou "30" para a mesa de 30 (Cliente 1 … Cliente 30)
 * de uma vez — pedido do Douglas (09/10/2026): tem cliente com 30 pessoas e
 * o "+" só punha uma por toque.
 *
 * O teto por vez é o mesmo da rota (api/store/table-sessions/[id]/guests).
 */
export const MAXIMO_DE_PESSOAS_POR_VEZ = 100;

/** O número de pessoas digitado, ou null quando o texto é um nome. */
export function quantidadeDigitada(texto: string): number | null {
  const t = String(texto || "").trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAXIMO_DE_PESSOAS_POR_VEZ ? n : null;
}
