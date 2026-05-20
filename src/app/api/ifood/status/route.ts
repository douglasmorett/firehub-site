import { NextResponse } from "next/server";
import { ifoodFetch, getMerchantId } from "@/lib/ifood-api";

export async function GET() {
  const merchantId = getMerchantId();

  try {
    // Parallel requests to iFood API
    const [statusRes, hoursRes, interruptRes] = await Promise.allSettled([
      ifoodFetch(`/merchant/v1.0/merchants/${merchantId}/status`),
      ifoodFetch(`/merchant/v1.0/merchants/${merchantId}/opening-hours`),
      ifoodFetch(`/merchant/v1.0/merchants/${merchantId}/interruptions`),
    ]);

    const status = statusRes.status === "fulfilled" && statusRes.value.ok
      ? await statusRes.value.json() : null;
    const hours = hoursRes.status === "fulfilled" && hoursRes.value.ok
      ? await hoursRes.value.json() : null;
    const interruptions = interruptRes.status === "fulfilled" && interruptRes.value.ok
      ? await interruptRes.value.json() : null;

    return NextResponse.json({
      merchantId,
      fetchedAt: new Date().toISOString(),
      status,
      openingHours: hours,
      interruptions,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
