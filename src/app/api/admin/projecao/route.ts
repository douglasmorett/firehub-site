import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { montarProjecao } from "@/lib/projecao-do-mes";

/** Aba Projeção do admin: mensalidade do mês projetada e as listas de contato. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await montarProjecao());
  } catch (e: any) {
    console.error("[admin/projecao]", e);
    return NextResponse.json({ error: e?.message || "Erro ao montar a projeção" }, { status: 500 });
  }
}
