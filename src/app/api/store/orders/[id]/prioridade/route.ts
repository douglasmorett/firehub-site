/**
 * PATCH /api/store/orders/[id]/prioridade — a loja manda o pedido para a
 * frente da cozinha (ou tira de lá).
 *
 *   corpo:    { prioridade: boolean }
 *   resposta: { success, prioridadeNaCozinha }
 *
 * Grava `prioridadeNaCozinha`, a mesma marca da reposição: o KDS ordena por
 * ela antes de tudo (api/kds, lib/kds-telas.ts `ordenarPelaPrioridade`) e o
 * card ganha a faixa roxa "PRIORIDADE · pedida pela loja".
 *
 * ── Por que existe (Douglas, 21/10/2026) ───────────────────────────────────
 *
 * Quem monta rota vê no mapa que um pedido podia ir junto com outros que já
 * estão prontos — "o cara viu no mapa que aquela podia ir junto". Até aqui a
 * única forma de furar a fila era criar a rota; agora é um botão no card da
 * Roteirização (um por um ou em lote, pela seleção).
 *
 * Pedido entregue/encerrado ou cancelado: 409 — já não tem cozinha.
 *
 * Quem pode: o mesmo de quem abre a roteirização (dono, ou funcionário com as
 * caixinhas "Motoboys" ou "Pedidos"), nas lojas que a sessão vê.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { podePedirPrioridade } from "@/lib/lote-da-roteirizacao";

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
  if (typeof corpo?.prioridade !== "boolean") {
    return NextResponse.json({ error: "Diga se é para pedir ou tirar a prioridade." }, { status: 400 });
  }

  // Na visão "todas as lojas" a roteirização mostra pedidos do grupo inteiro
  // (mesmo jeito do POST ../ponto); fora dela, só a loja da sessão.
  const cookieStore = await cookies();
  const { lojaIds } = await lojasDaVisao(operador, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({
    lojaIds: [operador.ownerId || operador.id],
  }));
  const { id } = await params;
  const pedido = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: { in: lojaIds } },
    select: { id: true, status: true },
  });
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (!podePedirPrioridade(pedido.status)) {
    return NextResponse.json({ error: "O pedido já foi finalizado ou cancelado." }, { status: 409 });
  }

  const salvo = await prisma.customerOrder.update({
    where: { id: pedido.id },
    data: { prioridadeNaCozinha: corpo.prioridade },
    select: { prioridadeNaCozinha: true },
  });

  return NextResponse.json({ success: true, prioridadeNaCozinha: salvo.prioridadeNaCozinha });
}
