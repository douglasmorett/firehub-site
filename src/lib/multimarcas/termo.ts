/**
 * O TERMO QUE O DONO ACEITA AO ATIVAR O MULTIMARCAS — a tela mostra este texto
 * e o servidor grava a versão aceita junto com o trecho ligado. Mudou o texto,
 * mude a versão.
 *
 * Douglas, 17/10/2026: "o cara vai pagar o valor normal por cada loja agregada
 * (2% do faturamento) e mais 97 para ter essa página especializada. Uma coisa
 * nada a ver com a outra. Tem que ficar bem especificado, bem claro pro cliente."
 *
 * Douglas, 18/10/2026 (versão 2026-10-18): desligar depois do teste não corta na hora —
 * o mês já está pago, fica liberado até o fim do mês e desliga sozinho na virada;
 * sem valor proporcional (lib/modulo-pago.ts).
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DO_MULTIMARCAS = "2026-10-18";

export const TITULO_DO_TERMO_DO_MULTIMARCAS = "Termo de contratação — Multimarcas";

export const CLAUSULAS_DO_TERMO_DO_MULTIMARCAS = [
  "Ao ativar, eu contrato o Multimarcas por R$ 97,00 por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.",
  "O Multimarcas é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade de cada loja (2% do faturamento, com mínimo e teto) nem o valor das lojas extras de iFood e 99Food, que continuam cobrados como hoje.",
  "Cortesia: no mês em que a loja tiver o Aplicativo da loja ativo nas duas plataformas (Android e Apple), o Multimarcas não é cobrado. Com só uma plataforma, ou sem o aplicativo, vale a cobrança normal.",
  "A primeira ativação da loja tem 7 dias grátis. Depois deles a cobrança começa sozinha. Os 7 dias valem uma vez só: desativar e ativar de novo não dá outro período grátis, e quem já usou o teste, ao ativar, já tem o mês em curso cobrado inteiro.",
  "Passados os 7 dias grátis, o mês em que o Multimarcas ficar ativo, mesmo que por um único dia, é cobrado inteiro (R$ 97,00), uma vez só, mesmo que eu desative e ative de novo.",
  "Se eu desativar durante os 7 dias grátis, o Multimarcas desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): o Multimarcas continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo. Desligado, a página das minhas marcas sai do ar.",
  "Sou responsável pelos nomes, logos, fotos, preços e textos das marcas que publico, e por ter o direito de usá-los.",
];
