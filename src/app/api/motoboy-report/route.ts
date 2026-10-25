import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { montarRelatorioDosEntregadores, periodoDoRelatorio } from "@/lib/relatorio-do-entregador";
import { podeComoNaTela } from "@/lib/permissoes-da-equipe";

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
    select: { id: true, ownerId: true, storeTimezone: true, role: true, permissions: true }
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  // Nome e endereço dos clientes e quanto cada entregador recebe: a caixinha da
  // tela Motoboys, a mesma das rotas irmãs do acerto (./sessao.ts).
  if (!podeComoNaTela(user, "/store/motoboys")) {
    return NextResponse.json({ error: "Sua conta não tem acesso à tela Motoboys." }, { status: 403 });
  }

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
