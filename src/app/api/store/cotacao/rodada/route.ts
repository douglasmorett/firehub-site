import { NextResponse } from "next/server";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { iniciarRodada, RodadaRecusadaError } from "@/lib/cotacao/rodada";
import { processarFila, ESPACO_ENTRE_ENVIOS_MS } from "@/lib/cotacao/fila";

/**
 * POST — "Pedir cotação agora": a mesma rodada da agenda, na hora. Os pedidos
 * de preço entram na fila espaçados (lib/cotacao/fila.ts) e começam a sair
 * já, sem esperar o cron; o resto da fila o cron termina.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  try {
    const rodada = await iniciarRodada(r.s.franchiseeId, "MANUAL", null);
    if (!rodada) return NextResponse.json({ error: "Essa cotação já foi pedida." }, { status: 409 });
    void processarFila({ franchiseeId: r.s.franchiseeId, tetoMs: Math.min(15 * 60_000, rodada.naFila * ESPACO_ENTRE_ENVIOS_MS + 30_000) });
    return NextResponse.json({ ok: true, ...rodada, minutos: Math.max(1, Math.ceil((rodada.naFila * ESPACO_ENTRE_ENVIOS_MS) / 60_000)) });
  } catch (err: any) {
    if (err instanceof RodadaRecusadaError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[Cotação] Pedir agora falhou:", err?.message);
    return NextResponse.json({ error: "Não deu para pedir a cotação agora. Tente de novo em instantes." }, { status: 500 });
  }
}
