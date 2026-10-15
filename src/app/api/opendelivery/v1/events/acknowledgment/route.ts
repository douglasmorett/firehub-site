import { NextRequest, NextResponse } from "next/server";
import { autenticarLogistica, NAO_AUTORIZADO, problema } from "@/lib/open-delivery-saida/acesso";
import { confirmarEventos, lerAck } from "@/lib/open-delivery-saida/eventos";

/**
 * POST /api/opendelivery/v1/events/acknowledgment — [{ id, orderId, eventType }].
 *
 * Tira os eventos do polling. Id de outra loja ou já confirmado é ignorado
 * sem erro (o ack pode chegar repetido). 202 sem corpo.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const integ = await autenticarLogistica(req);
  if (!integ) return NAO_AUTORIZADO();

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return problema(400, "Corpo precisa ser um array JSON de { id, orderId, eventType }.");
  }
  const acks = lerAck(corpo);
  if (!acks) return problema(400, "Corpo precisa ser um array JSON de { id, orderId, eventType }.");
  if (acks.length > 1000) return problema(400, "No máximo 1000 eventos por chamada.");

  await confirmarEventos(integ, acks);
  return new NextResponse(null, { status: 202 });
}
