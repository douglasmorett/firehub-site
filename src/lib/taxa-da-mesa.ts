/**
 * "Pagar sem taxa de serviço" escolhido na conta ABERTA da mesa.
 *
 * O cliente pode recusar a taxa, e quem está com ele na hora é o garçom com a
 * maquininha (pedido de 12/11/2026, depois do teste na Cielo). A tela da
 * maquininha cobra sem a taxa, mas quem FECHA a mesa é o caixa (ou o garçom
 * pelo link): o fechamento precisa saber da escolha, senão abre com a taxa da
 * loja, diz que falta a taxa e o caixa cobra de quem já foi embora.
 *
 * A escolha mora em `TableSession.serviceFee`, sem coluna nova:
 *   - conta aberta com `null` → taxa da loja (como sempre foi);
 *   - conta aberta com `0`    → sem taxa de serviço.
 * Só se grava 0 ou nulo enquanto a mesa está aberta. No fechamento o campo
 * passa a guardar o VALOR em reais da taxa cobrada (close/route.ts), e 0 lá
 * também quer dizer "sem taxa" — o 0 vale nos dois sentidos.
 */

/** A conta aberta está sem taxa de serviço. Mesa fechada não conta: lá o campo é o valor em reais. */
export function contaSemTaxa(sessao: { status?: string | null; serviceFee?: number | null } | null | undefined): boolean {
  return !!sessao && sessao.status === "OPEN" && sessao.serviceFee === 0;
}

/** O que gravar em `serviceFee` para a escolha; só aceita booleano de verdade. */
export function gravacaoDaTaxa(semTaxa: unknown): { serviceFee: 0 | null } | null {
  if (typeof semTaxa !== "boolean") return null;
  return { serviceFee: semTaxa ? 0 : null };
}

/** A taxa que o fechamento sugere: a da loja, ou zero se a conta está sem taxa. */
export function taxaSugeridaDaConta(taxaDaLoja: number, semTaxa: boolean | null | undefined): number {
  return semTaxa ? 0 : taxaDaLoja;
}
