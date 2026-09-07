import { NextRequest, NextResponse } from "next/server";
import { orderByCardapio } from "@/lib/menu-order";
import { prisma } from "@/lib/prisma";
import { autenticarTotem } from "@/lib/totem-auth";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelHoje, diaDaSemanaDaLoja, idsSoDeOpcaoDeCombo } from "@/lib/cardapio-interno";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { aplicarPrecoNoCardapio } from "@/lib/preco-por-canal";
import { precoMinimoDoProduto, precoVariaPorEscolha } from "@/lib/preco-combo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await autenticarTotem(req.nextUrl.searchParams.get("token"));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const lojaId = auth.licenca.franchiseeId;
    const hojeNaLoja = diaDaSemanaDaLoja(await fusoDaLoja(lojaId));

    const products = await prisma.menuProduct.findMany({
      where: {
        franchiseeId: lojaId,
        active: true,
        activeTotem: true,
        // O espelho do catálogo do iFood não é cardápio da loja: existe só para
        // casar o pedido que chega da plataforma. Cliente no totem não compra
        // por ali. Ver src/lib/cardapio-interno.ts.
        ...SEM_PRODUTO_DE_INTEGRACAO,
      },
      orderBy: await orderByCardapio(),
      select: {
        id: true, name: true, description: true, price: true, priceTotem: true, imageUrl: true,
        apenasEmCombo: true, priceSalao: true, priceDelivery: true,
        category: true, isCombo: true, isBeverage: true, tags: true, availableDays: true,
        comboConfig: true,
        comboGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              include: {
                menuProduct: { select: { id: true, name: true, active: true, imageUrl: true, price: true } },
              },
            },
          },
        },
      },
    });

    const dbCategories = await prisma.menuCategory.findMany({
      where: { franchiseeId: lojaId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emoji: true, imageUrl: true, color: true, sortOrder: true },
    });

    // Categoria que existe só no produto (nunca foi cadastrada em MenuCategory)
    // ainda precisa virar aba, senão o produto fica órfão e some da tela.
    const nomesConhecidos = new Set(dbCategories.map((c) => c.name.toLowerCase().trim()));
    const extras: any[] = [];
    for (const p of products) {
      const chave = p.category?.toLowerCase().trim();
      if (!chave || nomesConhecidos.has(chave)) continue;
      nomesConhecidos.add(chave);
      extras.push({
        id: `cat_${chave.replace(/[^a-z0-9]/g, "_")}`,
        name: p.category,
        emoji: "🍽️",
        imageUrl: null,
        color: "#E8360C",
        sortOrder: 99,
      });
    }

    // Canal TOTEM: o preço que o quiosque anuncia é o do canal, resolvido aqui
    // na origem — a coluna sai do payload e a tela segue vendo um `price` só.
    const doDia = aplicarPrecoNoCardapio(
      products.filter((p) => disponivelHoje(p.availableDays, hojeNaLoja)) as any[],
      "totem"
    );

    // O preço do combo é calculado aqui, não na tela. `price` de um combo é a
    // base: um combo de base R$ 0,00 cujo grupo obrigatório mais barato custa
    // R$ 9,90 apareceria como "R$ 0,00" no totem, e o cliente veria um preço
    // que não existe. `precoMinimoDoProduto` é a mesma função que o cardápio
    // online e o PDV usam — um preço só, calculado num lugar só.
    const comPreco = doDia.map((p) => {
      const minimo = precoMinimoDoProduto(p as any);
      return {
        ...p,
        precoMinimo: minimo,
        // "a partir de" só quando a escolha do cliente pode mudar o valor.
        precoAPartirDe: precoVariaPorEscolha(p as any),
      };
    });

    // Complemento não é item de cardápio em canal nenhum: quem escolhe um
    // adicional faz isso DENTRO da pergunta do combo. O totem era o canal
    // mais exposto — os 101 adicionais da Pastelaria da Paulista estão com
    // `activeTotem` LIGADO, então apareciam todos como card de R$ 0,00 para
    // o cliente final se servir sozinho.
    //
    // Calculado sobre `products` (cru), e não sobre `comPreco`: depois de
    // resolver o preço do canal as colunas específicas somem do objeto, e a
    // regra perde a informação de que o item tem preço em outro canal.
    const complementos = idsSoDeOpcaoDeCombo(products as any[]);
    const vendaveis = comPreco.filter((p: any) => !complementos.has(String(p.id)));

    return NextResponse.json({
      products: vendaveis,
      categories: [...dbCategories, ...extras],
    });
  } catch (err) {
    console.error("[Totem Menu] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
