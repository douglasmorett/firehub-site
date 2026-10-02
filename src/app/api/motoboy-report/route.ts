import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { montarRelatorioDosEntregadores, periodoDoRelatorio } from "@/lib/relatorio-do-entregador";

// GET /api/motoboy-report?motoboyId=xxx&from=2026-05-01&to=2026-05-31
//
// A conta mora em lib/relatorio-do-entregador.ts, a MESMA que o app do
// motoboy usa (/api/motoboys/relatorio): com o mesmo período (data e hora),
// a loja e o entregador veem o mesmo número.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Segurança e otimização: buscar apenas o id do usuário e timezone
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, storeTimezone: true }
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const url = new URL(req.url);
  const tz = user.storeTimezone || "America/Sao_Paulo";
  const { fromDate, toDate } = periodoDoRelatorio(url.searchParams.get("from"), url.searchParams.get("to"), tz);

  const relatorio = await montarRelatorioDosEntregadores({
    lojaId: user.ownerId || user.id,
    motoboyId: url.searchParams.get("motoboyId"),
    fromDate,
    toDate,
    tz,
  });
  return NextResponse.json(relatorio);
}
