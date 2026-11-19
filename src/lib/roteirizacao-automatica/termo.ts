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
 * 19/11/2026: texto revisto antes da publicação (mais curto, mesma regra) —
 * versão nova; ninguém tinha aceitado a de 2026-11-05.
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA = "2026-11-19";

export const TITULO_DO_TERMO_DA_ROTA_AUTOMATICA = "Termo de contratação — Rota 100% automatizada";

export const CLAUSULAS_DO_TERMO_DA_ROTA_AUTOMATICA = [
  "Ao ativar, eu contrato a Rota 100% automatizada por R$ 97,00 por mês, cobrados no boleto da mensalidade do FireHub, numa linha própria.",
  "Ela é cobrada À PARTE: não substitui nem desconta a mensalidade da loja (2% do faturamento, com mínimo e teto) nem os outros módulos. A Roteirização manual continua incluída, sem custo a mais.",
  "A primeira ativação tem 7 dias grátis, uma vez só. Depois deles a cobrança começa sozinha. Se eu já usei o teste, ao ativar o mês em curso é cobrado inteiro.",
  "Depois do teste, cada mês em que ela ficar ativa, mesmo que por um dia, é cobrado inteiro (R$ 97,00), uma vez só, sem valor proporcional.",
  "Se eu desativar durante os 7 dias grátis, ela desliga na hora e nada é cobrado. Se eu desativar depois do teste, o mês em curso já está no boleto, sem proporcional nem devolução: ela continua até o último dia do mês, desliga sozinha na virada e o mês seguinte não é cobrado. Desligada, para de criar rotas novas; as que já existem ficam até eu desfazer.",
  "Ela depende do pino da loja no mapa, dos endereços localizados no mapa e da localização do App Motoboys ligada. Pedido sem endereço localizado fica de fora, para rota manual. A loja continua responsável pelas entregas e pode desfazer, trocar o motoboy ou despachar à mão qualquer rota.",
];
