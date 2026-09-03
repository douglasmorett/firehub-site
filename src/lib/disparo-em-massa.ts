/**
 * /src/lib/disparo-em-massa.ts
 *
 * Interruptor único do disparo de campanha por WhatsApp.
 *
 * ── POR QUE ESTÁ DESLIGADO ──────────────────────────────────────────────────
 *
 * Em 02/09/2026 o WhatsApp baniu o número da Hakim Centro (contatohakim), que
 * era o número principal do negócio. Perdeu-se a conta, o histórico e o contato
 * com os clientes que só falavam por ali. Não há recurso: o gateway do FireHub
 * usa Baileys, um cliente NÃO OFICIAL, e a Meta trata isso como uso não
 * autorizado — banir é direito dela e não existe suporte para reclamar.
 *
 * O disparo não foi a causa imediata (o último tinha sido em 03/08, um mês
 * antes; o gatilho foi um pico de conversas novas vindas de tráfego pago). Mas
 * é o pior fator de RISCO que o sistema oferece, porque é a única função que
 * manda mensagem para quem NÃO pediu — e denúncia de destinatário é o que mais
 * pesa na decisão de banir. O histórico da própria Hakim mostra o estrago
 * acontecendo em tempo real: 133 alvos com 133 entregues em 31/07, e no dia
 * 03/08 apenas 39 de 273 passaram. O número já estava sendo estrangulado e
 * ninguém tinha como ver.
 *
 * Note que o ritmo NÃO era o problema: o envio já respeitava 12 a 28 segundos
 * entre mensagens e descanso de 45 a 75 segundos a cada dez. Mandar devagar não
 * conserta mandar para quem não pediu.
 *
 * ── COMO RELIGAR, E QUANDO ──────────────────────────────────────────────────
 *
 * Trocar esta constante para `true` reativa a função inteira (rota e tela) —
 * mas só faça isso quando o envio sair pela WhatsApp Cloud API OFICIAL, onde
 * mensagem de marketing é um template aprovado pela Meta e cobrado por envio
 * (~R$ 0,31 a R$ 0,55 no Brasil). Nesse modelo a Meta cobra em vez de banir, e
 * o custo por si já limita o exagero.
 *
 * Enquanto for Baileys, religar é escolher pagar de novo com um número.
 */
export const DISPARO_EM_MASSA_LIBERADO = false;

/** O que a loja lê na tela e o que a API responde. Um texto só, os dois lugares. */
export const MOTIVO_DISPARO_DESLIGADO =
  "O disparo de campanha está desligado. O WhatsApp bane números que enviam " +
  "mensagem para quem não pediu, e o robô do FireHub conecta pelo QR Code — " +
  "um caminho não oficial, sem direito a recurso. Um número da casa já foi " +
  "perdido assim. A função volta quando o envio passar pela API oficial da Meta.";
