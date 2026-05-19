/**
 * /api/ifood/interruptions/route.ts
 * Cenário 2 — Interrupção da Loja (Pausas)
 *   GET  → lista pausas ativas
 *   POST → cria uma nova pausa
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ifoodFetch, ifoodMutate, getMerchantId } from "@/lib/ifood-api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const merchantId = getMerchantId();
    const res = await ifoodMutate(`/merchant/v1.0/merchants/${merchantId}/interruptions`);

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `iFood ${res.status}: ${err}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data : data?.interruptions ?? []);
  } catch (err: any) {
    console.error("[iFood Interruptions GET]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { description, start, end } = body;

    if (!start || !end) {
      return NextResponse.json({ error: "start e end são obrigatórios (ISO 8601)" }, { status: 400 });
    }

    const merchantId = getMerchantId();
    const res = await ifoodMutate(`/merchant/v1.0/merchants/${merchantId}/interruptions`, {
      method: "POST",
      body: JSON.stringify({ description: description || "Pausa temporária", start, end }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json({ error: `iFood ${res.status}`, details: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, interruption: data });
  } catch (err: any) {
    console.error("[iFood Interruptions POST]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
