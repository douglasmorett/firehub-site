import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { analiseDasCarteiras } from "@/lib/performance-das-carteiras/no-banco";
import { PERIODOS, type ChaveDoPeriodo } from "@/lib/performance-das-carteiras/regras";

/**
 * GET ?periodo=mes|mesAnterior|3m|12m — o comparativo de todas as carteiras
 * (vendedores, embaixadores com lojas e "Sem vendedor") contra o período
 * anterior. Só ADMIN. A base fica 10 min em memória (no-banco.ts).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const pedido = req.nextUrl.searchParams.get("periodo") as ChaveDoPeriodo | null;
  const chave = PERIODOS.some((p) => p.chave === pedido) ? pedido! : "mes";
  return NextResponse.json(await analiseDasCarteiras(chave));
}
