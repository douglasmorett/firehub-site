/**
 * A IA do robô está de pé? — o estado que o PAINEL mostra.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O alerta de "IA fora do ar" vai pelo WhatsApp para o `notificationPhone` da
 * loja e da conta matriz. Conferido no banco em 18/09/2026: a matriz NÃO tem
 * número cadastrado, e 3 das 5 lojas com robô também não (Hakim Centro e Brazza
 * Burguer entre elas). Foi assim que o crédito do Gemini ficou esgotado cinco
 * dias sem ninguém saber: os alertas existiam e não tinham para onde ir.
 *
 * A faixa do painel não depende de telefone: toda loja com o painel aberto vê.
 * Este módulo é só o estado que ela lê — o webhook escreve, a rota
 * /api/chatbot/status-conexao entrega.
 *
 * Guardado em `globalThis` porque o Next carrega cada rota num bundle próprio;
 * uma variável de módulo seria uma por rota. Memória do processo de propósito:
 * depois de um deploy o estado volta a "de pé" e a primeira mensagem que falhar
 * o derruba de novo — sem custo de banco a cada mensagem do robô.
 */

export type SaudeDaIa = {
  foraDoAr: boolean;
  /** ISO de quando o incidente começou (neste processo). */
  desde: string | null;
  resumo: string | null;
  /** Não volta sozinha: alguém tem que agir (crédito, chave). */
  exigeAcao: boolean;
};

type Registro = { desde: number; ultimaFalhaEm: number; resumo: string; exigeAcao: boolean };
type Estado = { sistema: Registro | null; porLoja: Map<string, Registro> };

/** Falha passageira sem repetição some sozinha da faixa depois disto. */
const SOLUCO_EXPIRA_MS = 15 * 60 * 1000;

function estado(): Estado {
  const g = globalThis as any;
  if (!g.__firehubSaudeDaIa) g.__firehubSaudeDaIa = { sistema: null, porLoja: new Map<string, Registro>() };
  return g.__firehubSaudeDaIa as Estado;
}

export function registrarIncidenteDaIa(
  lojaId: string,
  falha: { resumo: string; exigeAcao: boolean; doSistema: boolean },
  agora: number = Date.now(),
) {
  const e = estado();
  const anterior = falha.doSistema ? e.sistema : e.porLoja.get(lojaId);
  const registro: Registro = {
    desde: anterior?.desde ?? agora,
    ultimaFalhaEm: agora,
    resumo: falha.resumo,
    exigeAcao: falha.exigeAcao,
  };
  if (falha.doSistema) e.sistema = registro;
  else e.porLoja.set(lojaId, registro);
}

/** A IA respondeu para esta loja: o incidente dela — e o do sistema, que usa a mesma chave — acabou. */
export function registrarSucessoDaIa(lojaId: string) {
  const e = estado();
  e.sistema = null;
  e.porLoja.delete(lojaId);
}

export function saudeDaIa(lojaId: string, agora: number = Date.now()): SaudeDaIa {
  const e = estado();
  const vivo = (r: Registro | null | undefined) =>
    r && (r.exigeAcao || agora - r.ultimaFalhaEm < SOLUCO_EXPIRA_MS) ? r : null;
  const r = vivo(e.sistema) || vivo(e.porLoja.get(lojaId));
  if (!r) return { foraDoAr: false, desde: null, resumo: null, exigeAcao: false };
  return { foraDoAr: true, desde: new Date(r.desde).toISOString(), resumo: r.resumo, exigeAcao: r.exigeAcao };
}
