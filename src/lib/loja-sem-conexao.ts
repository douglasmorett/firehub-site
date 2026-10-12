/**
 * LOJA SEM CONEXÃO — a internet da loja caiu no meio do expediente.
 *
 * ── O problema (achado de 12/10/2026) ───────────────────────────────────────
 *
 * Com o aceite automático ligado (User.autoAcceptOrders), o pedido do site, do
 * 99Food, da Keeta e da Wabiz é ACEITO na nuvem na hora em que chega, esteja a
 * loja vendo ou não (api/99food/webhook, lib/keeta/eventos.ts,
 * lib/wabiz-traducao.ts, api/customer-order). E o iFood continua mandando
 * pedido. Quando a internet da loja cai, ninguém lá dentro vê nada disso, e o
 * cliente espera um pedido que ninguém está preparando. Até aqui o único sinal
 * era o aviso "impressão parada" no WhatsApp do dono, dez minutos depois, e sem
 * pausar nada.
 *
 * ── Como se sabe que a loja apagou ──────────────────────────────────────────
 *
 * Dois sinais de vida, os dois já existentes:
 *
 *   A. O Assistente de Impressão consulta a fila a cada 3 s
 *      (api/store/print-queue). O banco guarda a última consulta em
 *      User.printQueuePolledAt, no máximo uma vez por minuto; a memória do
 *      processo guarda a de verdade (lib/sinais-da-loja.ts).
 *   B. Todo painel aberto em /store (inclusive a TV do KDS) chama
 *      /api/customer-order/poll a cada ~5 s. Só a memória do processo guarda.
 *
 * APAGADA exige TUDO isto (`lojaApagada`), porque pausar por engano perde venda:
 *
 *   1. O Assistente estava vivo há pouco (nos últimos 30 min) e está mudo há
 *      2 min ou mais. Loja que não usa o Assistente nunca apaga: fica como
 *      sempre foi. E PC desligado desde ontem não é queda; é o normal de quem
 *      liga o computador depois de abrir.
 *   2. Nenhum painel da loja (nem o do dono olhando a loja, nem o "Todas as
 *      lojas") chamou nos últimos 2 min, E o servidor está de pé há 3 min ou
 *      mais: logo depois de um deploy a memória está vazia, e "não vi painel"
 *      ainda não quer dizer nada.
 *   3. Dentro do horário cadastrado (turnoAgora), sem pausa programada, e com
 *      o "Site aberto" ligado: se o dono já fechou, não há o que proteger.
 *   4. A proteção da loja está ligada (chatbotConfig.protecaoSemConexao;
 *      ausente = ligada), em Chatbot IA → Notificações.
 *
 * VOLTOU (`motivoDaVolta`) quando qualquer sinal reaparece: painel nos últimos
 * 30 s, ou Assistente nos últimos 30 s (memória) ou carimbado no banco no
 * último minuto e meio. O carimbo é de minuto em minuto, e depois de um
 * silêncio de 2 min o primeiro carimbo novo só pode ser a volta. Fora do
 * horário o episódio também termina: o que fizemos é desfeito e o próximo
 * horário começa como sempre.
 *
 * ── O que se faz, e só o que se fez é desfeito ──────────────────────────────
 *
 *   • "Site aberto" desligado, só se estava ligado, na MESMA gravação que abre
 *     o episódio (o UPDATE exige storeOpen = true). Site e robô passam a dizer
 *     "estamos com instabilidade, volte em alguns minutos" (lib/loja-aberta.ts,
 *     `semConexao`). Na volta religa só se ainda for nosso: se alguém religou
 *     no meio, virou do dono e ninguém mexe.
 *   • iFood: uma pausa (interrupção) de 2 h com a nossa descrição em cada loja
 *     do iFood da conta, menos na que já está fechada lá (horário do iFood,
 *     pausa do dono). Perto de vencer, renova. Na volta tira as NOSSAS, pelo id
 *     e pela descrição, e nunca a do dono.
 *   • 99Food e Keeta: o FireHub não tem como fechar a loja nesses canais
 *     (food99-api.ts `setShopStatus` só põe ONLINE, de propósito; a Keeta não
 *     tem chamada de status de loja aqui). O aviso ao dono diz isso.
 *   • Aviso ao dono (lib/alertas-do-dono.ts, "loja_sem_conexao"), na queda e
 *     na volta. Loja que pisca não vira enxurrada: entre dois avisos de queda
 *     passam pelo menos 20 min.
 *
 * Arquivo sem banco e sem relógio: o cron (api/cron/loja-sem-conexao) entrega
 * os sinais e o estado gravado, e daqui saem as decisões. O estado mora em
 * User.semConexaoEstado (lib/loja-sem-conexao-no-banco.ts).
 * Teste: scripts/teste-loja-sem-conexao.ts.
 */

// ── Os tempos ───────────────────────────────────────────────────────────────

/** Assistente mudo por este tempo = sinal de queda. */
export const ASSISTENTE_MUDO_MS = 2 * 60_000;
/** ...mas só se ele estava vivo dentro desta janela: PC desligado desde ontem não é queda. */
export const ASSISTENTE_RECENTE_MS = 30 * 60_000;
/** Nenhum painel aberto por este tempo. */
export const PAINEL_MUDO_MS = 2 * 60_000;
/** Servidor recém-subido: a memória dos painéis ainda está vazia. */
export const CARENCIA_DO_BOOT_MS = 3 * 60_000;
/** Sinal visto há menos que isto = a loja voltou. */
export const VOLTA_MS = 30_000;
/**
 * O carimbo do banco é de minuto em minuto: vivo, ele nunca passa de ~63 s.
 * Depois de um silêncio de 2 min, carimbo com menos que isto só pode ser volta.
 */
export const VOLTA_PELO_BANCO_MS = 90_000;
/** Duração da pausa no iFood: se o FireHub cair junto, ela acaba sozinha. */
export const PAUSA_NO_IFOOD_MS = 2 * 60 * 60_000;
/** A pausa que vence antes disto, com a loja ainda apagada, é renovada. */
export const RENOVAR_ANTES_MS = 10 * 60_000;
/** Nova tentativa de pausar ou de tirar a pausa do iFood. */
export const REPETIR_MS = 2 * 60_000;
/** Tentativas de pausar o iFood por queda (a 1ª conta). */
export const MAX_TENTATIVAS_DE_PAUSA = 5;
/** O aviso de queda que não saiu tenta de novo depois disto. */
export const REPETIR_AVISO_MS = 10 * 60_000;
/** Entre dois avisos de queda: a loja que pisca recebe um aviso, não dez. */
export const ENTRE_AVISOS_DE_QUEDA_MS = 20 * 60_000;
/** A descrição das NOSSAS pausas no iFood: é por ela que a volta acha as que são nossas. */
export const DESCRICAO_DA_PAUSA = "Loja sem conexão (FireHub)";

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Os sinais de vida da loja, do jeito que o cron os enxerga agora. Tudo em ms. */
export type SinaisDeVida = {
  agora: number;
  /** Quando este processo do servidor subiu. */
  bootEm: number;
  /** User.printQueuePolledAt (gravado no máximo uma vez por minuto). */
  assistenteNoBanco: number | null;
  /** Última consulta do Assistente que ESTE processo atendeu. */
  assistenteNaMemoria: number | null;
  /** Última rodada de um painel aberto da loja que ESTE processo atendeu. */
  painelNaMemoria: number | null;
};

export type SituacaoDaLoja = {
  /** Chave do turno de agora (lib/loja-aberta.ts → turnoAgora); null = fora do horário. */
  turno: string | null;
  /** Pausa programada (férias) valendo hoje. */
  emPausa: boolean;
  /** "Site aberto" (User.storeOpen). */
  storeOpen: boolean;
  /** chatbotConfig.protecaoSemConexao (ausente = ligada). */
  protecaoLigada: boolean;
};

/** Uma loja do iFood desta loja do FireHub. */
export type LojaDoIfood = { merchantId: string; nome?: string | null };

/**
 * O que aconteceu com UMA loja do iFood nesta queda:
 *   pendente   — a pausa ainda vai ser tentada;
 *   pausada    — NÓS criamos a pausa `interrupcaoId`, que vai até `ate`;
 *   ja_fechada — o iFood já estava fechado (horário de lá, pausa do dono): não mexemos;
 *   sem_acesso — sem autorização do iFood para pausar pelo FireHub;
 *   falhou     — não conseguiu (rede, iFood fora); tenta de novo.
 */
export type PausaNoIfood = {
  merchantId: string;
  nome?: string | null;
  situacao: "pendente" | "pausada" | "ja_fechada" | "sem_acesso" | "falhou";
  interrupcaoId?: string;
  ate?: number;
  tentativas?: number;
  tentouEm?: number;
  erro?: string;
};

/** Uma queda em andamento. */
export type EpisodioSemConexao = {
  /** Quando a queda foi constatada. */
  desde: number;
  /** O último sinal do Assistente antes do silêncio: "sem conexão desde as 20:41". */
  ultimoSinal: number;
  /** O turno em que apagou. */
  turno: string;
  /**
   * O "Site aberto": fechado por nós (e ainda nosso), ou religado por alguém no
   * meio da queda — aí é do dono e a volta não mexe.
   */
  site: "fechado_por_nos" | "dono_mexeu";
  ifood: PausaNoIfood[];
  /** O aviso de queda: saiu, ficou de fora (sem número / desligado), quando pode sair, última tentativa. */
  aviso: { saiu?: boolean; pulado?: boolean; naoAntesDe: number; tentouEm?: number };
};

/** Pausas NOSSAS no iFood que ainda precisam sair (a volta não conseguiu falar com o iFood). */
export type PausaParaTirar = {
  merchantId: string;
  /** Ids conhecidos; as sem id saem pela descrição. */
  ids: string[];
  /** Depois disto a pausa já venceu sozinha: some da lista. */
  ate: number;
  tentativas?: number;
  tentouEm?: number;
};

/** O que fica gravado em User.semConexaoEstado (mais a `versao`, ver lib/loja-sem-conexao-no-banco.ts). */
export type EstadoSemConexao = {
  episodio?: EpisodioSemConexao;
  tirarDoIfood?: PausaParaTirar[];
  /** Quando saiu o último aviso de queda. */
  ultimoAvisoEm?: number;
};

export type MotivoDaVolta = "assistente" | "painel" | "fora_do_horario" | "protecao_desligada";

export type AvisoSemConexao = "queda" | "volta" | "fim_do_horario";

export type AcoesSemConexao = {
  /** "Site aberto" true → false, na mesma gravação do estado (só se ainda estiver true). */
  fecharSite?: boolean;
  /** "Site aberto" false → true, na mesma gravação do estado. */
  reabrirSite?: boolean;
  /** Lojas do iFood a pausar agora (primeira vez ou nova tentativa). */
  pausarNoIfood: string[];
  /** Pausas nossas perto de vencer (ou que sobraram da queda anterior): tira as nossas e põe outra de 2 h. */
  renovarNoIfood: Array<{ merchantId: string; ids: string[] }>;
  /** Tirar as nossas pausas destas lojas do iFood (pelos ids e pela descrição). */
  tirarDoIfood: Array<{ merchantId: string; ids: string[] }>;
  aviso: AvisoSemConexao | null;
};

export type DecisaoSemConexao = {
  evento: "nada" | "apagou" | "segue_apagada" | "voltou";
  motivo?: MotivoDaVolta;
  /** O episódio que acabou de terminar (para a mensagem da volta). */
  encerrado?: EpisodioSemConexao;
  /** O estado a gravar ANTES de agir: as tentativas já vão carimbadas. */
  estado: EstadoSemConexao;
  acoes: AcoesSemConexao;
};

/** O que voltou do iFood ao pausar (ou renovar) uma loja. */
export type ResultadoDaPausa =
  | { situacao: "pausada"; interrupcaoId?: string; ate: number }
  | { situacao: "ja_fechada" | "sem_acesso" | "falhou"; erro?: string }
  /** Renovação que não conseguiu tirar a pausa velha: nada mudou, tenta de novo. */
  | { situacao: "mantida" };

// ── Leitura ─────────────────────────────────────────────────────────────────

/** A proteção está ligada? Ausente = ligada (é o padrão de toda loja). */
export function protecaoLigada(chatbotConfig: unknown): boolean {
  return (chatbotConfig as { protecaoSemConexao?: unknown } | null)?.protecaoSemConexao !== false;
}

const numero = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * O estado gravado, conferido. Qualquer coisa estranha vira "sem estado" — o
 * pior que isso causa é uma pausa nossa que ninguém tira, e ela vence sozinha
 * em 2 h.
 */
export function lerEstadoSemConexao(bruto: unknown): { estado: EstadoSemConexao; versao: number } {
  const o: any = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
  const versao = Number.isInteger(o.versao) && o.versao > 0 ? o.versao : 0;
  const estado: EstadoSemConexao = {};

  const ep = o.episodio;
  if (ep && typeof ep === "object" && numero(ep.desde) !== undefined && numero(ep.ultimoSinal) !== undefined) {
    estado.episodio = {
      desde: ep.desde,
      ultimoSinal: ep.ultimoSinal,
      turno: String(ep.turno ?? ""),
      site: ep.site === "dono_mexeu" ? "dono_mexeu" : "fechado_por_nos",
      ifood: (Array.isArray(ep.ifood) ? ep.ifood : [])
        .filter((p: any) => p && typeof p.merchantId === "string")
        .map((p: any): PausaNoIfood => ({
          merchantId: p.merchantId,
          nome: typeof p.nome === "string" ? p.nome : null,
          situacao: ["pendente", "pausada", "ja_fechada", "sem_acesso", "falhou"].includes(p.situacao) ? p.situacao : "falhou",
          interrupcaoId: typeof p.interrupcaoId === "string" ? p.interrupcaoId : undefined,
          ate: numero(p.ate),
          tentativas: numero(p.tentativas),
          tentouEm: numero(p.tentouEm),
          erro: typeof p.erro === "string" ? p.erro : undefined,
        })),
      aviso: {
        saiu: ep.aviso?.saiu === true || undefined,
        pulado: ep.aviso?.pulado === true || undefined,
        naoAntesDe: numero(ep.aviso?.naoAntesDe) ?? ep.desde,
        tentouEm: numero(ep.aviso?.tentouEm),
      },
    };
  }

  if (Array.isArray(o.tirarDoIfood)) {
    const lista = o.tirarDoIfood
      .filter((t: any) => t && typeof t.merchantId === "string" && numero(t.ate) !== undefined)
      .map((t: any): PausaParaTirar => ({
        merchantId: t.merchantId,
        ids: Array.isArray(t.ids) ? t.ids.filter((i: unknown) => typeof i === "string") : [],
        ate: t.ate,
        tentativas: numero(t.tentativas),
        tentouEm: numero(t.tentouEm),
      }));
    if (lista.length > 0) estado.tirarDoIfood = lista;
  }

  const ultimo = numero(o.ultimoAvisoEm);
  if (ultimo !== undefined) estado.ultimoAvisoEm = ultimo;
  return { estado: limpo(estado), versao };
}

/** O mesmo valor com as chaves em ordem e sem as vazias, para comparar dois estados. */
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = canonico(x);
    }
    return o;
  }
  return v;
}

/** Os dois estados dizem a mesma coisa? (Sem isto, a ordem das chaves faria o cron regravar à toa.) */
export function mesmoEstado(a: EstadoSemConexao | null | undefined, b: EstadoSemConexao | null | undefined): boolean {
  return JSON.stringify(canonico(a ?? {})) === JSON.stringify(canonico(b ?? {}));
}

/** Tira chaves vazias: o JSON gravado fica do tamanho do que importa. */
function limpo(e: EstadoSemConexao): EstadoSemConexao {
  const r: EstadoSemConexao = {};
  if (e.episodio) r.episodio = e.episodio;
  if (e.tirarDoIfood && e.tirarDoIfood.length > 0) r.tirarDoIfood = e.tirarDoIfood;
  if (e.ultimoAvisoEm !== undefined) r.ultimoAvisoEm = e.ultimoAvisoEm;
  return JSON.parse(JSON.stringify(r));
}

// ── Os sinais ───────────────────────────────────────────────────────────────

/** O sinal mais recente do Assistente, venha do banco ou da memória. */
export function ultimoSinalDoAssistente(s: SinaisDeVida): number | null {
  const a = s.assistenteNoBanco;
  const b = s.assistenteNaMemoria;
  if (a === null && b === null) return null;
  return Math.max(a ?? -Infinity, b ?? -Infinity);
}

/** A loja apagou agora? As quatro condições do cabeçalho, todas. */
export function lojaApagada(s: SinaisDeVida, loja: SituacaoDaLoja): boolean {
  if (!loja.protecaoLigada) return false;
  if (!loja.turno || loja.emPausa || !loja.storeOpen) return false;
  // Recém-subido: a memória dos painéis ainda não viu ninguém.
  if (s.agora - s.bootEm < CARENCIA_DO_BOOT_MS) return false;

  const ultimo = ultimoSinalDoAssistente(s);
  if (ultimo === null) return false; // nunca usou o Assistente: fica como sempre foi
  const mudo = s.agora - ultimo;
  if (mudo < ASSISTENTE_MUDO_MS || mudo > ASSISTENTE_RECENTE_MS) return false;

  if (s.painelNaMemoria !== null && s.agora - s.painelNaMemoria < PAINEL_MUDO_MS) return false;
  return true;
}

function painelVivo(s: SinaisDeVida): boolean {
  return s.painelNaMemoria !== null && s.agora - s.painelNaMemoria <= VOLTA_MS;
}

function assistenteVivo(s: SinaisDeVida): boolean {
  if (s.assistenteNaMemoria !== null && s.agora - s.assistenteNaMemoria <= VOLTA_MS) return true;
  return s.assistenteNoBanco !== null && s.agora - s.assistenteNoBanco <= VOLTA_PELO_BANCO_MS;
}

/** A queda em andamento acabou? E por quê. null = segue apagada. */
export function motivoDaVolta(s: SinaisDeVida, loja: SituacaoDaLoja): MotivoDaVolta | null {
  // O dono desligou a proteção: desfaz o que fizemos, sem aviso (foi ele).
  if (!loja.protecaoLigada) return "protecao_desligada";
  if (painelVivo(s)) return "painel";
  if (assistenteVivo(s)) return "assistente";
  // Acabou o horário ainda sem conexão: o próximo horário começa como sempre.
  if (!loja.turno || loja.emPausa) return "fora_do_horario";
  return null;
}

// ── A decisão ───────────────────────────────────────────────────────────────

/** Junta uma pausa a tirar na entrada da mesma loja do iFood (uma por loja); a junção tenta já. */
function juntarTirada(lista: PausaParaTirar[], nova: { merchantId: string; ids: string[]; ate: number }): PausaParaTirar[] {
  const i = lista.findIndex((t) => t.merchantId === nova.merchantId);
  if (i < 0) return [...lista, { merchantId: nova.merchantId, ids: [...nova.ids], ate: nova.ate }];
  const velha = lista[i];
  const junta: PausaParaTirar = {
    merchantId: velha.merchantId,
    ids: Array.from(new Set([...velha.ids, ...nova.ids])),
    ate: Math.max(velha.ate, nova.ate),
  };
  return lista.map((t, j) => (j === i ? junta : t));
}

/** As pausas a tirar que já podem ser tentadas de novo entram nas ações, carimbadas. */
function agendarTiradas(lista: PausaParaTirar[], agora: number, acoes: AcoesSemConexao): PausaParaTirar[] {
  return lista.map((t) => {
    if (t.tentouEm !== undefined && agora - t.tentouEm < REPETIR_MS) return t;
    acoes.tirarDoIfood.push({ merchantId: t.merchantId, ids: [...t.ids] });
    return { ...t, tentouEm: agora, tentativas: (t.tentativas ?? 0) + 1 };
  });
}

/**
 * O que fazer com uma loja nesta rodada.
 *
 * Devolve o estado JÁ com as tentativas carimbadas: o cron grava isso antes de
 * chamar o iFood ou o WhatsApp (gravação condicionada à versão lida), e uma
 * segunda rodada que leia esse estado não repete a mesma pausa nem o mesmo
 * aviso. Os resultados entram depois, pelos `registrar...`.
 */
export function decidirSemConexao(o: {
  sinais: SinaisDeVida;
  loja: SituacaoDaLoja;
  /** As lojas do iFood ligadas a esta loja. */
  ifood: LojaDoIfood[];
  /** Há para quem avisar (aviso ligado e número cadastrado)? */
  podeAvisar: boolean;
  estado?: EstadoSemConexao | null;
}): DecisaoSemConexao {
  const { sinais: s, loja } = o;
  const agora = s.agora;
  const antes: EstadoSemConexao = o.estado || {};
  const acoes: AcoesSemConexao = { pausarNoIfood: [], renovarNoIfood: [], tirarDoIfood: [], aviso: null };

  // Pausas nossas de uma queda anterior que ainda não saíram. Vencida = o
  // iFood já reabriu sozinho: sai da lista.
  let tirar: PausaParaTirar[] = (antes.tirarDoIfood || []).filter((t) => t.ate > agora).map((t) => ({ ...t, ids: [...t.ids] }));
  const ep = antes.episodio;

  // ── Loja normal: apagou agora? ─────────────────────────────────────────────
  if (!ep) {
    if (!lojaApagada(s, loja)) {
      tirar = agendarTiradas(tirar, agora, acoes);
      return { evento: "nada", estado: limpo({ ...antes, episodio: undefined, tirarDoIfood: tirar }), acoes };
    }

    const naoAntesDe = Math.max(agora, (antes.ultimoAvisoEm ?? -Infinity) + ENTRE_AVISOS_DE_QUEDA_MS);
    const novo: EpisodioSemConexao = {
      desde: agora,
      ultimoSinal: ultimoSinalDoAssistente(s) as number,
      turno: loja.turno as string,
      site: "fechado_por_nos",
      ifood: [],
      aviso: o.podeAvisar ? { naoAntesDe } : { pulado: true, naoAntesDe },
    };
    for (const m of o.ifood) {
      novo.ifood.push({ merchantId: m.merchantId, nome: m.nome ?? null, situacao: "pendente", tentativas: 1, tentouEm: agora });
      const velha = tirar.find((t) => t.merchantId === m.merchantId);
      if (velha) {
        // Sobrou pausa nossa da queda anterior (a volta não conseguiu tirar):
        // ela é RENOVADA — sai e entra uma nova de 2 h. Pausar por cima daria
        // 409 (já há pausa) e a faxina pendente tiraria a nova no meio desta.
        tirar = tirar.filter((t) => t !== velha);
        acoes.renovarNoIfood.push({ merchantId: m.merchantId, ids: [...velha.ids] });
      } else {
        acoes.pausarNoIfood.push(m.merchantId);
      }
    }
    acoes.fecharSite = true;
    if (o.podeAvisar && agora >= naoAntesDe) {
      acoes.aviso = "queda";
      novo.aviso.tentouEm = agora;
    }
    tirar = agendarTiradas(tirar, agora, acoes);
    return { evento: "apagou", estado: limpo({ ...antes, episodio: novo, tirarDoIfood: tirar }), acoes };
  }

  // ── Em queda: voltou? ──────────────────────────────────────────────────────
  const motivo = motivoDaVolta(s, loja);
  if (motivo) {
    // Só o que é NOSSO volta: o site, se ninguém religou no meio.
    acoes.reabrirSite = ep.site === "fechado_por_nos";
    // Toda loja do iFood da queda passa pela faxina das nossas pausas, até a
    // que "falhou": um POST pode ter dado certo lá e a resposta se perdido.
    // A faxina só tira pausa com a NOSSA descrição; a do dono fica.
    for (const p of ep.ifood) {
      if (p.situacao === "sem_acesso") continue;
      tirar = juntarTirada(tirar, {
        merchantId: p.merchantId,
        ids: p.interrupcaoId ? [p.interrupcaoId] : [],
        ate: p.ate ?? (p.tentouEm ?? agora) + PAUSA_NO_IFOOD_MS,
      });
    }
    tirar = agendarTiradas(tirar, agora, acoes);
    if (ep.aviso.saiu && motivo !== "protecao_desligada") {
      acoes.aviso = motivo === "fora_do_horario" ? "fim_do_horario" : "volta";
    }
    return { evento: "voltou", motivo, encerrado: ep, estado: limpo({ ...antes, episodio: undefined, tirarDoIfood: tirar }), acoes };
  }

  // ── Segue apagada: o que ficou por fazer ───────────────────────────────────
  const novo: EpisodioSemConexao = { ...ep, ifood: ep.ifood.map((p) => ({ ...p })), aviso: { ...ep.aviso } };
  // Alguém religou o site no meio da queda: agora é do dono.
  if (novo.site === "fechado_por_nos" && loja.storeOpen) novo.site = "dono_mexeu";

  for (const p of novo.ifood) {
    if (p.tentouEm !== undefined && agora - p.tentouEm < REPETIR_MS) continue;
    if ((p.situacao === "pendente" || p.situacao === "falhou") && (p.tentativas ?? 0) < MAX_TENTATIVAS_DE_PAUSA) {
      acoes.pausarNoIfood.push(p.merchantId);
      p.tentativas = (p.tentativas ?? 0) + 1;
      p.tentouEm = agora;
    } else if (p.situacao === "pausada" && p.ate !== undefined && p.ate - agora <= RENOVAR_ANTES_MS) {
      acoes.renovarNoIfood.push({ merchantId: p.merchantId, ids: p.interrupcaoId ? [p.interrupcaoId] : [] });
      p.tentouEm = agora;
    }
  }

  const a = novo.aviso;
  if (!a.saiu && !a.pulado && agora >= a.naoAntesDe && (a.tentouEm === undefined || agora - a.tentouEm >= REPETIR_AVISO_MS)) {
    acoes.aviso = "queda";
    a.tentouEm = agora;
  }

  tirar = agendarTiradas(tirar, agora, acoes);
  return { evento: "segue_apagada", estado: limpo({ ...antes, episodio: novo, tirarDoIfood: tirar }), acoes };
}

// ── Os resultados ───────────────────────────────────────────────────────────

/** O resultado de pausar (ou renovar) uma loja do iFood entra no episódio. */
export function registrarPausaNoIfood(estado: EstadoSemConexao, merchantId: string, r: ResultadoDaPausa): EstadoSemConexao {
  const ep = estado.episodio;
  if (!ep || r.situacao === "mantida") return estado;
  return limpo({
    ...estado,
    episodio: {
      ...ep,
      ifood: ep.ifood.map((p): PausaNoIfood => {
        if (p.merchantId !== merchantId) return p;
        if (r.situacao === "pausada") return { ...p, situacao: "pausada", interrupcaoId: r.interrupcaoId, ate: r.ate, erro: undefined };
        return { ...p, situacao: r.situacao, erro: r.erro };
      }),
    },
  });
}

/** As nossas pausas daquela loja do iFood saíram: a entrada some. Não saíram: fica para a próxima. */
export function registrarTiradaDoIfood(estado: EstadoSemConexao, merchantId: string, ok: boolean): EstadoSemConexao {
  if (!ok) return estado;
  return limpo({ ...estado, tirarDoIfood: (estado.tirarDoIfood || []).filter((t) => t.merchantId !== merchantId) });
}

/** O aviso de queda saiu: carimba (e segura o próximo por 20 min). O da volta não guarda nada. */
export function registrarAviso(estado: EstadoSemConexao, aviso: AvisoSemConexao, saiu: boolean, agora: number): EstadoSemConexao {
  const ep = estado.episodio;
  if (aviso !== "queda" || !ep || !saiu) return estado;
  return limpo({ ...estado, ultimoAvisoEm: agora, episodio: { ...ep, aviso: { ...ep.aviso, saiu: true } } });
}

// ── iFood: formato e leitura ────────────────────────────────────────────────

/**
 * "2026-10-12T18:30:00" no relógio da LOJA, sem fuso: é o formato que a pausa
 * do iFood recebe e o que o painel manda (StoreTopNav, `localIso`). O servidor
 * roda em UTC; mandar a hora dele marcaria a pausa três horas no futuro.
 */
export function horaLocalParaOIfood(ms: number, timeZone: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const p: Record<string, string> = {};
  for (const x of partes) if (x.type !== "literal") p[x.type] = x.value;
  const hora = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hora}:${p.minute}:${p.second}`;
}

/** O id da pausa que o iFood devolveu ao criar. */
export function idDaPausaCriada(data: unknown): string | null {
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

/** As pausas NOSSAS (pela descrição) na listagem de pausas de uma loja do iFood. */
export function idsDasNossasPausas(data: unknown): string[] {
  const lista: any[] = Array.isArray(data) ? data : Array.isArray((data as any)?.interruptions) ? (data as any).interruptions : [];
  return lista
    .filter((i) => i && String(i.description ?? "").trim() === DESCRICAO_DA_PAUSA && (typeof i.id === "string" || typeof i.id === "number"))
    .map((i) => String(i.id));
}

// ── Mensagens ───────────────────────────────────────────────────────────────

const hhmm = (ms: number, tz: string) =>
  new Date(ms).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

/** "7 min", "1 h", "1 h 20 min". */
export function duracaoEmTexto(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** " (Hakim Centro, Hakim Pizza)" — o nome de cada loja do iFood, quando há. */
function nomes(lista: PausaNoIfood[]): string {
  const n = lista.map((p) => (p.nome || "").trim()).filter(Boolean);
  return n.length > 0 ? ` (${n.join(", ")})` : "";
}

function listaEmTexto(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** O aviso da queda: o que aconteceu, desde quando, o que foi pausado, e que tudo volta sozinho. */
export function mensagemDeQueda(o: {
  loja: string;
  episodio: EpisodioSemConexao;
  tz: string;
  /** Canais ligados à loja que o FireHub não consegue pausar ("99Food", "Keeta", "Wabiz"). */
  semPausaAutomatica?: string[];
}): string {
  const ep = o.episodio;
  const pausadas = ep.ifood.filter((p) => p.situacao === "pausada");
  const jaFechadas = ep.ifood.filter((p) => p.situacao === "ja_fechada");
  const semAcesso = ep.ifood.filter((p) => p.situacao === "sem_acesso");
  const falharam = ep.ifood.filter((p) => p.situacao === "falhou" || p.situacao === "pendente");

  const pausado: string[] = [];
  if (ep.site === "fechado_por_nos") pausado.push(`• Site e robô do WhatsApp: o cliente vê "estamos com instabilidade, volte em alguns minutos"`);
  if (pausadas.length > 0) pausado.push(`• iFood${nomes(pausadas)}`);

  const linhas: Array<string | null> = [
    `📡 *${o.loja}: loja sem conexão*`,
    ``,
    `Desde as ${hhmm(ep.ultimoSinal, o.tz)} o FireHub não tem sinal do computador da loja (Assistente de Impressão) e não há nenhum painel aberto.`,
    pausado.length > 0 ? `Para nenhum cliente pedir sem ninguém ver o pedido, pausamos:` : null,
    ...pausado,
    jaFechadas.length > 0 ? `iFood${nomes(jaFechadas)} já estava fechado: não mexemos.` : null,
    falharam.length > 0 ? `iFood${nomes(falharam)}: não consegui pausar agora, tento de novo a cada 2 minutos.` : null,
    semAcesso.length > 0 ? `iFood${nomes(semAcesso)}: o FireHub não tem permissão para pausar. Se a queda demorar, pause pelo Gestor de Pedidos.` : null,
    o.semPausaAutomatica && o.semPausaAutomatica.length > 0
      ? `⚠️ ${listaEmTexto(o.semPausaAutomatica)} não ${o.semPausaAutomatica.length > 1 ? "têm" : "tem"} pausa automática: os pedidos de lá continuam entrando. Se a queda demorar, pause pelo app.`
      : null,
    ``,
    `Quando o Assistente ou um painel voltar a falar com o FireHub, *tudo é reaberto sozinho* e você recebe outro aviso.`,
    `Para desligar esta proteção: painel → Chatbot IA → Notificações.`,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}

/** O aviso da volta: a hora, o que foi reaberto e quanto tempo durou. */
export function mensagemDeVolta(o: {
  loja: string;
  episodio: EpisodioSemConexao;
  agora: number;
  tz: string;
  /** Lojas do iFood cuja pausa nossa NÃO saiu (tenta de novo). */
  ifoodQueFicou?: string[];
}): string {
  const ep = o.episodio;
  const ficou = new Set(o.ifoodQueFicou || []);
  // Só a pausa que sabemos que é nossa conta como "reaberta" ou "presa". A
  // faxina das que falharam é por garantia, e o dono não precisa saber dela.
  const reabertas = ep.ifood.filter((p) => p.situacao === "pausada" && !ficou.has(p.merchantId));
  const presas = ep.ifood.filter((p) => p.situacao === "pausada" && ficou.has(p.merchantId));

  const reaberto: string[] = [];
  if (ep.site === "fechado_por_nos") reaberto.push(`• Site e robô do WhatsApp`);
  if (reabertas.length > 0) reaberto.push(`• iFood${nomes(reabertas)}`);
  const fim = presas.map((p) => p.ate).filter((v): v is number => typeof v === "number");

  const linhas: Array<string | null> = [
    `✅ *${o.loja}: a conexão voltou*`,
    ``,
    `A loja voltou às ${hhmm(o.agora, o.tz)}, depois de ${duracaoEmTexto(o.agora - ep.ultimoSinal)} sem conexão (desde as ${hhmm(ep.ultimoSinal, o.tz)}).`,
    reaberto.length > 0 ? `Já reabrimos:` : null,
    ...reaberto,
    ep.site === "dono_mexeu" ? `O site ficou do jeito que você deixou.` : null,
    presas.length > 0
      ? `⚠️ iFood${nomes(presas)}: não consegui tirar a pausa agora, tento de novo a cada 2 minutos${fim.length > 0 ? ` (ela acaba sozinha às ${hhmm(Math.max(...fim), o.tz)})` : ""}.`
      : null,
    ``,
    `Confira no painel os pedidos que entraram nesse intervalo.`,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}

/** O horário acabou com a loja ainda sem conexão: o que foi desfeito. */
export function mensagemDeFimDoHorario(o: {
  loja: string;
  episodio: EpisodioSemConexao;
  agora: number;
  tz: string;
  ifoodQueFicou?: string[];
}): string {
  const ep = o.episodio;
  const ficou = new Set(o.ifoodQueFicou || []);
  const pausadas = ep.ifood.filter((p) => p.situacao === "pausada");
  const presas = pausadas.filter((p) => ficou.has(p.merchantId));
  const desfeito: string[] = [];
  if (pausadas.length > presas.length) desfeito.push(`a pausa do iFood`);
  if (ep.site === "fechado_por_nos") desfeito.push(`o site e o robô`);

  const linhas: Array<string | null> = [
    `🌙 *${o.loja}: horário encerrado ainda sem conexão*`,
    ``,
    `A loja ficou sem conexão desde as ${hhmm(ep.ultimoSinal, o.tz)} até o fim do horário (${duracaoEmTexto(o.agora - ep.ultimoSinal)}).`,
    desfeito.length > 0
      ? `Desfizemos o que tínhamos pausado (${listaEmTexto(desfeito)}): no próximo horário tudo começa normalmente.`
      : `No próximo horário tudo começa normalmente.`,
    presas.length > 0 ? `⚠️ iFood${nomes(presas)}: a pausa ainda não saiu, tento de novo a cada 2 minutos.` : null,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}
