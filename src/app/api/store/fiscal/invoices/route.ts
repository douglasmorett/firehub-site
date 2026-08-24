import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const status = searchParams.get("status");
    const paymentMethod = searchParams.get("paymentMethod");

    const whereClause: any = { franchiseeId };

    if (fromDate || toDate) {
      whereClause.createdAt = {};
      if (fromDate) whereClause.createdAt.gte = new Date(fromDate + "T00:00:00.000Z");
      if (toDate) whereClause.createdAt.lte = new Date(toDate + "T23:59:59.999Z");
    }

    if (status && status !== "ALL") {
      whereClause.fiscalStatus = status;
    }

    if (paymentMethod && paymentMethod !== "ALL") {
      whereClause.paymentMethod = { contains: paymentMethod, mode: "insensitive" };
    }

    const orders = await prisma.customerOrder.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuProduct: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // ── SÓ O QUE EXISTE DE VERDADE ──────────────────────────────────────────
    // Este bloco fabricava a nota inteira quando o pedido não tinha uma:
    //
    //   isEmitted   = pedido com mais de uma hora
    //   nfceNumber  = Math.floor(10000 + (created.getTime() % 89999))
    //   nfceKey     = "352608" + dígitos do id do lojista + "65001" + ...
    //   protocol    = "13526" + últimos 10 dígitos do timestamp
    //   impostos    = 13,45% do total, fixo
    //   xmlUrl      = rota que não existe
    //
    // Chave de acesso, número e protocolo são emitidos pela SEFAZ; inventar os
    // três e ainda marcar a nota como AUTORIZADA porque o pedido é velho fazia a
    // tela mostrar um documento fiscal que nunca existiu. O lojista guardava
    // aquela chave achando ter uma nota.
    //
    // Agora: se `fiscalInfo` tem dados reais gravados por uma emissão, mostra.
    // Se não tem, o pedido aparece como PENDENTE e ponto.
    const formattedOrders = orders.map((order) => {
      const fiscal = (order.fiscalInfo as any) || {};
      const foiEmitida = order.fiscalStatus === "EMITTED" && Boolean(fiscal.nfceKey);

      const itemsFormatted = order.items.map((item: any) => {
        const mp = item.menuProduct;
        const temDetalhe =
          mp?.fiscalBreakdown && Array.isArray(mp.fiscalBreakdown) && mp.fiscalBreakdown.length > 0;

        return {
          id: item.id,
          // productName preserva o nome do momento da venda; menuProduct.name
          // muda se o lojista renomear o produto depois, e a nota tem que
          // refletir o que foi vendido.
          name: item.productName || mp?.name || "Item",
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          isCombo: Boolean(mp?.isCombo),
          ncm: mp?.ncm ?? null,
          cfop: mp?.cfop ?? null,
          fiscalBreakdown: temDetalhe ? mp.fiscalBreakdown : null,
          // O que impede este item de entrar numa nota, se for o caso.
          pendenciaFiscal: mp?.ncm ? null : "Produto sem NCM cadastrado",
        };
      });

      return {
        id: order.id,
        dailyOrderNumber:
          (order as any).dailyOrderNumber || (order as any).orderSeqNumber || order.id.slice(-5),
        customerName: order.customerName || "Cliente Consumidor",
        customerCpfCnpj: order.customerCpfCnpj || null,
        customerPhone: order.customerPhone || "—",
        customerAddress: order.customerAddress || "Balcão / Retirada",
        paymentMethod: order.paymentMethod || "Dinheiro",
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        createdAt: order.createdAt,
        fiscalStatus: order.fiscalStatus || "PENDING",
        // `null` quando não houve emissão. A tela mostra "não emitida" em vez
        // de um documento inventado.
        fiscalInfo: foiEmitida
          ? {
              nfceNumber: fiscal.nfceNumber ?? null,
              serie: fiscal.serie ?? null,
              nfceKey: fiscal.nfceKey,
              protocol: fiscal.protocol ?? null,
              emittedAt: fiscal.emittedAt ?? null,
              ambiente: fiscal.ambiente ?? null,
              xmlUrl: fiscal.xmlUrl ?? null,
              pdfUrl: fiscal.pdfUrl ?? null,
              items: itemsFormatted,
            }
          : null,
        itens: itemsFormatted,
      };
    });

    return NextResponse.json({ success: true, orders: formattedOrders });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
