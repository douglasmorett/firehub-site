import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { analiseDasCarteiras } from "@/lib/performance-das-carteiras/no-banco";
import type { ChaveDoPeriodo } from "@/lib/performance-das-carteiras/regras";

/**
 * GET ?periodo=mes|mesAnterior|90d|ano|mesEspecifico(&mes=YYYY-MM)|intervalo(&de=&ate=YYYY-MM-DD) — o comparativo de todas as carteiras
 * (vendedores, embaixadores com lojas e "Sem vendedor") contra o período
 * anterior. Só ADMIN. A base fica 10 min em memória (no-banco.ts).
 */
const CHAVES: ChaveDoPeriodo[] = ["mes", "mesAnterior", "90d", "ano", "mesEspecifico", "intervalo"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const pedido = q.get("periodo") as ChaveDoPeriodo | null;
  const chave: ChaveDoPeriodo = pedido && CHAVES.includes(pedido) ? pedido : "mes";
  const extra = { mes: q.get("mes") || undefined, de: q.get("de") || undefined, ate: q.get("ate") || undefined };
  return NextResponse.json(await analiseDasCarteiras(chave, extra));
}
