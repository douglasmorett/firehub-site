/**
 * O TERMO QUE O DONO ACEITA AO LIGAR O BILL — um texto só: a tela mostra este
 * e o servidor grava a versão aceita junto com o trecho ligado
 * (AssessorAssinatura.periodos[].aceite). Mudou o texto, mude a versão.
 *
 * Douglas, 14/10/2026: "ao ativar abrir um termo que diz que concorda em
 * descontar o valor e que mesmo que seja desativado e ativado no mesmo dia será
 * cobrado o valor do mês inteiro; caso desative, no mês seguinte não cobra mais."
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DO_BILL = "2026-10-14";

export const TITULO_DO_TERMO_DO_BILL = "Termo de contratação — Bill, seu assessor";

export const CLAUSULAS_DO_TERMO_DO_BILL = [
  "Ao ativar, eu contrato o Bill, seu assessor, por R$ 29,90 por mês e autorizo que esse valor seja cobrado no boleto da mensalidade do FireHub.",
  "O mês em que o Bill ficar ativo, mesmo que por um único dia, é cobrado inteiro (R$ 29,90). Desativar e ativar de novo no mesmo mês — inclusive no mesmo dia — não diminui o valor desse mês, e ele é cobrado uma vez só.",
  "Se eu desativar, a cobrança para: no mês seguinte não é cobrado nada, a não ser que eu ative de novo.",
  "O que o Bill lança no estoque, no financeiro e no cardápio fica no sistema como se eu tivesse feito pelo painel. Posso desfazer pelo próprio Bill (\"desfaz\") ou pelo painel.",
  "O Bill atende os números de WhatsApp cadastrados como do dono (Minha Loja e Chatbot IA › Notificações). Sou responsável por quem tem acesso a esses números.",
];
