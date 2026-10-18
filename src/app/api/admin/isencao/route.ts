/**
 * POST /api/admin/isencao — { userId, isenta: boolean }
 *
 * O dono escolhe quem não paga mensalidade (botão "Isentar" / "Cobrar" da lista
 * de lojistas). Desde 17/10/2026 ser embaixador ou vendedor não isenta sozinho:
 * a isenção é só esta (`planPercent` 0), além das lojas da casa. A regra e o
 * acerto do ciclo do mês estão em `definirIsencao` (lib/billing.ts).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { definirIsencao } from "@/lib/billing";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { role: true },
  });
  if (me?.role !== "ADMIN") return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const { userId, isenta } = await req.json().catch(() => ({}));
  if (!userId || typeof isenta !== "boolean") {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  }

  const r = await definirIsencao(userId, isenta);
  if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });
  console.log(`[Admin] Isenção ${isenta ? "LIGADA" : "DESLIGADA"} para ${userId} por ${session.user?.email} · ciclo ${r.ciclo.yearMonth} devido R$ ${r.ciclo.amountDue.toFixed(2)}`);
  return NextResponse.json({ ok: true, isenta, devido: r.ciclo.amountDue, mes: r.ciclo.yearMonth });
}
