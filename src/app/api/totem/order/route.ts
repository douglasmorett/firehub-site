import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumberTx } from "@/lib/order-number";
import { precoUnitarioDoItem, precoMinimoDoProduto } from "@/lib/preco-combo";
import { autenticarTotem } from "@/lib/totem-auth";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelHoje } from "@/lib/cardapio-interno";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, customerName, items, notes, paymentMethod } = body;

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const licenca = auth.licenca;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    // O produto precisa ser da loja, estar ativo E estar liberado para o totem.
    // Antes bastava ser da loja: quem montasse a requisição na mão comprava um
    // item que o totem nem oferece — inclusive o espelho do catálogo do iFood.
    const productIds = [...new Set(items.map((i: any) => i?.menuProductId).filter(Boolean))];
    const dbProducts = await prisma.menuProduct.findMany({
      where: {
        id: { in: productIds },
        franchiseeId: licenca.franchiseeId,
        active: true,
        activeTotem: true,
        ...SEM_PRODUTO_DE_INTEGRACAO,
      },
      include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
    });

    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    let totalAmount = 0;
    const orderItems: Array<{ menuProductId: string; quantity: number; price: number; comboSelections: any }> = [];
    const recusados: string[] = [];

    for (const item of items) {
      const product = productMap.get(item.menuProductId);
      if (!product) {
        recusados.push(String(item?.menuProductId ?? "?"));
        continue;
      }

      // Produto de dia específico não pode ser vendido fora do dia. O cardápio
      // já esconde, mas a tela pode estar aberta desde ontem.
      if (!disponivelHoje(product.availableDays)) {
        recusados.push(product.name);
        continue;
      }

      // Mesma conta do cardápio, do modal e do robô — src/lib/preco-combo.ts.
      let itemPrice = precoUnitarioDoItem(product as any, item.comboSelections);

      // Piso de segurança: produto cujo valor mora nas opções (o "Nugget" da
      // Hakim, base R$ 0,00) sairia por R$ 0,00 se a escolha não viesse ou não
      // casasse. Melhor cobrar o mínimo possível do que entregar de graça.
      const minimo = precoMinimoDoProduto(product as any);
      if (itemPrice < minimo) {
        console.warn(
          `[Totem] "${product.name}" sairia por R$ ${itemPrice} sem escolha válida; aplicando o mínimo R$ ${minimo}.`
        );
        itemPrice = minimo;
      }

      const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));
      totalAmount += itemPrice * quantity;

      orderItems.push({
        menuProductId: product.id,
        quantity,
        price: itemPrice,
        comboSelections: item.comboSelections || null,
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: "Nenhum produto válido no carrinho. Atualize o cardápio e tente de novo." },
        { status: 400 }
      );
    }

    // Recusar item silenciosamente é pior do que recusar o pedido: o cliente
    // paga na maquininha o valor da tela e recebe menos comida.
    if (recusados.length > 0) {
      return NextResponse.json(
        {
          error: "carrinho_desatualizado",
          mensagem: `Estes itens saíram do cardápio: ${recusados.join(", ")}. Refaça o pedido.`,
          itensRecusados: recusados,
        },
        { status: 409 }
      );
    }

    const store = await prisma.user.findUnique({
      where: { id: licenca.franchiseeId },
      select: { autoAcceptOrders: true },
    });
    const initialStatus = store?.autoAcceptOrders ? "ACEITO" : "NOVO";

    // Numeração DENTRO da transação que grava o pedido. Fora dela, o número é
    // consumido antes do insert e evapora se o insert falhar — foi o que abriu
    // buracos na sequência (os pedidos 92, 95 e 97 que sumiram).
    const order = await prisma.$transaction(async (tx) => {
      const dailyOrderNumber = await generateDailyOrderNumberTx(tx, licenca.franchiseeId);

      return tx.customerOrder.create({
        data: {
          franchiseeId: licenca.franchiseeId,
          dailyOrderNumber,
          customerName: customerName || `Totem ${licenca.label}`,
          customerPhone: "totem",
          deliveryType: "TAKEOUT", // Totem é sempre retirada no balcão
          paymentMethod: paymentMethod || "Cartão (Maquininha)",
          totalAmount,
          deliveryFee: 0,
          status: initialStatus,
          source: "TOTEM",
          notes: notes || null,
          kdsStage: "PRODUCTION",
          totemLicenseId: licenca.id,
          items: { create: orderItems },
        },
        include: { items: true },
      });
    });

    // Daqui para baixo é consequência do pedido já gravado: nada pode derrubar
    // a resposta. O cliente já está com o número dele na mão.
    prisma.user
      .update({ where: { id: licenca.franchiseeId }, data: { storeOrderCount: { increment: 1 } } })
      .catch((e) => console.error("[Totem] contador de pedidos:", e));

    // Baixa de estoque: o totem não fazia. Venda pelo autoatendimento saía do
    // caixa sem sair do estoque, e o saldo ia descolando do real todo dia.
    import("@/lib/stock")
      .then(({ deductStockForOrder }) => deductStockForOrder(order.id))
      .catch((e) => console.error("[Totem] baixa de estoque:", e));

    import("@/lib/billing")
      .then(({ trackSaleForBilling }) => trackSaleForBilling(licenca.franchiseeId))
      .catch((e) => console.error("[Totem] faturamento:", e));

    import("@/app/api/store/print-queue/route")
      .then(({ pushJobToPrintQueue }) => pushJobToPrintQueue(licenca.franchiseeId, order))
      .catch((e) => console.error("[Totem] impressão:", e));

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        numero: order.dailyOrderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        itemCount: order.items.length,
        createdAt: order.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[Totem Order] Erro:", err);
    return NextResponse.json({ error: "Erro ao criar pedido" }, { status: 500 });
  }
}
