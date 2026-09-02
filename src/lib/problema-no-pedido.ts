/**
 * Reconhece que o cliente está com PROBLEMA no pedido — e não apenas curioso.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 * Em 01/09/2026 uma cliente esperou 1h40. O robô respondeu quatro vezes, cada
 * vez mais confiante, e na última inventou uma ligação que nunca houve:
 * "Consegui falar com ele sim... ele acabou de me confirmar que teve uma
 * complicação na entrega anterior aqui perto, mas já tá na sua rua agora".
 * O robô não tem telefone, não liga para motoboy e não sabe onde ele está.
 *
 * O erro não foi de tom nem de prompt: foi de ATRIBUIÇÃO. Reclamação não é
 * dúvida — ninguém resolve atraso com informação, resolve com uma pessoa que
 * pode agir. Então a partir daqui a regra é: problema no pedido tira o robô da
 * conversa e chama gente.
 *
 * ── O que NÃO é problema ────────────────────────────────────────────────────
 * "Cadê meu pedido?" na primeira vez é pergunta legítima, e o robô responde bem
 * porque tem o status real em mãos. Escalar toda consulta afogaria a atendente
 * e tiraria o robô justamente do que ele faz certo. Por isso duas portas:
 *
 * 1. Reclamação explícita — "tá demorando", "não chegou", "faltou item",
 *    "veio frio", "quero cancelar". Escala na primeira.
 * 2. Cobrança repetida — perguntar do pedido de novo depois de já ter
 *    perguntado. A segunda vez não é dúvida, é insistência: a primeira resposta
 *    não resolveu. Foi exatamente o padrão da conversa real.
 */

/** Reclamação explícita: uma só já basta para chamar gente. */
const RECLAMACAO = [
  // Demora e atraso. Só as formas que descrevem algo JÁ acontecendo ou passado:
  // "demora" cru é pergunta de quem nem pediu ainda ("quanto tempo demora?").
  /demor(ando|ou|ei|aram|ada)/i,
  /atras(o|ado|ada|ando)/i,
  /\b(uma|um|1)\s*h(ora)?\b.*\b(esper|aguard)/i,
  /\b(esper|aguard)\w*\b.*\b(uma|um|1|\d+)\s*(h\b|hora|minuto)/i,
  /\d+\s*(h|hora|minuto|min)\w*\s*(de\s*)?(esper|aguard)/i,
  /(t[áa]|est[áa]|ficou|tem)\s+(muito\s+)?(tempo|demorado)/i,

  // Não chegou
  /n[ãa]o\s+(chegou|chegaram|recebi|veio|entregaram)/i,
  /(nada\s+(da|do|de)\s+(entrega|pedido|comida|lanche))/i,
  /(cad[êe]|onde)\s+(t[áa]|est[áa])?\s*(a\s+)?(entrega|comida|lanche|meu\s+pedido).*(ainda|at[ée]\s+agora)/i,
  /at[ée]\s+agora\s+nada/i,
  /sem\s+(o\s+)?(pedido|entrega)\s+at[ée]/i,

  // Item faltando ou pedido errado
  /falt(ou|ando|a)\s+(um|uma|o|a|os|as|meu|minha|\d)/i,
  /(veio|chegou|mandaram|entregaram)\s+(sem|errad|incomplet|trocad)/i,
  /(pedido|item|lanche|produto)\s+(errad|incomplet|trocad)/i,
  /n[ãa]o\s+(foi|era)\s+(isso|esse|essa)\s+que\s+(eu\s+)?pedi/i,
  /faltando\s+(item|produto|coisa)/i,

  // Qualidade — só com contexto de recebido, senão "coca gelada" viraria queixa
  /(veio|chegou|tava|estava|t[áa]|est[áa])\s+(frio|gelado|estragad|azed|queimad|cru|mofad|velho|duro)/i,
  /(passando|passei)\s+mal/i,
  /(comida|lanche|pedido)\s+(estragad|azed|queimad|podre)/i,

  // Cancelamento, estorno e escalada formal
  /\bcancel(ar|a|amento|e)\b/i,
  /reclama(r|[çc][ãa]o)/i,
  /\bprocon\b/i,
  /(estorn|dinheiro\s+de\s+volta|meu\s+dinheiro\s+de\s+volta|reembols)/i,
  /cobra(do|ram|n[çc]a)\s+(a\s+mais|errad|dobrad|duas\s+vezes)/i,

  // Frustração dirigida ao próprio atendimento
  /(nada\s+se\s+resolve|n[ãa]o\s+resolve|toda\s+hora\s+(voc[êe]|vc)\s+fala)/i,
  /(t[áa]|est[áa])\s+de\s+(brincadeira|sacanagem|zoeira)/i,
  /\b(absurdo|inadmiss[íi]vel|desrespeito|palha[çc]ada)\b/i,
];

/**
 * Cobrança de pedido: sozinha é pergunta legítima, repetida vira problema.
 * Deliberadamente mais frouxa que RECLAMACAO — só age no segundo tempo.
 */
const COBRANCA_DE_PEDIDO = [
  /(cad[êe]|onde)\s+(t[áa]|est[áa]|anda)?\s*(o\s+|a\s+|meu\s+|minha\s+)?(pedido|entrega|comida|lanche|motoboy|entregador)/i,
  /(pedido|entrega|lanche|comida|motoboy|entregador)\s*(j[áa]\s+)?(saiu|vem|chega|t[áa]\s+longe|demora)/i,
  /(quanto\s+tempo|falta\s+muito|vai\s+demorar|demora\s+mais)/i,
  /(previs[ãa]o|posi[çc][ãa]o)\s+(do|da)\s+(pedido|entrega)/i,
  /\bj[áa]\s+(saiu|ligou|falou|resolveu)\b/i,
];

export type ProblemaDetectado = {
  /** Chamar gente agora. */
  escalar: boolean;
  /** Por que — vai para o log, para o painel e para o alerta do dono. */
  motivo?: "reclamacao" | "cobranca_repetida";
  /** O trecho que disparou, para a atendente entender sem abrir a conversa. */
  gatilho?: string;
};

const SEM_PROBLEMA: ProblemaDetectado = { escalar: false };

function bate(regras: RegExp[], texto: string): string | null {
  for (const r of regras) {
    const m = texto.match(r);
    if (m) return m[0].slice(0, 60);
  }
  return null;
}

/** Quanto tempo para trás uma cobrança anterior ainda conta como insistência. */
const JANELA_DE_INSISTENCIA_MS = 90 * 60 * 1000;

/**
 * @param texto     Mensagem que acabou de chegar do cliente.
 * @param historico Mensagens anteriores da MESMA conversa, com quem falou e quando.
 * @param agora     Timestamp de referência (injetado para o teste ser determinístico).
 */
export function detectarProblemaNoPedido(
  texto: string,
  historico: Array<{ sender: string; text: string; timestamp?: number }> = [],
  agora: number = Date.now()
): ProblemaDetectado {
  if (typeof texto !== "string" || !texto.trim()) return SEM_PROBLEMA;

  const reclamacao = bate(RECLAMACAO, texto);
  if (reclamacao) return { escalar: true, motivo: "reclamacao", gatilho: reclamacao };

  const cobrandoAgora = bate(COBRANCA_DE_PEDIDO, texto);
  if (!cobrandoAgora) return SEM_PROBLEMA;

  // Segunda cobrança dentro da janela: a primeira resposta não resolveu.
  const jaCobrouAntes = historico.some((m) => {
    if (m?.sender !== "user" || typeof m.text !== "string") return false;
    if (typeof m.timestamp === "number" && agora - m.timestamp > JANELA_DE_INSISTENCIA_MS) return false;
    return Boolean(bate(COBRANCA_DE_PEDIDO, m.text));
  });

  return jaCobrouAntes
    ? { escalar: true, motivo: "cobranca_repetida", gatilho: cobrandoAgora }
    : SEM_PROBLEMA;
}

/**
 * A única frase que o robô diz antes de sair de cena.
 *
 * Curta e sem promessa. Nada de prazo ("chega em 2 minutos"), nada de ação que
 * ele não executa ("vou ligar para o motoboy") — foi exatamente esse tipo de
 * frase que virou mentira na conversa de 01/09/2026.
 */
export const FRASE_DE_TRANSFERENCIA =
  "Poxa, sinto muito por isso! 🙏 Vou chamar agora uma pessoa da nossa equipe " +
  "para resolver isso com você por aqui.";
