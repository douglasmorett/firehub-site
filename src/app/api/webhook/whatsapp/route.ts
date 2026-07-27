import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { processChatbotAI } from "@/lib/chatbot-ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = (body.event || body.type || "").toUpperCase();
    const instance = body.instance || body.instanceName;

    console.log(`[WhatsApp Webhook] Evento recebido: "${event}" para instância "${instance}"`);

    // 1. Atualização de conexão (QR Code escaneado / conectado no celular)
    if ((event.includes("CONNECTION") || event.includes("STATE")) && instance) {
      const shortId = instance.replace(/^firehub_/, "");
      const user = await prisma.user.findFirst({
        where: { id: { endsWith: shortId } },
        select: { id: true, chatbotConfig: true },
      });

      if (user) {
        const config = (user.chatbotConfig as any) || {};
        const phone = body.data?.ownerJid?.split("@")[0] || body.data?.phone || "";
        const formattedPhone = phone ? `+55 ${phone.replace(/^55/, "")}` : "";

        await prisma.user.update({
          where: { id: user.id },
          data: {
            chatbotConfig: {
              ...config,
              connected: true,
              phone: formattedPhone || config.phone || "+55 (21) 99999-9999",
              connectedAt: new Date().toISOString(),
            },
          },
        });
        console.log(`[WhatsApp Webhook] ✅ Instância ${instance} conectada no celular!`);
      }
      return NextResponse.json({ status: "connected" });
    }

    // 2. Recebimento de mensagens (MESSAGES_UPSERT / MESSAGES.UPSERT)
    if ((event.includes("MESSAGE") || event.includes("UPSERT") || body.data?.message) && instance) {
      const data = body.data || body;
      const key = data.key || data.message?.key || {};
      const fromMe = key.fromMe;
      const remoteJid = key.remoteJid || data.from || "";

      // Ignorar grupos ou mensagens próprias
      if (fromMe || remoteJid.endsWith("@g.us") || remoteJid.includes("@g.us")) {
        return NextResponse.json({ status: "ignored_group_or_self" });
      }

      const textMessage =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage?.caption ||
        data.body ||
        data.text ||
        "";

      if (!textMessage.trim()) {
        return NextResponse.json({ status: "empty_message" });
      }

      const shortId = instance.replace(/^firehub_/, "");
      const user = await prisma.user.findFirst({
        where: { id: { endsWith: shortId } },
        select: { id: true, chatbotConfig: true },
      });

      if (!user) {
        console.warn(`[WhatsApp Webhook] Usuário com id curto ${shortId} não encontrado.`);
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const chatbotConfig = (user.chatbotConfig as any) || {};
      if (chatbotConfig.active === false) {
        return NextResponse.json({ status: "chatbot_disabled" });
      }

      // Processar resposta da IA Gemini 2.5 diretamente em memória
      const aiResponse = await processChatbotAI(user.id, textMessage, []);
      if (aiResponse?.reply) {
        const customerPhone = remoteJid.split("@")[0].replace(/\D/g, "");
        await sendEvolutionMessage(user.id, customerPhone, aiResponse.reply);
        console.log(`[WhatsApp Webhook] 🤖 Resposta enviada para ${customerPhone}: "${aiResponse.reply}"`);
      }
    }

    return NextResponse.json({ status: "success" });
  } catch (err: any) {
    console.error("[WhatsApp Webhook Error]", err);
    return NextResponse.json({ error: err.message || "Webhook error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "WhatsApp Webhook Active" });
}
