import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { historicoAoLer, historicoParaGuardar, type MensagemDaConversa } from "./memoria-da-conversa";

/**
 * O histórico da conversa do robô, guardado no banco para sobreviver a deploy.
 *
 * ── Por que SQL cru, e não um campo no schema.prisma ────────────────────────
 *
 * A coluna mora em `ChatbotConversationState`, a tabela que o anti-loop lê e
 * grava a CADA mensagem. Campo declarado no schema com coluna ausente no banco
 * é erro em TODA consulta do modelo (o Prisma lista as colunas uma a uma) — o
 * anti-loop falharia aberto e o robô passaria a falar por cima do atendente.
 * Risco grande demais para uma memória de 30 minutos.
 *
 * Então é o mesmo desenho das colunas da Brendi (garantir-colunas.ts): o schema
 * não conhece a coluna, o acesso é por SQL cru, e TUDO aqui falha em silêncio
 * para o chamador — sem a coluna, o robô só volta a ter a memória em RAM que
 * sempre teve. Se um `prisma db push` manual um dia derrubar a coluna, o
 * próximo boot a recria.
 *
 * O que fica guardado são as últimas 15 mensagens, e só enquanto a conversa
 * está viva: `limparMemoriasVencidas` zera a coluna de quem parou de falar.
 */

let colunaOk = false;

/** Garante a coluna uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirColunaDaMemoria(): Promise<boolean> {
  if (colunaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    // Confere ANTES de alterar: `ADD COLUMN IF NOT EXISTS` pede trava exclusiva
    // na tabela mesmo quando a coluna já existe, e esta é uma tabela quente.
    const existe = await prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'ChatbotConversationState' AND column_name = 'history' LIMIT 1
    `;
    if (existe.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ChatbotConversationState" ADD COLUMN IF NOT EXISTS "history" JSONB`);
      console.log("[Boot] ✅ Coluna ChatbotConversationState.history criada (memória da conversa do robô).");
    }
    colunaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Memória da conversa] Não consegui garantir a coluna: ${err?.message || err}`);
    return false;
  }
}

/** O histórico guardado desta conversa, já limpo e dentro da validade. Nunca lança. */
export async function carregarMemoriaDaConversa(userId: string, remoteJid: string): Promise<MensagemDaConversa[]> {
  try {
    if (!(await garantirColunaDaMemoria())) return [];
    const linhas = await prisma.$queryRaw<{ history: unknown }[]>`
      SELECT "history" FROM "ChatbotConversationState"
      WHERE "userId" = ${userId} AND "remoteJid" = ${remoteJid} AND "history" IS NOT NULL
      LIMIT 1
    `;
    return linhas.length > 0 ? historicoAoLer(linhas[0].history, Date.now()) : [];
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha ao ler: ${err?.message || err}`);
    return [];
  }
}

/** Guarda o histórico desta conversa. Nunca lança — chame sem `await` se quiser. */
export async function guardarMemoriaDaConversa(userId: string, remoteJid: string, mensagens: unknown): Promise<void> {
  try {
    if (!(await garantirColunaDaMemoria())) return;
    const json = JSON.stringify(historicoParaGuardar(mensagens, Date.now()));
    // A linha quase sempre já existe (o anti-loop a cria na primeira mensagem);
    // o INSERT cobre a conversa que chegou aqui sem passar por ele. No conflito
    // só a memória e o `updatedAt` mudam — contadores e travas do anti-loop
    // ficam. (`updatedAt` não é lido por ninguém além da faxina abaixo.)
    await prisma.$executeRaw`
      INSERT INTO "ChatbotConversationState" ("id", "userId", "remoteJid", "turnCount", "turnsWithoutProgress", "history", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${remoteJid}, 0, 0, ${json}::jsonb, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("userId", "remoteJid") DO UPDATE
        SET "history" = EXCLUDED."history", "updatedAt" = EXCLUDED."updatedAt"
    `;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha ao guardar: ${err?.message || err}`);
  }
}

let ultimaFaxina = 0;

/**
 * Zera a memória das conversas paradas há mais de duas horas. Conversa de
 * cliente não é para ficar guardada: serve ao atendimento em curso e só.
 * No máximo uma vez por hora por processo. Nunca lança.
 */
export async function limparMemoriasVencidas(agora: number = Date.now()): Promise<void> {
  if (agora - ultimaFaxina < 60 * 60 * 1000) return;
  ultimaFaxina = agora;
  try {
    if (!(await garantirColunaDaMemoria())) return;
    const limite = new Date(agora - 2 * 60 * 60 * 1000);
    await prisma.$executeRaw`
      UPDATE "ChatbotConversationState" SET "history" = NULL
      WHERE "history" IS NOT NULL AND "updatedAt" < ${limite}
    `;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha na faxina: ${err?.message || err}`);
  }
}
