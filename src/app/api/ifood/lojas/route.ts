/**
 * /api/ifood/lojas
 * As lojas iFood da conta, para o seletor das telas de homologação.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasIfood } from "@/lib/ifood-token";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }
  try {
    return NextResponse.json({ lojas: await lojasIfood(session.user.email) });
  } catch (e: any) {
    console.error("[iFood lojas]", e?.message);
    return NextResponse.json({ error: "Não foi possível listar as lojas." }, { status: 500 });
  }
}
