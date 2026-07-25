import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { jotajaFetch, jotajaMutate } from "@/lib/jotaja-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId") || searchParams.get("id");

  try {
    const results: any[] = [];
    const testEndpoints = [
      "/v1/events:polling",
      "/v1/orders",
      "/v1/merchants/22238/orders",
      "/v1/orders?status=PLACED",
      "/v1/orders?status=CONFIRMED"
    ];
    const responses: any = {};

    for (const path of testEndpoints) {
      try {
        const r = await jotajaFetch(path);
        const text = await r.text().catch(() => "");
        responses[path] = { status: r.status, ok: r.ok, sample: text.slice(0, 500) };

        if (r.ok && text) {
          const parsed = JSON.parse(text);
          const items = Array.isArray(parsed) ? parsed : (parsed.orders || parsed.items || []);
          if (Array.isArray(items)) {
            for (const item of items) {
              const oid = item.orderId || item.id || item.eventId;
              if (oid) {
                const res = await processJotajaEvent(
                  { orderId: oid, eventType: item.eventType || "CREATED", code: item.code || "PLC" },
                  jotajaFetch,
                  jotajaMutate
                );
                results.push({ path, oid, res });
              }
            }
          }
        }
      } catch (e: any) {
        responses[path] = { error: e.message };
      }
    }

    return NextResponse.json({ ok: true, importedCount: results.length, responses, results });
  } catch (err: any) {
    console.error("[Jotaja Import] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
