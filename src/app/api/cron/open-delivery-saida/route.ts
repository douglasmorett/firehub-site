import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { cicloDaLoja, integracoesAtivas } from "@/lib/open-delivery-saida/eventos";

/**
 * GET /api/cron/open-delivery-saida — a cada 20 s: varre as lojas com a
 * logística ligada (Bem Dito) e manda os webhooks pendentes, com as
 * retentativas (lib/open-delivery-saida/eventos.ts).
 *
 * Sem loja ligada: uma leitura numa tabela vazia e volta — custo zero.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < 40_000;
  const lojas = await integracoesAtivas();
  const log: string[] = [];
  for (const integ of lojas) {
    if (!temTempo()) {
      log.push("⏱️ tempo do ciclo acabou — o resto fica para o próximo");
      break;
    }
    const l = await cicloDaLoja(integ, temTempo);
    if (l.length > 0) log.push(`${integ.franchiseeId}: ${l.join(" | ")}`);
  }
  if (log.length > 0) console.log(`[Open Delivery saída] ${log.join(" || ")}`);
  return NextResponse.json({ ok: true, lojas: lojas.length, log });
}
