import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = body.event || body.type;
    const instance = body.instance;

    // Se a conexão foi aberta (QR Code escaneado no celular)
    if (event === "CONNECTION_UPDATE" && body.data?.state === "open" && instance) {
      const shortId = instance.replace(/^firehub_/, "");
      const user = await prisma.user.findFirst({
        where: { id: { endsWith: shortId } },
        select: { id: true, chatbotConfig: true },
      });

      if (user) {
        const config = (user.chatbotConfig as any) || {};
        const phone = body.data?.ownerJid?.split("@")[0] || "";
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
        console.log(`[WhatsApp Webhook] ✅ Instância ${instance} conectada com sucesso no celular!`);
      }
      return NextResponse.json({ status: "connected" });
    }

    // Se for recebimento de mensagem (MESSAGES_UPSERT)
    if (event === "MESSAGES_UPSERT" && body.data && instance) {
      const data = body.data;
      const key = data.key || {};
      const fromMe = key.fromMe;
      const remoteJid = key.remoteJid || "";

      if (fromMe || remoteJid.endsWith("@g.us")) {
        return NextResponse.json({ status: "ignored_group_or_self" });
      }

      const textMessage =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage?.caption ||
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
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Processar resposta da IA pelo motor do FireHub
      const host = process.env.NEXTAUTH_URL || "https://firehubfood.com";
      const chatRes = await fetch(`${host}/api/chatbot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          message: textMessage,
          history: [],
        }),
      });

      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (chatData?.reply) {
          const customerPhone = remoteJid.split("@")[0];
          await sendEvolutionMessage(user.id, customerPhone, chatData.reply);
          console.log(`[WhatsApp Webhook] 🤖 Resposta da IA enviada para ${customerPhone}: "${chatData.reply}"`);
        }
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
