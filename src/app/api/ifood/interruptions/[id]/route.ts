/**
 * /api/ifood/interruptions/[id]/route.ts
 * Cenário 2 — Remove uma pausa específica
 *   DELETE → remove a pausa pelo interruptionId
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ifoodMutate, getMerchantId } from "@/lib/ifood-api";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const merchantId     = getMerchantId();
    const { id: interruptionId } = await params;

    const res = await ifoodMutate(
      `/merchant/v1.0/merchants/${merchantId}/interruptions/${interruptionId}`,
      { method: "DELETE" }
    );

    if (!res.ok && res.status !== 204) {
      const err = await res.text();
      return NextResponse.json({ error: `iFood ${res.status}: ${err}` }, { status: res.status });
    }

    return NextResponse.json({ success: true, removed: interruptionId });
  } catch (err: any) {
    console.error("[iFood Interruptions DELETE]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
