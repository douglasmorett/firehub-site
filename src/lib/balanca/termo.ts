/**
 * O TERMO QUE O DONO ACEITA AO ATIVAR A BALANÇA — a tela mostra este texto e o
 * servidor grava a versão aceita junto com o trecho ligado. Mudou o texto,
 * mude a versão.
 *
 * A regra de cobrança é a dos módulos pagos (lib/modulo-pago.ts, Douglas,
 * 18/10/2026); o equipamento é da loja (Douglas, 05/11/2026: "a gente não tem
 * intenção de entregar equipamento").
 *
 * Arquivo puro (sem banco): a tela importa.
 */
import { DIAS_DE_TESTE_DA_BALANCA, PRECO_DA_BALANCA } from "./preco";

export const VERSAO_DO_TERMO_DA_BALANCA = "2026-11-05";

export const TITULO_DO_TERMO_DA_BALANCA = "Termo de contratação — Balança (self-service por quilo)";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CLAUSULAS_DO_TERMO_DA_BALANCA = [
  `Ao ativar, eu contrato o módulo Balança por ${reais(PRECO_DA_BALANCA)} por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.`,
  "O módulo é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade do FireHub (2% do faturamento, com mínimo e teto), e as vendas pesadas na balança entram nesse faturamento como qualquer outro pedido.",
  `A primeira ativação da loja tem ${DIAS_DE_TESTE_DA_BALANCA} dias grátis. Depois deles a cobrança começa sozinha. Os ${DIAS_DE_TESTE_DA_BALANCA} dias valem uma vez só: desativar e ativar de novo não dá outro período grátis, e quem já usou o teste, ao ativar, já tem o mês em curso cobrado inteiro.`,
  `Passados os ${DIAS_DE_TESTE_DA_BALANCA} dias grátis, o mês em que o módulo ficar ativo, mesmo que por um único dia, é cobrado inteiro (${reais(PRECO_DA_BALANCA)}), uma vez só, mesmo que eu desative e ative de novo.`,
  "Se eu desativar durante os dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo.",
  "O FireHub não vende, não aluga e não entrega equipamento. A balança, o cabo ou adaptador, o leitor de código de barras, o tablet ou computador e os cartões de comanda são comprados pela loja. O FireHub indica os modelos compatíveis, mas não responde por defeito, garantia ou assistência deles.",
  "A balança usada para vender ao público é de responsabilidade da loja: modelo aprovado pelo Inmetro, verificação periódica do Ipem em dia, instalada de forma que o cliente veja o peso no visor dela enquanto pesa, e com a tara do prato feita na própria balança. O peso mostrado na tela do FireHub é uma cópia do que a balança informa, não é a indicação oficial, e a tela leva a inscrição \"Não verificado\".",
];
