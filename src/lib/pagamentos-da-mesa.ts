/**
 * /src/lib/pagamentos-da-mesa.ts
 *
 * Regra única de como as baixas de uma mesa são lidas e somadas.
 *
 * Duas rotas mexem nisso — a que registra baixa a baixa (`pagamentos`) e a que
 * fecha a mesa (`close`) — e elas PRECISAM concordar até o centavo. Se a
 * primeira somasse de um jeito e a segunda de outro, o garçom veria a mesa
 * zerada na tela e o fechamento recusaria por diferença de arredondamento, sem
 * ninguém entender de onde saiu o centavo.
 */

/** Uma baixa registrada na mesa. */
export type PagamentoDaMesa = {
  uid: string;
  /**
   * `method`/`amount` em inglês porque é o formato que já estava gravado na
   * coluna `TableSession.paymentMethods` e que o fechamento sempre leu.
   */
  method: string;
  amount: number;
  /** Nulo quando o pagamento é da mesa, e não de uma pessoa específica. */
  guestId: string | null;
  guestName: string | null;
  at: string;
  /** Quem registrou: nome do usuário do painel ou "Garçom X". Nulo em baixa antiga. */
  por: string | null;
};

export const emCentavos = (v: number) => Math.round((Number(v) || 0) * 100);
export const emReais = (c: number) => Math.round(c) / 100;

/**
 * Lê a coluna aceitando o formato ANTIGO.
 *
 * Mesa fechada antes desta mudança guardou `[{ method, amount }]` e nada mais.
 * Continua sendo lida sem erro: o que falta vira nulo, e o uid é inventado na
 * leitura só para a tela ter uma chave estável. Aceita também `metodo`/`valor`
 * em português, que é como a tela sempre nomeou os campos.
 */
export function lerPagamentos(bruto: unknown): PagamentoDaMesa[] {
  if (!bruto) return [];
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista
    .map((p: any, i: number) => ({
      uid: typeof p?.uid === "string" && p.uid ? p.uid : `antigo-${i}`,
      method: String(p?.method || p?.metodo || "Dinheiro"),
      amount: Number(p?.amount ?? p?.valor) || 0,
      guestId: typeof p?.guestId === "string" ? p.guestId : null,
      guestName: typeof p?.guestName === "string" ? p.guestName : null,
      at: typeof p?.at === "string" ? p.at : "",
      por: typeof p?.por === "string" ? p.por : null,
    }))
    .filter((p) => p.amount > 0);
}

/** Soma em centavos e devolve em reais — nunca somando float com float. */
export function somarPagamentos(lista: PagamentoDaMesa[]): number {
  return emReais(lista.reduce((s, p) => s + emCentavos(p.amount), 0));
}
