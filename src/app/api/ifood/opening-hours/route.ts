/**
 * /api/ifood/opening-hours/route.ts
 * Cenário 3 — Horário de Funcionamento
 *   GET → consulta horários cadastrados no iFood
 *   PUT → define novos horários de funcionamento
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ifoodMutate, getMerchantId } from "@/lib/ifood-api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const merchantId = getMerchantId();
    const res  = await ifoodMutate(`/merchant/v1.0/merchants/${merchantId}/opening-hours`);
    const data = res.ok ? await res.json() : null;
    return NextResponse.json({ merchantId, openingHours: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const body        = await req.json();
    const merchantId  = getMerchantId();

    // body.openingHours = [{ dayOfWeek, shifts: [{ start, duration }] }]
    const res = await ifoodMutate(`/merchant/v1.0/merchants/${merchantId}/opening-hours`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: `iFood ${res.status}`, details: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
