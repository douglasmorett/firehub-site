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
    const payload     = body.openingHours ?? body; // aceita ambos formatos

    console.log("[iFood Opening Hours PUT] Enviando:", JSON.stringify(payload, null, 2));

    const res = await ifoodMutate(`/merchant/v1.0/merchants/${merchantId}/opening-hours`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    console.log("[iFood Opening Hours PUT] Resposta:", res.status, JSON.stringify(data));

    if (!res.ok) {
      return NextResponse.json({ error: `iFood ${res.status}`, details: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error("[iFood Opening Hours PUT] Erro:", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
