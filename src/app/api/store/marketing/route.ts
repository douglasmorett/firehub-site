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
      const rawPhone = o.customerPhone || "";
      const cleanDigits = rawPhone.replace(/\D/g, "");

      // Ignora números mascarados do iFood (começados em 0800) e números com menos de 10 dígitos reais
      if (!cleanDigits || cleanDigits.startsWith("0800") || cleanDigits.startsWith("550800") || cleanDigits.length < 10) {
        return;
      }

      if (!customerMap.has(rawPhone)) {
        customerMap.set(rawPhone, {
          id: rawPhone,
          name: o.customerName || "Cliente WhatsApp",
          phone: rawPhone,
          totalOrders: 1,
          updatedAt: o.createdAt,
        });
      } else {
        const existing = customerMap.get(rawPhone);
        existing.totalOrders += 1;
      }
    });

    const customers = Array.from(customerMap.values());

    const chatbotConfig = (user.chatbotConfig as any) || {};

    // Coletar os códigos de cupons vinculados às campanhas de marketing e cupom instantâneo
    const activeCampaignCoupons = new Set<string>();
    if (chatbotConfig.coupon7d) activeCampaignCoupons.add(chatbotConfig.coupon7d.trim().toLowerCase());
    if (chatbotConfig.coupon15d) activeCampaignCoupons.add(chatbotConfig.coupon15d.trim().toLowerCase());
    if (chatbotConfig.coupon30d) activeCampaignCoupons.add(chatbotConfig.coupon30d.trim().toLowerCase());
    if (chatbotConfig.instantCouponCode) activeCampaignCoupons.add(chatbotConfig.instantCouponCode.trim().toLowerCase());

    // Buscar pedidos reais da loja que utilizaram os cupons das campanhas de marketing
    let recoveredOrdersCount = 0;
    let recoveredRevenue = 0;

    if (activeCampaignCoupons.size > 0) {
      const campaignOrders = await prisma.customerOrder.findMany({
        where: {
          franchiseeId: targetFranchiseeId,
          notes: {
            contains: "Cupom:", // Observação onde os cupons aplicados ficam registrados no pedido
          },
        },
        select: {
          totalAmount: true,
          notes: true,
        },
      });

      campaignOrders.forEach((o) => {
        const notesLower = (o.notes || "").toLowerCase();
        for (const coupon of activeCampaignCoupons) {
          if (notesLower.includes(`cupom: ${coupon}`) || notesLower.includes(`[cupom: ${coupon}]`)) {
            recoveredOrdersCount += 1;
            recoveredRevenue += o.totalAmount;
            break;
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      totalCustomers: customers.length,
      customers,
      recoveredOrdersCount,
      recoveredRevenue,
      marketingConfig: {
        autoRecuperation7d: chatbotConfig.autoRecuperation7d ?? true,
        autoRecuperation15d: chatbotConfig.autoRecuperation15d ?? true,
        autoRecuperation30d: chatbotConfig.autoRecuperation30d ?? true,
        msg7d: chatbotConfig.msg7d || "Oie, sentimos sua falta! 🍕 Que tal matar a fome hoje com R$ 10 de desconto?",
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

    // 1. Disparar teste individual de 7 dias
    if (body.action === "send_test_7d") {
      const { phone } = body;
      if (!phone) {
        return NextResponse.json({ error: "Telefone é obrigatório." }, { status: 400 });
      }

      const cleanPhone = phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

      const chatbotConfig = (user.chatbotConfig as any) || {};
      const coupon = chatbotConfig.coupon7d || "VOLTEI10";
      const storeSlug = (user as any).slug || "loja";
      const storeUrl = `https://firehubfood.com.br/loja/${storeSlug}`;

      const messageText = `Oi Rosangela, tudo bem? Sentimos sua falta! Tá sumida! 🍕\n\n` +
                          `Trouxemos 10% de desconto para você lanchar com a gente hoje!\n` +
                          `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

      const success = await sendEvolutionMessage(targetFranchiseeId, fullPhone, messageText);

      if (success) {
        return NextResponse.json({ success: true, message: `🚀 Mensagem de teste de 7 dias enviada com sucesso para ${fullPhone}!` });
      } else {
        return NextResponse.json({ error: "Falha ao enviar via WhatsApp. Certifique-se de que o WhatsApp da loja está conectado por QR Code." }, { status: 500 });
      }
    }

    // 2. Salvar configurações automáticas de marketing (7d, 15d, 30d)
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
