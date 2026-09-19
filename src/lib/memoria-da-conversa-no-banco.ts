import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  historicoAoLer,
  historicoParaAIa,
  historicoParaGuardar,
  VALIDADE_GUARDADA_MS,
  type MensagemDaConversa,
} from "./memoria-da-conversa";

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

/** O `history` cru desta conversa, ou null. Nunca lança. */
async function lerHistoricoCru(userId: string, remoteJid: string): Promise<unknown> {
  try {
    if (!(await garantirColunaDaMemoria())) return null;
    const linhas = await prisma.$queryRaw<{ history: unknown }[]>`
      SELECT "history" FROM "ChatbotConversationState"
      WHERE "userId" = ${userId} AND "remoteJid" = ${remoteJid} AND "history" IS NOT NULL
      LIMIT 1
    `;
    return linhas.length > 0 ? linhas[0].history : null;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha ao ler: ${err?.message || err}`);
    return null;
  }
}

/** O que o MODELO lê: janela curta (15 mensagens, 30 min). Nunca lança. */
export async function carregarMemoriaDaConversa(userId: string, remoteJid: string): Promise<MensagemDaConversa[]> {
  return historicoParaAIa(await lerHistoricoCru(userId, remoteJid), Date.now());
}

/** O que o PAINEL mostra: a conversa do turno (40 mensagens, 6 h). Nunca lança. */
export async function conversaParaOPainel(userId: string, remoteJid: string): Promise<MensagemDaConversa[]> {
  return historicoAoLer(await lerHistoricoCru(userId, remoteJid), Date.now());
}

/**
 * ACRESCENTA mensagens ao que já está guardado, sem apagar o resto.
 *
 * É por aqui que toda gravação passa, e a razão é a loja olhando o painel: a
 * mensagem do cliente é gravada assim que chega (mesmo quando o robô não vai
 * responder — conversa pausada, com atendente, ou barrada pelo cooldown), e a
 * resposta é gravada quando sai. Se cada ponto desses sobrescrevesse a lista
 * inteira com a cópia que tem em mãos, o outro apagaria o trabalho do primeiro.
 *
 * Nunca lança — chame sem `await` se quiser.
 */
export async function acrescentarNoHistorico(
  userId: string,
  remoteJid: string,
  novas: MensagemDaConversa[],
): Promise<void> {
  if (!Array.isArray(novas) || novas.length === 0) return;
  // Limpa e corta ANTES de mandar: o que entra no banco já está validado.
  const limpas = historicoParaGuardar(novas, Date.now());
  if (limpas.length === 0) return;
  try {
    if (!(await garantirColunaDaMemoria())) return;
    const json = JSON.stringify(limpas);
    // ACRÉSCIMO ATÔMICO (`||` do jsonb), e não "ler, juntar em JavaScript e
    // gravar por cima". Numa rajada — que é como as pessoas escrevem no
    // WhatsApp — duas mensagens do mesmo cliente chegam juntas: as duas leriam
    // a mesma lista e a segunda gravaria por cima da primeira. O painel existe
    // justamente para mostrar essas mensagens.
    //
    // A poda de tamanho fica na LEITURA (`historicoAoLer` corta em 40 e 6 h) e
    // no corte de emergência abaixo: assim o acréscimo é uma operação só.
    await prisma.$executeRaw`
      INSERT INTO "ChatbotConversationState" ("id", "userId", "remoteJid", "turnCount", "turnsWithoutProgress", "history", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${remoteJid}, 0, 0, ${json}::jsonb, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("userId", "remoteJid") DO UPDATE
        SET "history" = CASE
              WHEN jsonb_typeof("ChatbotConversationState"."history") = 'array'
                THEN "ChatbotConversationState"."history" || EXCLUDED."history"
              ELSE EXCLUDED."history"
            END,
            "updatedAt" = EXCLUDED."updatedAt"
    `;
    // Conversa muito longa não pode crescer sem fim dentro da linha: quando
    // passa do dobro da janela, regrava podada. É raro e fora do caminho quente.
    await prisma.$executeRaw`
      UPDATE "ChatbotConversationState"
      SET "history" = (
        SELECT jsonb_agg(m ORDER BY i) FROM (
          SELECT m, i FROM jsonb_array_elements("history") WITH ORDINALITY AS t(m, i)
          ORDER BY i DESC LIMIT 40
        ) ult
      )
      WHERE "userId" = ${userId} AND "remoteJid" = ${remoteJid}
        AND jsonb_typeof("history") = 'array' AND jsonb_array_length("history") > 80
    `;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha ao acrescentar: ${err?.message || err}`);
  }
}

/** Uma mensagem só, do cliente, que chegou e pode não ser respondida. */
export async function registrarMensagemDoCliente(userId: string, remoteJid: string, texto: string): Promise<void> {
  if (!texto || !texto.trim()) return;
  await acrescentarNoHistorico(userId, remoteJid, [{ sender: "user", text: texto, timestamp: Date.now() }]);
}

/** Uma mensagem só, do lado da loja: o robô ou uma pessoa da equipe. */
export async function registrarMensagemDaLoja(
  userId: string,
  remoteJid: string,
  texto: string,
  autor: "robo" | "atendente" = "robo",
): Promise<void> {
  if (!texto || !texto.trim()) return;
  await acrescentarNoHistorico(userId, remoteJid, [{ sender: "bot", text: texto, timestamp: Date.now(), autor }]);
}

/** Guarda o histórico desta conversa, substituindo o que estava lá. Nunca lança. */
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

export type ConversaDoRobo = {
  remoteJid: string;
  telefone: string;
  ultimaMensagem: string;
  /** Quem falou por último: o cliente ou a loja. */
  ultimoAutor: "user" | "bot";
  ultimaEm: number;
  mensagens: number;
  /** Trava no banco: a conversa está com uma pessoa (12 h, lib/loop-guard.ts). */
  comHumano: boolean;
  motivoDaPausa: string | null;
};

/**
 * As conversas que o robô atendeu recentemente, da mais nova para a mais velha.
 *
 * É o que a loja vê no painel: todo mundo com quem o robô está falando, não só
 * quem pediu atendente. Sai daqui a lista; o conteúdo de cada uma vem de
 * `conversaParaOPainel`.
 */
export async function listarConversasDoRobo(userId: string, limite = 40): Promise<ConversaDoRobo[]> {
  try {
    if (!(await garantirColunaDaMemoria())) return [];
    // SÓ A ÚLTIMA MENSAGEM VEM DO BANCO, não a conversa inteira. A lista é
    // recarregada de tempos em tempos com a janela aberta: trazer 40 conversas
    // de até 40 mensagens para desenhar 40 linhas de resumo é trabalho que o
    // Postgres faz melhor — `-> -1` é o último elemento do array.
    const linhas = await prisma.$queryRaw<
      {
        remoteJid: string;
        n: number | null;
        ultima: { sender?: string; text?: string; timestamp?: number } | null;
        degradedAt: Date | null;
        degradedReason: string | null;
      }[]
    >`
      -- O CASE no SELECT não é enfeite: o Postgres NÃO garante que a condição
      -- do WHERE seja avaliada antes da expressão da lista, então a contagem
      -- estourava (cannot get array length of a non-array) numa única linha com
      -- o campo malformado -- e levava junto a lista de TODAS as conversas da
      -- loja. Conferido contra o banco de produção.
      SELECT "remoteJid",
             CASE WHEN jsonb_typeof("history") = 'array' THEN jsonb_array_length("history") ELSE 0 END AS n,
             CASE WHEN jsonb_typeof("history") = 'array' THEN "history" -> -1 ELSE NULL END AS ultima,
             "degradedAt", "degradedReason"
      FROM "ChatbotConversationState"
      WHERE "userId" = ${userId}
        AND "history" IS NOT NULL
        AND jsonb_typeof("history") = 'array'
      ORDER BY "updatedAt" DESC
      LIMIT ${Math.min(Math.max(limite, 1), 100)}
    `;

    const agora = Date.now();
    const DOZE_HORAS = 12 * 60 * 60 * 1000;
    const conversas: ConversaDoRobo[] = [];

    for (const linha of linhas) {
      const ultima = linha.ultima || {};
      const quando = Number(ultima.timestamp);
      const texto = typeof ultima.text === "string" ? ultima.text : "";
      const pausadaEm = linha.degradedAt ? new Date(linha.degradedAt).getTime() : 0;
      const comHumano = pausadaEm > 0 && agora - pausadaEm < DOZE_HORAS;
      const viva = Number.isFinite(quando) && quando > 0 && agora - quando < VALIDADE_GUARDADA_MS;
      // Conversa PARADA há mais de 6 h sai da lista — menos quando o robô está
      // pausado nela: some da tela seria esconder justamente a que precisa de
      // gente, e a pausa dura 12 h.
      if (!viva && !comHumano) continue;
      conversas.push({
        remoteJid: linha.remoteJid,
        telefone: String(linha.remoteJid || "").split("@")[0].replace(/\D/g, ""),
        ultimaMensagem: texto,
        ultimoAutor: ultima.sender === "bot" ? "bot" : "user",
        ultimaEm: Number.isFinite(quando) && quando > 0 ? quando : pausadaEm,
        mensagens: Number(linha.n) || 0,
        comHumano,
        motivoDaPausa: linha.degradedReason || null,
      });
    }

    conversas.sort((a, b) => b.ultimaEm - a.ultimaEm);
    return conversas;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha ao listar: ${err?.message || err}`);
    return [];
  }
}

let ultimaFaxina = 0;

/**
 * Zera a memória das conversas paradas há mais de oito horas. Conversa de
 * cliente não é para ficar guardada: serve ao atendimento em curso e só. São
 * oito, e não seis, para a faxina nunca apagar uma conversa que o painel ainda
 * mostraria (a janela de lá é de 6 h).
 * No máximo uma vez por hora por processo. Nunca lança.
 */
export async function limparMemoriasVencidas(agora: number = Date.now()): Promise<void> {
  if (agora - ultimaFaxina < 60 * 60 * 1000) return;
  ultimaFaxina = agora;
  try {
    if (!(await garantirColunaDaMemoria())) return;
    // A CONTA É FEITA NO BANCO, não aqui. `updatedAt` é `timestamp without time
    // zone` guardando UTC; mandar um Date do processo faz o driver serializar
    // no fuso de quem chama, e a comparação erra por três horas — conferido
    // contra o banco de produção, de uma máquina em Brasília: a faxina não
    // apagava nada. Em UTC (o container) passaria despercebido.
    await prisma.$executeRaw`
      UPDATE "ChatbotConversationState" SET "history" = NULL
      WHERE "history" IS NOT NULL
        AND "updatedAt" < (now() AT TIME ZONE 'UTC') - interval '8 hours'
    `;
  } catch (err: any) {
    console.error(`[Memória da conversa] Falha na faxina: ${err?.message || err}`);
  }
}
