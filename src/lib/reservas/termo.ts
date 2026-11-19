/**
 * O TERMO QUE O DONO ACEITA AO ATIVAR AS RESERVAS DE MESA — a tela mostra este
 * texto e o servidor grava a versão aceita junto com o trecho ligado. Mudou o
 * texto, mude a versão.
 *
 * A regra de cobrança é a dos módulos pagos (lib/modulo-pago.ts, Douglas,
 * 18/10/2026). Arquivo puro (sem banco): a tela importa.
 */
import { DIAS_DE_TESTE_DAS_RESERVAS, PRECO_DAS_RESERVAS } from "./preco";

export const VERSAO_DO_TERMO_DAS_RESERVAS = "2026-11-19";

export const TITULO_DO_TERMO_DAS_RESERVAS = "Termo de contratação — Reservas de mesa";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const CLAUSULAS_DO_TERMO_DAS_RESERVAS = [
  `Ao ativar, eu contrato o módulo Reservas de mesa por ${reais(PRECO_DAS_RESERVAS)} por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.`,
  "O módulo é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade do FireHub (2% do faturamento, com mínimo e teto).",
  `A primeira ativação da loja tem ${DIAS_DE_TESTE_DAS_RESERVAS} dias grátis. Depois deles a cobrança começa sozinha. Os ${DIAS_DE_TESTE_DAS_RESERVAS} dias valem uma vez só: desativar e ativar de novo não dá outro período grátis, e quem já usou o teste, ao ativar, já tem o mês em curso cobrado inteiro.`,
  `Passados os ${DIAS_DE_TESTE_DAS_RESERVAS} dias grátis, o mês em que o módulo ficar ativo, mesmo que por um único dia, é cobrado inteiro (${reais(PRECO_DAS_RESERVAS)}), uma vez só, mesmo que eu desative e ative de novo.`,
  "Se eu desativar durante os dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo.",
  "Com o módulo ligado, o robô do WhatsApp da loja confirma a reserva sozinho quando há lugar, seguindo os horários, a duração e a quantidade de reservas ao mesmo tempo que EU configurar no painel. A loja é responsável por essa configuração e por receber os clientes das reservas confirmadas; reserva que a loja não puder atender, a loja cancela no painel e avisa o cliente.",
  "Desligado o módulo, o robô volta a atender reserva como antes (passando para a equipe). As reservas já gravadas não se apagam: voltam a aparecer no painel se eu ativar de novo.",
];
