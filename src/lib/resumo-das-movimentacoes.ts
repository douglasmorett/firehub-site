/**
 * As contas das entradas e retiradas de um caixa — puras, sem banco, para a
 * tela do Histórico, o PDF do fechamento e o teste usarem as mesmas.
 * A leitura do banco mora em lib/movimentacoes-do-caixa.ts.
 */

export type MovimentoDoCaixa = {
  id: string;
  /** ENTRADA = reforço/suprimento de troco; SAIDA = sangria/retirada. */
  tipo: "ENTRADA" | "SAIDA";
  /** Sempre positivo: o sinal é do `tipo` (schema, CashMovement). */
  valor: number;
  descricao: string | null;
  /** Nome de quem lançou (ou o e-mail, quando não é da equipe da loja). */
  quem: string | null;
  em: Date;
  /**
   * Lançado no Histórico DEPOIS de o caixa fechar (a sangria esquecida,
   * lib/lancamento-tardio-do-caixa.ts): `em` é quando foi lançado, não quando
   * o dinheiro saiu. Ausente = lançado com o caixa aberto.
   */
  depoisDoFechamento?: boolean;
};

const c2 = (n: number) => Math.round(n * 100) / 100;

export function resumoDasMovimentacoes(lista: Pick<MovimentoDoCaixa, "tipo" | "valor">[]) {
  const entradas = lista.filter((m) => m.tipo === "ENTRADA");
  const retiradas = lista.filter((m) => m.tipo !== "ENTRADA");
  return {
    entradas: { qtd: entradas.length, valor: c2(entradas.reduce((s, m) => s + m.valor, 0)) },
    retiradas: { qtd: retiradas.length, valor: c2(retiradas.reduce((s, m) => s + m.valor, 0)) },
  };
}

/**
 * De onde saiu o dinheiro esperado GRAVADO no fechamento, parcela por parcela:
 *
 *   dinheiro esperado = troco inicial + vendas em dinheiro + entradas − retiradas
 *
 * É a conta do fechamento (lib/esperado-do-turno.ts), só que lida de trás para
 * a frente: as vendas em dinheiro são o que sobra do esperado gravado — assim
 * as parcelas fecham com o número da tabela por construção, sem reapurar os
 * pedidos (o que mudaria o caixa já encerrado se alguém mexeu num pedido).
 *
 * `vendasEmDinheiro` nulo quando a conta não fecha com valor positivo (caixa
 * antigo, gravado por outra regra): aí a tela diz só a regra, sem inventar
 * uma parcela negativa.
 */
export function composicaoDoDinheiroEsperado(
  esperadoEmDinheiro: number,
  trocoInicial: number,
  resumo: ReturnType<typeof resumoDasMovimentacoes>
): { vendasEmDinheiro: number | null } {
  const vendas = c2(esperadoEmDinheiro - trocoInicial - resumo.entradas.valor + resumo.retiradas.valor);
  return { vendasEmDinheiro: vendas >= -0.005 ? Math.max(0, vendas) : null };
}
