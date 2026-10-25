import { prisma } from "./prisma";
import { faxinaDeTempoEmTempo, garantirTabelasDoRobo } from "./robo-no-banco";

/**
 * A pausa do robô numa conversa — no banco, com a memória do processo na frente.
 *
 * ── Por que é um módulo ─────────────────────────────────────────────────────
 *
 * A pausa vivia num `Map` privado do webhook (`cooldownCache`, chave `paused_`).
 * A rota do painel que encerra o atendimento humano ("Encerrar & Reativar
 * Robô") não tinha como alcançá-lo: limpava a marca do banco, dizia ao cliente
 * "nosso robô continuará te ajudando por aqui" — e o robô seguia mudo por até
 * 12 horas, porque a pausa em memória é conferida antes de tudo.
 *
 * ── Por que está no banco (tabela "PausaDoRobo", lib/robo-no-banco.ts) ──────
 *
 * O mesmo defeito, agora entre SERVIDORES: com dois atrás do balanceador, o
 * webhook fica fixo em A e o painel cai em qualquer um. O lojista clicava
 * "devolver ao robô" em B, B apagava a pausa da memória DELE — e A seguia
 * com o robô mudo. Quem pausa grava no banco; quem confere lê do banco.
 *
 * A memória continua aqui por três motivos:
 *  - a pausa entra na memória NA HORA (sem esperar o banco): quem pausa "antes
 *    dos awaits" — o webhook, para uma resposta da IA já em andamento conferir
 *    a pausa antes de enviar — continua sendo visto por quem confere depois.
 *    Quem confere espera a gravação pendente da mesma conversa terminar;
 *  - leitura repetida em poucos segundos (o webhook confere a mesma conversa
 *    duas, três vezes por mensagem) sai de um cache de 2 s, que a gravação
 *    deste processo apaga na hora;
 *  - banco fora, ou gravação que falhou: vale a memória, como antes.
 *
 * ── Esta NÃO é a trava do atendimento humano ────────────────────────────────
 *
 * A trava "conversa com a equipe" é a `degradedAt` em lib/loop-guard.ts, e
 * quem pausa uma conversa tem que gravar AS DUAS: esta responde antes de
 * tudo no webhook, aquela é a que o anti-loop e o painel leem. O caminho
 * "cliente pediu atendente" só gravava esta — houve noite com quinze deploys,
 * e cada um devolvia o robô à conversa de quem estava esperando uma pessoa.
 *
 * Guardada em `globalThis` porque o Next carrega cada rota num bundle próprio:
 * uma variável de módulo seria uma por rota, e é exatamente o defeito acima.
 */

export const PAUSA_PADRAO_MS = 12 * 60 * 60 * 1000;
/** Quanto uma leitura do banco vale para a mesma conversa. */
const CACHE_MS = 2_000;

type Local = {
  /** Até quando (ms). 0 = retomada. */
  ate: number;
  /** A gravação no banco deu certo? false = o banco não sabe: vale esta. */
  gravou: boolean;
};

type Estado = {
  locais: Map<string, Local>;
  /** A gravação em andamento de cada conversa, em ordem. */
  pendentes: Map<string, Promise<void>>;
  lidas: Map<string, { ate: number | null; em: number }>;
};

function estado(): Estado {
  const g = globalThis as any;
  if (!g.__firehubPausasDoRobo || !(g.__firehubPausasDoRobo.locais instanceof Map)) {
    g.__firehubPausasDoRobo = { locais: new Map(), pendentes: new Map(), lidas: new Map() };
  }
  return g.__firehubPausasDoRobo as Estado;
}

const chave = (userId: string, remoteJid: string) => `${userId}_${remoteJid}`;

/** Grava no banco, uma conversa de cada vez e na ordem das chamadas. Nunca lança. */
function gravar(k: string, sql: () => Promise<unknown>, depois: (ok: boolean) => void): Promise<void> {
  const e = estado();
  e.lidas.delete(k);
  const anterior = e.pendentes.get(k) ?? Promise.resolve();
  const esta = anterior.then(async () => {
    let ok = false;
    try {
      if (await garantirTabelasDoRobo()) {
        await sql();
        ok = true;
      }
    } catch (err: any) {
      console.warn(`[Pausa do robô] não gravei no banco (${String(err?.message || err).slice(0, 120)}) — vale a memória deste servidor.`);
    }
    e.lidas.delete(k);
    depois(ok);
  });
  e.pendentes.set(k, esta);
  esta.finally(() => {
    if (e.pendentes.get(k) === esta) e.pendentes.delete(k);
  });
  return esta;
}

/**
 * Cala o robô nesta conversa por `ms`. A memória muda na hora; a promessa
 * resolve quando o banco gravou (ou desistiu). Nunca rejeita: quem não quer
 * esperar pode ignorá-la.
 */
export function pausarRobo(userId: string, remoteJid: string, ms: number = PAUSA_PADRAO_MS, agora: number = Date.now()): Promise<void> {
  const k = chave(userId, remoteJid);
  const ate = agora + ms;
  const local: Local = { ate, gravou: false };
  estado().locais.set(k, local);
  return gravar(
    k,
    () => prisma.$executeRaw`
      INSERT INTO "PausaDoRobo" ("userId", "remoteJid", "ate") VALUES (${userId}, ${remoteJid}, ${new Date(ate)})
      ON CONFLICT ("userId", "remoteJid") DO UPDATE SET "ate" = EXCLUDED."ate"`,
    (ok) => {
      local.gravou = ok;
      if (ok) {
        faxinaDeTempoEmTempo("pausas", 60 * 60_000, () =>
          prisma.$executeRaw`DELETE FROM "PausaDoRobo" WHERE "ate" < now() - interval '1 day'`,
        );
      }
    },
  );
}

/** Devolve a conversa ao robô. Mesmo contrato de `pausarRobo`. */
export function retomarRobo(userId: string, remoteJid: string): Promise<void> {
  const k = chave(userId, remoteJid);
  const e = estado();
  const local: Local = { ate: 0, gravou: false };
  e.locais.set(k, local);
  return gravar(
    k,
    () => prisma.$executeRaw`DELETE FROM "PausaDoRobo" WHERE "userId" = ${userId} AND "remoteJid" = ${remoteJid}`,
    (ok) => {
      // Gravou: a memória não tem mais nada a dizer. Falhou: fica a retomada
      // na memória, senão a pausa velha do banco voltaria a valer aqui.
      if (ok && e.locais.get(k) === local) e.locais.delete(k);
    },
  );
}

/** A pausa desta conversa no banco: ms, ou null se não há. Lança se o banco falhar. */
async function lerDoBanco(userId: string, remoteJid: string): Promise<number | null> {
  const linhas = await prisma.$queryRaw<{ ate: Date }[]>`
    SELECT "ate" FROM "PausaDoRobo" WHERE "userId" = ${userId} AND "remoteJid" = ${remoteJid}`;
  return linhas.length ? new Date(linhas[0].ate).getTime() : null;
}

function pausadoNaMemoria(k: string, agora: number): boolean {
  const locais = estado().locais;
  const local = locais.get(k);
  if (!local) return false;
  if (agora >= local.ate) {
    if (local.gravou || local.ate === 0) locais.delete(k);
    return false;
  }
  return true;
}

/** O robô está quieto nesta conversa (em qualquer servidor)? Nunca lança. */
export async function roboEstaPausado(userId: string, remoteJid: string, agora: number = Date.now()): Promise<boolean> {
  const k = chave(userId, remoteJid);
  const e = estado();
  const pendente = e.pendentes.get(k);
  if (pendente) await pendente;

  const local = e.locais.get(k);
  if (local && !local.gravou) return pausadoNaMemoria(k, agora);
  if (!(await garantirTabelasDoRobo())) return pausadoNaMemoria(k, agora);

  const lida = e.lidas.get(k);
  let ate: number | null;
  if (lida && Date.now() - lida.em < CACHE_MS) {
    ate = lida.ate;
  } else {
    try {
      const em = Date.now();
      ate = await lerDoBanco(userId, remoteJid);
      // Gravação deste processo no meio da leitura: a lida já nasceu velha.
      if (!e.pendentes.has(k)) e.lidas.set(k, { ate, em });
      if (e.lidas.size > 5_000) e.lidas.clear();
    } catch {
      return pausadoNaMemoria(k, agora);
    }
  }
  return ate !== null && ate > agora;
}

/**
 * As conversas pausadas desta loja, numa consulta só — para a lista do painel
 * não fazer uma consulta por conversa. Nunca lança.
 */
export async function conversasPausadas(userId: string, agora: number = Date.now()): Promise<Set<string>> {
  const e = estado();
  const prefixo = `${userId}_`;
  const daMemoria = () => {
    const jids = new Set<string>();
    for (const k of [...e.locais.keys()]) {
      if (k.startsWith(prefixo) && pausadoNaMemoria(k, agora)) jids.add(k.slice(prefixo.length));
    }
    return jids;
  };
  if (!(await garantirTabelasDoRobo())) return daMemoria();
  let jids: Set<string>;
  try {
    const linhas = await prisma.$queryRaw<{ remoteJid: string }[]>`
      SELECT "remoteJid" FROM "PausaDoRobo" WHERE "userId" = ${userId} AND "ate" > ${new Date(agora)}`;
    jids = new Set(linhas.map((l) => l.remoteJid));
  } catch {
    return daMemoria();
  }
  // O que o banco ainda não sabe (gravação pendente ou que falhou) vale pela memória.
  for (const [k, local] of e.locais) {
    if (!k.startsWith(prefixo) || (local.gravou && !e.pendentes.has(k))) continue;
    const jid = k.slice(prefixo.length);
    if (local.ate > agora) jids.add(jid);
    else jids.delete(jid);
  }
  return jids;
}
