import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { cardapiowebConfigurada } from "@/lib/cardapioweb/api";
import { cicloDoCardapioWeb } from "@/lib/cardapioweb/eventos";

/**
 * GET /api/cron/cardapioweb-poll — a cada 30 s (scripts/cron-runner.js).
 *
 * A rede PRINCIPAL do CardápioWeb, não um enfeite: o webhook dele pausa
 * depois de 15 falhas e só volta por e-mail. Por loja ligada:
 *   - `GET /orders?updated_since=<cursor − 1 min>` (o CardápioWeb guarda 24 h):
 *     importa o pedido que o webhook perdeu, aplica cancelamento e status;
 *   - o token é renovado 5 min antes de vencer, de carona na chamada.
 * Depois: os avisos do webhook que pararam no meio e as ações pendentes
 * (lib/cardapioweb/acoes-pendentes.ts) — o dispatch barrado do iFood que
 * ninguém repetiu (03/10/2026) não se repete aqui.
 *
 * Limite do CardápioWeb: 300 chamadas a cada 3 min por loja. Este ciclo faz
 * UMA lista por loja e só busca o pedido que muda algo aqui.
 *
 * Sem as variáveis do CardápioWeb no servidor: responde na hora, sem tocar no banco.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!cardapiowebConfigurada()) return NextResponse.json({ ok: true, desligada: true });

  try {
    const r = await cicloDoCardapioWeb();
    if (r.log.length > 0) console.log(`[CardápioWeb Poll] ${r.log.join(" | ")}`);
    return NextResponse.json({ ok: true, lojas: r.lojas, log: r.log });
  } catch (e: any) {
    console.error("[CardápioWeb Poll] ❌", e?.message);
    return NextResponse.json({ ok: false, erro: e?.message || "erro" }, { status: 500 });
  }
}
