/**
 * A IA caiu. O que é, quem resolve, e o que dizer a cada um.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Em 29/08/2026 o crédito pré-pago do Gemini acabou num sábado à noite. Em
 * 13/09/2026 às 21:47 acabou de novo — e ninguém soube por CINCO DIAS. O robô
 * não cala quando a IA falha: ele cai numa frase fixa, personalizada com o nome
 * do cliente, que parece atendimento. Foram 1.053 respostas sem uma chamada de
 * IA, em todas as lojas; os pedidos feitos pelo robô caíram de 20 por dia para
 * zero. Na Hakim, uma cliente de retirada pediu para falar com uma pessoa e leu
 * sete vezes que o pedido "já tinha saído para entrega com o motoboy", até o
 * detector de reclamação chamar alguém, 42 minutos depois.
 *
 * A regra daqui em diante: IA fora do ar é INCIDENTE, não modo de operação.
 *   - o cliente lê a verdade, uma vez, e a conversa vai para uma pessoa;
 *   - a loja é avisada para atender na mão;
 *   - o administrador do FireHub é avisado quando a causa é do sistema (a chave
 *     é uma só para todas as lojas: crédito, chave, modelo).
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-falha-da-ia.mjs).
 */

export type TipoDeFalhaDaIa =
  /** Crédito pré-pago esgotado / faturamento. Não volta sozinho: alguém tem que pagar. */
  | "sem_credito"
  /** Chave recusada, revogada ou sem permissão. Não volta sozinho. */
  | "chave_invalida"
  /** Loja (e sistema) sem chave nenhuma cadastrada. */
  | "sem_chave"
  /** O modelo pedido não existe mais (o Google aposenta modelos). É código: não volta sozinho. */
  | "modelo_indisponivel"
  /** Limite de requisições por minuto/dia. Costuma voltar em minutos. */
  | "limite_de_uso"
  /** Demorou mais que o teto da chamada. */
  | "timeout"
  /** 5xx, sobrecarga, rede. Costuma voltar sozinho. */
  | "instavel"
  /** Respondeu sem texto (bloqueio de segurança, resposta vazia). */
  | "resposta_vazia"
  | "desconhecida";

export type FalhaDaIa = {
  tipo: TipoDeFalhaDaIa;
  /** Não se resolve esperando: exige ação de uma pessoa (pagar, trocar chave, trocar modelo). */
  exigeAcao: boolean;
  /** A causa é do sistema inteiro (chave única), não desta loja — avisa o administrador. */
  doSistema: boolean;
  /** Uma linha, para o log e para o alerta. Nunca contém a chave. */
  resumo: string;
};

/** Texto de erro → tipo. Aceita a mensagem crua do SDK, o JSON do Google ou um Error. */
export function classificarFalhaDaIa(erro: unknown): FalhaDaIa {
  const bruto =
    typeof erro === "string"
      ? erro
      : erro instanceof Error
        ? `${erro.name} ${erro.message}`
        : (() => { try { return JSON.stringify(erro); } catch { return String(erro); } })();
  const t = String(bruto || "").toLowerCase();
  const fazer = (tipo: TipoDeFalhaDaIa, exigeAcao: boolean, doSistema: boolean, resumo: string): FalhaDaIa => ({
    tipo, exigeAcao, doSistema, resumo,
  });

  if (!t || t === "null" || t === "undefined" || t === "{}") {
    return fazer("desconhecida", false, false, "falha sem mensagem");
  }
  if (/sem_chave|no api key|api key (?:is )?(?:missing|required)|chave (?:nao|não) (?:cadastrada|configurada)/.test(t)) {
    return fazer("sem_chave", true, true, "nenhuma chave do Gemini cadastrada");
  }
  // "billing" SOLTO não entra: o 429 de cota comum do Gemini diz "please check
  // your plan and billing details" — com a palavra solta, uma sexta cheia batendo
  // o limite por minuto virava "crédito esgotado", incidente falso na primeira
  // falha, com alerta ao dono e conversa entregue à equipe (achado da revisão
  // de 18/09/2026). Só frases de faturamento DESLIGADO contam.
  if (/prepay|credits? (?:are |is )?depleted|billing (?:account )?(?:is |has been )?(?:disabled|closed|suspended|not (?:enabled|active))|payment required|insufficient (?:funds|credit)|\b402\b/.test(t)) {
    return fazer("sem_credito", true, true, "crédito pré-pago do Gemini esgotado");
  }
  if (/api key not valid|api_key_invalid|invalid api key|permission_denied|unauthenticated|\b401\b|\b403\b|key (?:was |has been )?(?:revoked|expired|disabled)|reported as leaked/.test(t)) {
    return fazer("chave_invalida", true, true, "chave do Gemini recusada (inválida, revogada ou sem permissão)");
  }
  if (/\b404\b|not_found|not found|no longer available|is not supported|deprecated|does not exist/.test(t)) {
    return fazer("modelo_indisponivel", true, true, "modelo do Gemini indisponível (aposentado ou nome errado)");
  }
  if (/resource_exhausted|\b429\b|quota|rate limit|too many requests/.test(t)) {
    return fazer("limite_de_uso", false, true, "limite de uso do Gemini atingido (costuma voltar em minutos)");
  }
  if (/abort|timeout|timed out|deadline/.test(t)) {
    return fazer("timeout", false, false, "o Gemini demorou mais que o limite da chamada");
  }
  if (/\b5\d\d\b|unavailable|overloaded|internal|econnreset|enotfound|eai_again|fetch failed|network|socket/.test(t)) {
    return fazer("instavel", false, false, "instabilidade no Gemini ou na rede");
  }
  if (/safety|blocked|finish_reason|resposta vazia|empty response|no text/.test(t)) {
    return fazer("resposta_vazia", false, false, "o Gemini respondeu sem texto");
  }
  return fazer("desconhecida", false, false, String(bruto).slice(0, 160));
}

/**
 * De várias falhas da mesma mensagem (um modelo por tentativa), a que manda:
 * a que exige ação vence a passageira — "sem crédito" no primeiro modelo e
 * "timeout" no segundo é um problema de crédito, não de lentidão.
 */
export function falhaQueManda(falhas: FalhaDaIa[]): FalhaDaIa | null {
  if (!falhas.length) return null;
  // Crédito e chave são do PROJETO: mandam sempre.
  const doProjeto = falhas.find((f) => f.exigeAcao && f.tipo !== "modelo_indisponivel");
  if (doProjeto) return doProjeto;
  // Modelo aposentado só manda quando TODOS morreram por isso. Um nome velho na
  // lista + um timeout isolado no modelo bom é um soluço, não "IA fora do ar" —
  // senão o dia em que o Google aposentar um modelo vira incidente a cada
  // lentidão, com a conversa entregue à equipe.
  if (falhas.every((f) => f.tipo === "modelo_indisponivel")) return falhas[0];
  return falhas.find((f) => !f.exigeAcao) || falhas[0];
}

/** O que o cliente lê. Uma vez só: depois disso a conversa é de uma pessoa. */
export function mensagemDeIaForaDoAr(e: { primeiroNome?: string | null; linkDoCardapio?: string | null }): string {
  const oi = `Oi${e.primeiroNome ? `, ${e.primeiroNome}` : ""}!`;
  const link = e.linkDoCardapio ? `\n\nSe quiser adiantar, dá para pedir direto pelo nosso cardápio: ${e.linkDoCardapio}` : "";
  return (
    `${oi} 😊 Nosso atendimento automático está com uma instabilidade agora. ` +
    `Já avisei a equipe e uma pessoa vai te responder por aqui em instantes.${link}`
  );
}

/**
 * Falha PASSAGEIRA (timeout, 503): o robô não sai da conversa por causa de um
 * soluço — pede para repetir e segue. Só vira incidente quando se repete
 * (`virouIncidente`), e aí quem fala é `mensagemDeIaForaDoAr`.
 */
export function mensagemDeInstabilidadePassageira(e: { primeiroNome?: string | null; linkDoCardapio?: string | null }): string {
  const oi = `Oi${e.primeiroNome ? `, ${e.primeiroNome}` : ""}!`;
  const link = e.linkDoCardapio ? ` Se preferir, dá para pedir direto pelo nosso cardápio: ${e.linkDoCardapio}` : "";
  return `${oi} 😅 Tive uma instabilidade aqui agora. Pode me mandar de novo daqui a pouquinho?${link}`;
}

/**
 * Esta falha já é um INCIDENTE — hora de dizer a verdade, chamar gente e
 * avisar a loja? Sim quando exige ação (crédito, chave: não volta sozinho), ou
 * quando a mesma loja acumulou `limite` falhas dentro de `janelaMs`. O estado é
 * de quem chama: um Map loja → horários das falhas recentes.
 */
export function virouIncidente(
  estado: Map<string, number[]>,
  loja: string,
  falha: FalhaDaIa,
  agora: number,
  limite = 3,
  janelaMs = 10 * 60 * 1000,
): boolean {
  const recentes = (estado.get(loja) || []).filter((t) => agora - t < janelaMs);
  recentes.push(agora);
  estado.set(loja, recentes.slice(-20));
  return falha.exigeAcao || recentes.length >= limite;
}

/** O alerta para o dono da LOJA: o que fazer agora é atender na mão. */
export function alertaDeIaForaDoArParaALoja(e: {
  falha: FalhaDaIa;
  nomeDoCliente: string;
  telefone: string;
  mensagemDoCliente: string;
  /**
   * O cliente desta mensagem FOI passado para a equipe? Quem perguntou do pedido
   * recebe o status e não entra na fila — dizer ao dono que ele "está esperando
   * uma pessoa" o mandaria procurar no balãozinho alguém que não está lá.
   */
  transferido?: boolean;
}): string {
  const trecho = String(e.mensagemDoCliente || "").trim().slice(0, 180);
  const quemEspera =
    e.transferido === false
      ? `Quem pergunta do pedido ainda recebe o status; os demais clientes são avisados e passados para a equipe.`
      : `*${e.nomeDoCliente}* (${e.telefone}) está esperando uma pessoa` + (trecho ? `:\n_"${trecho}"_` : ".");
  return (
    `🚨 *O robô está sem inteligência artificial agora*\n\n` +
    `Motivo: ${e.falha.resumo}.\n` +
    (e.falha.exigeAcao
      ? `Isso NÃO volta sozinho — o suporte do FireHub já foi avisado.\n\n`
      : `Costuma voltar sozinho em alguns minutos.\n\n`) +
    `Enquanto isso o robô NÃO está atendendo: ele avisa o cliente e passa a conversa para a equipe. ` +
    quemEspera +
    `\n\nResponda pelo WhatsApp ou pelo balãozinho vermelho do painel.`
  );
}

/** O que o DONO lê quando é ele quem escreve ao robô durante a queda — sem "já avisei a equipe": a equipe é ele. */
export function mensagemDeIaForaDoArParaODono(falha: FalhaDaIa): string {
  return (
    `⚠️ A inteligência artificial do robô está fora do ar agora: ${falha.resumo}. ` +
    (falha.exigeAcao ? `Isso não volta sozinho — o suporte do FireHub já foi avisado. ` : `Costuma voltar em alguns minutos. `) +
    `Enquanto isso o robô avisa os clientes e passa as conversas para a equipe (balãozinho vermelho do painel).`
  );
}

/** O alerta para o ADMINISTRADOR do FireHub: a causa é do sistema e é ele quem resolve. */
export function alertaDeIaForaDoArParaOAdmin(e: { falha: FalhaDaIa; loja: string; quando: string }): string {
  const oQueFazer: Record<TipoDeFalhaDaIa, string> = {
    sem_credito: "Recarregue o crédito em https://ai.studio/projects → Billing. O robô volta sozinho, sem deploy.",
    chave_invalida: "Confira a chave em https://aistudio.google.com/apikey e atualize em Admin → Chatbot (conta matriz).",
    sem_chave: "Cadastre a chave do Gemini na conta matriz (Admin → Chatbot).",
    modelo_indisponivel: "O Google aposentou o modelo: troque a lista `modelNames` em src/lib/chatbot-ai.ts.",
    limite_de_uso: "Se persistir por mais de alguns minutos, aumente a cota do projeto no Google AI Studio.",
    timeout: "Se persistir, veja o status do Gemini e os logs do app.",
    instavel: "Se persistir, veja o status do Gemini e os logs do app.",
    resposta_vazia: "Se persistir, veja os logs do app (bloqueio de segurança ou prompt grande demais).",
    desconhecida: "Veja os logs do app (Coolify → Runtime Logs), procure por [Chatbot AI].",
  };
  return (
    `🔥 *FireHub — IA do robô FORA DO AR*\n\n` +
    `${e.falha.resumo}.\n` +
    `Primeira loja a sentir: ${e.loja} (${e.quando}).\n` +
    `A chave é uma só: TODAS as lojas estão sem IA — os robôs estão passando as conversas para atendimento humano.\n\n` +
    `👉 ${oQueFazer[e.falha.tipo]}`
  );
}

/**
 * Freio de alerta: no máximo um por chave a cada `janelaMs`. O estado é de quem
 * chama (um Map do processo) — depois de um deploy o alerta pode repetir uma
 * vez, e durante um incidente isso é desejável, não defeito.
 */
export function podeAlertarAgora(
  estado: Map<string, number>,
  chave: string,
  agora: number,
  janelaMs: number,
): boolean {
  // `undefined` e não `|| 0`: "nunca alertou" não é "alertou no instante zero".
  const ultimo = estado.get(chave);
  if (ultimo !== undefined && agora - ultimo < janelaMs) return false;
  estado.set(chave, agora);
  return true;
}
