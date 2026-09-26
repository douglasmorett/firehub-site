/**
 * A loja abre e fecha sozinha no horário — e o dono fica sabendo quando ela
 * devia estar vendendo e não está.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 25/09/2026 a Hakim Centro passou a noite sem pedido: ninguém ligou o
 * "Site aberto" do painel, e com o interruptor desligado o site recusa pedido
 * e o robô diz que a loja está fechada (lib/loja-aberta.ts, `estadoDaLoja`),
 * mesmo dentro do horário. O dono só descobriu pelo movimento.
 *
 * Duas respostas, as duas decididas aqui e executadas pelo cron
 * (api/cron/abertura-da-loja):
 *
 *   1. ABERTURA AUTOMÁTICA (User.aberturaAutomatica, Minha Loja → Horários):
 *      liga o interruptor quando o turno começa e desliga quando termina.
 *   2. AVISOS no WhatsApp do dono, pelo robô (lib/alertas-do-dono.ts): loja
 *      fechada no horário, caixa não aberto e loja do iFood fechada.
 *
 * ── Ela age na VIRADA do turno, não o tempo todo ────────────────────────────
 *
 * Abrir "sempre que estiver no horário" desfaria toda pausa: a cozinha estoura,
 * o atendente fecha o site, e um minuto depois o cron reabriria. Então a
 * abertura acontece UMA vez por turno (carimbo `abriu` = chave do turno) e o
 * fechamento uma vez depois dele (`fechou`). Quem fecha no meio do turno fica
 * fechado até o próximo; quem abre fora do horário fica aberto até o próximo
 * fim de turno (fora do horário o site já não vende, pelo `estadoDaLoja`).
 *
 * Arquivo sem banco e sem relógio próprio: o cron entrega o estado e o
 * `agora`, daqui saem decisões. Teste: scripts/teste-abertura-da-loja.ts.
 */
import type { TurnoDaLoja } from "@/lib/loja-aberta";

/** Carimbos gravados em User.aberturaEstado. */
export type EstadoDaAbertura = {
  /** Chave do turno em que a abertura automática já agiu. */
  abriu?: string;
  /** Chave do turno cujo fechamento já foi feito. */
  fechou?: string;
  /** Desde quando (ms) a loja está vista fechada DENTRO do turno. */
  fechadaDesde?: number;
  /** Aviso por tipo: `turno` = já avisado neste turno; `tentouEm` = última tentativa que não saiu. */
  avisos?: Partial<Record<"lojaFechada" | "caixa", { turno?: string; tentouEm?: number }>>;
  /** Loja do iFood, por merchantId. */
  ifood?: Record<string, RegistroDoIfood>;
};

export type RegistroDoIfood = {
  consultadoEm?: number;
  /** Primeira consulta que a viu fechada (e todas as seguintes, até abrir). */
  fechadoDesde?: number;
  /** `fechadoDesde` do fechamento já avisado: um aviso por fechamento. */
  avisadoDesde?: number;
  tentouEm?: number;
};

/** Minutos depois de o turno começar antes de cobrar loja aberta e caixa. */
export const CARENCIA_MIN = 15;
/** Loja vista fechada por este tempo antes do aviso: fechar e reabrir em seguida não é problema. */
export const FECHADA_POR_MS = 10 * 60_000;
/** Nos últimos minutos do turno não se avisa: não há o que salvar. */
export const FIM_DO_TURNO_MIN = 10;
/** Aviso que não saiu (robô caído) tenta de novo depois disto. */
export const REPETIR_TENTATIVA_MS = 10 * 60_000;
/** Consulta ao iFood por loja. */
export const CONSULTA_IFOOD_MS = 5 * 60_000;
/** iFood fechado por este tempo (duas consultas) antes do aviso. */
export const IFOOD_FECHADO_POR_MS = 4 * 60_000;

// ── 1. ABERTURA AUTOMÁTICA ──────────────────────────────────────────────────

/**
 * O que fazer com o interruptor agora. `storeOpen` ausente = não mexer.
 *
 * `emPausa` é a pausa programada (férias) de hoje: ela não abre, e o turno não
 * é carimbado — se a pausa acabar no meio do dia, o turno ainda abre.
 */
export function decidirAbertura(o: {
  turno: TurnoDaLoja | null;
  storeOpen: boolean;
  emPausa: boolean;
  estado: EstadoDaAbertura;
}): { storeOpen?: boolean; estado: EstadoDaAbertura; acao: "abriu" | "fechou" | null } {
  const { turno, storeOpen, emPausa, estado } = o;
  if (turno) {
    if (emPausa || estado.abriu === turno.chave) return { estado, acao: null };
    return {
      storeOpen: storeOpen ? undefined : true,
      estado: { ...estado, abriu: turno.chave },
      acao: storeOpen ? null : "abriu",
    };
  }
  // Fora de turno: fecha o último turno que a abertura abriu, uma vez só.
  if (estado.abriu && estado.fechou !== estado.abriu) {
    return {
      storeOpen: storeOpen ? false : undefined,
      estado: { ...estado, fechou: estado.abriu },
      acao: storeOpen ? "fechou" : null,
    };
  }
  return { estado, acao: null };
}

// ── 2. AVISOS: LOJA FECHADA E CAIXA ─────────────────────────────────────────

export type AvisoDoTurno = "lojaFechada" | "caixa";

/**
 * Quais avisos do turno estão devidos agora, e o estado com `fechadaDesde`
 * atualizado. O carimbo de "avisado" é do chamador, depois que o aviso sai
 * (`marcarAviso`) — aviso que não saiu continua devido.
 */
export function avisosDevidos(o: {
  turno: TurnoDaLoja | null;
  agora: number;
  storeOpen: boolean;
  emPausa: boolean;
  caixaAberto: boolean;
  estado: EstadoDaAbertura;
}): { devidos: AvisoDoTurno[]; estado: EstadoDaAbertura } {
  const { turno, agora, storeOpen, emPausa, caixaAberto } = o;
  let estado = o.estado;

  if (!turno) {
    if (estado.fechadaDesde === undefined) return { devidos: [], estado };
    const { fechadaDesde: _, ...resto } = estado;
    return { devidos: [], estado: resto };
  }

  // Fechada de propósito (pausa programada) não é "devia estar aberta".
  const fechada = !storeOpen && !emPausa;
  if (fechada && estado.fechadaDesde === undefined) estado = { ...estado, fechadaDesde: agora };
  if (!fechada && estado.fechadaDesde !== undefined) {
    const { fechadaDesde: _, ...resto } = estado;
    estado = resto;
  }

  const dentroDoPrazo = turno.minutosDesdeAbertura >= CARENCIA_MIN && turno.minutosAteFechar > FIM_DO_TURNO_MIN;
  if (!dentroDoPrazo) return { devidos: [], estado };

  const pode = (tipo: AvisoDoTurno) => {
    const a = estado.avisos?.[tipo];
    if (a?.turno === turno.chave) return false;
    return !(a?.tentouEm && agora - a.tentouEm < REPETIR_TENTATIVA_MS);
  };

  const devidos: AvisoDoTurno[] = [];
  if (fechada && agora - (estado.fechadaDesde ?? agora) >= FECHADA_POR_MS && pode("lojaFechada")) devidos.push("lojaFechada");
  if (!caixaAberto && pode("caixa")) devidos.push("caixa");
  return { devidos, estado };
}

/** Carimba o aviso: `saiu` = avisado neste turno; senão, só a tentativa. */
export function marcarAviso(estado: EstadoDaAbertura, tipo: AvisoDoTurno, turno: TurnoDaLoja, saiu: boolean, agora: number): EstadoDaAbertura {
  const avisos = { ...(estado.avisos || {}) };
  avisos[tipo] = saiu ? { turno: turno.chave } : { ...(avisos[tipo] || {}), tentouEm: agora };
  return { ...estado, avisos };
}

// ── 3. AVISO: LOJA DO IFOOD FECHADA ─────────────────────────────────────────

/** O iFood deve ser consultado agora? Só dentro do turno, na janela dos avisos, a cada 5 min. */
export function consultarIfoodAgora(turno: TurnoDaLoja | null, registro: RegistroDoIfood | undefined, agora: number): boolean {
  if (!turno) return false;
  if (turno.minutosDesdeAbertura < CARENCIA_MIN || turno.minutosAteFechar <= FIM_DO_TURNO_MIN) return false;
  return !registro?.consultadoEm || agora - registro.consultadoEm >= CONSULTA_IFOOD_MS - 30_000;
}

/**
 * Leitura do iFood → registro novo e se é hora de avisar.
 *
 * `aberta` null = não deu para saber (API fora, token recusado): não mexe em
 * nada — "não sei" não é "fechada". O aviso só sai com a loja vista fechada em
 * duas consultas seguidas, e uma vez por fechamento.
 */
export function decidirIfood(o: { aberta: boolean | null; agora: number; registro?: RegistroDoIfood }): { avisar: boolean; registro: RegistroDoIfood } {
  const { aberta, agora } = o;
  const registro: RegistroDoIfood = { ...(o.registro || {}) };
  if (aberta === null) return { avisar: false, registro };
  registro.consultadoEm = agora;
  if (aberta) {
    delete registro.fechadoDesde;
    delete registro.avisadoDesde;
    delete registro.tentouEm;
    return { avisar: false, registro };
  }
  if (registro.fechadoDesde === undefined) registro.fechadoDesde = agora;
  const jaAvisado = registro.avisadoDesde === registro.fechadoDesde;
  const esperando = registro.tentouEm !== undefined && agora - registro.tentouEm < REPETIR_TENTATIVA_MS;
  const avisar = !jaAvisado && !esperando && agora - registro.fechadoDesde >= IFOOD_FECHADO_POR_MS;
  return { avisar, registro };
}

/** Fora de turno o registro do iFood recomeça: o fechamento de ontem não vira aviso hoje. */
export function limparIfoodForaDoTurno(estado: EstadoDaAbertura): EstadoDaAbertura {
  if (!estado.ifood || Object.keys(estado.ifood).length === 0) return estado;
  const { ifood: _, ...resto } = estado;
  return resto;
}

// ── MENSAGENS ───────────────────────────────────────────────────────────────

const hhmm = (ms: number, tz: string) =>
  new Date(ms).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

export function mensagemLojaFechada(o: { loja: string; turno: TurnoDaLoja; fechadaDesde: number; tz: string; automatica: boolean }): string {
  return [
    `⚠️ *${o.loja}: loja FECHADA no horário*`,
    ``,
    `O horário de hoje é das ${o.turno.abre} às ${o.turno.fecha}, e a loja está fechada no FireHub desde as ${hhmm(o.fechadaDesde, o.tz)}.`,
    `Site, robô do WhatsApp e cardápio *não estão recebendo pedido*.`,
    ``,
    `Para abrir: botão "Site aberto" no topo do painel.`,
    o.automatica
      ? `A abertura automática está ligada: se alguém fechou de propósito, ela só volta a abrir no próximo turno.`
      : `Para não depender disso, ligue "Abrir e fechar sozinha no horário" em Minha Loja → Horários.`,
  ].join("\n");
}

export function mensagemCaixa(o: { loja: string; turno: TurnoDaLoja }): string {
  return [
    `💰 *${o.loja}: caixa não foi aberto*`,
    ``,
    `A loja abriu às ${o.turno.abre} e o caixa ainda está fechado.`,
    `Sem caixa aberto, o dinheiro do dia não entra no fechamento. Abra em Caixa, no painel.`,
  ].join("\n");
}

export function mensagemIfoodFechado(o: { loja: string; lojaIfood: string | null; turno: TurnoDaLoja; fechadoDesde: number; tz: string; motivo: string | null }): string {
  return [
    `🔴 *${o.loja}: loja FECHADA no iFood*`,
    ``,
    `${o.lojaIfood ? `"${o.lojaIfood}" está` : "A loja está"} fechada no iFood desde as ${hhmm(o.fechadoDesde, o.tz)}, dentro do seu horário (${o.turno.abre} às ${o.turno.fecha}).`,
    o.motivo ? `O iFood diz: ${o.motivo}.` : null,
    `Pedido do iFood *não está entrando*.`,
    ``,
    `Confira no Gestor de Pedidos ou no Portal do Parceiro do iFood (pausa, horário, ou loja desconectada).`,
  ].filter((l) => l !== null).join("\n");
}
