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
 * ── RELIGADO COM ACEITE, EM 11/11/2026 ──────────────────────────────────────
 *
 * Douglas (11/11/2026): liberar o disparo e a recuperação pelo QR para TODAS
 * as lojas, mas cada uma só usa depois de ACEITAR o risco (caixa "Entendo que
 * meu número pode ser banido..." em Marketing › Pelo QR Code). O aceite fica
 * em `chatbotConfig.aceiteRiscoQr` (quem e quando), pode ser desfeito, e a
 * trava é do SERVIDOR: a rota de marketing e o cron da recuperação conferem
 * `aceiteDoRiscoQr` antes de enviar. O Disparo oficial (lib/disparo-oficial)
 * continua sendo o caminho que a tela recomenda.
 *
 * As duas constantes abaixo ficam como interruptor GERAL: `false` desliga
 * para todo mundo, com aceite ou sem.
 *
 * ── COMO RELIGAR, E QUANDO (texto de 02/09, mantido pela história) ──────────
 *
 * Trocar esta constante para `true` reativa a função inteira (rota e tela) —
 * mas só faça isso quando o envio sair pela WhatsApp Cloud API OFICIAL, onde
 * mensagem de marketing é um template aprovado pela Meta e cobrado por envio
 * (~R$ 0,31 a R$ 0,55 no Brasil). Nesse modelo a Meta cobra em vez de banir, e
 * o custo por si já limita o exagero.
 *
 * Enquanto for Baileys, religar é escolher pagar de novo com um número.
 */
export const DISPARO_EM_MASSA_LIBERADO = true;

/** O que a loja lê na tela e o que a API responde. Um texto só, os dois lugares. */
export const MOTIVO_DISPARO_DESLIGADO =
  "O disparo de campanha está desligado. O WhatsApp bane números que enviam " +
  "mensagem para quem não pediu, e o robô do FireHub conecta pelo QR Code — " +
  "um caminho não oficial, sem direito a recurso. Um número da casa já foi " +
  "perdido assim. A função volta quando o envio passar pela API oficial da Meta.";

/**
 * A recuperação automática de clientes sumidos (7, 15 e 30 dias —
 * api/cron/recuperacao-clientes) também saía pelo QR Code: até 60 mensagens
 * por loja por dia para quem não pediu. Desligada em 13/10/2026 junto com a
 * central de disparos (Douglas: "desliga então e a gente refaz depois"). Volta
 * pela API oficial, com crédito e modelo aprovado pela Meta (lib/disparo-oficial).
 * Religada em 11/11/2026 só para a loja que aceitou o risco (ver acima); o
 * marco que estiver ligado no oficial fica parado aqui.
 */
export const RECUPERACAO_PELO_QR_LIGADA = true;

export const MOTIVO_RECUPERACAO_PAUSADA =
  "A recuperação automática está pausada: ela mandava as mensagens pelo QR Code, " +
  "o mesmo caminho que põe o número da loja em risco de banimento. Ela volta em breve " +
  "pela API oficial do WhatsApp, junto com o Disparo oficial. Até lá, nada é enviado, " +
  "mesmo com os marcos ligados.";

// ── ACEITE DO RISCO (11/11/2026) ────────────────────────────────────────────
//
// Sem import de servidor: a tela importa daqui os textos e a leitura.

export type AceiteDoRiscoQr = { aceitoEm: string; aceitoPor: string; nome: string | null };

/** O aceite gravado na loja, ou null (nunca aceitou, ou desfez). */
export function aceiteDoRiscoQr(chatbotConfig: unknown): AceiteDoRiscoQr | null {
  const a = (chatbotConfig as any)?.aceiteRiscoQr;
  if (!a || typeof a !== "object" || typeof a.aceitoEm !== "string" || !a.aceitoEm) return null;
  return { aceitoEm: a.aceitoEm, aceitoPor: String(a.aceitoPor || ""), nome: typeof a.nome === "string" ? a.nome : null };
}

export const FRASE_DO_ACEITE = "Entendo que meu número pode ser banido e quero usar mesmo assim";

export const MOTIVO_SEM_ACEITE =
  "O envio pelo QR Code está travado nesta loja. Para usar, leia o aviso em " +
  "Marketing › Pelo QR Code e marque que entende que o WhatsApp pode banir o número.";

/**
 * Quem recebeu a recuperação pelo QR desde `desde` — para a recuperação
 * OFICIAL não mandar a mesma coisa pelo outro caminho (foraDaAutomacao em
 * lib/disparo-oficial/servidor.ts). `recuperacaoQrEnvios` é um mapa
 * telefone (telefoneDaMeta) → quando (ISO), gravado pelo cron do QR.
 */
export function enviosRecentesDaRecuperacaoQr(chatbotConfig: unknown, desde: Date): string[] {
  const m = (chatbotConfig as any)?.recuperacaoQrEnvios;
  if (!m || typeof m !== "object") return [];
  return Object.entries(m)
    .filter(([, em]) => typeof em === "string" && new Date(em) >= desde)
    .map(([tel]) => tel);
}
