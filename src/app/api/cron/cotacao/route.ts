/**
 * GET /api/cron/cotacao — a Cotação automática (lib/cotacao), a cada minuto:
 *   1. a loja com um horário da agenda vencendo agora ganha a rodada: um
 *      pedido de preços por fornecedor, na fila, espaçado;
 *   2. a rodada que chegou na hora do resumo (ou em que todos responderam)
 *      manda o resumo ao comprador;
 *   3. a fila sai, um envio de cada vez, até ~45 s (o próximo minuto continua).
 *
 * Exclusivo no cron-runner: uma rodada que ainda está mandando não ganha
 * outra por cima. Sem loja com o módulo, são três consultas vazias.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { garantirEstruturaDaCotacao } from "@/lib/cotacao/estrutura-no-banco";
import { enviarResumos, rodarAgendas } from "@/lib/cotacao/rodada";
import { processarFila } from "@/lib/cotacao/fila";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await garantirEstruturaDaCotacao())) return NextResponse.json({ ok: false, motivo: "estrutura" });
  const agora = new Date();
  const rodadas = await rodarAgendas(agora).catch((err) => { console.error("[Cotação] Agendas:", err?.message); return 0; });
  const resumos = await enviarResumos(agora).catch((err) => { console.error("[Cotação] Resumos:", err?.message); return 0; });
  const fila = await processarFila({ tetoMs: 45_000 });
  return NextResponse.json({ ok: true, rodadas, resumos, ...fila });
}
