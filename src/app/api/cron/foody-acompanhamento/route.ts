/**
 * GET /api/cron/foody-acompanhamento — a cada minuto (scripts/cron-runner.js).
 *
 * Pergunta à Foody/Voe (POST /orders/checkupdates, até 100 uids por chamada)
 * como estão as entregas em curso e grava status, motoboy e link de rastreio
 * em "FoodyEntrega". Quando a Foody diz `delivered` e a loja ligou "fechar o
 * pedido quando a Foody entregar", o pedido de canal próprio vira ENTREGUE
 * (lib/foody-no-banco.ts, `acompanharEntregasDaFoody`).
 *
 * A Foody pede consulta no máximo a cada 30 s; 1 minuto fica dentro. Sem
 * entrega em curso a rota responde vazio com uma consulta só.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { acompanharEntregasDaFoody } from "@/lib/foody-no-banco";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const r = await acompanharEntregasDaFoody();
    return NextResponse.json({ ok: true, ...r });
  } catch (err: any) {
    console.error("[Cron Foody] erro:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "erro" }, { status: 500 });
  }
}
