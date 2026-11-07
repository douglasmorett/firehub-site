/**
 * QUANTAS PESSOAS NA MESA — o divisor do ticket por pessoa (Giro de mesas e
 * Ticket médio, lib/relatorios/).
 *
 * O Alex (Hambúrgueria Avenida, 11/2026) veio do SWFast, que mostra "ticket
 * por pessoa": a conta de R$ 240 de quatro pessoas é outro negócio que a de
 * R$ 240 de duas. A conta da mesa (TableSession) não guardava quantas pessoas
 * sentaram; só as pessoas NOMEADAS para dividir a conta (TableGuest), que a
 * maioria das mesas não usa.
 *
 * Por isso a coluna `TableSession.pessoas`: o "Quantas pessoas?" opcional ao
 * abrir a mesa (painel e celular do garçom, POST api/store/table-sessions),
 * editável com a mesa aberta (PATCH api/store/table-sessions/[id]). Vazio é o
 * padrão — o garçom com o salão cheio não pode ser travado por um campo.
 *
 * A regra de quantas pessoas a conta teve:
 *   1. o número digitado, quando há — é o que alguém afirmou;
 *   2. senão, as pessoas nomeadas na conta (TableGuest), quando há;
 *   3. senão, NÃO SE SABE (null). O relatório diz "sem nº de pessoas" e tira
 *      essa conta do ticket por pessoa — inventar 1 ou a capacidade da mesa
 *      daria um número que parece certo e não é.
 *
 * Arquivo puro (sem banco): rotas, telas e relatórios importam.
 */

/** Teto do campo: mesa de 99 já é evento, não mesa — número maior é dedo errado. */
export const MAX_PESSOAS = 99;

/** O "Quantas pessoas?" saneado: inteiro de 1 a 99, ou null (vazio, zero, texto, negativo). */
export function sanearPessoas(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(MAX_PESSOAS, n);
}

/** Quantas pessoas a conta teve, pela regra do topo. null = não se sabe. */
export function pessoasDaConta(c: { pessoas?: number | null; convidados?: number | null }): number | null {
  const digitado = sanearPessoas(c.pessoas);
  if (digitado !== null) return digitado;
  const nomeadas = Math.max(0, Math.floor(Number(c.convidados) || 0));
  return nomeadas > 0 ? nomeadas : null;
}
