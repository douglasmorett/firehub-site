import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { detalheDaCarteira } from "@/lib/performance-das-carteiras/no-banco";
import { PERIODOS, type ChaveDoPeriodo } from "@/lib/performance-das-carteiras/regras";

/** GET ?periodo= — uma carteira por dentro (id do vendedor/embaixador, ou "sem"). Só ADMIN. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const pedido = req.nextUrl.searchParams.get("periodo") as ChaveDoPeriodo | null;
  const chave = PERIODOS.some((p) => p.chave === pedido) ? pedido! : "mes";
  const detalhe = await detalheDaCarteira(id, chave);
  if (!detalhe) return NextResponse.json({ error: "Carteira não encontrada." }, { status: 404 });
  return NextResponse.json(detalhe);
}
