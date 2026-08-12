import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const { items, invoiceData, imageUrl } = await req.json();
    // items = Array<{ stockItemId: string | 'NEW', newItemName?: string, newItemUnit?: string, quantidade: number, valorUnitario: number, valorTotal: number }>
    // invoiceData = { fornecedor, numeroNF, dataEmissao, valorTotal }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Nenhum item para processar" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdItems: string[] = [];
      const transactions: string[] = [];

      for (const item of items) {
        let stockItemId = item.stockItemId;

        // If NEW, create the stock item
        if (stockItemId === 'NEW' || !stockItemId) {
          const existing = await tx.stockItem.findFirst({
            where: { 
              franchiseeId: user.id, 
              name: { equals: item.newItemName || item.nome, mode: 'insensitive' } 
            }
          });
          
          if (existing) {
            stockItemId = existing.id;
          } else {
            const newItem = await tx.stockItem.create({
              data: {
                franchiseeId: user.id,
                name: item.newItemName || item.nome,
                quantity: 0,
                unit: item.newItemUnit || item.unidade || 'un',
                minQuantity: null,
                unitCost: item.valorUnitario || null,
                supplier: invoiceData?.fornecedor || null,
              }
            });
            stockItemId = newItem.id;
            createdItems.push(newItem.id);
          }
        }

        // Update unit cost and supplier on the stock item
        await tx.stockItem.update({
          where: { id: stockItemId },
          data: {
            quantity: { increment: item.quantidade },
            ...(item.valorUnitario ? { unitCost: item.valorUnitario } : {}),
            ...(invoiceData?.fornecedor ? { supplier: invoiceData.fornecedor } : {}),
          }
        });

        // Create stock transaction
        const transaction = await tx.stockTransaction.create({
          data: {
            stockItemId,
            quantity: item.quantidade,
            type: 'INPUT',
            notes: `NF-e${invoiceData?.numeroNF ? ` #${invoiceData.numeroNF}` : ''}${invoiceData?.fornecedor ? ` - ${invoiceData.fornecedor}` : ''} (R$ ${(item.valorTotal || 0).toFixed(2)})`,
          }
        });
        transactions.push(transaction.id);
      }

      // Save invoice record
      const invoice = await tx.stockInvoice.create({
        data: {
          franchiseeId: user.id,
          invoiceNumber: invoiceData?.numeroNF || null,
          supplier: invoiceData?.fornecedor || null,
          totalAmount: invoiceData?.valorTotal || null,
          imageUrl: imageUrl || null,
          processedData: { items, invoiceData },
        }
      });

      return { createdItems: createdItems.length, transactions: transactions.length, invoiceId: invoice.id };
    });

    return NextResponse.json({ 
      success: true, 
      message: `${result.transactions} itens processados com sucesso`,
      ...result 
    });
  } catch (error: any) {
    console.error("[NFe Confirm] Error:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
