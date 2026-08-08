import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

// Mapeia paymentMethod (texto livre) → código interno
function mapMethod(pm: string | null): string {
  const v = (pm || "").toLowerCase();
  if (v.includes("dinheiro") || v === "cash") return "CASH";
  if (v.includes("crédito") || v.includes("credito") || v.includes("credit")) return "CARD_CREDIT";
  if (v.includes("débito") || v.includes("debito") || v.includes("debit")) return "CARD_DEBIT";
  if (v.includes("pix")) return "PIX";
  if (v.includes("voucher") || v.includes("vale")) return "VOUCHER";
  if (v.includes("ifood") || v.includes("online")) return "ONLINE";
  return "OTHER";
}

// Agrupa pedidos por forma de pagamento
function groupOrders(orders: any[]) {
  const byMethod: Record<string, number> = {};
  let ifoodTotal = 0;
  let jotajaTotal = 0;
  let onlineTotal = 0;

  for (const o of orders) {
    const amount = (o.totalAmount ?? 0) + (o.discountIfood ?? 0);
    const code   = mapMethod(o.paymentMethod);

    // iFood
    if (o.source === "IFOOD" || o.ifoodOrderId) {
      ifoodTotal += amount;
      byMethod["IFOOD"] = (byMethod["IFOOD"] || 0) + amount;
      continue;
    }
    // Jotajá (Open Delivery)
    if (o.source === "JOTAJA" || o.openDeliveryOrderId) {
      jotajaTotal += amount;
      byMethod["JOTAJA"] = (byMethod["JOTAJA"] || 0) + amount;
      continue;
    }
    // Pago online (Pagar.me)
    if (o.pagarmeStatus === "paid" || o.pagarmeChargeId) {
      onlineTotal += amount;
      byMethod["ONLINE"] = (byMethod["ONLINE"] || 0) + amount;
      continue;
    }
    byMethod[code] = (byMethod[code] || 0) + amount;
  }

  return { byMethod, ifoodTotal, jotajaTotal, onlineTotal };
}

// GET — busca caixa aberto | preview de esperado | histórico | histórico do dia
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email! },
    select: { storeTimezone: true }
  });
  const tz = currentUser?.storeTimezone || "America/Sao_Paulo";

  const mode = req.nextUrl.searchParams.get("mode") || "current";

  if (mode === "current") {
    const open = await prisma.cashRegister.findFirst({
      where: { status: "OPEN" },
      include: { entries: true },
      orderBy: { openedAt: "desc" },
    });
    return NextResponse.json({ register: open });
  }

  if (mode === "preview") {
    // Retorna valores esperados por método para o caixa aberto atual
    const open = await prisma.cashRegister.findFirst({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    if (!open) return NextResponse.json({ error: "Nenhum caixa aberto" }, { status: 404 });

    const orders = await prisma.customerOrder.findMany({
      where: {
        status: { in: ["ENTREGUE", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA"] },
        createdAt: { gte: open.openedAt }
      },
    });

    const { byMethod, ifoodTotal, jotajaTotal, onlineTotal } = groupOrders(orders);
    // Adiciona troco de abertura no dinheiro
    byMethod["CASH"] = (byMethod["CASH"] || 0) + open.openingAmount;

    const totalExpected = Object.values(byMethod).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      registerId:    open.id,
      openedAt:      open.openedAt,
      openingAmount: open.openingAmount,
      byMethod,
      ifoodTotal,
      jotajaTotal,
      onlineTotal,
      totalExpected,
      orderCount:    orders.length,
    });
  }

  if (mode === "today") {
    // Usar timezone da loja para calcular início do dia corretamente
    const nowBR = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const start = new Date(nowBR);
    start.setHours(0, 0, 0, 0);
    // Converter de volta para UTC para query no banco
    const offsetMs = new Date().getTime() - nowBR.getTime();
    const startUTC = new Date(start.getTime() + offsetMs);
    const registers = await prisma.cashRegister.findMany({
      where: { openedAt: { gte: startUTC } },
      include: { entries: true },
      orderBy: { openedAt: "asc" },
    });
    return NextResponse.json(registers);
  }

  // histórico (últimos 30 fechamentos)
  const history = await prisma.cashRegister.findMany({
    where: { status: "CLOSED" },
    include: { entries: true },
    orderBy: { closedAt: "desc" },
    take: 30,
  });
  return NextResponse.json(history);
}

// POST — abrir caixa
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const existing = await prisma.cashRegister.findFirst({ where: { status: "OPEN" } });
  if (existing) return NextResponse.json({ error: "Já existe um caixa aberto." }, { status: 400 });

  const body = await req.json();
  const parsed = parseFloat(body.openingAmount || "0");
  if (parsed < 0) {
    return NextResponse.json({ error: "Valor de abertura não pode ser negativo." }, { status: 400 });
  }
  const register = await prisma.cashRegister.create({
    data: {
      openingAmount: parsed,
      openedBy: session.user?.email || "admin",
      status: "OPEN",
    },
  });
  return NextResponse.json(register);
}

// PUT — fechar caixa + enviar resumo WhatsApp
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email! },
    select: { storeTimezone: true, storePhone: true, name: true, storeName: true }
  });
  const tz = currentUser?.storeTimezone || "America/Sao_Paulo";

  const { registerId, entries, justification } = await req.json();

  const register = await prisma.cashRegister.findUnique({
    where: { id: registerId },
    include: { entries: true },
  });
  if (!register) return NextResponse.json({ error: "Caixa não encontrado." }, { status: 404 });

  // Pedidos do período
  const orders = await prisma.customerOrder.findMany({
    where: { status: "ENTREGUE", createdAt: { gte: register.openedAt } },
  });

  const { byMethod, ifoodTotal, jotajaTotal, onlineTotal } = groupOrders(orders);
  byMethod["CASH"] = (byMethod["CASH"] || 0) + register.openingAmount;

  const expectedTotal = Object.values(byMethod).reduce((a, b) => a + b, 0);
  const actualTotal   = entries.reduce((sum: number, e: any) => sum + parseFloat(e.actualAmount || "0"), 0);
  const discrepancy   = actualTotal - expectedTotal;

  // Exige justificativa se discrepância > R$0,50
  if (Math.abs(discrepancy) > 0.5 && !justification?.trim()) {
    return NextResponse.json({
      error: "Há uma discrepância no caixa. Informe uma justificativa.",
      discrepancy,
      expectedTotal,
      actualTotal,
      expectedByMethod: byMethod,
    }, { status: 400 });
  }

  // Salvar entradas
  const entriesData = entries.map((e: any) => ({
    method:         mapMethod(e.method),
    methodLabel:    e.methodLabel,
    expectedAmount: byMethod[mapMethod(e.method)] || 0,
    actualAmount:   parseFloat(e.actualAmount || "0"),
    registerId,
  }));
  await prisma.cashRegisterEntry.createMany({ data: entriesData });

  const closed = await prisma.cashRegister.update({
    where: { id: registerId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedBy: session.user?.email || "admin",
      expectedTotal,
      actualTotal,
      discrepancy,
      justification: justification || null,
    },
    include: { entries: true },
  });

  // Buscar telefone do admin para WhatsApp
  const admin = currentUser;

  // Montar mensagem WhatsApp
  const now     = new Date().toLocaleString("pt-BR", { timeZone: tz });
  const diff    = discrepancy >= 0 ? `+${fmt(discrepancy)}` : fmt(discrepancy);
  const diffEmoji = Math.abs(discrepancy) <= 0.5 ? "✅" : (discrepancy > 0 ? "🟡 Sobra" : "🔴 Falta");

  const METHOD_LABELS: Record<string, string> = {
    CASH: "💵 Dinheiro", CARD_CREDIT: "💳 Cartão Crédito", CARD_DEBIT: "💳 Cartão Débito",
    PIX: "📱 PIX", VOUCHER: "🎟️ Voucher", IFOOD: "🛵 iFood", JOTAJA: "📱 Jotajá", ONLINE: "💻 Online", OTHER: "🔄 Outro",
  };

  const methodLines = Object.entries(byMethod)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `  ${METHOD_LABELS[k] || k}: *${fmt(v)}*`)
    .join("\n");

  const waMsg = encodeURIComponent(
    `🏪 *FECHAMENTO DE CAIXA*\n` +
    `📍 ${admin?.storeName || "Loja"}\n` +
    `📅 ${now}\n\n` +
    `💰 *Troco abertura:* ${fmt(register.openingAmount)}\n` +
    `📦 *Pedidos entregues:* ${orders.length}\n\n` +
    `📊 *ESPERADO POR FORMA:*\n${methodLines}\n\n` +
    `📥 *Total esperado:* ${fmt(expectedTotal)}\n` +
    `📤 *Total informado:* ${fmt(actualTotal)}\n` +
    `${diffEmoji}: ${diff}\n` +
    (justification ? `\n📝 Justificativa: ${justification}` : "") +
    `\n\n_Relatório gerado pelo FireHub_`
  );

  const phone  = (admin?.storePhone || "").replace(/\D/g, "");
  const waLink = phone ? `https://wa.me/55${phone}?text=${waMsg}` : `https://wa.me/?text=${waMsg}`;

  return NextResponse.json({ ...closed, waLink });
}
