/**
 * O TERMO QUE O DONO ACEITA AO LIGAR A ROTA 100% AUTOMATIZADA — a janela da
 * Roteirização (components/customer/RotaAutomatica.tsx) mostra este texto e o
 * servidor grava a versão aceita junto com o trecho ligado
 * (lib/roteirizacao-automatica/assinatura.ts). Mudou o texto, mude a versão.
 *
 * Douglas, 05/11/2026: a rota automática vira módulo pago para todas as lojas,
 * R$ 97 por mês, 7 dias grátis, pela mesma regra dos outros módulos pagos
 * (lib/modulo-pago.ts; o texto segue o do Multimarcas, lib/multimarcas/termo.ts).
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA = "2026-11-05";

export const TITULO_DO_TERMO_DA_ROTA_AUTOMATICA = "Termo de contratação — Rota 100% automatizada";

export const CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA = [
  "Ao ativar, eu contrato a Rota 100% automatizada por R$ 97,00 por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria.",
  "A Rota 100% automatizada é cobrada À PARTE. Ela não substitui, não inclui e não desconta a mensalidade da loja (2% do faturamento, com mínimo e teto) nem os outros módulos, que continuam cobrados como hoje. A Roteirização manual continua no pacote, sem custo a mais.",
  "A primeira ativação da loja tem 7 dias grátis. Depois deles a cobrança começa sozinha. Os 7 dias valem uma vez só: desativar e ativar de novo não dá outro período grátis, e quem já usou o teste, ao ativar, já tem o mês em curso cobrado inteiro.",
  "Passados os 7 dias grátis, o mês em que a rota automática ficar ativa, mesmo que por um único dia, é cobrado inteiro (R$ 97,00), uma vez só, mesmo que eu desative e ative de novo.",
  "Se eu desativar durante os 7 dias grátis, ela desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): a rota automática continua funcionando até o último dia do mês, desliga sozinha na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ative de novo. Desligada, o sistema para de criar rotas novas; as que já existem continuam até eu desfazer.",
  "A rota automática depende do pino da loja no mapa, dos endereços localizados no mapa e da localização do App Motoboys. Pedido sem endereço localizado fica de fora, para rota manual. A loja continua responsável pelas entregas e pode desfazer, trocar o motoboy ou despachar à mão qualquer rota.",
];
