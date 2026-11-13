/**
 * O TERMO QUE O DONO ACEITA AO ATIVAR O CAIXA DE MERCADO — a tela mostra este
 * texto e o servidor grava a versão aceita junto com o trecho ligado. Mudou o
 * texto, mude a versão. Regra de cobrança dos módulos pagos (lib/modulo-pago.ts),
 * por computador como o Tablet na mesa (lib/tablet-da-mesa/termo.ts).
 *
 * Arquivo puro (sem banco): a tela importa.
 */
import { DIAS_DE_TESTE_DO_CAIXA, PRECO_POR_COMPUTADOR } from "./preco";

export const VERSAO_DO_TERMO_DO_CAIXA = "2026-11-13";

export const TITULO_DO_TERMO_DO_CAIXA = "Termo de contratação — Caixa de mercado";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CLAUSULAS_DO_TERMO_DO_CAIXA = [
  `Ao ativar, eu contrato o módulo Caixa de mercado por ${reais(PRECO_POR_COMPUTADOR)} por mês para CADA computador de caixa que usar o módulo no mês, e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.`,
  "Conta como computador em uso o computador pareado (registrado como caixa) que fizer pelo menos uma venda ou abrir um turno em algum dia do mês. Computador pareado e parado no mês não é cobrado.",
  "O módulo é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade do FireHub (2% do faturamento, com mínimo e teto), e as vendas do caixa entram nesse faturamento como qualquer outro pedido.",
  `A primeira ativação da loja tem ${DIAS_DE_TESTE_DO_CAIXA} dias grátis. Os ${DIAS_DE_TESTE_DO_CAIXA} dias valem uma vez só: desativar e ativar de novo não dá outro período grátis.`,
  `Passados os dias grátis, cada computador em uso no mês, mesmo que por um único dia, é cobrado no mês inteiro (${reais(PRECO_POR_COMPUTADOR)}), uma vez só por computador.`,
  "Se eu desativar durante os dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto pelos computadores usados (sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês e desliga sozinho na virada.",
  "O FireHub não vende, não aluga e não entrega equipamento. Computador, leitor de código de barras, balança, impressora, gaveta e pinpad (TEF) são comprados pela loja. A balança usada para vender ao público é de responsabilidade da loja (Inmetro e Ipem em dia). O TEF depende do contrato da loja com a adquirente/credenciadora e da homologação do pinpad.",
  "O cadastro fiscal dos produtos (NCM, CEST, CFOP, CSOSN/CST, PIS e COFINS) é responsabilidade da loja e do contador dela. A importação e as sugestões do FireHub (inclusive as sugeridas por inteligência artificial, marcadas \"sugerido, conferir\") são um ponto de partida e precisam ser conferidas pelo contador.",
];
