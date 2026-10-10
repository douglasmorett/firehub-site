import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ajusteDoDescontoDaEdicao,
  avaliarEdicao,
  descontoDaLojaDepoisDaEdicao,
  descontoNaEdicao,
  empilharEdicao,
  type RegistroDeEdicao,
} from "@/lib/edicao-de-pedido";

/**
 * PATCH /api/store/orders/[id]/desconto { novo: number, motivo?: string }
 *
 * AJUSTA o desconto total do pedido para `novo` reais — para menos ou para
 * mais, inclusive zero. "Dar desconto" (rota de itens) só soma: o Divinos deu
 * 30% por engano (R$ 28,80) em 09/10/2026 e não tinha como voltar. Mesmas
 * travas do "Dar desconto" (descontoNaEdicao: pago online, pago no parceiro,
 * dividido, nota fiscal, permissão). O total anda só a diferença, a parte da
 * loja (discountMerchant) também, e a troca vai para o histórico (DESCONTO).
 */

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, totalAmount: true, deliveryFee: true,
  discountTotal: true, discountMerchant: true, discountIfood: true, tableSessionId: true,
  paymentMethod: true, paymentMethods: true, gatewayPaymentId: true,
  ifoodOrderId: true, openDeliveryOrderId: true, openDeliveryChannel: true,
  dailyOrderNumber: true, deliveryType: true, notes: true, editHistory: true,
  fiscalStatus: true, fiscalInfo: true,
  items: { select: { quantity: true, price: true } },
} as const;

const reais = (n: number) => `R$ ${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")}`;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const operador = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
    });
    if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = operador.ownerId || operador.id;
    const { id } = await params;
    const order = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: lojaId }, select: CAMPOS });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    const avaliacao = avaliarEdicao(order as any, operador);
    if (avaliacao.modo === "BLOQUEADO") return NextResponse.json({ error: avaliacao.motivo }, { status: 403 });
    const pode = descontoNaEdicao(order as any, avaliacao);
    if (!pode.pode) return NextResponse.json({ error: pode.motivo }, { status: 403 });

    const corpo = await req.json().catch(() => ({}));
    const conta = ajusteDoDescontoDaEdicao({
      itens: order.items,
      discountTotal: order.discountTotal,
      deliveryFee: order.deliveryFee,
      totalAmount: order.totalAmount,
      novo: Number(String(corpo?.novo ?? "").replace(",", ".")),
    });
    if (conta.problema) return NextResponse.json({ error: conta.problema }, { status: 400 });

    const motivo = String(corpo?.motivo || "").trim().slice(0, 80);
    const quem = `${operador.name || operador.email || "?"} (${(operador.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono"})`;
    const descricao = `desconto do pedido ${reais(conta.atual)} → ${reais(conta.novo)}${motivo ? ` — ${motivo}` : ""}`;
    const registro: RegistroDeEdicao = {
      quando: new Date().toISOString(),
      quem,
      acao: "DESCONTO",
      descricao,
      totalAntes: order.totalAmount || 0,
      totalDepois: conta.total,
    };
    const notas = `${String(order.notes || "").trim()} [Desconto ajustado: ${reais(conta.atual)} → ${reais(conta.novo)}]`.trim();

    // Só passa se o pedido ainda é o que foi lido (dois aparelhos ao mesmo tempo).
    const r = await prisma.customerOrder.updateMany({
      where: { id: order.id, franchiseeId: lojaId, totalAmount: order.totalAmount, discountTotal: order.discountTotal },
      data: {
        discountTotal: conta.novo,
        discountMerchant: Math.max(0, descontoDaLojaDepoisDaEdicao(order as any, conta.delta)),
        totalAmount: conta.total,
        notes: notas,
        editHistory: empilharEdicao(order.editHistory, registro) as any,
      },
    });
    if (r.count !== 1) {
      return NextResponse.json({ error: "O pedido mudou enquanto você ajustava. Abra de novo e confira." }, { status: 409 });
    }
    console.log(`[Ajuste de desconto] pedido ${order.id} (#${order.dailyOrderNumber ?? "—"}): ${descricao}; total ${order.totalAmount} → ${conta.total}; por ${quem}`);
    return NextResponse.json({ success: true, discountTotal: conta.novo, totalAmount: conta.total, descricao });
  } catch (err: any) {
    console.error("[Ajuste de desconto]", err);
    return NextResponse.json({ error: "Erro ao ajustar o desconto" }, { status: 500 });
  }
}
