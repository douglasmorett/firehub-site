import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classifyProduct } from "@/lib/antecipacao";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const email = session.user.email;
    const role = (session.user as any)?.role;

    // Apenas contatohakim@gmail.com ou ADMINs podem acessar
    if (email !== "contatohakim@gmail.com" && role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso não autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const hours = parseFloat(searchParams.get("hours") || "1");
    const referenceTime = searchParams.get("referenceTime") || "18:00";
    
    // Obter o dia da semana atual local do servidor (0-6)
    const now = new Date();
    const defaultDay = now.getDay();
    const dayOfWeek = parseInt(searchParams.get("dayOfWeek") ?? String(defaultDay), 10);

    // Encontrar a ocorrência mais recente desse dia da semana
    const targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0);
    const diff = targetDate.getDay() - dayOfWeek;
    const offset = diff >= 0 ? diff : diff + 7;
    targetDate.setDate(targetDate.getDate() - offset);

    // Datas históricas: 7 e 14 dias atrás
    const date1 = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const date2 = new Date(targetDate.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Montar janelas de tempo
    const [refHour, refMinute] = referenceTime.split(":").map(Number);
    
    const start1 = new Date(date1);
    start1.setHours(refHour, refMinute, 0, 0);
    const end1 = new Date(start1.getTime() + hours * 60 * 60 * 1000);

    const start2 = new Date(date2);
    start2.setHours(refHour, refMinute, 0, 0);
    const end2 = new Date(start2.getTime() + hours * 60 * 60 * 1000);

    // Encontrar o franchiseeId correto
    let franchiseeId = "";
    const user = await prisma.user.findUnique({
      where: { email: email || "" },
      select: { id: true }
    });
    if (user) {
      franchiseeId = user.id;
    }

    // Se admin e não for hakim, usa o ID do hakim se ele existir para testar
    if (role === "ADMIN" && email !== "contatohakim@gmail.com") {
      const hakimUser = await prisma.user.findUnique({
        where: { email: "contatohakim@gmail.com" },
        select: { id: true }
      });
      if (hakimUser) {
        franchiseeId = hakimUser.id;
      }
    }

    if (!franchiseeId) {
      return NextResponse.json({ error: "Lojista não encontrado no banco de dados." }, { status: 404 });
    }

    // Buscar pedidos da Semana 1 (7 dias atrás)
    const ordersDay1 = await prisma.customerOrder.findMany({
      where: {
        franchiseeId,
        status: { not: "CANCELADO" },
        createdAt: { gte: start1, lte: end1 }
      },
      include: {
        items: {
          include: {
            menuProduct: {
              select: { name: true }
            }
          }
        }
      }
    });

    // Buscar pedidos da Semana 2 (14 dias atrás)
    const ordersDay2 = await prisma.customerOrder.findMany({
      where: {
        franchiseeId,
        status: { not: "CANCELADO" },
        createdAt: { gte: start2, lte: end2 }
      },
      include: {
        items: {
          include: {
            menuProduct: {
              select: { name: true }
            }
          }
        }
      }
    });

    // Consolidar contagens por sabor base
    const qtyDay1: Record<string, number> = {
      carne: 0,
      calabresa: 0,
      queijo: 0,
      "queijo temperado": 0,
      "quatro queijos": 0,
      "massa vazia": 0
    };
    const qtyDay2 = { ...qtyDay1 };

    ordersDay1.forEach(order => {
      order.items.forEach(item => {
        const name = item.menuProduct?.name || "Outros";
        const base = classifyProduct(name);
        if (base !== "outros") {
          qtyDay1[base] = (qtyDay1[base] || 0) + item.quantity;
        }
      });
    });

    ordersDay2.forEach(order => {
      order.items.forEach(item => {
        const name = item.menuProduct?.name || "Outros";
        const base = classifyProduct(name);
        if (base !== "outros") {
          qtyDay2[base] = (qtyDay2[base] || 0) + item.quantity;
        }
      });
    });

    // Calcular médias
    const averages = Object.keys(qtyDay1).map(key => {
      const q1 = qtyDay1[key];
      const q2 = qtyDay2[key];
      const avg = (q1 + q2) / 2;
      return {
        base: key,
        qtyDay1: q1,
        qtyDay2: q2,
        average: avg,
        suggested: Math.ceil(avg)
      };
    });

    const formatLocaleDate = (d: Date) => {
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    return NextResponse.json({
      success: true,
      dayOfWeek,
      referenceTime,
      hours,
      labelDay1: `${formatLocaleDate(start1)} (${start1.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${end1.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`,
      labelDay2: `${formatLocaleDate(start2)} (${start2.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${end2.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`,
      averages,
      ordersDay1: ordersDay1.map(o => ({
        id: o.id,
        customerName: o.customerName,
        createdAt: o.createdAt.toISOString(),
        totalAmount: o.totalAmount,
        status: o.status,
        items: o.items.map(i => ({ name: i.menuProduct?.name || "Outros", quantity: i.quantity }))
      })),
      ordersDay2: ordersDay2.map(o => ({
        id: o.id,
        customerName: o.customerName,
        createdAt: o.createdAt.toISOString(),
        totalAmount: o.totalAmount,
        status: o.status,
        items: o.items.map(i => ({ name: i.menuProduct?.name || "Outros", quantity: i.quantity }))
      }))
    });

  } catch (error: any) {
    console.error("[Antecipacao API] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno do servidor" }, { status: 500 });
  }
}
