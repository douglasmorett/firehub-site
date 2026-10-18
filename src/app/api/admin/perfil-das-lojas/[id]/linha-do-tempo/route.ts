import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { linhaDoTempoDaLoja } from "@/lib/perfil-da-loja/linha-do-tempo-no-banco";

/** GET: a linha do tempo completa da loja (com o texto das conversas) — só ADMIN. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json(await linhaDoTempoDaLoja(id, "ADMIN"));
}
