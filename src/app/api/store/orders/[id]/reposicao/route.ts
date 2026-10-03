/**
 * Reposição: o item que faltou (ou veio errado) num pedido que JÁ SAIU
 * (colunas Saiu para entrega e Finalizado do quadro).
 *
 * POST {
 *   motivo: "FALTOU" | "TROCA",
 *   prioridade: boolean,          // topo da produção no KDS (padrão: sim)
 *   observacao?: string,
 *   itens: [{ itemId, quantity, opcao?: { nome } }]
 * }
 *
 * `opcao` é a escolha DENTRO de um combo: no caso que originou isto, o combo
 * de 10 esfihas de carne + 1 de Nevada, faltou só a de Nevada. Ela vira item
 * próprio no pedido de reposição, ligado ao produto do cardápio pelo nome
 * (é o produto que diz a categoria — sem ela o pedido some do KDS).
 *
 * Nasce um pedido novo, R$ 0,00, "Pago Online", com a comanda própria e o
 * aviso "JÁ PAGO - SÓ ENTREGAR". Ver lib/reposicao.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { podeEditarPedidos, empilharEdicao } from "@/lib/edicao-de-pedido";
import {
  podeTerReposicao,
  numeroDoPedido,
  formaDePagamentoDaReposicao,
  observacaoDaReposicao,
  ROTULO_DO_MOTIVO,
  opcoesDoItem,
  type MotivoDaReposicao,
  type Reposicao,
} from "@/lib/reposicao";

type ItemPedido = { itemId: string; quantity: number; opcao?: { nome: string } | null };

function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const operador = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
    });
    if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    if (!podeEditarPedidos(operador)) {
      return NextResponse.json({ error: "Você não tem permissão para editar pedidos." }, { status: 403 });
    }
    const lojaId = operador.ownerId || operador.id;
    const { id } = await params;

    const order = await prisma.customerOrder.findFirst({
      where: { id, franchiseeId: lojaId },
      select: {
        id: true, status: true, dailyOrderNumber: true, ifoodReference: true, openDeliveryReference: true,
        customerId: true, customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
        deliveryType: true, editHistory: true, totalAmount: true,
        items: {
          select: { id: true, menuProductId: true, productName: true, quantity: true, notes: true, comboSelections: true },
        },
      },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!podeTerReposicao(order)) {
      return NextResponse.json(
        { error: "A reposição é para pedido que já saiu (Saiu para entrega ou Finalizado). Antes disso, edite o pedido (lápis) — ele ainda está na loja." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const motivo: MotivoDaReposicao = body?.motivo === "TROCA" ? "TROCA" : "FALTOU";
    const prioridade = body?.prioridade !== false;
    const observacao = String(body?.observacao || "").slice(0, 300);
    const pedidos: ItemPedido[] = Array.isArray(body?.itens) ? body.itens : [];
    if (pedidos.length === 0) return NextResponse.json({ error: "Marque o que faltou." }, { status: 400 });

    // Os produtos das opções de combo, pelo nome — uma consulta só.
    const nomesDasOpcoes = pedidos.map((p) => p.opcao?.nome).filter(Boolean) as string[];
    const produtosDaLoja = nomesDasOpcoes.length
      ? await prisma.menuProduct.findMany({ where: { franchiseeId: lojaId }, select: { id: true, name: true } })
      : [];
    const produtoPeloNome = new Map(produtosDaLoja.map((p) => [normalizar(p.name), p.id]));

    const novosItens: { menuProductId: string | null; productName: string; quantity: number; price: number; notes: string | null; comboSelections?: any }[] = [];
    for (const p of pedidos) {
      const item = order.items.find((i) => i.id === p.itemId);
      if (!item) return NextResponse.json({ error: "Item não é deste pedido." }, { status: 400 });
      const qtd = Math.floor(Number(p.quantity) || 0);
      if (qtd <= 0) continue;

      if (p.opcao?.nome) {
        // Já multiplicada pelo item: 2x combo com 1 Nevada = 2 Nevadas.
        const maximo = opcoesDoItem(item).find((o) => o.nome === p.opcao!.nome)?.quantidade || 0;
        if (maximo <= 0) return NextResponse.json({ error: `"${p.opcao.nome}" não está neste pedido.` }, { status: 400 });
        if (qtd > maximo) return NextResponse.json({ error: `O pedido tinha ${maximo}x ${p.opcao.nome}.` }, { status: 400 });
        novosItens.push({
          menuProductId: produtoPeloNome.get(normalizar(p.opcao.nome)) ?? item.menuProductId,
          productName: p.opcao.nome,
          quantity: qtd,
          price: 0,
          notes: `do ${item.productName || "combo"}`,
        });
      } else {
        if (qtd > item.quantity) return NextResponse.json({ error: `O pedido tinha ${item.quantity}x ${item.productName}.` }, { status: 400 });
        novosItens.push({
          menuProductId: item.menuProductId,
          productName: item.productName || "Item",
          quantity: qtd,
          price: 0,
          notes: item.notes,
          ...(item.comboSelections ? { comboSelections: item.comboSelections as any } : {}),
        });
      }
    }
    if (novosItens.length === 0) return NextResponse.json({ error: "Marque o que faltou." }, { status: 400 });

    const numero = numeroDoPedido(order);
    const reposicao: Reposicao = { pedidoId: order.id, numero, motivo };
    const descricao = novosItens.map((i) => `${i.quantity}x ${i.productName}`).join(", ");
    const quem = nomeDoOperador(operador);

    const novo = await prisma.customerOrder.create({
      data: {
        franchiseeId: lojaId,
        dailyOrderNumber: await generateDailyOrderNumber(lojaId),
        customerId: order.customerId,
        customerName: order.customerName || "Cliente",
        customerPhone: order.customerPhone || "00000000000",
        customerAddress: order.customerAddress || "",
        ...(order.customerLatLng ? { customerLatLng: order.customerLatLng as any } : {}),
        deliveryType: order.deliveryType || "DELIVERY",
        paymentMethod: formaDePagamentoDaReposicao(numero),
        // Já pago no original: nem item, nem taxa. Faturamento e caixa ficam
        // como estavam.
        deliveryFee: 0,
        totalAmount: 0,
        status: "ACEITO",
        source: "PRESENCIAL",
        notes: observacaoDaReposicao({ numero, motivo, observacao }),
        reposicao: reposicao as any,
        prioridadeNaCozinha: prioridade,
        editHistory: [
          { quando: new Date().toISOString(), quem, acao: "REPOSICAO", descricao: `${ROTULO_DO_MOTIVO[motivo]} do pedido #${numero}: ${descricao}`, totalAntes: 0, totalDepois: 0 },
        ] as any,
        items: { create: novosItens },
      },
      select: { id: true, dailyOrderNumber: true },
    });

    if (motivo === "TROCA") {
      import("@/lib/stock")
        .then(({ deductStockForOrder }) => deductStockForOrder(novo.id))
        .catch((e: any) => console.error(`[Reposição] baixa de estoque ${novo.id}:`, e?.message));
    }

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        editHistory: empilharEdicao(order.editHistory, {
          quando: new Date().toISOString(),
          quem,
          acao: "REPOSICAO",
          descricao: `${ROTULO_DO_MOTIVO[motivo]}: ${descricao} (pedido de reposição #${novo.dailyOrderNumber ?? novo.id.slice(-6).toUpperCase()})`,
          totalAntes: order.totalAmount || 0,
          totalDepois: order.totalAmount || 0,
        }) as any,
      },
    });

    console.log(`[Reposição] ${novo.id} (${motivo}) do pedido ${order.id}: ${descricao}, por ${quem}`);
    return NextResponse.json({ success: true, reposicao: { id: novo.id, numero: novo.dailyOrderNumber, descricao } });
  } catch (e: any) {
    console.error("[Reposição] erro:", e?.message);
    return NextResponse.json({ error: "Não deu para lançar a reposição. Tente de novo." }, { status: 500 });
  }
}
