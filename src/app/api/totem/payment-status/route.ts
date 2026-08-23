import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { segredoObrigatorio } from "@/lib/segredos";

// Função, não constante: `segredoObrigatorio` lança quando a variável falta, e
// no topo do módulo isso quebraria o BUILD (o Next avalia os módulos ao gerar
// as páginas). Avaliado só no uso, falha apenas a requisição — e com mensagem.
const obterSegredo = () => new TextEncoder().encode(segredoObrigatorio("NEXTAUTH_SECRET"));

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const orderId = req.nextUrl.searchParams.get("orderId");
    if (!token || !orderId) return NextResponse.json({ error: "Parâmetros obrigatórios" }, { status: 400 });

    let payload: any;
    try {
      const result = await jwtVerify(token, obterSegredo());
      payload = result.payload;
    } catch {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, totalAmount: true, gatewayPaymentId: true, franchiseeId: true }
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    // Verify the order belongs to this totem's store
    const license = await prisma.totemLicense.findUnique({
      where: { id: payload.licenseId },
      select: { franchiseeId: true }
    });
    if (!license || license.franchiseeId !== order.franchiseeId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      paid: order.status !== "AGUARDANDO_PAGAMENTO" && order.status !== "CANCELADO",
    });
  } catch (err) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
