import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pegarVez } from "@/lib/vez";
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
  // Cinto do cron-runner (que já só dispara no líder): com dois containers
  // vivos — o velho e o novo no deploy, ou A e B —, só um roda esta volta.
  // Vale 16 s (~0,8 do intervalo) e é renovada pelo mesmo servidor (lib/vez.ts).
  if (!(await pegarVez("job:open-delivery-saida", 16_000))) {
    return NextResponse.json({ ok: true, pulada: "outro servidor está nesta volta" });
  }

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
