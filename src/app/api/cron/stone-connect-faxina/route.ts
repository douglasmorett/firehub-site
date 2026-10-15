/**
 * GET /api/cron/stone-connect-faxina — a cada 5 min (scripts/cron-runner.js).
 *
 * Pedido aberto na Stone pela nuvem (Connect 2.0) NÃO expira e cada POS aceita
 * no máximo 30 abertos: cobrança abandonada (totem desligado no meio, mesa
 * esquecida) trava a maquininha. Esta faxina confere as cobranças Stone ainda
 * "na maquininha" — dá baixa nas que foram pagas e o webhook perdeu, e derruba
 * as abandonadas (15 min no totem, 30 na mesa). Sem cobrança Stone viva, não
 * faz nenhuma chamada à Stone.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { faxinaDaStoneNoTotem } from "@/lib/cobranca-stone-do-totem";
import { faxinaDaStoneNaMesa } from "@/lib/cobranca-da-mesa-na-maquininha";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const totem = await faxinaDaStoneNoTotem();
  const mesa = await faxinaDaStoneNaMesa();
  return NextResponse.json({ ok: true, totem, mesa });
}
