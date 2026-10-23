import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pegarVez } from "@/lib/vez";
import { aiqfomeConfigurada } from "@/lib/aiqfome/api";
import { cicloDoAiqfome } from "@/lib/aiqfome/eventos";

/**
 * GET /api/cron/aiqfome-poll — a cada 30 s (scripts/cron-runner.js).
 *
 * A rede PRINCIPAL do aiqfome: a doc não garante a entrega do webhook. Por
 * loja ligada, `GET /orders/open` (o pedido que o webhook perdeu, o que
 * avançou lá) e, a cada 60 s, `GET /orders/cancelled`. Depois os avisos que
 * pararam no meio e as ações pendentes (lib/aiqfome/acoes-pendentes.ts).
 * São 1 a 2 chamadas por loja por volta — bem abaixo do limite de 20 a 60
 * por minuto por rota que a V0 publicava.
 *
 * Sem as variáveis do aiqfome no servidor: responde na hora, sem tocar no banco.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!aiqfomeConfigurada()) return NextResponse.json({ ok: true, desligada: true });
  // Com dois containers vivos (o velho e o novo no deploy), só um roda esta volta.
  if (!(await pegarVez("job:aiqfome-poll", 24_000))) {
    return NextResponse.json({ ok: true, pulada: "outro servidor está nesta volta" });
  }
  try {
    const r = await cicloDoAiqfome();
    if (r.log.length > 0) console.log(`[aiqfome Poll] ${r.log.join(" | ")}`);
    return NextResponse.json({ ok: true, lojas: r.lojas, log: r.log });
  } catch (e: any) {
    console.error("[aiqfome Poll] ❌", e?.message);
    return NextResponse.json({ ok: false, erro: e?.message || "erro" }, { status: 500 });
  }
}
