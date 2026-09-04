import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelHoje } from "@/lib/cardapio-interno";
import { aplicarPrecoDoCanalComCombo } from "@/lib/preco-por-canal";
import { precoUnitarioDoItem, precoMinimoDoProduto } from "@/lib/preco-combo";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { items, notes, customerName } = data;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Items are required" }, { status: 400 });
    }

    const tableSession = await prisma.tableSession.findUnique({
      where: { id },
      include: {
        table: true
      }
    });

    if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tableSession.status !== "OPEN") {
      return NextResponse.json({ error: "Session is not open" }, { status: 400 });
    }

    // ── PREÇO E PRODUTO SÃO DO SERVIDOR, NÃO DO CORPO ─────────────────────
    // A rota gravava o `price` que a tela mandava e aceitava qualquer
    // menuProductId. Com o módulo aberto ao garçom pelo link — o papel de
    // menor confiança do sistema — bastaria uma requisição montada na mão para
    // lançar o combo por R$ 0,01 ou um produto de outra loja. Mesma regra do
    // totem (api/totem/order): produto da loja, ativo e liberado para o
    // salão; preço recalculado pelo canal a partir das escolhas do combo, com
    // o mínimo do produto como piso; quantidade inteira de 1 a 99.
    const idsPedidos = [...new Set(items.map((i: any) => String(i?.menuProductId ?? "")).filter(Boolean))] as string[];
    const produtosDaLoja = await prisma.menuProduct.findMany({
      where: {
        id: { in: idsPedidos },
        franchiseeId: targetFranchiseeId,
        active: true,
        activeGarcom: true,
        ...SEM_PRODUTO_DE_INTEGRACAO,
      },
      include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
    });
    const porId = new Map(produtosDaLoja.map((p) => [p.id, p]));

    const recusados: string[] = [];
    const itensValidados: {
      menuProductId: string;
      quantity: number;
      price: number;
      comboSelections: any;
      tableGuestId: string | null;
    }[] = [];

    for (const item of items) {
      const produto = porId.get(String(item?.menuProductId ?? ""));
      if (!produto) {
        recusados.push(String(item?.menuProductId ?? "?"));
        continue;
      }
      // Produto de dia específico não sai fora do dia; a tela pode estar
      // aberta desde ontem.
      if (!disponivelHoje(produto.availableDays)) {
        recusados.push(produto.name);
        continue;
      }
      // Mesma conta do cardápio, do modal e do totem (src/lib/preco-combo.ts).
      const noCanal = aplicarPrecoDoCanalComCombo(produto as any, "salao");
      let preco = precoUnitarioDoItem(noCanal as any, item.comboSelections);
      const minimo = precoMinimoDoProduto(noCanal as any);
      if (preco < minimo) preco = minimo;
      const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)));
      itensValidados.push({
        menuProductId: produto.id,
        quantity,
        price: preco,
        comboSelections: item.comboSelections ?? null,
        tableGuestId: item.tableGuestId ? String(item.tableGuestId) : null,
      });
    }

    if (recusados.length > 0) {
      // Recusar o pedido inteiro, não o item: lançar MENOS do que o garçom
      // conferiu com o cliente é pior do que pedir para lançar de novo.
      return NextResponse.json(
        { error: `Estes itens não estão no cardápio da mesa: ${recusados.join(", ")}. Atualize a tela e lance de novo.` },
        { status: 400 }
      );
    }

    const totalAmount = itensValidados.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Só aceita vincular a item quem realmente está NESTA mesa. Sem esta
    // conferência, um id qualquer no corpo da requisição jogaria o consumo na
    // conta de uma pessoa de outra mesa.
    const pedidos = items.map((i: any) => i?.tableGuestId).filter(Boolean);
    const idsValidos = new Set<string>();
    if (pedidos.length > 0) {
      const daMesa = await prisma.tableGuest.findMany({
        where: { id: { in: pedidos }, tableSessionId: id },
        select: { id: true },
      });
      daMesa.forEach((g: any) => idsValidos.add(g.id));
    }

    const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);
    

    const defaultName = customerName || tableSession.customerName || `Mesa ${tableSession.table.number}`;

    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: targetFranchiseeId,
        dailyOrderNumber,
        customerName: defaultName,
        customerPhone: "00000000000",
        customerAddress: `Mesa ${tableSession.table.number}`,
        deliveryType: "MESA",
        paymentMethod: "N/A", // Payment happens at session close
        notes: notes || "",
        totalAmount,
        deliveryFee: 0,
        status: "ACEITO",
        source: "PRESENCIAL",
        tableSessionId: id,
        items: {
          create: itensValidados.map((item): Prisma.CustomerOrderItemUncheckedCreateWithoutOrderInput => ({
            menuProductId: item.menuProductId,
            quantity: item.quantity,
            price: item.price,
            // De quem é este item. Nulo = da mesa inteira (couvert, entrada
            // para dividir), e nesse caso entra no rateio geral no fechamento.
            // É o que permite rachar a conta pelo consumo real de cada um em
            // vez de dividir por igual — que é onde alguém sempre paga a
            // bebida do outro.
            tableGuestId: item.tableGuestId && idsValidos.has(item.tableGuestId) ? item.tableGuestId : null,
            // Coluna Json: ausente (undefined) vira o nulo do banco; null literal o
            // Prisma recusa para Json.
            comboSelections: item.comboSelections ? (typeof item.comboSelections === "string" ? item.comboSelections : JSON.stringify(item.comboSelections)) : undefined,
          })),
        },
      },
    });

    // Realiza a baixa imediata no estoque do pedido
    const { deductStockForOrder } = await import("@/lib/stock");
    deductStockForOrder(order.id).catch(err =>
      console.error("[Stock] Erro ao deduzir estoque de pedido de mesa:", err)
    );

    // Enfileira impressão automática
    try {
      const fullOrder = await prisma.customerOrder.findUnique({
        where: { id: order.id },
        include: {
          items: {
            include: {
              menuProduct: { select: { id: true, name: true, isBeverage: true } }
            }
          }
        }
      });

      if (fullOrder) {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        pushJobToPrintQueue(targetFranchiseeId, fullOrder, operador.tipo === "loja" && operador.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS");
      }
    } catch (printErr) {
      console.error("[Mesa] Erro ao enfileirar impressão automática:", printErr);
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error("[Table Sessions Add Order POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
