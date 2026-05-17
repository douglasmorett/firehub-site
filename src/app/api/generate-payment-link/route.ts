import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ASAAS_HEADERS = (key: string) => ({
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, cpfCnpj: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.userId !== user.id) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // Se já tem link, retorna direto
    if (order.boletoUrl) {
      return NextResponse.json({ boletoUrl: order.boletoUrl, alreadyExists: true });
    }

    if (order.status !== "PENDING_PAYMENT") {
      return NextResponse.json({ error: "Pedido não está aguardando pagamento" }, { status: 400 });
    }

    // ── Gerar diretamente no Asaas com erros detalhados ──
    const asaasKey = process.env.ASAAS_API_KEY;
    if (!asaasKey) {
      return NextResponse.json({ error: "ASAAS_API_KEY não configurada no servidor" }, { status: 500 });
    }

    const BASE = asaasKey.startsWith("$aact_prod")
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/v3";

    const shortId = order.id.slice(-6).toUpperCase();
    const headers = ASAAS_HEADERS(asaasKey);

    // 1. Buscar ou criar cliente
    let customerId: string | null = null;

    if (user.cpfCnpj) {
      const searchRes = await fetch(
        `${BASE}/customers?cpfCnpj=${encodeURIComponent(user.cpfCnpj)}`,
        { headers }
      );
      const searchData = await searchRes.json();
      
      if (!searchRes.ok) {
        console.error("[generate-link] Erro buscar cliente:", JSON.stringify(searchData));
        return NextResponse.json({ 
          error: `Asaas erro ao buscar cliente: ${searchData?.errors?.[0]?.description || JSON.stringify(searchData)}` 
        }, { status: 502 });
      }
      
      if (searchData.data?.length > 0) {
        customerId = searchData.data[0].id;
      }
    }

    if (!customerId) {
      const createRes = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: user.name || user.email,
          email: user.email,
          cpfCnpj: user.cpfCnpj || undefined,
        }),
      });
      const createData = await createRes.json();

      if (!createRes.ok) {
        console.error("[generate-link] Erro criar cliente:", JSON.stringify(createData));
        return NextResponse.json({ 
          error: `Asaas erro ao criar cliente: ${createData?.errors?.[0]?.description || JSON.stringify(createData)}` 
        }, { status: 502 });
      }
      customerId = createData.id;
    }

    if (!customerId) {
      return NextResponse.json({ error: "Não foi possível criar/encontrar cliente no Asaas" }, { status: 502 });
    }

    // 2. Criar cobrança
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10);

    const payRes = await fetch(`${BASE}/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED",
        value: order.totalAmount,
        dueDate: dueDate.toISOString().split("T")[0],
        description: `Pedido #${shortId} — Icebox Congelados`,
        externalReference: order.id,
      }),
    });

    const payData = await payRes.json();

    if (!payRes.ok) {
      console.error("[generate-link] Erro criar pagamento:", JSON.stringify(payData));
      return NextResponse.json({ 
        error: `Asaas erro ao criar cobrança: ${payData?.errors?.[0]?.description || JSON.stringify(payData)}` 
      }, { status: 502 });
    }

    const boletoUrl = payData.invoiceUrl || payData.bankSlipUrl || null;

    if (!boletoUrl) {
      console.error("[generate-link] Pagamento criado mas sem URL:", JSON.stringify(payData));
      return NextResponse.json({ 
        error: `Pagamento criado (${payData.id}) mas sem link. Status: ${payData.status}` 
      }, { status: 502 });
    }

    // 3. Salvar no banco
    await prisma.order.update({
      where: { id: order.id },
      data: { boletoUrl, asaasPaymentId: payData.id },
    });

    console.log(`[generate-link] ✅ #${shortId} link: ${boletoUrl}`);
    return NextResponse.json({ boletoUrl, paymentId: payData.id });

  } catch (error: any) {
    console.error("[generate-link] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
