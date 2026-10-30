import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
import { prisma } from "@/lib/prisma";
import { podeEditarPedidos } from "@/lib/edicao-de-pedido";
import { efeitosDoEntregueDepoisDeCancelado, marcarEntregueDepoisDeCancelado } from "@/lib/entregue-depois-de-cancelado-no-banco";

/**
 * POST /api/store/orders/[id]/entregue-depois-de-cancelado   { forma, trocoPara? }
 *
 * O cliente cancelou, o motoboy já estava na rua, entregou e recebeu (Allan,
 * Delícias de Casa, 17/10/2026). O pedido volta a contar como venda — caixa,
 * faturamento e acerto do motoboy — com a forma que a loja informa. A regra
 * e a gravação são as de lib/entregue-depois-de-cancelado*.ts, as mesmas do
 * app do motoboy.
 *
 * Quem pode é quem pode editar pedidos: mexe no caixa tanto quanto trocar a
 * forma de pagamento (api/store/orders/[id]/pagamento). O rastro registra o
 * nome de quem marcou.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (!podeEditarPedidos(operador)) {
    return NextResponse.json(
      { error: "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
  const papel = String(operador.role || "").toUpperCase() === "STAFF" ? "funcionário" : operador.role === "ADMIN" ? "admin" : "dono";
  const quem = `${(operador.name || "").trim() || operador.email} (${papel})`;

  // "Todas as Lojas" (cookie "all", lib/loja-ativa.ts): o pedido pode ser de
  // qualquer loja do grupo (30/10/2026: "agora todos é pra mexer em tudo").
  const { lojaIds } = await lojasDaVisao(operador, await cookieDaVisao()).catch(() => ({
    lojaIds: [operador.ownerId || operador.id],
  }));
  const r = await marcarEntregueDepoisDeCancelado({
    pedidoId: id,
    lojaIds,
    forma: corpo?.forma,
    trocoPara: corpo?.trocoPara,
    quem,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });

  if (!r.jaEstava) efeitosDoEntregueDepoisDeCancelado(r.pedido.id, r.pedido.franchiseeId);
  return NextResponse.json({ success: true, jaEstava: r.jaEstava, forma: r.forma });
}
