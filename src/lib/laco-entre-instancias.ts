import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { idDaInstancia } from "./instancia";
import { executarDDL } from "./ddl-do-boot";
import { lembrarPor } from "./cache-curto";
import { aoMarcarNovidade, marcarNovidadeDeOutraInstancia } from "./novidade-da-loja";
import { devolverSinaisParaOBanco, tirarSinaisParaOBanco, type TipoDoSinal } from "./sinais-da-loja";
import {
  devolverAssistentesParaOBanco,
  tirarAssistentesParaOBanco,
  type AssistenteNoBanco,
} from "./dono-da-impressora";

/**
 * ── O LAÇO ENTRE INSTÂNCIAS: o que uma grava, a outra fica sabendo ──────────
 *
 * Com dois servidores atrás do balanceador (A e B), ou o container velho e o
 * novo juntos no deploy, três coisas que moravam só na memória do processo
 * precisam chegar ao outro:
 *
 *  1. NOVIDADE DA LOJA (lib/novidade-da-loja.ts). A fila do Assistente e o
 *     painel respondem "nada novo" pela memória enquanto nada da loja foi
 *     gravado. O pedido que entrou pelo webhook em A não marcava nada em B: a
 *     fila servida por B seguia "vazia" até o prazo de 15 s vencer — a comanda
 *     saía até 15 s atrasada. Aqui a marca vai para "NovidadeDaLoja" (uma
 *     linha por loja e instância) e cada instância lê a das outras a cada 1 s:
 *     o pedido gravado em A aparece na fila de B em ~1–2 s.
 *  2. SINAIS DA LOJA (lib/sinais-da-loja.ts): o painel aberto e o Assistente
 *     vistos por B contam para o cron da loja sem conexão que roda em A.
 *  3. ASSISTENTES DA LOJA (lib/dono-da-impressora.ts): as duas instâncias
 *     precisam escolher o MESMO dono de cada impressora, senão sai comanda em
 *     dobro.
 *
 * Um laço só por processo (globalThis), a cada 1 s. Custo por instância:
 *   • 1 SELECT por segundo (as novidades das outras instâncias — poucas linhas);
 *   • escritas agrupadas, só quando há o que gravar: a novidade no máximo 1
 *     por segundo (todas as lojas marcadas naquele segundo num INSERT só); os
 *     Assistentes no máximo 1 por segundo (cada um regravado a cada 10 s); os
 *     sinais da loja 1 a cada 5 s (cada loja e tipo regravado a cada 30 s — o
 *     cron que os lê roda de minuto em minuto). No pico (~60 lojas, ~80
 *     Assistentes): ~2,2 escritas/s;
 *   • a cada 10 min, a faxina das linhas velhas.
 * Nenhuma consulta nova em rota de polling: a rota só põe na fila em memória.
 *
 * O RELÓGIO: os servidores podem discordar entre si em segundos. O cursor da
 * leitura e as idades vêm só do relógio do banco (now()), e a marca que chega
 * de fora vale a partir do AGORA daqui (marcarNovidadeDeOutraInstancia) — ela
 * invalida o que esta instância guardou antes de saber, e não depende de
 * relógio nenhum concordar.
 *
 * BANCO FORA: cada parte do laço falha sozinha, com um log por minuto, e
 * nunca derruba nada. O que não foi gravado volta para a fila; enquanto isso a
 * novidade cai no prazo de 15 s (como antes deste laço), o cron só vê a
 * própria memória (como antes) e o dono da impressora sai da memória (como
 * antes).
 *
 * Tabelas próprias, por SQL cru (fora do schema.prisma), criadas no boot.
 */

/** Uma volta do laço: lê as novidades das outras e grava o que estiver na fila. */
export const INTERVALO_DO_LACO_MS = 1_000;
/** A marca da novidade espera isto para juntar as gravações do mesmo instante. */
const AGRUPAR_MS = 50;
/** Leitura com folga para trás: o INSERT de outra instância pode ter now() anterior e chegar ao commit depois. */
const FOLGA_DA_LEITURA_MS = 3_000;
/** Nunca lê mais que isto para trás (depois de o banco voltar): marca mais velha que o prazo de 15 s não muda nada. */
const JANELA_MAXIMA_S = 30;
/** Os sinais da loja vão ao banco a cada tantas voltas (5 s): o cron que os lê roda de minuto em minuto. */
const VOLTAS_DOS_SINAIS = 5;
/** Faxina das linhas velhas. */
const FAXINA_MS = 10 * 60_000;
/** "Todas as lojas" (gravação em lote, SQL direto). */
const TODAS = "*";

export const TABELAS_ENTRE_INSTANCIAS = [
  `CREATE TABLE IF NOT EXISTS "NovidadeDaLoja" ("lojaId" TEXT NOT NULL, "por" TEXT NOT NULL, "em" TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY ("lojaId", "por"))`,
  `CREATE TABLE IF NOT EXISTS "SinalDaLoja" ("lojaId" TEXT NOT NULL, "tipo" TEXT NOT NULL, "por" TEXT NOT NULL, "em" TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY ("lojaId", "tipo", "por"))`,
  `CREATE TABLE IF NOT EXISTS "AssistenteDaLoja" ("lojaId" TEXT NOT NULL, "chave" TEXT NOT NULL, "versao" TEXT NOT NULL DEFAULT '', "impressoras" TEXT NOT NULL DEFAULT '', "desde" TIMESTAMPTZ NOT NULL DEFAULT now(), "em" TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY ("lojaId", "chave"))`,
];

type Laco = {
  iniciado: boolean;
  timer: ReturnType<typeof setInterval> | null;
  rodando: boolean;
  /** Lojas marcadas aqui que ainda vão para o banco ("*" = todas). */
  novidades: Set<string>;
  timerDaNovidade: ReturnType<typeof setTimeout> | null;
  gravandoNovidades: boolean;
  ultimaGravacaoDeNovidade: number;
  /** Cursor da leitura, no relógio do BANCO (ms desde 1970). */
  cursorMs: number;
  /** "loja\0instância" → `em` (µs) já aplicado: a folga relê a mesma linha, e ela não vale duas vezes. */
  aplicadas: Map<string, string>;
  ultimaFaxina: number;
  voltas: number;
  ultimoLog: Map<string, number>;
};

const gl = globalThis as unknown as { __firehubLacoEntreInstancias?: Laco };
const L: Laco = (gl.__firehubLacoEntreInstancias ??= {
  iniciado: false,
  timer: null,
  rodando: false,
  novidades: new Set(),
  timerDaNovidade: null,
  gravandoNovidades: false,
  ultimaGravacaoDeNovidade: 0,
  cursorMs: 0,
  aplicadas: new Map(),
  ultimaFaxina: Date.now(),
  voltas: 0,
  ultimoLog: new Map(),
});

function logar(parte: string, err: unknown) {
  const agora = Date.now();
  if (agora - (L.ultimoLog.get(parte) ?? 0) < 60_000) return;
  L.ultimoLog.set(parte, agora);
  const msg = String((err as any)?.message || err).replace(/\s+/g, " ").slice(0, 160);
  console.warn(`[Entre instâncias] ${parte} falhou (${msg}) — sigo só com a memória deste servidor.`);
}

function semRelogio<T>(t: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): T {
  (t as { unref?: () => void }).unref?.();
  return t as T;
}

// ── 1. NOVIDADE DA LOJA ─────────────────────────────────────────────────────

function aoMarcar(lojaId: string | null) {
  if (L.novidades.size >= 2_000) {
    // Fila enorme (banco fora há muito tempo): "todas" diz o mesmo em uma linha.
    L.novidades.clear();
    L.novidades.add(TODAS);
  } else {
    L.novidades.add(lojaId ?? TODAS);
  }
  agendarGravacaoDasNovidades();
}

/** Grava logo (para a outra instância saber em ~1 s), mas no máximo uma vez por segundo. */
function agendarGravacaoDasNovidades() {
  if (L.timerDaNovidade || L.gravandoNovidades) return;
  const espera = Math.max(AGRUPAR_MS, L.ultimaGravacaoDeNovidade + INTERVALO_DO_LACO_MS - Date.now());
  L.timerDaNovidade = semRelogio(
    setTimeout(() => {
      L.timerDaNovidade = null;
      gravarNovidades().catch(() => undefined);
    }, espera),
  );
}

export async function gravarNovidades(): Promise<void> {
  if (L.gravandoNovidades || L.novidades.size === 0) return;
  L.gravandoNovidades = true;
  const lojas = [...L.novidades];
  L.novidades.clear();
  L.ultimaGravacaoDeNovidade = Date.now();
  try {
    await prisma.$executeRaw(Prisma.sql`/* fh:novidade-gravar */ INSERT INTO "NovidadeDaLoja" ("lojaId", "por", "em")
SELECT x, ${idDaInstancia()}, now() FROM unnest(${lojas}::text[]) AS x
ON CONFLICT ("lojaId", "por") DO UPDATE SET "em" = EXCLUDED."em"`);
  } catch (err) {
    for (const l of lojas) L.novidades.add(l);
    logar("gravar a novidade", err);
  } finally {
    L.gravandoNovidades = false;
    if (L.novidades.size > 0) agendarGravacaoDasNovidades();
  }
}

/** As novidades que as OUTRAS instâncias gravaram desde a última leitura, aplicadas na memória daqui. */
export async function lerNovidadesDasOutras(): Promise<number> {
  // O `em` volta em µs exatos (texto): é por ele que a mesma linha relida na
  // folga não é aplicada duas vezes. O cursor só filtra (com 3 s de folga),
  // então ms bastam.
  const desdeS = L.cursorMs > 0 ? (L.cursorMs - FOLGA_DA_LEITURA_MS) / 1000 : 0;
  const linhas = await prisma.$queryRaw<{ lojaId: string; por: string; us: string }[]>(Prisma.sql`/* fh:novidade-ler */
SELECT "lojaId", "por", ((extract(epoch FROM "em") * 1000000)::bigint)::text AS us
FROM "NovidadeDaLoja"
WHERE "por" <> ${idDaInstancia()}
  AND "em" > greatest(now() - interval '${Prisma.raw(String(JANELA_MAXIMA_S))} seconds', to_timestamp(${desdeS}::float8))`);
  let aplicou = 0;
  for (const l of linhas) {
    const us = String(l.us);
    const ms = Number(us) / 1000;
    if (ms > L.cursorMs) L.cursorMs = ms;
    const chave = `${l.lojaId}\u0000${l.por}`;
    if (L.aplicadas.get(chave) === us) continue;
    if (L.aplicadas.size >= 10_000) L.aplicadas.clear();
    L.aplicadas.set(chave, us);
    marcarNovidadeDeOutraInstancia(l.lojaId === TODAS ? null : l.lojaId);
    aplicou++;
  }
  return aplicou;
}

// ── 2. SINAIS DA LOJA ───────────────────────────────────────────────────────

export async function gravarSinais(): Promise<void> {
  const lista = tirarSinaisParaOBanco();
  if (lista.length === 0) return;
  try {
    await prisma.$executeRaw(Prisma.sql`/* fh:sinal-gravar */ INSERT INTO "SinalDaLoja" ("lojaId", "tipo", "por", "em")
SELECT l, t, ${idDaInstancia()}, now() FROM unnest(${lista.map((s) => s.lojaId)}::text[], ${lista.map((s) => s.tipo)}::text[]) AS x(l, t)
ON CONFLICT ("lojaId", "tipo", "por") DO UPDATE SET "em" = EXCLUDED."em"`);
  } catch (err) {
    devolverSinaisParaOBanco(lista);
    logar("gravar os sinais da loja", err);
  }
}

export type SinaisDeFora = { painelHaMs: number | null; assistenteHaMs: number | null };

/**
 * Para o cron da loja sem conexão: há quanto tempo (relógio do banco) alguma
 * OUTRA instância viu painel e Assistente de cada loja, nas últimas 6 h. A
 * própria instância fica de fora — a memória dela é mais fresca, e com um
 * servidor só o cron decide exatamente como antes. Falha = mapa vazio (só a
 * memória, como antes). Uma consulta por rodada do cron (1×/min).
 */
export async function sinaisDasOutrasInstancias(): Promise<Map<string, SinaisDeFora>> {
  const mapa = new Map<string, SinaisDeFora>();
  try {
    const linhas = await prisma.$queryRaw<{ lojaId: string; tipo: TipoDoSinal; ha: number }[]>(Prisma.sql`/* fh:sinal-ler */
SELECT "lojaId", "tipo", (extract(epoch FROM now() - max("em")) * 1000)::float8 AS ha
FROM "SinalDaLoja"
WHERE "por" <> ${idDaInstancia()} AND "em" > now() - interval '6 hours'
GROUP BY "lojaId", "tipo"`);
    for (const l of linhas) {
      const s = mapa.get(l.lojaId) ?? { painelHaMs: null, assistenteHaMs: null };
      const ha = Math.max(0, Number(l.ha));
      if (l.tipo === "painel") s.painelHaMs = ha;
      else if (l.tipo === "assistente") s.assistenteHaMs = ha;
      mapa.set(l.lojaId, s);
    }
  } catch (err) {
    logar("ler os sinais das outras instâncias", err);
  }
  return mapa;
}

// ── 3. ASSISTENTES DA LOJA ──────────────────────────────────────────────────

/** Nomes de impressora nunca têm quebra de linha: é o separador da coluna. */
const SEPARADOR = "\n";

export async function gravarAssistentes(): Promise<void> {
  const lista = tirarAssistentesParaOBanco();
  if (lista.length === 0) return;
  try {
    // "desde" recomeça quando a linha estava parada há mais de 30 s (o
    // Assistente sumiu e voltou) — a mesma regra da memória, que esquece quem
    // não consulta há 30 s.
    await prisma.$executeRaw(Prisma.sql`/* fh:assistente-gravar */ INSERT INTO "AssistenteDaLoja" ("lojaId", "chave", "versao", "impressoras", "desde", "em")
SELECT l, c, v, i, now(), now()
FROM unnest(${lista.map((a) => a.lojaId)}::text[], ${lista.map((a) => a.chave)}::text[], ${lista.map((a) => a.versao)}::text[], ${lista.map((a) => a.impressoras.join(SEPARADOR))}::text[]) AS x(l, c, v, i)
ON CONFLICT ("lojaId", "chave") DO UPDATE SET
  "desde" = CASE WHEN "AssistenteDaLoja"."em" < now() - interval '30 seconds' THEN EXCLUDED."desde" ELSE "AssistenteDaLoja"."desde" END,
  "em" = EXCLUDED."em", "versao" = EXCLUDED."versao", "impressoras" = EXCLUDED."impressoras"`);
  } catch (err) {
    devolverAssistentesParaOBanco(lista);
    logar("gravar os Assistentes", err);
  }
}

/**
 * Os Assistentes da loja que alguma instância viu nos últimos 40 s. Só a fila
 * COM trabalho pergunta (api/store/print-queue), e a resposta vale 2 s — a
 * fila vazia, a de toda hora, nunca chega aqui. Falha = lista vazia (só a
 * memória decide, como antes).
 */
export function assistentesNoBanco(lojaId: string): Promise<AssistenteNoBanco[]> {
  return lembrarPor(`assistentes-no-banco:${lojaId}`, 2_000, async () => {
    try {
      const linhas = await prisma.$queryRaw<{ chave: string; versao: string; impressoras: string; desdeHaMs: number; vistoHaMs: number }[]>(Prisma.sql`/* fh:assistente-ler */
SELECT "chave", "versao", "impressoras",
  (extract(epoch FROM now() - "desde") * 1000)::float8 AS "desdeHaMs",
  (extract(epoch FROM now() - "em") * 1000)::float8 AS "vistoHaMs"
FROM "AssistenteDaLoja"
WHERE "lojaId" = ${lojaId} AND "em" > now() - interval '40 seconds'`);
      return linhas.map((l) => ({
        chave: l.chave,
        versao: l.versao,
        impressoras: String(l.impressoras || "").split(SEPARADOR).filter(Boolean),
        desdeHaMs: Number(l.desdeHaMs),
        vistoHaMs: Number(l.vistoHaMs),
      }));
    } catch (err) {
      logar("ler os Assistentes", err);
      return [];
    }
  });
}

// ── O LAÇO ──────────────────────────────────────────────────────────────────

async function faxina() {
  await prisma.$executeRawUnsafe(`/* fh:entre-instancias-faxina */ DELETE FROM "NovidadeDaLoja" WHERE "em" < now() - interval '10 minutes'`);
  await prisma.$executeRawUnsafe(`/* fh:entre-instancias-faxina */ DELETE FROM "SinalDaLoja" WHERE "em" < now() - interval '6 hours'`);
  await prisma.$executeRawUnsafe(`/* fh:entre-instancias-faxina */ DELETE FROM "AssistenteDaLoja" WHERE "em" < now() - interval '1 day'`);
}

/** Uma volta: grava o que está na fila, lê as novidades das outras. Nunca lança. */
export async function voltaDoLaco(): Promise<void> {
  if (L.rodando) return;
  L.rodando = true;
  try {
    await gravarNovidades().catch((e) => logar("gravar a novidade", e));
    if (L.voltas++ % VOLTAS_DOS_SINAIS === 0) await gravarSinais().catch((e) => logar("gravar os sinais da loja", e));
    await gravarAssistentes().catch((e) => logar("gravar os Assistentes", e));
    await lerNovidadesDasOutras().catch((e) => logar("ler a novidade das outras instâncias", e));
    if (Date.now() - L.ultimaFaxina > FAXINA_MS) {
      L.ultimaFaxina = Date.now();
      await faxina().catch((e) => logar("faxina", e));
    }
  } finally {
    L.rodando = false;
  }
}

/**
 * Liga o laço deste processo (src/instrumentation.ts, no boot). Uma vez só por
 * processo; chamar de novo não faz nada. Nunca lança: sem as tabelas, cada
 * volta falha em silêncio (log por minuto) e tudo segue como antes.
 */
export async function iniciarLacoEntreInstancias(): Promise<void> {
  if (L.iniciado) return;
  L.iniciado = true;
  try {
    await executarDDL("entre-instancias", TABELAS_ENTRE_INSTANCIAS);
  } catch (err: any) {
    console.error(`[Entre instâncias] 🛑 Tabelas não criadas (${err?.message}) — cada servidor segue só com a própria memória.`);
  }
  aoMarcarNovidade(aoMarcar);
  L.timer = semRelogio(setInterval(() => void voltaDoLaco(), INTERVALO_DO_LACO_MS));
}

/** Só para teste: desliga o laço (as filas em memória ficam). */
export function pararLacoEntreInstancias(): void {
  if (L.timer) clearInterval(L.timer);
  if (L.timerDaNovidade) clearTimeout(L.timerDaNovidade);
  L.timer = null;
  L.timerDaNovidade = null;
  L.iniciado = false;
  aoMarcarNovidade(undefined);
}
