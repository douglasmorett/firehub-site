import { NextRequest, NextResponse } from "next/server";
import { autenticarLogistica, NAO_AUTORIZADO } from "@/lib/open-delivery-saida/acesso";
import { eventoOD, eventosDoPolling, varrerLoja } from "@/lib/open-delivery-saida/eventos";

/**
 * GET /api/opendelivery/v1/events:polling — os eventos ainda sem ack da loja do token.
 *
 * O ":" do caminho da spec não vira pasta (no Windows nem dá para criar), então
 * src/proxy.ts reescreve `events:polling` (e `events%3Apolling`) para cá.
 *
 * Antes de responder, varre a loja: o polling não depende do cron para ver o
 * pedido que acabou de entrar. 200 com a lista, 204 sem evento.
 * `eventType` (vírgula ou repetido) filtra; `x-polling-merchants` sem o
 * merchant desta loja → 204 (o token só abre a própria loja).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const integ = await autenticarLogistica(req);
  if (!integ) return NAO_AUTORIZADO();

  const merchants = (req.headers.get("x-polling-merchants") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (merchants.length > 0 && !merchants.includes(integ.merchantId)) return new NextResponse(null, { status: 204 });

  try {
    await varrerLoja(integ);
  } catch (e: any) {
    console.warn(`[Open Delivery saída] varredura no polling ${integ.franchiseeId}:`, e?.message);
  }

  const tipos = req.nextUrl.searchParams.getAll("eventType").flatMap((t) => t.split(","));
  const eventos = await eventosDoPolling(integ, { tipos });
  if (eventos.length === 0) return new NextResponse(null, { status: 204 });
  return NextResponse.json(eventos.map((e) => eventoOD(e)));
}
