import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, chatbotConfig: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;

    // Buscar todos os clientes da loja a partir dos pedidos e interações
    const orders = await prisma.customerOrder.findMany({
      where: { franchiseeId: targetFranchiseeId },
      select: {
        customerName: true,
        customerPhone: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });

    const customerMap = new Map<string, any>();
    orders.forEach((o) => {
      const phone = o.customerPhone;
      if (phone && !customerMap.has(phone)) {
        customerMap.set(phone, {
          id: phone,
          name: o.customerName || "Cliente WhatsApp",
          phone: phone,
          totalOrders: 1,
          updatedAt: o.createdAt,
        });
      } else if (phone && customerMap.has(phone)) {
        const existing = customerMap.get(phone);
        existing.totalOrders += 1;
      }
    });

    const customers = Array.from(customerMap.values());

    const chatbotConfig = (user.chatbotConfig as any) || {};

    return NextResponse.json({
      success: true,
      totalCustomers: customers.length,
      customers,
      marketingConfig: {
        autoRecuperation7d: chatbotConfig.autoRecuperation7d ?? true,
        autoRecuperation15d: chatbotConfig.autoRecuperation15d ?? true,
        autoRecuperation30d: chatbotConfig.autoRecuperation30d ?? true,
        msg7d: chatbotConfig.msg7d || "Oie, sentimos sua falta! 🍕 Que tal matar a fome hoje com R$ 10 de desconto? Use o cupom VOLTEI10!",
        msg15d: chatbotConfig.msg15d || "Faz 15 dias que você não pede seu lanche favorito! 🚀 Ganhe 15% OFF hoje no nosso cardápio!",
        msg30d: chatbotConfig.msg30d || "Saudade do nosso tempero especial? ❤️ Liberamos Frete Grátis exclusivo para você pedir hoje!",
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, chatbotConfig: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();

    // 1. Salvar configurações automáticas de marketing (7d, 15d, 30d)
    if (body.action === "save_config") {
      const currentConfig = (user.chatbotConfig as any) || {};
      const updatedConfig = {
        ...currentConfig,
        autoRecuperation7d: body.autoRecuperation7d,
        autoRecuperation15d: body.autoRecuperation15d,
        autoRecuperation30d: body.autoRecuperation30d,
        msg7d: body.msg7d,
        msg15d: body.msg15d,
        msg30d: body.msg30d,
      };

      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });

      return NextResponse.json({ success: true, message: "Configurações de Marketing salvas!" });
    }

    // 2. Disparo seguro em massa (Anti-Ban com delay aleatório entre 8s e 15s por mensagem)
    if (body.action === "send_broadcast") {
      const { message, targetPhones } = body;
      if (!message || !Array.isArray(targetPhones) || targetPhones.length === 0) {
        return NextResponse.json({ error: "Mensagem e contatos alvo são obrigatórios." }, { status: 400 });
      }

      // Limite máximo de segurança recomendado por lote: 50 mensagens
      const safeBatch = targetPhones.slice(0, 50);

      // Dispara em background com intervalo seguro anti-ban
      (async () => {
        for (let i = 0; i < safeBatch.length; i++) {
          const phone = safeBatch[i];
          const cleanPhone = phone.replace(/\D/g, "");
          const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

          await sendEvolutionMessage(targetFranchiseeId, fullPhone, message).catch(() => {});

          // Intervalo de segurança anti-ban aleatório entre 8 a 15 segundos entre cada envio
          const delaySec = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
          await new Promise((r) => setTimeout(r, delaySec));
        }
      })();

      return NextResponse.json({
        success: true,
        message: `🚀 Disparo anti-ban iniciado com segurança para ${safeBatch.length} contatos! As mensagens serão enviadas com intervalos de 8 a 15 segundos entre cada uma.`,
      });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
