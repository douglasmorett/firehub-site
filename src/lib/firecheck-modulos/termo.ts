/**
 * O TERMO QUE O DONO ACEITA AO LIGAR UM MÓDULO DO FIRECHECK (Checklist ou
 * Controle de ponto) — a tela mostra este texto e o servidor grava a versão
 * aceita junto com o trecho ligado. Mudou o texto, mude a versão.
 *
 * Douglas, 28/10/2026: "o cara só ativar e ser cobrado no pagamento do mês
 * dele"; os dois juntos pelo preço do combo; 7 dias grátis; "usando ou não
 * usando, se tiver ativo vai gerar cobrança"; "ligou, vai pagar o mês
 * inteiro"; "deixou de pagar qualquer coisinha, bloqueia completo. Tudo junto."
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DO_FIRECHECK = "2026-10-28";

export const TITULO_DO_TERMO_DO_FIRECHECK = "Termo de contratação — FireCheck no FireHub";

export const CLAUSULAS_DO_TERMO_DO_FIRECHECK = [
  "Ao ligar, eu contrato o módulo do FireCheck escolhido (Checklist ou Controle de ponto) por R$ 149,00 por mês cada um, e autorizo que o valor seja cobrado no boleto da mensalidade do FireHub, numa linha própria. Com os dois módulos ligados no mesmo mês, pago o preço do combo: R$ 197,00 pelos dois.",
  "Cada módulo libera até 30 colaboradores; com os dois ligados, até 50.",
  "O FireCheck é cobrado À PARTE. Ele não substitui, não inclui e não desconta a mensalidade da loja (2% do faturamento, com mínimo e teto) nem os outros serviços do boleto.",
  "A primeira vez que ligo cada módulo tenho 7 dias grátis. Depois deles a cobrança começa sozinha. Os 7 dias valem uma vez só por módulo: desligar e ligar de novo não dá outro período grátis, e quem já usou o teste, ao ligar, já tem o mês em curso cobrado inteiro.",
  "A cobrança é por estar LIGADO, usando ou não. Passados os 7 dias grátis, o mês em que o módulo ficar ligado, mesmo que por um único dia, é cobrado inteiro, uma vez só, mesmo que eu desligue e ligue de novo. Não existe valor proporcional.",
  "Se eu desligar durante os 7 dias grátis, o módulo desliga na hora e nada é cobrado. Se eu desligar depois do teste, o mês em curso já está no boleto (inteiro, sem valor proporcional nem devolução): o módulo continua liberado até o último dia do mês, desliga sozinho na virada e, a partir do mês seguinte, não é cobrado nada, a não ser que eu ligue de novo.",
  "Se a mensalidade do FireHub ficar em aberto e a loja for bloqueada, o FireCheck é bloqueado junto, inteiro (checklists e ponto), e volta sozinho quando o pagamento for compensado.",
  "Se eu já pago o FireCheck por fora (cartão, pela Cakto), preciso cancelar essa assinatura antes de ligar aqui, para não pagar duas vezes.",
];
