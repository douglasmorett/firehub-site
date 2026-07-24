import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findFirst({
    where: { email: "contatohakim@gmail.com" }
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário contatohakim@gmail.com não encontrado" }, { status: 404 });
  }

  try {
    // 1. Limpar cardápio anterior de contatohakim@gmail.com
    const existingProducts = await prisma.menuProduct.findMany({
      where: { franchiseeId: user.id },
      select: { id: true }
    });
    const productIds = existingProducts.map(p => p.id);

    if (productIds.length > 0) {
      await prisma.comboGroupItem.deleteMany({
        where: { menuProductId: { in: productIds } }
      });
      await prisma.comboGroup.deleteMany({
        where: { menuProductId: { in: productIds } }
      });
      await prisma.menuProduct.deleteMany({
        where: { franchiseeId: user.id }
      });
    }

    await prisma.menuCategory.deleteMany({
      where: { franchiseeId: user.id }
    });

    // 2. Criar as 7 Categorias
    const categoriesData = [
      { name: "Promoção do Dia", emoji: "🔥", color: "#EF4444", sortOrder: 1 },
      { name: "Novidade", emoji: "✨", color: "#8B5CF6", sortOrder: 2 },
      { name: "Combos", emoji: "👑", color: "#F59E0B", sortOrder: 3 },
      { name: "Acompanhamentos", emoji: "🍟", color: "#10B981", sortOrder: 4 },
      { name: "Esfirras Salgadas", emoji: "🥟", color: "#3B82F6", sortOrder: 5 },
      { name: "Esfirras Doces", emoji: "🍫", color: "#EC4899", sortOrder: 6 },
      { name: "Bebidas", emoji: "🥤", color: "#06B6D4", sortOrder: 7 },
    ];

    const categoryMap = new Map<string, any>();
    for (const cat of categoriesData) {
      const createdCat = await prisma.menuCategory.create({
        data: {
          franchiseeId: user.id,
          name: cat.name,
          emoji: cat.emoji,
          color: cat.color,
          sortOrder: cat.sortOrder,
        }
      });
      categoryMap.set(cat.name, createdCat);
    }

    // 3. Cadastrar Produtos Individuais
    const productMap = new Map<string, any>();

    const simpleProducts = [
      { name: "Esfirra de Calabresa (Promo)", category: "Promoção do Dia", price: 2.90, description: "Esfiha de calabresa moída na promoção do dia!" },
      { name: "Dois Amores", category: "Novidade", price: 9.90, description: "Esfirra de cream cheese com goiabada especial do Dia dos namorados!" },
      { name: "Doguinho", category: "Acompanhamentos", price: 6.90, description: "Nosso delicioso cachorro quente na massa de esfirra com queijo por cima" },
      { name: "Pastel de Nata", category: "Acompanhamentos", price: 6.90, description: "Uma sobremesa doce e saborosa peculiar de portugal agora tambem na sua casa!" },
      { name: "Maionese Da casa Ervas Finas", category: "Acompanhamentos", price: 2.90, description: "Sache de 30 gramas sabor Ervas Finas" },
      { name: "Esfirra de Carne", category: "Esfirras Salgadas", price: 7.98, description: "Esfiha de carne com cebola e tomate e um tempero especial" },
      { name: "Esfirra de Calabresa", category: "Esfirras Salgadas", price: 7.98, description: "Esfiha de calabresa moida com mussarela a preferida das crianças!" },
      { name: "Esfirra de Frango", category: "Esfirras Salgadas", price: 8.98, description: "Deliciosa esfiha de frango desfiado forrada com mussarela por baixo" },
      { name: "Esfirra de Queijo", category: "Esfirras Salgadas", price: 8.98, description: "Maravilhosa esfiha de queijo com cheiro verde e um temperinho especial!" },
      { name: "Esfirra de Bacon", category: "Esfirras Salgadas", price: 8.98, description: "Esfiha forrada de queijo com um maravilhoso bacon de pernil" },
      { name: "Esfirra de Carne c/ Mussarela", category: "Esfirras Salgadas", price: 8.98, description: "A deliciosa esfiha de carne que você conhece com mussarela por cima!" },
      { name: "Esfirra de Carne c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de carne com Catupiry" },
      { name: "Esfirra de Frango c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "A deliciosa esfiha de frango que você ja conhece com o nosso Catupiry premium" },
      { name: "Esfirra de Frango c/ Cheddar", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de frango com cheddar premium" },
      { name: "Esfirra de Alho Torrado", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de queijo que você ama com uma pitada de alho torrado, hum... Deu água na boca" },
      { name: "Esfirra de Bacon c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de Bacon com o nosso Catupiry premium" },
      { name: "Esfirra de Bacon c/ Cheddar", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de bacon, com um cheddar sensacional!" },
      { name: "Esfirra de 4 queijos", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de 4 queijos, mussarela, provolone, parmesão e Catupiry" },
      { name: "Esfirra 5 Queijos", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfirra de mussarela, provolone, parmesão, Catupiry e cheddar" },
      { name: "Esfirra de Peperoni", category: "Esfirras Salgadas", price: 9.98, description: "Esfiha de queijo com peperoni" },
      { name: "Esfirra Peperoni c/ Catupiry", category: "Esfirras Salgadas", price: 10.98, description: "Esfiha de peperoni com Catupiry por cima! Humm deu água na boca.." },
      { name: "Esfirra de Romeu e Julieta", category: "Esfirras Doces", price: 5.98, description: "Ajude os dois a se encontrarem dentro da sua boca" },
      { name: "Esfirra de Chocolate ao Leite", category: "Esfirras Doces", price: 7.98, description: "Chocolate ao leite premium" },
      { name: "Esfirra de Chocolate Branco", category: "Esfirras Doces", price: 7.98, description: "Chocolate branco premium" },
      { name: "Esfirra Duo", category: "Esfirras Doces", price: 7.98, description: "Chocolate ao leite e branco" },
      { name: "Esfirra de Banana Nevada", category: "Esfirras Doces", price: 9.98, description: "Você não pode perder essa..." },
      { name: "Esfirra de Nutella", category: "Esfirras Doces", price: 9.98, description: "Com Nutella de verdade!!" },
      { name: "Esfirra de M&M", category: "Esfirras Doces", price: 9.98, description: "Deliciosa esfiha premium com M&M de verdade!!" },
      { name: "Esfirra de Kitkat", category: "Esfirras Doces", price: 9.98, description: "Deliciosa esfiha premium com kitkat de verdade!" },
      { name: "Guaravita 280ml", category: "Bebidas", price: 4.90, description: "Copo 280ml" },
      { name: "Coca-Cola lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml" },
      { name: "Coca-Cola Zero", category: "Bebidas", price: 9.90, description: "Lata 310 ml" },
      { name: "Fanta Laranja lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml" },
      { name: "Fanta Uva lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml" },
      { name: "Água sem gás", category: "Bebidas", price: 5.90, description: "Garrafa 500ml" },
      { name: "Água c/ Gás", category: "Bebidas", price: 5.90, description: "Garrafa 500ml" },
    ];

    for (const p of simpleProducts) {
      const prod = await prisma.menuProduct.create({
        data: {
          franchiseeId: user.id,
          name: p.name,
          description: p.description,
          price: p.price,
          category: p.category,
          active: true,
          isCombo: false,
          activePDV: true,
          activeDelivery: true,
        }
      });
      productMap.set(p.name, prod);
    }

    const esfirrasClassicas = [
      productMap.get("Esfirra de Carne").id,
      productMap.get("Esfirra de Calabresa").id,
      productMap.get("Esfirra de Queijo").id,
    ];

    const esfirrasPremium = [
      productMap.get("Esfirra de Frango c/ Catupiry").id,
      productMap.get("Esfirra de Frango c/ Cheddar").id,
      productMap.get("Esfirra de Bacon c/ Catupiry").id,
      productMap.get("Esfirra de Bacon c/ Cheddar").id,
      productMap.get("Esfirra de 4 queijos").id,
      productMap.get("Esfirra 5 Queijos").id,
      productMap.get("Esfirra de Alho Torrado").id,
      productMap.get("Esfirra de Peperoni").id,
    ];

    const esfirrasDoces = [
      productMap.get("Esfirra de Romeu e Julieta").id,
      productMap.get("Esfirra de Chocolate ao Leite").id,
      productMap.get("Esfirra de Chocolate Branco").id,
      productMap.get("Esfirra Duo").id,
      productMap.get("Esfirra de Banana Nevada").id,
      productMap.get("Esfirra de Nutella").id,
      productMap.get("Esfirra de M&M").id,
      productMap.get("Esfirra de Kitkat").id,
    ];

    const bebidasLata = [
      productMap.get("Guaravita 280ml").id,
      productMap.get("Coca-Cola lata").id,
      productMap.get("Coca-Cola Zero").id,
      productMap.get("Fanta Laranja lata").id,
      productMap.get("Fanta Uva lata").id,
    ];

    const acompanhamentosList = [
      productMap.get("Doguinho").id,
      productMap.get("Pastel de Nata").id,
      productMap.get("Maionese Da casa Ervas Finas").id,
    ];

    const combosData = [
      {
        name: "Oferta Hk - 5 Itens a partir de 29,90",
        category: "Promoção do Dia",
        price: 29.90,
        description: "5 Itens a partir de 29,90! Monte suas escolhas favoritas.",
        groups: [
          { title: "Escolha até 5 Itens", maxQty: 5, items: [...esfirrasClassicas, productMap.get("Doguinho").id] }
        ]
      },
      {
        name: "Combo Imperial",
        category: "Combos",
        price: 24.90,
        description: "5 esfirras clássicas + 1 guaravita",
        groups: [
          { title: "Escolha suas 5 Esfirras Clássicas", maxQty: 5, items: esfirrasClassicas },
          { title: "Escolha 1 Bebida", maxQty: 1, items: [productMap.get("Guaravita 280ml").id] }
        ]
      },
      {
        name: "Pedido do Rei",
        category: "Combos",
        price: 34.90,
        description: "4 esfirras premium + 1 bebida lata",
        groups: [
          { title: "Escolha suas 4 Esfirras Premium", maxQty: 4, items: esfirrasPremium },
          { title: "Escolha 1 Bebida Lata", maxQty: 1, items: bebidasLata }
        ]
      },
      {
        name: "4 Esfirras de Queijo Temperado",
        category: "Combos",
        price: 24.90,
        description: "Combo com 4 Esfirras de Queijo Temperado",
        groups: [
          { title: "Suas 4 Esfirras de Queijo", maxQty: 4, items: [productMap.get("Esfirra de Queijo").id] }
        ]
      },
      {
        name: "4 Esfirras de Calabresa",
        category: "Combos",
        price: 24.90,
        description: "Leva queijo",
        groups: [
          { title: "Suas 4 Esfirras de Calabresa", maxQty: 4, items: [productMap.get("Esfirra de Calabresa").id] }
        ]
      },
      {
        name: "4 Esfirras de Carne",
        category: "Combos",
        price: 24.90,
        description: "Combo com 4 Esfirras de Carne",
        groups: [
          { title: "Suas 4 Esfirras de Carne", maxQty: 4, items: [productMap.get("Esfirra de Carne").id] }
        ]
      },
      {
        name: "3 Esfirras Doces",
        category: "Combos",
        price: 24.90,
        description: "Combo com 3 Esfirras Doces à escolha",
        groups: [
          { title: "Escolha suas 3 Esfirras Doces", maxQty: 3, items: esfirrasDoces }
        ]
      },
      {
        name: "Combo 6 Esfirras Mix",
        category: "Combos",
        price: 29.90,
        description: "Escolha 6 esfirras entre salgadas e doces",
        groups: [
          { title: "Escolha suas 6 Esfirras", maxQty: 6, items: [...esfirrasClassicas, ...esfirrasDoces] }
        ]
      },
      {
        name: "4 Pasteis de Nata",
        category: "Combos",
        price: 26.90,
        description: "O delicioso pastel de nata agora na sua casa",
        groups: [
          { title: "Seus 4 Pasteis de Nata", maxQty: 4, items: [productMap.get("Pastel de Nata").id] }
        ]
      },
      {
        name: "Combo do Solteiro",
        category: "Combos",
        price: 29.90,
        description: "Tá sozinho? Pede esse kit completo para você!",
        groups: [
          { title: "Escolha suas 3 Esfirras", maxQty: 3, items: esfirrasClassicas },
          { title: "Escolha 1 Acompanhamento", maxQty: 1, items: acompanhamentosList },
          { title: "Escolha 1 Bebida", maxQty: 1, items: bebidasLata }
        ]
      },
      {
        name: "Trio Hk",
        category: "Combos",
        price: 29.90,
        description: "3 Esfirras + Acompanhamento + Refri",
        groups: [
          { title: "Escolha suas 3 Esfirras", maxQty: 3, items: esfirrasClassicas },
          { title: "Escolha 1 Acompanhamento", maxQty: 1, items: acompanhamentosList },
          { title: "Escolha 1 Bebida", maxQty: 1, items: bebidasLata }
        ]
      },
      {
        name: "Combo 10 Esfirras Simples + 2 Bebidas",
        category: "Combos",
        price: 59.90,
        description: "Descubra o prazer inconfundível de nosso Combo 10 esfirras simples + 2 Bebidas",
        groups: [
          { title: "Escolha suas 10 Esfirras Simples", maxQty: 10, items: esfirrasClassicas },
          { title: "Escolha suas 2 Bebidas", maxQty: 2, items: bebidasLata }
        ]
      },
      {
        name: "Monte seu Combo (10 itens Variados)",
        category: "Combos",
        price: 59.90,
        description: "Doguinho, Kibe, Pastel de Nata ou esfirras. Escolha 10 itens variados",
        groups: [
          { title: "Escolha seus 10 Itens Variados", maxQty: 10, items: [...esfirrasClassicas, ...acompanhamentosList] }
        ]
      },
      {
        name: "20 Esfihas do Sábio",
        category: "Combos",
        price: 109.90,
        description: "10 esfihas simples + 10 esfihas premium ou doces... Isso sim é ser sábio!",
        groups: [
          { title: "Escolha suas 10 Esfirras Simples", maxQty: 10, items: esfirrasClassicas },
          { title: "Escolha suas 10 Esfirras Premium ou Doces", maxQty: 10, items: [...esfirrasPremium, ...esfirrasDoces] }
        ]
      },
      {
        name: "10 Esfirras Premium + 2 Bebidas",
        category: "Combos",
        price: 79.90,
        description: "Combo 10 esfihas premium, os melhores sabores para você escolher + 2 bebidas",
        groups: [
          { title: "Escolha suas 10 Esfirras Premium", maxQty: 10, items: esfirrasPremium },
          { title: "Escolha suas 2 Bebidas", maxQty: 2, items: bebidasLata }
        ]
      },
      {
        name: "Rodizio do Sábio",
        category: "Combos",
        price: 59.90,
        description: "4 esfihas simples + 4 esfihas especiais + 2 Doces, isso sim é sabedoria!",
        groups: [
          { title: "Escolha suas 4 Esfirras Simples", maxQty: 4, items: esfirrasClassicas },
          { title: "Escolha suas 4 Esfirras Especiais", maxQty: 4, items: esfirrasPremium },
          { title: "Escolha suas 2 Esfirras Doces", maxQty: 2, items: esfirrasDoces }
        ]
      }
    ];

    let combosCount = 0;
    let groupsCount = 0;
    let itemsCount = 0;

    for (const combo of combosData) {
      const createdCombo = await prisma.menuProduct.create({
        data: {
          franchiseeId: user.id,
          name: combo.name,
          description: combo.description,
          price: combo.price,
          category: combo.category,
          active: true,
          isCombo: true,
          activePDV: true,
          activeDelivery: true,
        }
      });
      combosCount++;

      for (let i = 0; i < combo.groups.length; i++) {
        const g = combo.groups[i];
        const createdGroup = await prisma.comboGroup.create({
          data: {
            menuProductId: createdCombo.id,
            title: g.title,
            maxQty: g.maxQty,
            sortOrder: i,
          }
        });
        groupsCount++;

        for (const targetProductId of g.items) {
          if (targetProductId) {
            await prisma.comboGroupItem.create({
              data: {
                comboGroupId: createdGroup.id,
                menuProductId: targetProductId,
              }
            });
            itemsCount++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Cardápio do JotaJá reconstruído com sucesso para contatohakim@gmail.com!",
      categoriesCount: categoryMap.size,
      productsCount: productMap.size + combosCount,
      combosCount,
      groupsCount,
      comboItemsCount: itemsCount,
    });
  } catch (err: any) {
    console.error("Erro ao povoar cardápio:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
