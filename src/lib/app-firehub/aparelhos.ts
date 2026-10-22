/**
 * O celular da LOJA com o app FireHub (apps/firehub), e o aviso que chega
 * nele com o app fechado e a tela bloqueada: "🔔 Pedido #47 — iFood".
 *
 * Era o pedido da Holy Top (19/10/2026): o som de pedido novo só tocava com a
 * tela de Pedidos aberta no navegador. O app registra aqui o token de
 * notificação do Expo e o servidor avisa a loja quando o pedido nasce
 * (lib/app-firehub/aviso-de-pedido.ts, chamado pelo gatilho do prisma.ts).
 *
 * Mesmo desenho do app do entregador (lib/app-motoboy/aparelhos.ts): o token é
 * do APARELHO — celular que passa de mão muda de dono (ON CONFLICT) —, e a
 * tabela é SQL cru criada na primeira chamada. Se ela faltar, o aviso
 * simplesmente não sai; pedido nenhum depende disto.
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

const URL_DO_EXPO = "https://exp.host/--/api/v2/push/send";

/** O formato que o Expo devolve em getExpoPushTokenAsync. Qualquer outra coisa é lixo. */
const TOKEN_VALIDO = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;

/**
 * O canal criado pelo app (apps/firehub/src/lib/notificacoes.ts) com
 * importância máxima e a campainha própria: é o que faz o Android tocar alto e
 * mostrar o aviso por cima da tela bloqueada.
 */
export const CANAL_DE_PEDIDOS = "pedido-novo";
export const SOM_DO_PEDIDO = "pedido.wav";

let tabelaOk = false;

export async function garantirTabelaDeAparelhosDaLoja(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LojaAparelho" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "pushToken" TEXT NOT NULL,
      "plataforma" TEXT,
      "versaoDoApp" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "LojaAparelho_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "LojaAparelho_pushToken_key" ON "LojaAparelho"("pushToken")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "LojaAparelho_lojaId_idx" ON "LojaAparelho"("lojaId")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[App FireHub] 🛑 Tabela LojaAparelho falhou: ${err?.message}`);
    return false;
  }
}

export function tokenDeNotificacaoValido(token: unknown): token is string {
  return typeof token === "string" && TOKEN_VALIDO.test(token.trim());
}

/** Grava (ou muda de dono) o aparelho. Devolve false se não deu para gravar. */
export async function registrarAparelhoDaLoja(a: {
  userId: string;
  lojaId: string;
  pushToken: string;
  plataforma?: string | null;
  versaoDoApp?: string | null;
}): Promise<boolean> {
  if (!(await garantirTabelaDeAparelhosDaLoja())) return false;
  const plataforma = String(a.plataforma || "").slice(0, 20) || null;
  const versao = String(a.versaoDoApp || "").slice(0, 40) || null;
  // TIMESTAMP sem fuso, em UTC, como o Prisma grava (lib/cashback-no-banco.ts).
  await prisma.$executeRaw`
    INSERT INTO "LojaAparelho" ("id", "userId", "lojaId", "pushToken", "plataforma", "versaoDoApp", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${a.userId}, ${a.lojaId}, ${a.pushToken.trim()}, ${plataforma}, ${versao},
            (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pushToken") DO UPDATE SET
      "userId" = EXCLUDED."userId",
      "lojaId" = EXCLUDED."lojaId",
      "plataforma" = EXCLUDED."plataforma",
      "versaoDoApp" = EXCLUDED."versaoDoApp",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  return true;
}

/** Sair do app: o aparelho para de receber os avisos da loja. */
export async function esquecerAparelhoDaLoja(pushToken: string): Promise<void> {
  if (!(await garantirTabelaDeAparelhosDaLoja())) return;
  await prisma.$executeRaw`DELETE FROM "LojaAparelho" WHERE "pushToken" = ${pushToken.trim()}`;
}

export type AvisoALoja = {
  titulo: string;
  corpo: string;
  /** Vai junto para o app decidir o que abrir quando tocarem no aviso. */
  dados?: Record<string, unknown>;
};

/**
 * Manda o aviso para todos os celulares da loja. NUNCA lança e nunca deve ser
 * esperado por quem grava o pedido. Token que o Expo diz que morreu (app
 * desinstalado) sai da tabela aqui mesmo.
 */
export async function avisarLoja(lojaId: string, aviso: AvisoALoja): Promise<void> {
  if (!lojaId) return;
  try {
    if (!(await garantirTabelaDeAparelhosDaLoja())) return;
    const linhas = await prisma.$queryRaw<{ pushToken: string }[]>`
      SELECT "pushToken" FROM "LojaAparelho" WHERE "lojaId" = ${lojaId}
    `;
    if (linhas.length === 0) return;

    const mensagens = linhas.map((l) => ({
      to: l.pushToken,
      title: aviso.titulo,
      body: aviso.corpo,
      data: aviso.dados ?? {},
      sound: SOM_DO_PEDIDO,
      priority: "high",
      channelId: CANAL_DE_PEDIDOS,
      // Aviso de pedido de meia hora atrás só atrapalha.
      ttl: 30 * 60,
    }));

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    const res = await fetch(URL_DO_EXPO, {
      method: "POST",
      headers,
      body: JSON.stringify(mensagens),
      signal: AbortSignal.timeout(8000),
    });
    const corpo = await res.json().catch(() => null as any);
    if (!res.ok) {
      console.warn(`[App FireHub] aviso para a loja ${lojaId} recusado pelo Expo: ${res.status} ${JSON.stringify(corpo).slice(0, 200)}`);
      return;
    }

    const tickets: any[] = Array.isArray(corpo?.data) ? corpo.data : [];
    const mortos = tickets
      .map((t, i) => (t?.status === "error" && t?.details?.error === "DeviceNotRegistered" ? mensagens[i]?.to : null))
      .filter((t): t is string => Boolean(t));
    for (const token of mortos) {
      await prisma.$executeRaw`DELETE FROM "LojaAparelho" WHERE "pushToken" = ${token}`.catch(() => {});
    }
  } catch (err: any) {
    console.warn(`[App FireHub] aviso para a loja ${lojaId} falhou: ${err?.message}`);
  }
}
