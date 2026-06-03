/**
 * /api/ifood/merchant/route.ts
 * Cenário 1 — Informações da Loja
 *   GET → lista todas as lojas do integrador + detalhes + status
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ifoodFetch, getMerchantIdForUser } from "@/lib/ifood-api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const email = session.user?.email || "";
    const merchantId = await getMerchantIdForUser(email);

    // 1. Detalhes da loja
    const detailRes = await ifoodFetch(`/merchant/v1.0/merchants/${merchantId}`);
    const detail    = detailRes.ok ? await detailRes.json() : null;

    // 2. Status de disponibilidade
    const statusRes = await ifoodFetch(`/merchant/v1.0/merchants/${merchantId}/status`);
    const status    = statusRes.ok ? await statusRes.json() : null;

    // 3. Lista de lojas vinculadas ao integrador
    const listRes = await ifoodFetch(`/merchant/v1.0/merchants`);
    const list    = listRes.ok ? await listRes.json() : [];

    return NextResponse.json({
      merchantId,
      detail,
      status,
      list: Array.isArray(list) ? list : [list].filter(Boolean),
    });
  } catch (err: any) {
    console.error("[iFood Merchant]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
