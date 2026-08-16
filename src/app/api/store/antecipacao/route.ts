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
              select: { name: true, isCombo: true }
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
              select: { name: true, isCombo: true }
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

    const isGenericName = (nameStr: string) => {
      if (!nameStr) return true;
      const n = nameStr.trim().toLowerCase();
      return (
        n === "item de integração" ||
        n === "item de integracao" ||
        n === "outros" ||
        n === "item sem nome" ||
        n.startsWith("pedido ifood") ||
        n.startsWith("pedido 99food") ||
        n.startsWith("pedido jotaja") ||
        n.startsWith("item #")
      );
    };

    // ─── Função para extrair itens individuais de um combo ──────────────────
    const extractItemsFromCombo = (item: any): { name: string; qty: number }[] => {
      const results: { name: string; qty: number }[] = [];
      if (!item.comboSelections) return results;

      try {
        const cs = typeof item.comboSelections === "string"
          ? JSON.parse(item.comboSelections)
          : item.comboSelections;

        if (Array.isArray(cs)) {
          // Formato: [{name: "Esfirra de Carne", quantity: 2}, ...] ou
          //          [{title: "Grupo X", items: [{name: "...", qty: 1}]}] ou
          //          [{groupTitle: "...", selections: [{name: "...", quantity: 1}]}]
          for (const entry of cs) {
            // Formato iFood: options array [{name, quantity, ...}]
            if (entry.name && !entry.items && !entry.selections) {
              results.push({ name: entry.name, qty: entry.quantity || 1 });
            }
            // Formato combo groups: [{title, items: [...]}]
            if (entry.items && Array.isArray(entry.items)) {
              for (const subItem of entry.items) {
                const subName = subItem.name || subItem.productName || "";
                if (subName && !isGenericName(subName)) {
                  results.push({ name: subName, qty: subItem.quantity || subItem.qty || 1 });
                }
              }
            }
            // Formato com selections
            if (entry.selections && Array.isArray(entry.selections)) {
              for (const sel of entry.selections) {
                const selName = sel.name || sel.productName || "";
                if (selName && !isGenericName(selName)) {
                  results.push({ name: selName, qty: sel.quantity || 1 });
                }
              }
            }
          }
        } else if (typeof cs === "object" && cs !== null) {
          // Formato objeto: {name: "X", items: [...]}
          if (cs.items && Array.isArray(cs.items)) {
            for (const subItem of cs.items) {
              const subName = subItem.name || subItem.productName || "";
              if (subName && !isGenericName(subName)) {
                results.push({ name: subName, qty: (subItem.quantity || 1) * item.quantity });
              }
            }
          }
        }
      } catch {
        // Se não conseguir parsear, ignora
      }

      return results;
    };

    // ─── Processar itens (explodindo combos) ───────────────────────────────
    const processItems = (order: any, productQty: Record<string, number>, baseQty: Record<string, number>) => {
      order.items.forEach((item: any) => {
        const isCombo = item.menuProduct?.isCombo || false;
        const name = item.menuProduct?.name || (item as any).name || "";

        if (isCombo || (item.comboSelections && name.toLowerCase().includes("combo"))) {
          // COMBO → explodir em itens individuais
          const subItems = extractItemsFromCombo(item);
          if (subItems.length > 0) {
            for (const sub of subItems) {
              if (!isGenericName(sub.name)) {
                productQty[sub.name] = (productQty[sub.name] || 0) + sub.qty;
              }
              const base = classifyProduct(sub.name);
              if (base !== "outros") {
                baseQty[base] = (baseQty[base] || 0) + sub.qty;
              }
            }
          } else {
            // Se não conseguiu explodir (combo sem comboSelections), conta normalmente
            if (name && !isGenericName(name)) {
              productQty[name] = (productQty[name] || 0) + item.quantity;
            }
            const base = classifyProduct(name);
            if (base !== "outros") {
              baseQty[base] = (baseQty[base] || 0) + item.quantity;
            }
          }
        } else {
          // ITEM NORMAL → contar diretamente
          if (name && !isGenericName(name)) {
            productQty[name] = (productQty[name] || 0) + item.quantity;
          }
          const base = classifyProduct(name);
          if (base !== "outros") {
            baseQty[base] = (baseQty[base] || 0) + item.quantity;
          }
        }
      });
    };

    ordersDay1.forEach(order => processItems(order, productQtyDay1, qtyDay1));
    ordersDay2.forEach(order => processItems(order, productQtyDay2, qtyDay2));

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
