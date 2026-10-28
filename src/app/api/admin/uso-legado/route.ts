import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ehEquipeInterna } from "@/lib/equipe-interna";
import { lerUsoLegado, resumirUsoLegado } from "@/lib/uso-legado";

export const dynamic = "force-dynamic";

/**
 * GET ?dias=14 — quem ainda usa os caminhos antigos que a fase 2 vai travar
 * (lib/uso-legado.ts), por tipo → loja: total de vezes, dias com uso, último
 * uso e os detalhes (rota, `sessao=sim|nao`). Só a equipe interna.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!(await ehEquipeInterna(session))) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });

  const pedido = Math.floor(Number(req.nextUrl.searchParams.get("dias")) || 14);
  const dias = Math.min(90, Math.max(1, pedido));
  try {
    const { desde, linhas } = await lerUsoLegado(dias);
    return NextResponse.json({ dias, desde, ...resumirUsoLegado(linhas), geradoEm: new Date().toISOString() });
  } catch (e: any) {
    console.error("[Uso legado] leitura:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "Não consegui ler o uso agora." }, { status: 500 });
  }
}
