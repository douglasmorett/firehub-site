/**
 * lib/jotaja-instavel.ts — quando a API do JotaJá cai, ninguém fica sem saber.
 *
 * 24/10/2026, Duga Burguer: das 18:49 às 19:47 a API do JotaJá respondeu 500
 * em parte das chamadas (fila de eventos e confirmação de pedido). Três
 * pedidos feitos nesse período (#3, #9 e #14 do portal) nunca entraram na fila
 * do Open Delivery — nem depois que ela voltou — e a loja só percebeu olhando
 * o portal, duas horas depois. Do lado do FireHub não há como importar um
 * pedido que o JotaJá não entrega (a API não tem listagem; ver cron/jotaja-poll).
 *
 * O que dá para garantir é que a queda não passe em silêncio:
 * - fila falhando em 2 rodadas seguidas do cron (1/min) → WhatsApp para o dono
 *   da loja (lib/alertas-do-dono.ts) e para o FireHub (lib/server-monitor.ts),
 *   e faixa no painel de pedidos (AvisoParceiroInstavel, por /api/store/avisos);
 * - quando volta → WhatsApp dizendo o período em que pedido pode ter ficado só
 *   no portal;
 * - confirmação / preparo / despacho / entrega que o JotaJá recusou com 5xx
 *   fica guardada e o cron reenvia a cada minuto, para o pedido não ficar
 *   "aguardando aceite" no portal deles enquanto já está na cozinha.
 *
 * Tabelas criadas no 1º uso por SQL cru, fora do schema.prisma, como a
 * JotajaLigacao (lib/jotaja-api.ts). Hora em milissegundos (BIGINT).
 * As regras puras estão em lib/jotaja-instavel-regras.ts (teste:
 * scripts/teste-jotaja-instavel.ts).
 */
import { prisma } from "./prisma";
import {
  type AcaoPendente,
  CANAL,
  deveAvisarQueda,
  FALHAS_PARA_AVISAR,
  separarAcoes,
  textoDaQueda,
  textoDaVolta,
} from "./jotaja-instavel-regras";

export * from "./jotaja-instavel-regras";

// ── Banco ───────────────────────────────────────────────────────────────────

let tabelasOk = false;

async function garantirTabelas(): Promise<void> {
  if (tabelasOk) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "JotajaFalha" (
      "lojaId" TEXT PRIMARY KEY,
      "desdeMs" BIGINT NOT NULL,
      "falhas" INTEGER NOT NULL DEFAULT 1,
      "ultimoErro" TEXT,
      "avisadoEmMs" BIGINT
    )`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "JotajaAcaoPendente" (
      "id" SERIAL PRIMARY KEY,
      "lojaId" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "rotulo" TEXT NOT NULL,
      "tentativas" INTEGER NOT NULL DEFAULT 0,
      "criadoEmMs" BIGINT NOT NULL,
      UNIQUE ("lojaId", "orderId", "path")
    )`);
  tabelasOk = true;
}

async function fusoDaLoja(lojaId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } }).catch(() => null);
  return u?.storeTimezone || "America/Sao_Paulo";
}

/** O dono pelo robô da loja; o FireHub pelo monitor. Nunca lança. */
async function avisar(lojaId: string, nomeDaLoja: string, chave: "queda" | "volta", texto: string): Promise<void> {
  const [{ avisarDono }, { alertarParceiroForaDoAr }] = await Promise.all([import("./alertas-do-dono"), import("./server-monitor")]);
  await Promise.all([
    avisarDono(lojaId, "parceiro_fora_do_ar", texto).catch(() => false),
    alertarParceiroForaDoAr(CANAL, nomeDaLoja, chave, texto).catch(() => {}),
  ]);
}

// Loja que acabou de ser conferida sem falha: não repete o DELETE a cada minuto.
const semFalhaAte = new Map<string, number>();
const SEM_FALHA_POR_MS = 10 * 60_000;

/** A leitura da fila desta loja falhou nesta rodada. Avisa na 2ª seguida. */
export async function registrarFalhaDaFila(lojaId: string, nomeDaLoja: string, erro: string): Promise<void> {
  semFalhaAte.delete(lojaId);
  try {
    await garantirTabelas();
    const agora = Date.now();
    const [l] = await prisma.$queryRaw<{ desdeMs: bigint; falhas: number; avisadoEmMs: bigint | null }[]>`
      INSERT INTO "JotajaFalha" ("lojaId", "desdeMs", "falhas", "ultimoErro")
      VALUES (${lojaId}, ${BigInt(agora)}, 1, ${erro.slice(0, 300)})
      ON CONFLICT ("lojaId") DO UPDATE SET "falhas" = "JotajaFalha"."falhas" + 1, "ultimoErro" = EXCLUDED."ultimoErro"
      RETURNING "desdeMs", "falhas", "avisadoEmMs"`;
    if (!l || !deveAvisarQueda(Number(l.falhas), l.avisadoEmMs == null ? null : Number(l.avisadoEmMs))) return;
    await prisma.$executeRaw`UPDATE "JotajaFalha" SET "avisadoEmMs" = ${BigInt(agora)} WHERE "lojaId" = ${lojaId}`;
    console.error(`[JotaJá instável] ${nomeDaLoja}: fila falhando há ${Number(l.falhas)} rodadas (${erro}) — avisando`);
    await avisar(lojaId, nomeDaLoja, "queda", textoDaQueda(nomeDaLoja, Number(l.desdeMs), erro, await fusoDaLoja(lojaId)));
  } catch (e: any) {
    console.error(`[JotaJá instável] não registrei a falha de ${nomeDaLoja}:`, e?.message);
  }
}

/** A fila desta loja respondeu. Se tinha avisado a queda, avisa a volta. */
export async function registrarVoltaDaFila(lojaId: string, nomeDaLoja: string): Promise<void> {
  if ((semFalhaAte.get(lojaId) ?? 0) > Date.now()) return;
  try {
    await garantirTabelas();
    const [l] = await prisma.$queryRaw<{ desdeMs: bigint; avisadoEmMs: bigint | null }[]>`
      DELETE FROM "JotajaFalha" WHERE "lojaId" = ${lojaId} RETURNING "desdeMs", "avisadoEmMs"`;
    semFalhaAte.set(lojaId, Date.now() + SEM_FALHA_POR_MS);
    if (!l || l.avisadoEmMs == null) return;
    console.log(`[JotaJá instável] ${nomeDaLoja}: a fila voltou — avisando`);
    await avisar(lojaId, nomeDaLoja, "volta", textoDaVolta(nomeDaLoja, Number(l.desdeMs), Date.now(), await fusoDaLoja(lojaId)));
  } catch (e: any) {
    console.error(`[JotaJá instável] não registrei a volta de ${nomeDaLoja}:`, e?.message);
  }
}

/** Para a faixa do painel: o parceiro está caído nesta loja? */
export async function parceiroInstavel(
  lojaId: string,
): Promise<{ canal: string; desde: string; ultimoErro: string | null } | null> {
  await garantirTabelas();
  const [l] = await prisma.$queryRaw<{ desdeMs: bigint; falhas: number; ultimoErro: string | null }[]>`
    SELECT "desdeMs", "falhas", "ultimoErro" FROM "JotajaFalha" WHERE "lojaId" = ${lojaId}`;
  if (!l || Number(l.falhas) < FALHAS_PARA_AVISAR) return null;
  return { canal: CANAL, desde: new Date(Number(l.desdeMs)).toISOString(), ultimoErro: l.ultimoErro };
}

/** O JotaJá recusou (5xx / rede) uma ação do pedido: o cron reenvia. Nunca lança. */
export async function guardarAcaoPendente(lojaId: string, orderId: string, path: string, rotulo: string): Promise<void> {
  try {
    await garantirTabelas();
    await prisma.$executeRaw`
      INSERT INTO "JotajaAcaoPendente" ("lojaId", "orderId", "path", "rotulo", "criadoEmMs")
      VALUES (${lojaId}, ${orderId}, ${path}, ${rotulo}, ${BigInt(Date.now())})
      ON CONFLICT ("lojaId", "orderId", "path") DO NOTHING`;
    console.warn(`[JotaJá instável] ${rotulo} de ${orderId} guardado — o cron reenvia`);
  } catch (e: any) {
    console.error(`[JotaJá instável] não guardei ${rotulo} de ${orderId}:`, e?.message);
  }
}

/** Reenvia as ações pendentes da loja, na ordem. 4xx não vai passar depois: sai da fila. */
export async function reenviarAcoesPendentes(
  lojaId: string,
  mutate: (path: string, opts?: RequestInit) => Promise<Response>,
): Promise<{ enviadas: number; pendentes: number; descartadas: number }> {
  await garantirTabelas();
  const linhas = await prisma.$queryRaw<(Omit<AcaoPendente, "criadoEmMs"> & { criadoEmMs: bigint })[]>`
    SELECT "id", "orderId", "path", "rotulo", "tentativas", "criadoEmMs"
    FROM "JotajaAcaoPendente" WHERE "lojaId" = ${lojaId} ORDER BY "criadoEmMs" LIMIT 30`;
  const { reenviar, descartar } = separarAcoes(linhas.map((l) => ({ ...l, criadoEmMs: Number(l.criadoEmMs) })), Date.now());
  for (const d of descartar) {
    await prisma.$executeRaw`DELETE FROM "JotajaAcaoPendente" WHERE "id" = ${d.id}`;
    console.warn(`[JotaJá instável] ${d.rotulo} de ${d.orderId} descartado após ${d.tentativas} tentativa(s)`);
  }
  let enviadas = 0;
  let pendentes = 0;
  for (const a of reenviar) {
    let status = 0;
    try {
      status = (await mutate(a.path, { method: "POST" })).status;
    } catch (e: any) {
      console.warn(`[JotaJá instável] ${a.rotulo} de ${a.orderId}: ${e?.message}`);
    }
    const resolvido = status > 0 && status < 500;
    if (resolvido) {
      await prisma.$executeRaw`DELETE FROM "JotajaAcaoPendente" WHERE "id" = ${a.id}`;
      enviadas++;
      console.log(`[JotaJá instável] ${status < 400 || status === 409 ? "✅" : "⚠️"} ${a.rotulo} de ${a.orderId} reenviado: ${status}`);
    } else {
      await prisma.$executeRaw`UPDATE "JotajaAcaoPendente" SET "tentativas" = "tentativas" + 1 WHERE "id" = ${a.id}`;
      pendentes++;
    }
  }
  return { enviadas, pendentes, descartadas: descartar.length };
}
