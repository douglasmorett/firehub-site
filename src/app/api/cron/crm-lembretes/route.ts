import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { rodarLembretes } from "@/lib/crm/lembretes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A cada 5 minutos (scripts/cron-runner.js): reconexão do número do FireHub,
 * lembrete de demonstração ao contato e aviso pendente ao vendedor
 * (lib/crm/lembretes.ts).
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const r = await rodarLembretes();
    return NextResponse.json({ ok: true, ...r });
  } catch (err: any) {
    console.error(`[CRM] Lembretes falharam: ${err?.message}`);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
