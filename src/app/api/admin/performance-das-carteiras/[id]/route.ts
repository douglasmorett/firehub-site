import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { detalheDaCarteira } from "@/lib/performance-das-carteiras/no-banco";
import type { ChaveDoPeriodo } from "@/lib/performance-das-carteiras/regras";

/** GET ?periodo= — uma carteira por dentro (id do vendedor/embaixador, ou "sem"). Só ADMIN. */
const CHAVES: ChaveDoPeriodo[] = ["mes", "mesAnterior", "90d", "ano", "mesEspecifico", "intervalo"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  const pedido = q.get("periodo") as ChaveDoPeriodo | null;
  const chave: ChaveDoPeriodo = pedido && CHAVES.includes(pedido) ? pedido : "mes";
  const extra = { mes: q.get("mes") || undefined, de: q.get("de") || undefined, ate: q.get("ate") || undefined };
  const detalhe = await detalheDaCarteira(id, chave, extra);
  if (!detalhe) return NextResponse.json({ error: "Carteira não encontrada." }, { status: 404 });
  return NextResponse.json(detalhe);
}
