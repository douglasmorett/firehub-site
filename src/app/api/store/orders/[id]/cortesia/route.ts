/**
 * POST /api/store/orders/[id]/cortesia { itemId, quantidade?, motivo }
 *
 * Dá um item do pedido (ou parte das unidades dele) de CORTESIA: o item fica
 * a R$ 0,00, o total cai o valor dele e o rastro do pedido ganha o registro
 * CORTESIA com quem deu (nome e id), o motivo e o valor que teria custado.
 * A regra (quando pode, o que vira o quê, como a régua de venda trata) está
 * em lib/cortesia.ts; o relatório é o Cancelamentos e cortesias.
 *
 * Guardas, na ordem da edição do pedido (api/store/orders/[id]/itens):
 * sessão → permissão de editar pedidos → pedido DESTA loja (ou do grupo, no
 * "Todas as Lojas") → `avaliarEdicao` / `avaliarEdicaoDaMesa` (status, nota
 * fiscal, mesa aberta) → `cortesiaNaEdicao` (o dinheiro ainda é da loja) →
 * motivo com 3 letras ou mais.
 *
 * O estoque NÃO volta: a cortesia foi feita e consumida — o insumo entra no
 * custo (CMV), só não entra na venda.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
import { prisma } from "@/lib/prisma";
import { avaliarEdicao, avaliarEdicaoDaMesa, empilharEdicao, recalcularTotal, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { carregarRodadaDaMesa } from "@/lib/edicao-na-mesa";
import { valorDoAcrescimoGravado } from "@/lib/acrescimo-no-credito";
import { motivoDoCorpo, MINIMO_DO_MOTIVO } from "@/lib/motivo-do-cancelamento";
import { cortesiaNaEdicao, planejarCortesia } from "@/lib/cortesia";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";

export const dynamic = "force-dynamic";

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, totalAmount: true, deliveryFee: true,
  discountTotal: true, tableSessionId: true, deliveryType: true, notes: true, editHistory: true,
  paymentMethod: true, paymentMethods: true, gatewayPaymentId: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true,
  dailyOrderNumber: true, fiscalStatus: true, fiscalInfo: true,
  items: {
    select: {
      id: true, quantity: true, price: true, productName: true, menuProductId: true, notes: true,
      comboSelections: true, tableGuestId: true, pesoKg: true, prontoEm: true,
    },
  },
} as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const operador = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
    });
    if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const { lojaIds } = await lojasDaVisao(operador, await cookieDaVisao()).catch(() => ({
      lojaIds: [operador.ownerId || operador.id],
    }));
    const { id } = await params;
    const order = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: { in: lojaIds } }, select: CAMPOS });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    const avaliacao = order.tableSessionId ? avaliarEdicaoDaMesa(order as any, operador) : avaliarEdicao(order as any, operador);
    if (avaliacao.modo === "BLOQUEADO") return NextResponse.json({ error: avaliacao.motivo }, { status: 403 });
    const pode = cortesiaNaEdicao(order as any, avaliacao);
    if (!pode.pode) return NextResponse.json({ error: pode.motivo }, { status: 403 });
    // Mesa: as guardas da tela de Mesas (conta aberta, rodada desta conta, sem nota).
    if (order.tableSessionId) {
      const carregado = await carregarRodadaDaMesa(order.franchiseeId, order.id);
      if ("erro" in carregado) return NextResponse.json(carregado.erro.corpo, { status: carregado.erro.status });
    }

    const corpo = await req.json().catch(() => ({}));
    const motivo = motivoDoCorpo(corpo);
    if (!motivo) {
      return NextResponse.json(
        { error: `Escreva o motivo da cortesia (pelo menos ${MINIMO_DO_MOTIVO} letras). Ele aparece no relatório de cortesias.`, precisaDeMotivo: true },
        { status: 400 }
      );
    }
    const plano = planejarCortesia(order.items as any, { itemId: corpo?.itemId, quantidade: corpo?.quantidade });
    if (!plano.ok) return NextResponse.json({ error: plano.erro }, { status: 400 });
    // Cortesia é desconto de 100% no item: o "Dar desconto" da senha do
    // gerente vale aqui também — senão era o caminho para contornar a senha.
    const semSenha = await exigirSenhaDoGerente(req, order.franchiseeId, "darDesconto");
    if (semSenha) return semSenha;

    // O total refeito dos itens como ficam (a cortesia a R$ 0,00), mantendo
    // desconto, taxa de entrega e acréscimo no crédito — a conta da edição.
    const itensDepois = order.items.map((i) =>
      i.id === plano.item.id
        ? { price: plano.separa ? i.price : 0, quantity: plano.separa ? i.quantity - plano.quantidade : i.quantity }
        : { price: i.price, quantity: i.quantity }
    );
    if (plano.separa) itensDepois.push({ price: 0, quantity: plano.quantidade });
    const totalDepois = recalcularTotal({
      itens: itensDepois,
      deliveryFee: order.deliveryFee,
      discountTotal: order.discountTotal,
      acrescimo: order.tableSessionId ? 0 : valorDoAcrescimoGravado(order),
    });

    const quem = `${operador.name || operador.email || "?"} (${(operador.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono"})`;
    const registro: RegistroDeEdicao = {
      quando: new Date().toISOString(),
      quem,
      quemId: operador.id,
      acao: "CORTESIA",
      descricao: plano.descricao,
      totalAntes: order.totalAmount || 0,
      totalDepois,
      motivo,
      itensCortesia: [plano.linha],
    };

    const gravou = await prisma.$transaction(async (tx) => {
      // Só passa se o pedido ainda é o que foi lido (dois aparelhos ao mesmo tempo).
      const r = await tx.customerOrder.updateMany({
        where: { id: order.id, franchiseeId: order.franchiseeId, totalAmount: order.totalAmount },
        data: { totalAmount: totalDepois, editHistory: empilharEdicao(order.editHistory, registro) as any },
      });
      if (r.count !== 1) return false;
      const it = order.items.find((i) => i.id === plano.item.id)!;
      if (plano.separa) {
        await tx.customerOrderItem.update({ where: { id: it.id }, data: { quantity: it.quantity - plano.quantidade } });
        await tx.customerOrderItem.create({
          data: {
            orderId: order.id,
            menuProductId: it.menuProductId,
            productName: it.productName,
            quantity: plano.quantidade,
            price: 0,
            notes: it.notes,
            comboSelections: it.comboSelections ?? Prisma.DbNull,
            tableGuestId: it.tableGuestId,
            prontoEm: it.prontoEm,
          },
        });
      } else {
        await tx.customerOrderItem.update({ where: { id: it.id }, data: { price: 0 } });
      }
      return true;
    });
    if (!gravou) return NextResponse.json({ error: "O pedido mudou enquanto você dava a cortesia. Abra de novo e confira." }, { status: 409 });

    console.log(`[Cortesia] pedido ${order.id} (#${order.dailyOrderNumber ?? "—"}): ${plano.descricao} — ${motivo}; total ${order.totalAmount} → ${totalDepois}; por ${quem}`);
    return NextResponse.json({ success: true, totalAmount: totalDepois, cortesia: plano.linha.valor, registro });
  } catch (err: any) {
    console.error("[Cortesia]", err);
    return NextResponse.json({ error: "Erro ao dar a cortesia" }, { status: 500 });
  }
}
