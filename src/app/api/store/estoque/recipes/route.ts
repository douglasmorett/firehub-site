import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizarUnidade, converter } from "@/lib/unidades";

// GET: Fetch the recipe for a product and the available stock items
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
    // abria a tela de fichas técnicas sem nenhum ingrediente e sem nenhum produto.
    const franchiseeId = user.ownerId || user.id;

    const { searchParams } = new URL(req.url);
    const menuProductId = searchParams.get("menuProductId");

    // Obter ingredientes cadastrados no estoque do franchisee
    const stockItems = await prisma.stockItem.findMany({
      where: { franchiseeId },
      orderBy: { name: "asc" }
    });

    if (menuProductId) {
      // Buscar receita específica desse produto
      const recipe = await prisma.productRecipe.findMany({
        where: {
          menuProductId,
          menuProduct: {
            franchiseeId
          }
        },
        include: {
          stockItem: {
            select: { name: true, unit: true }
          }
        }
      });
      return NextResponse.json({ success: true, recipe, stockItems });
    }

    // Se não informou ID de produto, retorna todos os produtos ativos reais do cardápio com suas receitas
    const junkCategories = ["IFOOD", "iFood", "Jotajá", "JOTAJA", "Jotaja", "ONLINE", "COMPLEMENTO", "COMPLEMENTOS", "OPCIONAL", "OPCIONAIS", "ADICIONAL", "ADICIONAIS", "INSUMO", "INSUMOS", "OCULTO"];
    
    const menuProducts = await prisma.menuProduct.findMany({
      where: {
        franchiseeId,
        active: true,
        category: {
          notIn: junkCategories
        },
        NOT: [
          { name: { startsWith: "IFOOD |" } },
          { name: { startsWith: "JOTAJÁ |" } },
          { name: { startsWith: "JOTAJA |" } },
          { name: { startsWith: "COMBOS |" } },
          { name: { startsWith: "Produto (R$" } }
        ]
      },
      include: {
        recipeItems: {
          include: {
            stockItem: {
              select: { name: true, unit: true }
            }
          }
        }
      },
      orderBy: { name: "asc" }
    });

    return NextResponse.json({ success: true, menuProducts, stockItems });
  } catch (error: any) {
    console.error("[Recipes GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Save/update the recipe for a product
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

    // O STAFF é um User com ownerId apontando para o dono da loja: sem isso a ficha técnica
    // que o funcionário salvava ia parar num estoque paralelo, fora da loja dele.
    const franchiseeId = user.ownerId || user.id;

    const body = await req.json();
    const { menuProductId, ingredients } = body; // ingredients = Array<{ stockItemId, quantityConsumed }>

    if (!menuProductId || !Array.isArray(ingredients)) {
      return NextResponse.json({ error: "Dados inválidos ou incompletos" }, { status: 400 });
    }

    // Verificar se o produto do cardápio pertence ao lojista
    const menuProduct = await prisma.menuProduct.findUnique({ where: { id: menuProductId } });
    if (!menuProduct || menuProduct.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Produto do cardápio não encontrado" }, { status: 404 });
    }

    // Só o menuProduct era conferido. Como o stockItemId vinha cru do body, a loja A podia
    // salvar uma receita apontando para um ingrediente da loja B, e a partir daí cada venda
    // da A dava baixa no estoque da B. Confere todos os ids de uma vez antes de gravar.
    const idsInformados: string[] = Array.from(
      new Set(
        ingredients
          .filter((ing: any) => ing?.stockItemId && ing.stockItemId !== "NEW")
          .map((ing: any) => String(ing.stockItemId))
      )
    );

    if (idsInformados.length > 0) {
      const itensDaLoja = await prisma.stockItem.findMany({
        where: { id: { in: idsInformados }, franchiseeId },
        select: { id: true }
      });

      if (itensDaLoja.length !== idsInformados.length) {
        return NextResponse.json(
          { error: "Um dos ingredientes informados não pertence ao estoque desta loja" },
          { status: 400 }
        );
      }
    }

    // Linhas que o servidor converteu de unidade, e linhas que ele teve que
    // recusar. As duas voltam para a TELA: a ficha técnica salvava em silêncio
    // e o lojista nunca sabia que uma linha tinha sido descartada — via
    // "✅ Ficha técnica salva!" com a ficha pela metade.
    const convertidas: string[] = [];
    const recusadas: string[] = [];

    // Usar transação atômica do Prisma para limpar e salvar
    await prisma.$transaction(async (tx) => {
      // 1. Apagar receita anterior
      await tx.productRecipe.deleteMany({
        where: { menuProductId }
      });

      // 2. Criar novos itens de receita (se houver)
      if (ingredients.length > 0) {
        const recipeData: Array<{ menuProductId: string; stockItemId: string; quantityConsumed: number }> = [];
        
        for (const ing of ingredients) {
          let stockItemId = ing.stockItemId;
          // NaN e Infinity passavam por "qty <= 0" (a comparação é falsa para os dois) e iam
          // parar no quantityConsumed. Infinity gravado é o pior: o Postgres aceita no double
          // e a primeira venda do produto jogava o saldo do ingrediente para -Infinity, sem
          // nenhuma tela que trouxesse ele de volta.
          const qty = Number(ing.quantityConsumed);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          // O que vai para o banco pode ser CONVERTIDO logo abaixo, quando o
          // lojista escolher uma unidade diferente da do insumo que já existe.
          let qtyFinal = qty;

          // Auto-create stock item if it's a new ingredient
          if (stockItemId === 'NEW' && ing.newItemName) {
            // Check if already exists (case-insensitive)
            const existing = await tx.stockItem.findFirst({
              where: {
                franchiseeId,
                name: { equals: ing.newItemName, mode: 'insensitive' }
              }
            });
            
            if (existing) {
              stockItemId = existing.id;

              // ── A UNIDADE NÃO PODE SER DESCARTADA AQUI ──────────────────
              //
              // Este ramo reaproveitava o insumo existente e jogava fora o
              // `newItemUnit` que o lojista tinha acabado de escolher. Ele
              // digitava "150" pensando em GRAMAS, o insumo estava em QUILOS,
              // e a primeira venda baixava 150 QUILOS. Erro de 1000×,
              // silencioso e permanente — e sem conserto pela tela, porque não
              // existe edição de insumo e apagar leva junto a ficha técnica de
              // todos os produtos.
              //
              // Agora a quantidade é CONVERTIDA para a unidade do insumo. Se as
              // grandezas não conversarem (ele escolheu ml e o insumo está em
              // kg), a linha é RECUSADA com mensagem — nunca gravada crua.
              const escolhida = normalizarUnidade(ing.newItemUnit);
              const doInsumo = normalizarUnidade(existing.unit);
              if (escolhida && doInsumo && escolhida !== doInsumo) {
                const convertida = converter(qty, escolhida, doInsumo);
                if (convertida === null) {
                  // "cx", "fd", "pct" caem aqui de propósito: só o lojista sabe
                  // quantas unidades vêm na caixa. Adivinhar seria plantar o
                  // mesmo erro silencioso que esta correção existe para tirar.
                  recusadas.push(
                    `"${ing.newItemName}" já está cadastrado em ${doInsumo}, e ${escolhida} não converte para ${doInsumo}. ` +
                    `Ajuste essa linha para ${doInsumo}.`
                  );
                  continue;
                }
                convertidas.push(`"${ing.newItemName}": ${qty} ${escolhida} = ${convertida} ${doInsumo}`);
                qtyFinal = convertida;
              }
            } else {
              const newItem = await tx.stockItem.create({
                data: {
                  franchiseeId,
                  name: ing.newItemName,
                  quantity: 0,
                  unit: ing.newItemUnit || 'un',
                }
              });
              stockItemId = newItem.id;
            }
          }
          
          if (!stockItemId || stockItemId === 'NEW') continue;
          
          // A tela deixa abrir duas linhas com o mesmo ingrediente ("100 g de queijo no
          // recheio" e "50 g na cobertura"), e o par (menuProductId, stockItemId) é único no
          // banco: o createMany estourava a constraint e a ficha técnica inteira se perdia com
          // "Erro interno". Somar as linhas repetidas é o que o lojista quis dizer — 150 g de
          // queijo por unidade do produto. Vale também para dois 'NEW' com o mesmo nome, que
          // caem no mesmo StockItem logo acima.
          const repetido = recipeData.find((r) => r.stockItemId === stockItemId);
          if (repetido) {
            repetido.quantityConsumed += qtyFinal;
            continue;
          }

          recipeData.push({
            menuProductId,
            stockItemId,
            quantityConsumed: qtyFinal
          });
        }

        if (recipeData.length > 0) {
          await tx.productRecipe.createMany({ data: recipeData });
        }
      }
    });

    // Retorna a receita salva
    const savedRecipe = await prisma.productRecipe.findMany({
      where: { menuProductId },
      include: {
        stockItem: {
          select: { name: true, unit: true }
        }
      }
    });

    // `convertidas` e `recusadas` viajam para a tela: salvar em silêncio uma
    // ficha pela metade, com "✅ Ficha técnica salva!", é como o lojista
    // acreditava estar com o estoque configurado sem estar.
    return NextResponse.json({ success: true, recipe: savedRecipe, convertidas, recusadas });
  } catch (error: any) {
    console.error("[Recipes POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
