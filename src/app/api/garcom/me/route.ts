/**
 * GET /api/garcom/me
 *
 * Diz à tela do garçom se a sessão dele ainda vale e, se não, POR QUÊ. As
 * rotas de mesa respondem um 401 seco; é aqui que a tela descobre se foi
 * senha trocada, acesso desativado, caixa fechado ou sessão vencida — e leva
 * o motivo para a tela de login (?motivo=), em vez de um formulário mudo.
 */
import { NextResponse } from "next/server";
import { autenticarGarcom } from "@/lib/garcom-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await autenticarGarcom();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, codigo: auth.codigo, erro: auth.erro }, { status: auth.status });
  }
  return NextResponse.json({
    ok: true,
    garcom: { id: auth.garcom.id, name: auth.garcom.name, commissionRate: auth.garcom.commissionRate },
  });
}
