/**
 * GET /api/cron/health-check
 * Cron job a cada 5 minutos — verifica saúde do servidor e envia alertas
 * WhatsApp para os administradores se algo estiver errado.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runHealthCheck, notifyServerBoot } from "@/lib/server-monitor";

export const dynamic = "force-dynamic";

// Flag para enviar notificação de boot na primeira execução
let firstRun = true;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Na primeira execução, notificar que o servidor subiu
  if (firstRun) {
    firstRun = false;
    notifyServerBoot().catch(() => {});
  }

  try {
    const result = await runHealthCheck();

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    }, {
      status: result.status === "critical" ? 503 : 200,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: "error",
      error: err.message,
    }, { status: 500 });
  }
}
