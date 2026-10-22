/**
 * PATCH /api/store/orders/[id]/rota-automatica — o pedido VOLTA para a Rota
 * 100% automatizada depois que a loja o tirou de uma rota automática.
 *
 *   corpo:    { voltar: true }
 *   resposta: { success }
 *
 * Desfazer uma rota AUTO, ou tirar um pedido dela, grava
 * `CustomerOrder.semRotaAutomaticaEm` (api/store/routes, DELETE e PATCH): o
 * cron deixa o pedido de fora ("tirado-pela-loja") para não montar a mesma
 * rota 20 s depois. É o "✋ fora da automática · voltar" da lista de
 * pendentes da Roteirização que chama esta rota e limpa a marca — no ciclo
 * seguinte ele volta a ser agrupado.
 *
 * Quem pode: o mesmo de quem abre a roteirização (dono, ou funcionário com as
 * caixinhas "Motoboys" ou "Pedidos"), nas lojas que a sessão vê — a mesma
 * régua do PATCH ../prioridade.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";

export const dynamic = "force-dynamic";

function podeUsarARoteirizacao(op: { role?: string | null; permissions?: string | null }): boolean {
  const papel = String(op.role || "").toUpperCase();
  if (papel === "ADMIN" || papel === "FRANCHISEE") return true;
  const caixinhas = String(op.permissions || "").split(",").map((p) => p.trim());
  return caixinhas.includes("motoboys") || caixinhas.includes("orders");
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (!podeUsarARoteirizacao(operador)) {
    return NextResponse.json({ error: "Seu usuário não tem acesso à roteirização." }, { status: 403 });
  }

  const corpo = await req.json().catch(() => ({} as any));
  if (corpo?.voltar !== true) {
    return NextResponse.json({ error: "Mande { voltar: true } para o pedido voltar à rota automática." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const { lojaIds } = await lojasDaVisao(operador, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({
    lojaIds: [operador.ownerId || operador.id],
  }));
  const { id } = await params;
  // `semRotaAutomaticaEm` é coluna da Fase 2: o client do build a conhece; o
  // `as any` é do client local.
  const { count } = await (prisma.customerOrder as any).updateMany({
    where: { id, franchiseeId: { in: lojaIds } },
    data: { semRotaAutomaticaEm: null },
  });
  if (count === 0) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  return NextResponse.json({ success: true });
}
