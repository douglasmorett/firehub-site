/**
 * O TERMO QUE O DONO ACEITA AO ATIVAR A COTAÇÃO AUTOMÁTICA — a tela mostra
 * este texto e o servidor grava a versão aceita junto com o trecho ligado.
 * Mudou o texto, mude a versão.
 *
 * A regra de cobrança é a dos módulos pagos (lib/modulo-pago.ts, Douglas,
 * 18/10/2026). As mensagens saem pelo WhatsApp DA LOJA: a cláusula do envio
 * deixa claro que o número é dela e que os fornecedores são os que ela
 * cadastrou (antispam).
 *
 * Arquivo puro (sem banco): a tela importa.
 */
import { DIAS_DE_TESTE_DA_COTACAO, PRECO_DA_COTACAO } from "./preco";

export const VERSAO_DO_TERMO_DA_COTACAO = "2026-11-07";

export const TITULO_DO_TERMO_DA_COTACAO = "Termo de contratação — Cotação automática";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CLAUSULAS_DO_TERMO_DA_COTACAO = [
  `Ao ativar, eu contrato o módulo Cotação automática por ${reais(PRECO_DA_COTACAO)} por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.`,
  "O módulo é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade do FireHub (2% do faturamento, com mínimo e teto).",
  `A primeira ativação da loja tem ${DIAS_DE_TESTE_DA_COTACAO} dias grátis. Depois deles a cobrança começa sozinha. Os ${DIAS_DE_TESTE_DA_COTACAO} dias valem uma vez só: desativar e ativar de novo não dá outro período grátis, e quem já usou o teste, ao ativar, já tem o mês em curso cobrado inteiro.`,
  `Passados os ${DIAS_DE_TESTE_DA_COTACAO} dias grátis, o mês em que o módulo ficar ativo, mesmo que por um único dia, é cobrado inteiro (${reais(PRECO_DA_COTACAO)}), uma vez só, mesmo que eu desative e ative de novo.`,
  "Se eu desativar durante os dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo.",
  "As mensagens aos fornecedores e ao comprador saem pelo WhatsApp da MINHA loja (o número conectado ao robô), só para os fornecedores que eu cadastrar e nos dias e horários que eu marcar. Eu confirmo que esses fornecedores são meus contatos comerciais e aceitam receber essas mensagens.",
  "Os preços são lidos por inteligência artificial a partir do que o fornecedor manda (texto, foto, PDF ou áudio). A leitura pode errar: antes de comprar, eu confiro o preço no comparativo, e o que a leitura não teve certeza fica marcado para eu confirmar. O FireHub não responde por preço lido errado, pedido feito com base nele, nem pelo que o fornecedor cobrar ou entregar.",
];
