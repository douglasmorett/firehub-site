import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const { customerName, customerPhone, customerAddress, deliveryType, notes, totalAmount, deliveryFee, items, employeeId, employeeName, changeAmount, change } = data;
  let paymentMethod: string = data.paymentMethod;

  // ── PAGAMENTO DIVIDIDO ──────────────────────────────────────────────────
  //
  // O balcão pode receber metade no Pix e metade em dinheiro. As partes vêm
  // em `paymentMethods` ([{ method, amount }], o formato da mesa) e têm que
  // fechar com o total: gravar partes que não somam o pedido é criar uma
  // diferença de caixa que ninguém vai achar. O `paymentMethod` (texto) vira o
  // resumo "Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00" — é o que a comanda e
  // o painel mostram; o caixa lê as partes.
  let paymentMethods: { method: string; amount: number }[] | null = null;
  if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
    const partes = data.paymentMethods
      .map((p: any) => ({ method: String(p?.method || p?.metodo || "").trim(), amount: Math.round((Number(p?.amount ?? p?.valor) || 0) * 100) / 100 }))
      .filter((p: { method: string; amount: number }) => p.method && p.amount > 0);
    if (partes.length < 2) {
      return NextResponse.json({ error: "Para dividir o pagamento, informe pelo menos duas formas com valor." }, { status: 400 });
    }
    const soma = Math.round(partes.reduce((s: number, p: { amount: number }) => s + p.amount, 0) * 100) / 100;
    if (Math.abs(soma - (Number(totalAmount) || 0)) > 0.02) {
      return NextResponse.json({ error: `A soma das formas (R$ ${soma.toFixed(2).replace(".", ",")}) não bate com o total do pedido (R$ ${(Number(totalAmount) || 0).toFixed(2).replace(".", ",")}).` }, { status: 400 });
    }
    paymentMethods = partes;
    paymentMethod = "Dividido: " + partes.map((p: { method: string; amount: number }) => `${p.method} R$ ${p.amount.toFixed(2).replace(".", ",")}`).join(" + ");
  }

  if (!items || items.length === 0) return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });

  const dbUser = await prisma.user.findUnique({ where: { email: session.user.email! }, select: { id: true, ownerId: true } });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = dbUser.ownerId || dbUser.id;

  // ISOLAMENTO ENTRE LOJAS: so aceita produto DESTA loja.
  // O corpo vinha cru — um menuProductId de outra loja entrava no pedido e a
  // baixa de estoque seguia a ficha tecnica dela, drenando insumo alheio.
  const idsInformados = (items || []).map((i: any) => i.menuProductId).filter(Boolean);
  if (idsInformados.length > 0) {
    const daLoja = await prisma.menuProduct.findMany({
      where: { id: { in: idsInformados }, franchiseeId: targetFranchiseeId },
      select: { id: true },
    });
    const permitidos = new Set(daLoja.map((p) => p.id));
    const invasores = idsInformados.filter((id: string) => !permitidos.has(id));
    if (invasores.length > 0) {
      console.error(`[PDV] Produtos de outra loja recusados na loja ${targetFranchiseeId}:`, invasores);
      return NextResponse.json(
        { error: "Um dos itens não pertence ao cardápio desta loja." },
        { status: 400 }
      );
    }
  }

  const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);

  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: targetFranchiseeId,
      dailyOrderNumber,
      customerName: customerName || (employeeName ? `Func. ${employeeName}` : "Balcão"),
      customerPhone: customerPhone || "00000000000",
      customerAddress: customerAddress || "",
      deliveryType: deliveryType || "RETIRADA",
      paymentMethod: paymentMethod || "Dinheiro",
      ...(paymentMethods ? { paymentMethods } : {}),
      changeAmount: changeAmount ? Number(changeAmount) : (change ? Number(change) : null),
      employeeId: employeeId || null,
      employeeName: employeeName || null,
      notes: notes || "",
      totalAmount: totalAmount || 0,
      deliveryFee: deliveryFee || 0,
      status: "ACEITO",
      source: "PRESENCIAL",
      items: {
        create: items.map((item: any) => ({
          menuProductId: item.menuProductId,
          quantity: item.quantity,
          price: item.price,
          comboSelections: item.comboSelections ? (typeof item.comboSelections === "string" ? item.comboSelections : JSON.stringify(item.comboSelections)) : null,
          // Observação do item ("tirar o milho"): a coluna existia, a cozinha
          // e a comanda já a imprimem, mas o balcão nunca a gravava.
          notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
        })),
      },
    },
  });

  // Realiza a baixa imediata no estoque do pedido presencial
  const { deductStockForOrder } = await import("@/lib/stock");
  deductStockForOrder(order.id).catch(err =>
    console.error("[Stock] Erro ao deduzir estoque de pedido presencial:", err)
  );

  // Enfileira impressão automática da Via de Retirada/Comanda na impressora térmica
  try {
    const fullOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            menuProduct: { select: { id: true, name: true, isBeverage: true } }
          }
        }
      }
    });

    if (fullOrder) {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(targetFranchiseeId, fullOrder, dbUser.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS");
    }
  } catch (printErr) {
    console.error("[Presencial] Erro ao enfileirar impressão automática:", printErr);
  }

  return NextResponse.json({ success: true, orderId: order.id });
}
