import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { jotajaFetch, jotajaMutate } from "@/lib/jotaja-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId") || searchParams.get("id");

  try {
    if (orderId) {
      // Import a specific order directly by ID
      const result = await processJotajaEvent(
        { orderId, eventType: "CREATED", code: "PLC" },
        jotajaFetch,
        jotajaMutate
      );
      return NextResponse.json({ ok: true, orderId, result });
    }

    // Otherwise poll active events
    const pollRes = await jotajaFetch("/v1/events:polling", { method: "GET" });
    if (!pollRes.ok) {
      return NextResponse.json({ ok: false, status: pollRes.status, message: "events:polling falhou" });
    }

    const events = await pollRes.json();
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, message: "Nenhum evento pendente no JotaJá" });
    }

    const results = [];
    for (const event of events) {
      const res = await processJotajaEvent(event, jotajaFetch, jotajaMutate);
      results.push(res);
    }

    return NextResponse.json({ ok: true, count: events.length, results });
  } catch (err: any) {
    console.error("[Jotaja Import] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
