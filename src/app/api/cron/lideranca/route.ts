/**
 * GET /api/cron/lideranca — "o cron-runner DESTE container dispara os jobs?"
 *
 * Só o scripts/cron-runner.js do mesmo container pergunta, a cada ~30 s.
 * Responde pegando (ou renovando) a vez "cron:lider" por 90 s (lib/vez.ts):
 * com dois containers vivos — o velho e o novo no deploy, ou A e B atrás do
 * balanceador — só um dispara os jobs. O outro fica de reserva e assume
 * quando a vez vence sem renovação (o líder caiu ou foi desligado).
 *
 * CRON_PREFERIDO=1 (no servidor A): a preferida pega assim que a vez vence;
 * as outras dão 20 s de folga a ela antes de assumir.
 *
 * Banco fora: responde 503 com `lider: false` e o runner continua líder só
 * enquanto a vez que JÁ tem ainda vale (ninguém pode pegá-la antes de vencer)
 * — depois para de disparar. Os jobs dependem do banco de qualquer jeito, e o
 * health-check (que roda em toda instância) é quem avisa que o banco caiu.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { sqlPegarVez, CHAVE_DO_LIDER_DO_CRON } from "@/lib/vez";
import { garantirTabelasDeCoordenacao } from "@/lib/ddl-do-boot";
import { idDaInstancia } from "@/lib/instancia";

export const dynamic = "force-dynamic";

const VALIDADE_DO_LIDER_MS = 90_000;
const FOLGA_PARA_A_PREFERIDA_MS = 20_000;

/** A chamada veio de dentro do container (o cron-runner), sem passar pelo proxy. */
function chamadaLocal(req: NextRequest): boolean {
  const host = req.headers.get("host") || "";
  const veioDoProxy = req.headers.has("x-forwarded-for") || req.headers.has("x-forwarded-host");
  return !veioDoProxy && (host.startsWith("127.0.0.1") || host.startsWith("localhost"));
}

export async function GET(req: NextRequest) {
  // Mesmo com o CRON_SECRET certo, a vez do líder é do cron-runner deste
  // container: de fora, ninguém pega a liderança de outro servidor.
  if (!verifyCronAuth(req) || (process.env.NODE_ENV !== "development" && !chamadaLocal(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preferida = process.env.CRON_PREFERIDO === "1";
  const folga = preferida ? 0 : FOLGA_PARA_A_PREFERIDA_MS;
  const pegar = async () =>
    (await prisma.$queryRaw<{ ok: number }[]>(sqlPegarVez(CHAVE_DO_LIDER_DO_CRON, idDaInstancia(), VALIDADE_DO_LIDER_MS, folga))).length > 0;

  try {
    let lider: boolean;
    try {
      lider = await pegar();
    } catch (err: any) {
      // A tabela pode ter faltado no boot (banco soluçando): cria e tenta uma vez.
      if (!/relation .*Vez.* does not exist|42P01/i.test(String(err?.message || ""))) throw err;
      await garantirTabelasDeCoordenacao();
      lider = await pegar();
    }
    return NextResponse.json({ lider, validadeMs: VALIDADE_DO_LIDER_MS, instancia: idDaInstancia(), preferida });
  } catch (err: any) {
    console.error(`[Liderança do cron] não consegui consultar a vez: ${String(err?.message || err).slice(0, 160)}`);
    return NextResponse.json(
      { lider: false, erro: String(err?.message || err).slice(0, 160), instancia: idDaInstancia() },
      { status: 503 },
    );
  }
}
