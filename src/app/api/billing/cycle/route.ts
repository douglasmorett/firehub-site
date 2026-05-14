/**
 * GET /api/billing/cycle
 * Retorna o ciclo de faturamento atual do franqueado logado.
 * Usado para exibir o widget de mensalidade no painel financeiro.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getCurrentCycleView } from "@/lib/billing";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const franchiseeId = (session.user as any).id;
  if (!franchiseeId) return NextResponse.json({ error: "ID não encontrado" }, { status: 400 });

  const cycle = await getCurrentCycleView(franchiseeId);
  return NextResponse.json(cycle);
}
