/**
 * PATCH /api/store/orders/[id]/cliente — a loja INCLUI ou CORRIGE o nome e o
 * telefone do cliente de um pedido já lançado.
 *
 *   corpo:    { nome?, telefone? }   (em branco = não mexe naquele campo)
 *   resposta: { ok, semMudanca?, customerName, customerPhone }
 *
 * A regra (quem pode, quais pedidos) é lib/cliente-do-pedido.ts — a mesma que
 * decide se o botão aparece. Nasceu do Divinos Burguer (24/10/2026): pedido
 * lançado no balcão sem cliente e nenhum jeito de incluir depois.
 *
 * Não mexe em endereço, taxa nem total: só em quem é o cliente. O que mudou
 * entra no histórico do pedido (ação CLIENTE).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { empilharEdicao, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import {
  descricaoDaMudancaDoCliente,
  mesmoCliente,
  motivoParaNaoMudarOCliente,
  nomeParaGravar,
  problemaDoCliente,
  telefoneParaGravar,
} from "@/lib/cliente-do-pedido";

export const dynamic = "force-dynamic";

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, deliveryType: true, tableSessionId: true,
  totalAmount: true, customerName: true, customerPhone: true, editHistory: true,
  // O que decide canal (marketplace): é o que `canalDoPedido` lê.
  paymentMethod: true, gatewayPaymentId: true, paymentMethods: true, paymentPaidAt: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
} as const;

function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const operador = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
    });
    if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const corpo = await req.json().catch(() => ({} as any));
    const novo = { nome: nomeParaGravar(corpo?.nome), telefone: telefoneParaGravar(corpo?.telefone) };
    const problema = problemaDoCliente(novo.nome, novo.telefone);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });

    const cookieStore = await cookies();
    const { lojaIds } = await lojasDaVisao(operador, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({
      lojaIds: [operador.ownerId || operador.id],
    }));
    const { id } = await params;
    const pedido = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: { in: lojaIds } }, select: CAMPOS });
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    const naoPode = motivoParaNaoMudarOCliente(pedido, operador);
    if (naoPode) return NextResponse.json({ error: naoPode }, { status: 403 });

    if (mesmoCliente(novo, pedido)) {
      return NextResponse.json({ ok: true, semMudanca: true, customerName: pedido.customerName, customerPhone: pedido.customerPhone });
    }

    const registro = {
      quando: new Date().toISOString(),
      quem: nomeDoOperador(operador),
      acao: "CLIENTE" as const,
      descricao: descricaoDaMudancaDoCliente(novo, pedido),
      totalAntes: pedido.totalAmount || 0,
      totalDepois: pedido.totalAmount || 0,
    };
    const dados: Record<string, unknown> = {
      editHistory: empilharEdicao(pedido.editHistory, registro as unknown as RegistroDeEdicao) as any,
    };
    if (novo.nome) dados.customerName = novo.nome;
    if (novo.telefone) dados.customerPhone = novo.telefone;

    // Grava só se ninguém mudou o cliente no meio (outra aba, outro atendente).
    const gravados = await prisma.customerOrder.updateMany({
      where: { id: pedido.id, customerName: pedido.customerName, customerPhone: pedido.customerPhone },
      data: dados as any,
    });
    if (gravados.count !== 1) {
      return NextResponse.json(
        { error: "O cliente deste pedido mudou enquanto você corrigia. Abra o pedido de novo e confira." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      customerName: (dados.customerName as string) ?? pedido.customerName,
      customerPhone: (dados.customerPhone as string) ?? pedido.customerPhone,
    });
  } catch (err: any) {
    console.error("[Orders cliente PATCH]", err?.message || err);
    return NextResponse.json({ error: "Não consegui salvar o cliente. Tente de novo." }, { status: 500 });
  }
}
