import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const email = session.user.email;
    const role = (session.user as any)?.role;

    if (email !== "contatohakim@gmail.com" && role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso não autorizado" }, { status: 403 });
    }

    // Obter ID do user hakim
    let user = await prisma.user.findUnique({
      where: { email: email || "" },
      select: { id: true }
    });

    // Se admin e não for hakim, usa o ID do hakim se ele existir
    if (role === "ADMIN" && email !== "contatohakim@gmail.com") {
      const hakimUser = await prisma.user.findUnique({
        where: { email: "contatohakim@gmail.com" },
        select: { id: true }
      });
      if (hakimUser) user = hakimUser;
    }

    if (!user) {
      return NextResponse.json({ error: "Lojista não encontrado." }, { status: 404 });
    }

    const franchiseeId = user.id;

    // 1. Garantir que os produtos existem
    const productsToCreate = [
      { name: "Esfiha de Carne", price: 6.90, category: "Esfihas Salgadas" },
      { name: "Esfiha de Calabresa", price: 6.50, category: "Esfihas Salgadas" },
      { name: "Esfiha de Queijo", price: 6.50, category: "Esfihas Salgadas" },
      { name: "Esfiha de Queijo Temperado", price: 6.90, category: "Esfihas Salgadas" },
      { name: "Esfiha Quatro Queijos", price: 7.50, category: "Esfihas Salgadas" },
      { name: "Esfiha de Chocolate Preto", price: 8.00, category: "Esfihas Doces" },
      { name: "Esfiha de Chocolate Branco", price: 8.00, category: "Esfihas Doces" },
    ];

    const menuProducts: Record<string, any> = {};

    for (const p of productsToCreate) {
      let prod = await prisma.menuProduct.findFirst({
        where: { franchiseeId, name: p.name }
      });
      if (!prod) {
        prod = await prisma.menuProduct.create({
          data: {
            franchiseeId,
            name: p.name,
            description: `Esfiha deliciosa de ${p.name.replace("Esfiha de ", "")}`,
            price: p.price,
            category: p.category,
            active: true,
            activeDelivery: true,
            activePDV: true
          }
        });
      }
      menuProducts[p.name] = prod;
    }

    // 2. Limpar dados anteriores do simulador para evitar duplicados
    await prisma.customerOrder.deleteMany({
      where: {
        franchiseeId,
        notes: { startsWith: "[SIMULADO ANTECIPACAO]" }
      }
    });

    // 3. Criar datas relativas a hoje
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    const d7 = new Date();
    d7.setDate(d7.getDate() - 7);
    d7.setHours(0, 0, 0, 0);

    const d14 = new Date();
    d14.setDate(d14.getDate() - 14);
    d14.setHours(0, 0, 0, 0);

    // Helper para criar datas com horário preciso
    const dateAt = (baseDate: Date, hour: number, minute: number) => {
      const d = new Date(baseDate);
      d.setHours(hour, minute, 0, 0);
      return d;
    };

    // Criar pedidos simulados
    // DIA 1 (7 dias atrás)
    const orderDataDay1 = [
      {
        customerName: "Carlos Antunes",
        customerPhone: "11988887777",
        time: { hour: currentHour, min: currentMin + 15 },
        items: [
          { prod: menuProducts["Esfiha de Carne"], qty: 2 },
          { prod: menuProducts["Esfiha de Queijo"], qty: 1 }
        ]
      },
      {
        customerName: "Mariana Souza",
        customerPhone: "11977776666",
        time: { hour: currentHour, min: currentMin + 30 },
        items: [
          { prod: menuProducts["Esfiha de Calabresa"], qty: 1 },
          { prod: menuProducts["Esfiha de Chocolate Preto"], qty: 2 }
        ]
      },
      {
        customerName: "Bruno Costa",
        customerPhone: "11966665555",
        time: { hour: currentHour, min: currentMin - 15 },
        items: [
          { prod: menuProducts["Esfiha Quatro Queijos"], qty: 1 }
        ]
      }
    ];

    // DIA 2 (14 dias atrás)
    const orderDataDay2 = [
      {
        customerName: "Amanda Lima",
        customerPhone: "11955554444",
        time: { hour: currentHour, min: currentMin + 10 },
        items: [
          { prod: menuProducts["Esfiha de Carne"], qty: 4 },
          { prod: menuProducts["Esfiha de Queijo Temperado"], qty: 2 }
        ]
      },
      {
        customerName: "Daniel Ribeiro",
        customerPhone: "11944443333",
        time: { hour: currentHour, min: currentMin + 40 },
        items: [
          { prod: menuProducts["Esfiha de Queijo"], qty: 2 },
          { prod: menuProducts["Esfiha de Chocolate Branco"], qty: 1 }
        ]
      }
    ];

    let createdCount = 0;

    // Criar no banco
    for (const data of orderDataDay1) {
      const orderDate = dateAt(d7, data.time.hour, data.time.min);
      const itemsCost = data.items.reduce((acc, it) => acc + (it.prod.price * it.qty), 0);
      
      await prisma.customerOrder.create({
        data: {
          franchiseeId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          totalAmount: itemsCost,
          status: "ENCERRADO",
          notes: `[SIMULADO ANTECIPACAO] Pedido simulado 7 dias atrás às ${data.time.hour}:${data.time.min}`,
          createdAt: orderDate,
          items: {
            create: data.items.map(it => ({
              menuProductId: it.prod.id,
              quantity: it.qty,
              price: it.prod.price
            }))
          }
        }
      });
      createdCount++;
    }

    for (const data of orderDataDay2) {
      const orderDate = dateAt(d14, data.time.hour, data.time.min);
      const itemsCost = data.items.reduce((acc, it) => acc + (it.prod.price * it.qty), 0);

      await prisma.customerOrder.create({
        data: {
          franchiseeId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          totalAmount: itemsCost,
          status: "ENCERRADO",
          notes: `[SIMULADO ANTECIPACAO] Pedido simulado 14 dias atrás às ${data.time.hour}:${data.time.min}`,
          createdAt: orderDate,
          items: {
            create: data.items.map(it => ({
              menuProductId: it.prod.id,
              quantity: it.qty,
              price: it.prod.price
            }))
          }
        }
      });
      createdCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Simulação concluída. Criados ${createdCount} pedidos de teste com sucesso para o dia correspondente de hoje (há 7 e 14 dias).`
    });

  } catch (error: any) {
    console.error("[Antecipacao Simulate API] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao simular dados" }, { status: 500 });
  }
}
