/**
 * O TERMO QUE O DONO ACEITA AO LIGAR O TABLET NA MESA — a tela mostra este
 * texto e o servidor grava a versão aceita junto com o trecho ligado. Mudou o
 * texto, mude a versão. A regra de desligar é a de lib/modulo-pago.ts.
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DO_TABLET = "2026-10-22";

export const TITULO_DO_TERMO_DO_TABLET = "Termo de contratação — Tablet na mesa";

export const CLAUSULAS_DO_TERMO_DO_TABLET = [
  "Ao ativar, eu contrato o Tablet na mesa por R$ 29,90 por mês para CADA tablet ativo, e autorizo que o valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria. O valor é à parte da mensalidade da loja (2% do faturamento, com mínimo e teto), que continua cobrada como hoje.",
  "Tablet ativo é o tablet pareado com uma mesa que funcionou (ficou ligado com o cardápio aberto) em pelo menos um dia do mês. Tablet que não foi usado no mês não é cobrado. Um tablet usado em qualquer dia do mês é cobrado pelo mês inteiro (R$ 29,90), uma vez só, mesmo que troque de mesa.",
  "Os tablets são meus. O FireHub fornece o sistema (cardápio da mesa, pedido direto para a cozinha, chamar o garçom e pedir a conta); compra, conserto, internet e suporte de mesa dos aparelhos são por minha conta.",
  "A primeira ativação da loja tem 7 dias grátis, com quantos tablets eu quiser. Depois deles a cobrança começa sozinha. Os 7 dias valem uma vez só: desativar e ativar de novo não dá outro período grátis.",
  "Se eu desativar durante os 7 dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desativar depois do teste, os tablets usados no mês em curso já estão no boleto (sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo. Desligado, os tablets mostram \"chame o garçom\" e não recebem pedido.",
  "O pedido feito no tablet entra na conta da mesa como se o garçom tivesse lançado, com o preço do salão, e é fechado pela loja no fim. A conferência do que foi pedido e a cobrança do cliente continuam sendo responsabilidade da loja.",
];
