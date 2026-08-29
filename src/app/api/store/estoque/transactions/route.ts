import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Fetch transaction history
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, ownerId: true }
    });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    // O STAFF é um User com ownerId apontando para o dono da loja: sem isso o funcionário
    // não via nenhuma movimentação, porque o estoque pertence ao dono e não a ele.
    const franchiseeId = user.ownerId || user.id;

    const transactions = await prisma.stockTransaction.findMany({
      where: {
        stockItem: {
          franchiseeId
        }
      },
      include: {
        stockItem: {
          select: { id: true, name: true, unit: true }
        },
        // `stockLotId` é FK de verdade e vem preenchida em TODA baixa por QR,
        // mas o GET nunca a incluiu: o único vestígio de que alguém escaneou
        // era o texto cru dentro de `notes`, e no histórico uma baixa por
        // etiqueta ficava indistinguível de uma digitada na mão. Sem isso o
        // lojista não tem como ver que escanear mexeu no sistema.
        stockLot: {
          select: { code: true, productName: true, validoAte: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return NextResponse.json({ success: true, transactions });
  } catch (error: any) {
    console.error("[Stock Transactions GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Add a new manual transaction (INPUT / OUTPUT / WASTE)
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, ownerId: true }
    });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    // O STAFF é um User com ownerId apontando para o dono da loja: sem isso a baixa
    // manual do funcionário nunca encontrava o ingrediente da loja onde ele trabalha.
    const franchiseeId = user.ownerId || user.id;

    const body = await req.json();
    const { stockItemId, quantity, type, notes } = body;

    if (!stockItemId || quantity === undefined || !type) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    // Verificar se o stockItem pertence ao franchisee
    const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!stockItem || stockItem.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Ingrediente não encontrado" }, { status: 404 });
    }

    // Number("1e400") vira Infinity e passa por isNaN: o saldo do ingrediente virava
    // Infinity no Postgres (double aceita) e nenhum lançamento posterior trazia ele de
    // volta, porque incremento sobre Infinity continua Infinity — e a tela de itens só
    // edita nome, unidade e mínimo, então o lojista ficava sem como consertar.
    const qtyVal = Number(quantity);
    if (!Number.isFinite(qtyVal)) return NextResponse.json({ error: "Quantidade inválida" }, { status: 400 });

    // O sinal sai do tipo, e não de um "se for OUTPUT": a tela de histórico também exibe
    // "Venda" (SALE), então nada impedia alguém mandar SALE por aqui e cair no ramo padrão,
    // somando no saldo uma movimentação que é baixa. Tipo fora desta tabela é recusado para
    // não gravar movimentação com sinal adivinhado.
    const sinalPorTipo: Record<string, number> = {
      INPUT: 1,
      OUTPUT: -1,
      WASTE: -1,
      SALE: -1
    };
    const sinal = sinalPorTipo[type];
    if (sinal === undefined) {
      return NextResponse.json({ error: "Tipo de movimentação inválido" }, { status: 400 });
    }
    const finalQuantity = Math.abs(qtyVal) * sinal;

    // Histórico e saldo têm que cair juntos. Em dois comandos soltos, o create passando e o
    // update falhando deixava a movimentação na lista sem nunca ter mexido no estoque, e o
    // lojista conferia o histórico contra um saldo que não bate.
    const { transaction, updatedItem } = await prisma.$transaction(async (tx) => {
      const transaction = await tx.stockTransaction.create({
        data: {
          stockItemId,
          quantity: finalQuantity,
          type,
          notes: notes || null
        }
      });

      // O franchiseeId vai junto no where da escrita, como em nfe-confirm, e não só na
      // conferência lá de cima: entre conferir e gravar o ingrediente pode ter sido
      // apagado, e com update por id puro a movimentação de uma loja seguiria mexendo em
      // saldo que não é dela. Sem casar, o Prisma derruba a transação inteira e o
      // histórico não fica com uma movimentação que nunca aconteceu.
      const updatedItem = await tx.stockItem.update({
        where: { id: stockItemId, franchiseeId },
        data: {
          quantity: {
            increment: finalQuantity
          }
        }
      });

      return { transaction, updatedItem };
    });

    return NextResponse.json({ success: true, transaction, currentQuantity: updatedItem.quantity });
  } catch (error: any) {
    console.error("[Stock Transactions POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
