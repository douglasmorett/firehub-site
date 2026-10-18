import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { perfilDaLoja } from "@/lib/perfil-da-loja/no-banco";

/** GET: o perfil completo de uma loja (recursos, oportunidades, financeiro), para o admin. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const perfil = await perfilDaLoja(id);
  if (!perfil) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  return NextResponse.json(perfil);
}
