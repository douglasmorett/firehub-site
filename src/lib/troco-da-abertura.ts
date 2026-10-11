/**
 * O TROCO DA ABERTURA BATE COM O FECHAMENTO ANTERIOR?
 *
 * Douglas, 11/10/2026: "se o caixa fechar ontem com um valor e abrir hoje com
 * outro, eu quero ser avisado". O dinheiro que foi CONTADO na gaveta no último
 * fechamento (`closingCash`) é o que deveria estar lá na abertura seguinte; o
 * troco digitado diferente disso é dinheiro que saiu ou entrou entre um turno
 * e outro sem passar pelo sistema.
 *
 * Devolve o parágrafo que vai junto no aviso de "Caixa Aberto" do WhatsApp,
 * ou null quando bate (ou quando não há com o que comparar). Puro; testado em
 * scripts/teste-troco-da-abertura.ts.
 */

export type FechamentoAnterior = {
  /** Dinheiro contado na gaveta no fechamento. Nulo = fechou sem contar. */
  closingCash: number | null;
  closedAt: Date;
  /** "sistema — encerrado ao abrir outro caixa" quando ninguém fechou. */
  closedBy?: string | null;
};

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export function avisoDoTrocoDaAbertura(e: {
  anterior: FechamentoAnterior | null;
  /** Havia um caixa ainda aberto, que esta abertura encerrou sem contagem. */
  haviaCaixaAberto: boolean;
  troco: number;
  tz: string;
}): string | null {
  if (e.haviaCaixaAberto) {
    return "⚠️ O caixa anterior *não foi fechado*: ninguém contou a gaveta, então não dá para conferir este troco. Ele foi encerrado agora, sem contagem.";
  }
  const a = e.anterior;
  if (!a) return null;
  const quando = a.closedAt.toLocaleString("pt-BR", { timeZone: e.tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
  if (a.closingCash == null) {
    return `⚠️ O último caixa (fechado em ${quando}) foi fechado *sem contar o dinheiro*, então não dá para conferir este troco.`;
  }
  const troco = Math.round((Number(e.troco) || 0) * 100) / 100;
  const contado = Math.round(a.closingCash * 100) / 100;
  const diferenca = Math.round((troco - contado) * 100) / 100;
  if (Math.abs(diferenca) < 0.01) return null;
  return (
    `⚠️ *O troco não bate com o fechamento anterior.*\n` +
    `Fechou em ${quando} com ${reais(contado)} em dinheiro na gaveta e abriu agora com ${reais(troco)}: ` +
    `*${diferenca < 0 ? `faltam ${reais(-diferenca)}` : `sobram ${reais(diferenca)}`}*.`
  );
}
