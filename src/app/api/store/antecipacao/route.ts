import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classifyProduct } from "@/lib/antecipacao";
import { checkIsHoliday } from "@/lib/holidays";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const email = session.user.email || "";
    const emailLower = email.toLowerCase();
    const role = (session.user as any)?.role;

    // Apenas contatohakim@gmail.com ou ADMINs podem acessar
    if (emailLower !== "contatohakim@gmail.com" && role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso não autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const start1Str = searchParams.get("start1");
    const end1Str = searchParams.get("end1");
    const start2Str = searchParams.get("start2");
    const end2Str = searchParams.get("end2");
    const clientDate = searchParams.get("clientDate") || (start1Str ? start1Str.split("T")[0] : "");

    if (!start1Str || !end1Str || !start2Str || !end2Str) {
      return NextResponse.json({ error: "Parâmetros de data/hora ausentes." }, { status: 400 });
    }

    const start1 = new Date(start1Str);
    const end1 = new Date(end1Str);
    const start2 = new Date(start2Str);
    const end2 = new Date(end2Str);

    // Encontrar o franchiseeId correto
    let franchiseeId = "";
    const user = await prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true, city: true, storeTimezone: true }
    });
    if (user) {
      franchiseeId = user.id;
    }
    const tz = user?.storeTimezone || "America/Sao_Paulo";

    // Se admin e não for hakim, usa o ID do hakim se ele existir para testar
    let userCity = user?.city || null;
    if (role === "ADMIN" && emailLower !== "contatohakim@gmail.com") {
      const hakimUser = await prisma.user.findUnique({
        where: { email: "contatohakim@gmail.com" },
        select: { id: true, city: true }
      });
      if (hakimUser) {
        franchiseeId = hakimUser.id;
        userCity = hakimUser.city;
      }
    }

    if (!franchiseeId) {
      return NextResponse.json({ error: "Lojista não encontrado no banco de dados." }, { status: 404 });
    }

    // Verificar se hoje (clientDate) é feriado
    const holidayCheck = await checkIsHoliday(clientDate, userCity);
    const isHoliday = holidayCheck.isHoliday;
    const holidayName = holidayCheck.name;

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

    // Consolidar contagens por PRODUTO INDIVIDUAL (X-Burger, X-Bacon, Esfirras, Pizzas, Bebidas, etc.)
    const productQtyDay1: Record<string, number> = {};
    const productQtyDay2: Record<string, number> = {};

    // Consolidar contagens por sabor/massa base
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
        const name = item.menuProduct?.name || (item as any).name || "Outros";
        productQtyDay1[name] = (productQtyDay1[name] || 0) + item.quantity;

        const base = classifyProduct(name);
        if (base !== "outros") {
          qtyDay1[base] = (qtyDay1[base] || 0) + item.quantity;
        }
      });
    });

    ordersDay2.forEach(order => {
      order.items.forEach(item => {
        const name = item.menuProduct?.name || (item as any).name || "Outros";
        productQtyDay2[name] = (productQtyDay2[name] || 0) + item.quantity;

        const base = classifyProduct(name);
        if (base !== "outros") {
          qtyDay2[base] = (qtyDay2[base] || 0) + item.quantity;
        }
      });
    });

    // Calcular médias de produtos do cardápio (ordenados do mais vendido para o menos vendido)
    const allProductNames = Array.from(new Set([...Object.keys(productQtyDay1), ...Object.keys(productQtyDay2)]));
    const productAverages = allProductNames.map(name => {
      const q1 = productQtyDay1[name] || 0;
      const q2 = productQtyDay2[name] || 0;
      const avg = (q1 + q2) / 2;
      const baseSuggested = isHoliday ? avg * 1.30 : avg;
      return {
        name,
        qtyDay1: q1,
        qtyDay2: q2,
        average: avg,
        suggested: Math.ceil(baseSuggested)
      };
    }).sort((a, b) => b.suggested - a.suggested || b.average - a.average);

    // Calcular médias de insumos base
    const averages = Object.keys(qtyDay1).map(key => {
      const q1 = qtyDay1[key];
      const q2 = qtyDay2[key];
      const avg = (q1 + q2) / 2;
      const baseSuggested = isHoliday ? avg * 1.30 : avg;
      return {
        base: key,
        qtyDay1: q1,
        qtyDay2: q2,
        average: avg,
        suggested: Math.ceil(baseSuggested)
      };
    });

    const formatDateSP = (d: Date) => {
      return d.toLocaleDateString("pt-BR", {
        timeZone: tz,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
    };
    const formatTimeSP = (d: Date) => {
      return d.toLocaleTimeString("pt-BR", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit"
      });
    };

    return NextResponse.json({
      success: true,
      labelDay1: `${formatDateSP(start1)} (${formatTimeSP(start1)} - ${formatTimeSP(end1)})`,
      labelDay2: `${formatDateSP(start2)} (${formatTimeSP(start2)} - ${formatTimeSP(end2)})`,
      isHoliday,
      holidayName: holidayName || null,
      productAverages,
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
