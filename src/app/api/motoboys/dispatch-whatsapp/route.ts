import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();
    const { motoboyPhone, routeText, orderIds } = body;

    if (!motoboyPhone || !routeText) {
      return NextResponse.json({ error: "Telefone do motoboy e texto da rota são obrigatórios." }, { status: 400 });
    }

    const cleanPhone = motoboyPhone.replace(/\D/g, "");
    if (cleanPhone.length < 8) {
      return NextResponse.json({ error: "Número de telefone do motoboy inválido." }, { status: 400 });
    }

    const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

    let success = await sendEvolutionMessage(targetFranchiseeId, fullPhone, routeText);
    if (!success && user.id !== targetFranchiseeId) {
      success = await sendEvolutionMessage(user.id, fullPhone, routeText);
    }

    // Se vieram orderIds da rota, atualiza o status de todos para SAIU_ENTREGA e notifica cada cliente via WhatsApp
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      try {
        await prisma.customerOrder.updateMany({
          where: { id: { in: orderIds }, status: { notIn: ["ENTREGUE", "CANCELADO", "CANCELED"] } },
          data: { status: "SAIU_ENTREGA" },
        });

        const { sendOrderNotification } = await import("@/lib/order-notifications");
        for (const orderId of orderIds) {
          sendOrderNotification(orderId, "SAIU_ENTREGA").catch(() => {});
        }
      } catch (errSync) {
        console.warn("[dispatch-whatsapp] Erro ao sincronizar status/notificações dos pedidos da rota:", errSync);
      }
    }

    if (success) {
      return NextResponse.json({
        success: true,
        message: `🚀 Rota enviada com sucesso no WhatsApp do Motoboy (${fullPhone})!`,
      });
    } else {
      return NextResponse.json(
        { error: "Falha ao enviar mensagem no WhatsApp do motoboy. Verifique se o WhatsApp Gateway está ativo." },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
