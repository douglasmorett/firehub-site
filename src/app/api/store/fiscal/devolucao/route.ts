import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { notaDoPedido } from "@/lib/fiscal-config";
import { empilharEdicao, registroDaDevolucao } from "@/lib/edicao-de-pedido";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/fiscal/devolucao { orderId, observacao, confirmar: true }
 *
 * Registra que o contador fez a devolução/ajuste de uma NFC-e que não pode
 * mais ser cancelada — e com isso libera a trava de editar e cancelar o
 * pedido (lib/edicao-de-pedido → travaDaNotaFiscal).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Depois da saída da mercadoria ou dos 30 minutos a NFC-e não cancela (Ajuste
 * SINIEF 19/16, cl. 15ª), e a trava mandava "fale com o contador" — mas não
 * havia como dizer ao FireHub que o contador já tinha feito a NF-e de
 * devolução. O pedido ficava travado para sempre, mesmo com a venda desfeita
 * no documento certo, e o cliente que devolveu não saía do caixa.
 *
 * Isto NÃO emite nada na SEFAZ: é o registro de que o documento foi feito
 * fora daqui. Por isso pede confirmação explícita, é do titular (não do
 * balcão) e deixa rastro no `editHistory` de cada pedido da nota — quem,
 * quando e a observação (o número da NF-e de devolução).
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true, name: true, email: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    // Mesmo papel do cancelamento da nota: é ato do titular sobre a venda declarada.
    if (user.role === "STAFF") {
      return NextResponse.json({ error: "Só o responsável pela loja registra devolução de nota fiscal." }, { status: 403 });
    }
    const lojaId = user.ownerId || user.id;

    const body = await req.json().catch(() => ({}));
    const { orderId, observacao, confirmar } = body || {};
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    if (confirmar !== true) {
      return NextResponse.json(
        {
          error: "confirmacao_necessaria",
          mensagem:
            "Confirme que o contador JÁ fez a devolução/estorno desta NFC-e. O registro libera o pedido para editar e " +
            "cancelar no FireHub; ele não emite nada na SEFAZ.",
        },
        { status: 400 }
      );
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: { id: true, franchiseeId: true, status: true, deliveryType: true, totalAmount: true, fiscalStatus: true, fiscalInfo: true, editHistory: true },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });

    const quem = user.name || user.email || "Loja";
    const r = registroDaDevolucao(order, { quem, observacao });
    if (!r.ok) return NextResponse.json({ error: "nao_registrada", mensagem: r.mensagem }, { status: 409 });

    // A nota da conta da mesa é uma para todos os pedidos da conta: a
    // devolução dela vale para todos os que têm a MESMA chave.
    const nota = notaDoPedido(order);
    const chave = (order.fiscalInfo as any)?.nfceKey;
    const daNota = nota.pedidos.length > 1
      ? await prisma.customerOrder.findMany({
          where: { id: { in: nota.pedidos }, franchiseeId: lojaId },
          select: { id: true, totalAmount: true, fiscalInfo: true, editHistory: true },
        })
      : [{ id: order.id, totalAmount: order.totalAmount, fiscalInfo: order.fiscalInfo, editHistory: order.editHistory }];
    const alvos = daNota.filter((p) => p.id === order.id || (p.fiscalInfo as any)?.nfceKey === chave);

    await prisma.$transaction(
      alvos.map((p) =>
        prisma.customerOrder.update({
          where: { id: p.id },
          data: {
            fiscalInfo: { ...((p.fiscalInfo as any) || {}), devolucao: r.devolucao },
            editHistory: empilharEdicao(p.editHistory, {
              quando: r.devolucao.quando,
              quem,
              acao: "DEVOLUCAO_FISCAL",
              descricao: `Devolução/ajuste da NFC-e ${chave} registrada: ${r.devolucao.observacao}`,
              totalAntes: Number(p.totalAmount) || 0,
              totalDepois: Number(p.totalAmount) || 0,
            }) as any,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      pedidos: alvos.map((p) => p.id),
      mensagem:
        "Devolução registrada. O pedido está liberado para editar e cancelar no FireHub — a NFC-e continua " +
        "autorizada na SEFAZ, e a devolução é o documento que o contador emitiu.",
    });
  } catch (err: any) {
    console.error("[Fiscal Devolução] Erro:", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
