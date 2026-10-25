import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pegarVez } from "@/lib/vez";
import { cicloDoSaipos, integracoesAtivasDoSaipos } from "@/lib/saipos/varredura";

/**
 * GET /api/cron/saipos-pedidos — a cada 20 s: manda para o PDV Saipos os
 * pedidos novos das lojas com a integração ligada (FireHub → Saipos, sentido
 * único), repete os que falharam e avisa os cancelados (lib/saipos/varredura.ts).
 *
 * Sem SAIPOS_SECRET no servidor ou sem loja ligada: volta na hora — custo zero.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await pegarVez("job:saipos-pedidos", 16_000))) {
    return NextResponse.json({ ok: true, pulada: "outro servidor está nesta volta" });
  }

  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < 40_000;
  const lojas = await integracoesAtivasDoSaipos();
  const log: string[] = [];
  for (const integ of lojas) {
    if (!temTempo()) {
      log.push("tempo do ciclo acabou — o resto fica para o próximo");
      break;
    }
    try {
      const l = await cicloDoSaipos(integ, temTempo);
      if (l.length > 0) log.push(`${integ.franchiseeId}: ${l.join(" | ")}`);
    } catch (e: any) {
      log.push(`${integ.franchiseeId}: falhou (${String(e?.message || e).slice(0, 200)})`);
    }
  }
  if (log.length > 0) console.log(`[Saipos] ${log.join(" || ")}`);
  return NextResponse.json({ ok: true, lojas: lojas.length, log });
}
