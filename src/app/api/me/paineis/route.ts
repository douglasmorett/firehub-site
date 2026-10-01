import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { paineisDaSessao } from "@/lib/paineis-do-dono";

/**
 * A loja e o portal do parceiro de quem está logado — para a escolha do
 * /login e o atalho "outro painel" da barra da loja e do portal. Regra em
 * lib/paineis-do-dono.ts.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ paineis: null }, { status: 401 });
  try {
    return NextResponse.json({ paineis: await paineisDaSessao(session.user) });
  } catch (err) {
    console.error("[api/me/paineis]", err);
    return NextResponse.json({ paineis: null });
  }
}
