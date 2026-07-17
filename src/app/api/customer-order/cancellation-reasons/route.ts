import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json({ error: "orderId é obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const role = (session.user as any)?.role;
  if (role !== "ADMIN" && order.franchisee.email !== session.user?.email) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const defaultReasons = [
    { cancelCodeId: "501", description: "Área de risco / Sem segurança" },
    { cancelCodeId: "502", description: "Estabelecimento sem motoboy" },
    { cancelCodeId: "503", description: "Item indisponível no cardápio" },
    { cancelCodeId: "504", description: "Pedido em duplicidade" },
    { cancelCodeId: "505", description: "Cliente desistiu do pedido" },
    { cancelCodeId: "506", description: "Cardápio com preço incorreto" },
    { cancelCodeId: "507", description: "Outros motivos" },
  ];

  if (order.ifoodOrderId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/cancellationReasons`;

      console.log(`[iFood cancellationReasons] Fetching reasons for order ${order.ifoodOrderId}...`);
      const res = await fetch(baseUrl, { method: "GET", headers });
      if (res.ok) {
        const data = await res.json();
        console.log(`[iFood cancellationReasons] Received data:`, JSON.stringify(data));
        
        let reasons: any[] = [];
        if (Array.isArray(data)) {
          reasons = data;
        } else if (data && Array.isArray(data.reasons)) {
          reasons = data.reasons;
        } else if (data && typeof data === "object") {
          const arrayVal = Object.values(data).find(Array.isArray);
          if (arrayVal) {
            reasons = arrayVal;
          }
        }

        if (reasons.length > 0) {
          const formatted = reasons.map((r: any) => ({
            cancelCodeId: String(r.cancelCodeId || r.code || r.cancelCode || "501"),
            description: String(r.description || r.reason || "Outros")
          }));
          return NextResponse.json(formatted);
        }
      } else {
        console.warn(`[iFood cancellationReasons] Failed to fetch. Status: ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[iFood cancellationReasons] Error:`, err?.message);
    }
  }

  // Fallback if not iFood order or if API fetch failed/returned empty
  return NextResponse.json(defaultReasons);
}
