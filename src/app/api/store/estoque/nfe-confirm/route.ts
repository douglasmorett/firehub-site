import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { converter, fatorDeConversao, normalizarUnidade } from "@/lib/unidades";

/**
 * Recusa que é culpa do que veio escrito na nota, não do servidor: nota em "cx"
 * para um insumo em "un" (ninguém além do lojista sabe quantas unidades vêm na
 * caixa), quantidade que a IA leu errado. Jogar um erro próprio deixa a transação
 * inteira ser desfeita e vira um 400 explicando o que falta, em vez de um 500
 * seco — e a tela de estoque mostra essa mensagem direto para o lojista.
 */
class NotaRecusadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "NotaRecusadaError";
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    // O STAFF é um User com ownerId apontando para o dono da loja: sem isso a nota lançada
    // pelo funcionário criava itens num estoque paralelo, sem tocar no estoque da loja.
    const franchiseeId = user.ownerId || user.id;

    const { items, invoiceData, imageUrl } = await req.json();
    // items = Array<{ stockItemId: string | 'NEW', newItemName?: string, newItemUnit?: string, quantidade: number, valorUnitario: number, valorTotal: number }>
    // invoiceData = { fornecedor, numeroNF, dataEmissao, valorTotal }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Nenhum item para processar" }, { status: 400 });
    }

    // Os stockItemId vêm crus do body, então a loja A podia lançar uma nota somando
    // quantidade em ingredientes da loja B. Confere todos de uma vez antes de abrir a
    // transação, para recusar a nota inteira com 400 em vez de gravar metade.
    const idsInformados: string[] = Array.from(
      new Set(
        items
          .filter((item: any) => item?.stockItemId && item.stockItemId !== "NEW")
          .map((item: any) => String(item.stockItemId))
      )
    );

    if (idsInformados.length > 0) {
      const itensDaLoja = await prisma.stockItem.findMany({
        where: { id: { in: idsInformados }, franchiseeId },
        select: { id: true }
      });

      if (itensDaLoja.length !== idsInformados.length) {
        return NextResponse.json(
          { error: "Um dos itens da nota não pertence ao estoque desta loja" },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdItems: string[] = [];
      const transactions: string[] = [];
      // Uma linha em "cx" derruba a nota inteira, então vale juntar todas as linhas
      // problemáticas e dizer de uma vez: recusando na primeira, o lojista corrigia uma,
      // mandava de novo e descobria a próxima.
      const incompativeis: string[] = [];

      for (const item of items) {
        let stockItemId = item.stockItemId;
        // O valor da nota pode chegar como texto ("42,00") quando a leitura da IA escapa
        // do JSON numérico. Number(...) disso dá NaN, o Postgres aceita NaN em double e o
        // custo do insumo ficava NaN — a partir dali o CMV inteiro saía NaN na tela.
        const valorUnitarioNota = Number(item.valorUnitario);
        const valorUnitarioValido = Number.isFinite(valorUnitarioNota) && valorUnitarioNota > 0;

        // If NEW, create the stock item
        if (stockItemId === 'NEW' || !stockItemId) {
          const existing = await tx.stockItem.findFirst({
            where: {
              franchiseeId,
              name: { equals: item.newItemName || item.nome, mode: 'insensitive' }
            }
          });

          if (existing) {
            stockItemId = existing.id;
          } else {
            const newItem = await tx.stockItem.create({
              data: {
                franchiseeId,
                name: item.newItemName || item.nome,
                quantity: 0,
                unit: normalizarUnidade(item.newItemUnit || item.unidade) || 'un',
                minQuantity: null,
                unitCost: valorUnitarioValido ? valorUnitarioNota : null,
                supplier: invoiceData?.fornecedor || null,
              }
            });
            stockItemId = newItem.id;
            createdItems.push(newItem.id);
          }
        }

        // O saldo mora na unidade em que o insumo foi cadastrado, e a nota quase nunca vem
        // na mesma: o queijo está em g, chegou nota de 5 kg e o saldo de 5000 virava 5005
        // em vez de 10000 — depois a ficha técnica dava baixa em cima de um saldo que nunca
        // existiu. Por isso a quantidade da nota é convertida antes de entrar no estoque.
        const insumo = await tx.stockItem.findFirst({
          where: { id: stockItemId, franchiseeId },
          select: { name: true, unit: true }
        });

        if (!insumo) {
          throw new Error("Um dos itens da nota não pertence ao estoque desta loja");
        }

        // Insumo com unidade em branco (o cadastro pela tela só oferece g/kg/un/ml/l, mas a
        // rota de itens aceita o que mandarem) caía como unidade ilegível e fazia a nota
        // inteira ser recusada falando de uma unidade vazia. Em branco é "un", que é o
        // default da coluna e o que a tela mostra.
        const unidadeDoInsumo = normalizarUnidade(insumo.unit) || String(insumo.unit || "").trim() || "un";
        // Nota sem unidade legível é tratada como já estando na unidade do insumo: é o
        // único caso em que somar o número cru não inventa fator nenhum.
        const unidadeDaNota = normalizarUnidade(item.unidade || item.newItemUnit) || unidadeDoInsumo;

        // Quantidade ilegível vira NaN e "1e400" vira Infinity. Com o antigo
        // Number(...) || 0 a linha entrava com zero e o lojista via "processado" sem o saldo
        // subir; e o Infinity travava o insumo para sempre, porque incremento sobre Infinity
        // continua Infinity e a tela não deixa editar saldo.
        const quantidadeDaNota = Number(item.quantidade);
        if (!Number.isFinite(quantidadeDaNota)) {
          throw new NotaRecusadaError(
            `A quantidade de "${insumo.name}" veio ilegível da nota. Confira esse item na leitura ou lance a entrada dele em Movimentar.`
          );
        }

        const quantidade = converter(quantidadeDaNota, unidadeDaNota, unidadeDoInsumo);

        if (quantidade === null) {
          incompativeis.push(`"${insumo.name}" (nota em ${unidadeDaNota}, insumo em ${unidadeDoInsumo})`);
          continue;
        }

        // O valor da nota é por unidade dela: R$ 40,00 o kg é R$ 0,04 o g. Sem dividir pelo
        // mesmo fator, o custo do insumo ficava mil vezes maior e contaminava o CMV.
        const fator = fatorDeConversao(unidadeDaNota, unidadeDoInsumo) || 1;
        const custoUnitario = valorUnitarioValido ? Number((valorUnitarioNota / fator).toFixed(6)) : null;

        // updateMany com o franchiseeId no where é o que garante o isolamento na hora da
        // escrita: com update por id puro, uma nota da loja A somava quantidade e trocava o
        // fornecedor de um ingrediente da loja B. Se nada casar, a nota inteira é desfeita.
        const atualizados = await tx.stockItem.updateMany({
          where: { id: stockItemId, franchiseeId },
          data: {
            quantity: { increment: quantidade },
            ...(custoUnitario ? { unitCost: custoUnitario } : {}),
            ...(invoiceData?.fornecedor ? { supplier: invoiceData.fornecedor } : {}),
          }
        });

        if (atualizados.count === 0) {
          throw new Error("Um dos itens da nota não pertence ao estoque desta loja");
        }

        // Create stock transaction
        const transaction = await tx.stockTransaction.create({
          data: {
            stockItemId,
            quantity: quantidade,
            type: 'INPUT',
            // Guardar o que estava escrito na nota quando a unidade foi convertida: sem
            // isso o lojista via "5000" no extrato e não achava esse número em lugar nenhum
            // do papel que ele digitou.
            notes: `NF-e${invoiceData?.numeroNF ? ` #${invoiceData.numeroNF}` : ''}${invoiceData?.fornecedor ? ` - ${invoiceData.fornecedor}` : ''} (R$ ${(Number(item.valorTotal) || 0).toFixed(2)})${unidadeDaNota !== unidadeDoInsumo ? ` - nota: ${quantidadeDaNota} ${unidadeDaNota}` : ''}`,
          }
        });
        transactions.push(transaction.id);
      }

      // Metade da nota lançada e metade não seria pior do que nada: o lojista não tem como
      // saber o que entrou. Ou entra tudo, ou nada entra e ele lê quais linhas travaram.
      if (incompativeis.length > 0) {
        throw new NotaRecusadaError(
          `Nenhum item foi lançado. A unidade destes itens não se converte sozinha: ${incompativeis.join("; ")}. ` +
          `Cadastre o insumo na mesma unidade da nota, ou lance essas entradas em Movimentar já com a quantidade convertida.`
        );
      }

      // Save invoice record
      const invoice = await tx.stockInvoice.create({
        data: {
          franchiseeId,
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
    if (error instanceof NotaRecusadaError || error?.name === "NotaRecusadaError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
