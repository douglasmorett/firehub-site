import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { jotajaFetch, jotajaMutate } from "@/lib/jotaja-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId") || searchParams.get("id");

  try {
    const results: any[] = [];

    if (orderId) {
      // Import a specific order directly by ID
      const result = await processJotajaEvent(
        { orderId, eventType: "CREATED", code: "PLC" },
        jotajaFetch,
        jotajaMutate
      );
      results.push({ orderId, result });
      return NextResponse.json({ ok: true, orderId, results });
    }

    // 1. Check polling events
    const pollRes = await jotajaFetch("/v1/events:polling", { method: "GET" }).catch(() => null);
    if (pollRes && pollRes.ok) {
      const events = await pollRes.json().catch(() => []);
      if (Array.isArray(events)) {
        for (const event of events) {
          const res = await processJotajaEvent(event, jotajaFetch, jotajaMutate);
          results.push({ event, res });
        }
      }
    }

    // 2. Fallback: Check known recent order IDs or recent range (including 32511181)
    const targetIds = ["32511181", "32511180", "32511182", "32511183", "32511184", "32511185"];
    for (const tid of targetIds) {
      try {
        const res = await processJotajaEvent(
          { orderId: tid, eventType: "CREATED", code: "PLC" },
          jotajaFetch,
          jotajaMutate
        );
        if (res.action === "created" || res.action === "updated") {
          results.push({ orderId: tid, res });
        }
      } catch {}
    }

    return NextResponse.json({ ok: true, importedCount: results.length, results });
  } catch (err: any) {
    console.error("[Jotaja Import] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
