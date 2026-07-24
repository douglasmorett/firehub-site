import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  if (secret !== "hakim123") {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
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

    // 3. Cadastrar Produtos Individuais com Suas Fotos Reais
    const productMap = new Map<string, any>();

    const simpleProducts = [
      { name: "Esfirra de Calabresa (Promo)", category: "Promoção do Dia", price: 2.90, description: "Esfiha de calabresa moída na promoção do dia!", imageUrl: "https://imagens.jotaja.com/produtos/0a370eba-8ae7-419d-9574-c059bcd372ec.jpg" },
      { name: "Dois Amores", category: "Novidade", price: 9.90, description: "Esfirra de cream cheese com goiabada especial do Dia dos namorados!", imageUrl: "https://imagens.jotaja.com/produtos/45424751-e8c7-4397-8e2e-94ff0a7b27c0.jpg" },
      { name: "Doguinho", category: "Acompanhamentos", price: 6.90, description: "Nosso delicioso cachorro quente na massa de esfirra com queijo por cima", imageUrl: "https://imagens.jotaja.com/produtos/9fb341df-40f1-43d4-89f0-32e5824a1347.jpg" },
      { name: "Pastel de Nata", category: "Acompanhamentos", price: 6.90, description: "Uma sobremesa doce e saborosa peculiar de portugal agora tambem na sua casa!", imageUrl: "https://imagens.jotaja.com/produtos/5ad0e71a-3872-4909-8ebb-5d4f0cab4c11.jpg" },
      { name: "Maionese Da casa Ervas Finas", category: "Acompanhamentos", price: 2.90, description: "Sache de 30 gramas sabor Ervas Finas", imageUrl: "https://imagens.jotaja.com/produtos/d1f5b701-d68e-4c62-acce-190569ba7a17.jpg" },
      { name: "Esfirra de Carne", category: "Esfirras Salgadas", price: 7.98, description: "Esfiha de carne com cebola e tomate e um tempero especial", imageUrl: "https://imagens.jotaja.com/produtos/2032527a-1c7b-49ea-9f8f-469a7eeb0c08.jpg" },
      { name: "Esfirra de Calabresa", category: "Esfirras Salgadas", price: 7.98, description: "Esfiha de calabresa moida com mussarela a preferida das crianças!", imageUrl: "https://imagens.jotaja.com/produtos/0a370eba-8ae7-419d-9574-c059bcd372ec.jpg" },
      { name: "Esfirra de Frango", category: "Esfirras Salgadas", price: 8.98, description: "Deliciosa esfiha de frango desfiado forrada com mussarela por baixo", imageUrl: "https://imagens.jotaja.com/produtos/42368d15-1946-4e3d-b278-ddc5327a31e0.jpg" },
      { name: "Esfirra de Queijo", category: "Esfirras Salgadas", price: 8.98, description: "Maravilhosa esfiha de queijo com cheiro verde e um temperinho especial!", imageUrl: "https://imagens.jotaja.com/produtos/bdf8e6be-928b-497b-97ed-476cce7bd53c.jpg" },
      { name: "Esfirra de Bacon", category: "Esfirras Salgadas", price: 8.98, description: "Esfiha forrada de queijo com um maravilhoso bacon de pernil", imageUrl: "https://imagens.jotaja.com/produtos/0d11d44c-d889-4ef1-8164-291114f31e97.jpg" },
      { name: "Esfirra de Carne c/ Mussarela", category: "Esfirras Salgadas", price: 8.98, description: "A deliciosa esfiha de carne que você conhece com mussarela por cima!", imageUrl: "https://imagens.jotaja.com/produtos/f52fef1c-281d-430f-aaec-96f209ddac2a.jpg" },
      { name: "Esfirra de Carne c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de carne com Catupiry", imageUrl: "https://imagens.jotaja.com/produtos/0f71cc3c-637e-4647-8573-d2772a123f0c.jpg" },
      { name: "Esfirra de Frango c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "A deliciosa esfiha de frango que você ja conhece com o nosso Catupiry premium", imageUrl: "https://imagens.jotaja.com/produtos/1eb2b89f-7bf1-46b1-88b8-70e462fb9261.jpg" },
      { name: "Esfirra de Frango c/ Cheddar", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de frango com cheddar premium", imageUrl: "https://imagens.jotaja.com/produtos/53422f7b-4120-48c7-82ec-79b4650a202a.jpg" },
      { name: "Esfirra de Alho Torrado", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de queijo que você ama com uma pitada de alho torrado, hum... Deu água na boca", imageUrl: "https://imagens.jotaja.com/produtos/27dfb18e-0226-40a4-9c34-7911f827ebff.jpg" },
      { name: "Esfirra de Bacon c/ Catupiry", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de Bacon com o nosso Catupiry premium", imageUrl: "https://imagens.jotaja.com/produtos/b22f34fd-a162-41a1-bd6e-57892bb69edf.jpg" },
      { name: "Esfirra de Bacon c/ Cheddar", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de bacon, com um cheddar sensacional!", imageUrl: "https://imagens.jotaja.com/produtos/b3d5d552-b0fb-4f5b-8a15-1702e0b9ad97.jpg" },
      { name: "Esfirra de 4 queijos", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfiha de 4 queijos, mussarela, provolone, parmesão e Catupiry", imageUrl: "https://imagens.jotaja.com/produtos/65deaa7b-5af7-4dd3-b4d6-cb57ee774e88.jpg" },
      { name: "Esfirra 5 Queijos", category: "Esfirras Salgadas", price: 9.98, description: "Deliciosa esfirra de mussarela, provolone, parmesão, Catupiry e cheddar", imageUrl: "https://imagens.jotaja.com/produtos/a4aa4f57-432d-44c1-898c-abd2a5b8fd4a.jpg" },
      { name: "Esfirra de Peperoni", category: "Esfirras Salgadas", price: 9.98, description: "Esfiha de queijo com peperoni", imageUrl: "https://imagens.jotaja.com/produtos/db58b6b0-a290-4b62-adbb-dcb40a67d2eb.jpg" },
      { name: "Esfirra Peperoni c/ Catupiry", category: "Esfirras Salgadas", price: 10.98, description: "Esfiha de peperoni com Catupiry por cima! Humm deu água na boca..", imageUrl: "https://imagens.jotaja.com/produtos/abde7de9-ed8a-4c9d-99d9-1c66646e29f0.jpg" },
      { name: "Esfirra de Romeu e Julieta", category: "Esfirras Doces", price: 5.98, description: "Ajude os dois a se encontrarem dentro da sua boca", imageUrl: "https://imagens.jotaja.com/produtos/3fe936f3-94b7-4445-8c0b-4272b5a17911.jpg" },
      { name: "Esfirra de Chocolate ao Leite", category: "Esfirras Doces", price: 7.98, description: "Chocolate ao leite premium", imageUrl: "https://imagens.jotaja.com/produtos/c1d683e3-5779-4d68-94c9-8c586e886d3a.jpg" },
      { name: "Esfirra de Chocolate Branco", category: "Esfirras Doces", price: 7.98, description: "Chocolate branco premium", imageUrl: "https://imagens.jotaja.com/produtos/e8f4bfa8-8127-40ca-8bd5-ce150da03d4b.jpg" },
      { name: "Esfirra Duo", category: "Esfirras Doces", price: 7.98, description: "Chocolate ao leite e branco", imageUrl: "https://imagens.jotaja.com/produtos/bc4eba39-ec50-4ab6-8be5-9994e012f3fa.jpg" },
      { name: "Esfirra de Banana Nevada", category: "Esfirras Doces", price: 9.98, description: "Você não pode perder essa...", imageUrl: "https://imagens.jotaja.com/produtos/1e99727f-6cfc-4010-81ce-93abf41504ac.jpg" },
      { name: "Esfirra de Nutella", category: "Esfirras Doces", price: 9.98, description: "Com Nutella de verdade!!", imageUrl: "https://imagens.jotaja.com/produtos/07e421df-50d2-48e9-98a7-da4cade93f95.jpg" },
      { name: "Esfirra de M&M", category: "Esfirras Doces", price: 9.98, description: "Deliciosa esfiha premium com M&M de verdade!!", imageUrl: "https://imagens.jotaja.com/produtos/1852e265-5b3e-4df2-a03f-2593fd22474e.jpg" },
      { name: "Esfirra de Kitkat", category: "Esfirras Doces", price: 9.98, description: "Deliciosa esfiha premium com kitkat de verdade!", imageUrl: "https://imagens.jotaja.com/produtos/ef744c7a-0dd4-453f-b5b2-f3fdd95026b5.jpg" },
      { name: "Guaravita 280ml", category: "Bebidas", price: 4.90, description: "Copo 280ml", imageUrl: "https://imagens.jotaja.com/produtos/1f0b3e27-6cf9-48bd-aba8-638931d34de9.jpg" },
      { name: "Coca-Cola lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml", imageUrl: "https://imagens.jotaja.com/produtos/1f0b3e27-6cf9-48bd-aba8-638931d34de9.jpg" },
      { name: "Coca-Cola Zero", category: "Bebidas", price: 9.90, description: "Lata 310 ml", imageUrl: "https://imagens.jotaja.com/produtos/20c57220-4c21-48a4-8d11-bc9763661d35.jpg" },
      { name: "Fanta Laranja lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml", imageUrl: "https://imagens.jotaja.com/produtos/88af2231-c5c1-40e6-a874-2fd200349ec7.jpg" },
      { name: "Fanta Uva lata", category: "Bebidas", price: 9.90, description: "Lata 310 ml", imageUrl: "https://imagens.jotaja.com/produtos/53d75d51-d1f8-43d4-affd-f4f69f4d5c6f.jpg" },
      { name: "Água sem gás", category: "Bebidas", price: 5.90, description: "Garrafa 500ml", imageUrl: "https://imagens.jotaja.com/produtos/05b25e4d-24db-4cf8-8f5e-b72a3baf29b5.jpg" },
      { name: "Água c/ Gás", category: "Bebidas", price: 5.90, description: "Garrafa 500ml", imageUrl: "https://imagens.jotaja.com/produtos/caa84567-e402-4016-ab3a-da918a99cd50.jpg" },
    ];

    for (const p of simpleProducts) {
      const prod = await prisma.menuProduct.create({
        data: {
          franchiseeId: user.id,
          name: p.name,
          description: p.description,
          price: p.price,
          category: p.category,
          imageUrl: p.imageUrl,
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
        imageUrl: "https://imagens.jotaja.com/produtos/1a2549f3-f3bb-4002-ab57-ebebd74741ca.jpg",
        groups: [
          { title: "Escolha até 5 Itens", maxQty: 5, items: [...esfirrasClassicas, productMap.get("Doguinho").id] }
        ]
      },
      {
        name: "Combo Imperial",
        category: "Combos",
        price: 24.90,
        description: "5 esfirras clássicas + 1 guaravita",
        imageUrl: "https://imagens.jotaja.com/produtos/68195131-bbdd-43a1-b1b4-311065e8f2b6.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/2714af2e-90b6-46ff-b897-6b4ff23c005c.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/7a0de2c4-7350-434e-bcf2-cbf7695532f8.jpg",
        groups: [
          { title: "Suas 4 Esfirras de Queijo", maxQty: 4, items: [productMap.get("Esfirra de Queijo").id] }
        ]
      },
      {
        name: "4 Esfirras de Calabresa",
        category: "Combos",
        price: 24.90,
        description: "Leva queijo",
        imageUrl: "https://imagens.jotaja.com/produtos/45b935b8-ebd3-428c-a55a-041e129cef79.jpg",
        groups: [
          { title: "Suas 4 Esfirras de Calabresa", maxQty: 4, items: [productMap.get("Esfirra de Calabresa").id] }
        ]
      },
      {
        name: "4 Esfirras de Carne",
        category: "Combos",
        price: 24.90,
        description: "Combo com 4 Esfirras de Carne",
        imageUrl: "https://imagens.jotaja.com/produtos/4dfbc763-6b36-44eb-b592-d0ffdaa33deb.jpg",
        groups: [
          { title: "Suas 4 Esfirras de Carne", maxQty: 4, items: [productMap.get("Esfirra de Carne").id] }
        ]
      },
      {
        name: "3 Esfirras Doces",
        category: "Combos",
        price: 24.90,
        description: "Combo com 3 Esfirras Doces à escolha",
        imageUrl: "https://imagens.jotaja.com/produtos/95a7b756-8b8a-49c3-8b8c-129da539e5c0.jpg",
        groups: [
          { title: "Escolha suas 3 Esfirras Doces", maxQty: 3, items: esfirrasDoces }
        ]
      },
      {
        name: "Combo 6 Esfirras Mix",
        category: "Combos",
        price: 29.90,
        description: "Escolha 6 esfirras entre salgadas e doces",
        imageUrl: "https://imagens.jotaja.com/produtos/99b2307a-89f9-4168-b9bc-00e71008ced4.jpg",
        groups: [
          { title: "Escolha suas 6 Esfirras", maxQty: 6, items: [...esfirrasClassicas, ...esfirrasDoces] }
        ]
      },
      {
        name: "4 Pasteis de Nata",
        category: "Combos",
        price: 26.90,
        description: "O delicioso pastel de nata agora na sua casa",
        imageUrl: "https://imagens.jotaja.com/produtos/b54e5996-3b96-4c2f-a465-676caf622833.jpg",
        groups: [
          { title: "Seus 4 Pasteis de Nata", maxQty: 4, items: [productMap.get("Pastel de Nata").id] }
        ]
      },
      {
        name: "Combo do Solteiro",
        category: "Combos",
        price: 29.90,
        description: "Tá sozinho? Pede esse kit completo para você!",
        imageUrl: "https://imagens.jotaja.com/produtos/e355bea9-e822-44a3-9211-8a8dba28a795.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/8433610a-fcae-4b8e-b9d9-59553efc51f3.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/4826de54-a437-48d7-813f-0a3d9473522d.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/f457c8b1-c8a6-4a44-894a-a1787b7c6b11.jpg",
        groups: [
          { title: "Escolha seus 10 Itens Variados", maxQty: 10, items: [...esfirrasClassicas, ...acompanhamentosList] }
        ]
      },
      {
        name: "20 Esfihas do Sábio",
        category: "Combos",
        price: 109.90,
        description: "10 esfihas simples + 10 esfihas premium ou doces... Isso sim é ser sábio!",
        imageUrl: "https://imagens.jotaja.com/produtos/7c94d220-a481-42eb-9d2e-4dada7e93c67.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/32c93f28-aa87-4e26-a582-76755714ffde.jpg",
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
        imageUrl: "https://imagens.jotaja.com/produtos/c8638fd8-c566-4ce2-83ba-d40465fe4663.jpg",
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
          imageUrl: combo.imageUrl,
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
      message: "Cardápio do JotaJá com FOTOS reconstruído com sucesso para contatohakim@gmail.com!",
      categoriesCount: categoryMap.size,
      productsCount: productMap.size + combosCount,
      combosCount,
      groupsCount,
      comboItemsCount: itemsCount,
    });
  } catch (err: any) {
    console.error("Erro ao povoar cardápio com fotos:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
