import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEvolutionQRCode, disconnectEvolutionInstance } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, chatbotConfig: true, storePhone: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const chatbotConfig = (user.chatbotConfig as any) || {};

  // Obter QR Code real via Evolution API Gateway / Baileys Gateway com timeout
  try {
    const waDataPromise = getEvolutionQRCode(user.id, user.storePhone || undefined);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Timeout ao consultar gateway")), 10000)
    );
    const waData = await Promise.race([waDataPromise, timeoutPromise]) as any;

    if (waData.connected && !chatbotConfig.connected) {
      const updatedConfig = {
        ...chatbotConfig,
        connected: true,
        phone: waData.phone || chatbotConfig.phone || user.storePhone || "+55 (21) 99999-9999",
        connectedAt: new Date().toISOString(),
        // Histórico, não estado: é o que autoriza o alerta de queda mais tarde.
        // Quem nunca conectou não tem robô para cair e não deve ser avisado.
        jaConectouAlgumaVez: true,
        desconectadoDesde: null,
        avisoDesconexaoEm: null,
        // Vínculo instância -> loja. O webhook procura por este campo para saber
        // de quem é a mensagem; sem ele, o robô da loja ficava mudo mesmo com o
        // QR conectado. O nome é o mesmo gerado em getEvolutionQRCode.
        instanceName: `firehub_${user.id.slice(-10)}`,
      };
      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });
    } else if (!waData.connected && chatbotConfig.connected) {
      const updatedConfig = {
        ...chatbotConfig,
        connected: false,
        connectedAt: null,
        // `connectedAt` some, mas o histórico precisa ficar: é ele que mantém
        // a loja sob vigilância do keep-alive e autoriza o aviso de queda.
        // Sem esta linha, abrir a tela de QR durante a queda desligava o
        // próprio alarme.
        jaConectouAlgumaVez: true,
        desconectadoDesde: chatbotConfig.desconectadoDesde || new Date().toISOString(),
      };
      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });
    }
    return NextResponse.json(waData);
  } catch (err: any) {
    console.error("[WhatsApp Gateway API] Erro ao obter QR Code da Evolution API:", err);

    return NextResponse.json({
      connected: false,
      qrCodeUrl: null,
      error: "Servidor de WhatsApp indisponível no momento. Certifique-se de que a Evolution API / WhatsApp Gateway está rodando.",
      status: "DISCONNECTED",
    });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, chatbotConfig: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  try {
    const { action, phone } = await req.json();
    const currentConfig = (user.chatbotConfig as any) || {};

    if (action === "connect") {
      const updatedConfig = {
        ...currentConfig,
        connected: true,
        phone: phone || (user.chatbotConfig as any)?.phone || "+55 (21) 99876-5432",
        connectedAt: new Date().toISOString(),
      };

      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });

      return NextResponse.json({ success: true, connected: true, config: updatedConfig });
    } else if (action === "disconnect") {
      await disconnectEvolutionInstance(user.id);

      const updatedConfig = {
        ...currentConfig,
        connected: false,
        phone: "",
        connectedAt: null,
      };

      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });

      return NextResponse.json({ success: true, connected: false, config: updatedConfig });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro na sessão WhatsApp" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, chatbotConfig: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  try {
    await disconnectEvolutionInstance(user.id);
    const currentConfig = (user.chatbotConfig as any) || {};
    const updatedConfig = {
      ...currentConfig,
      connected: false,
      phone: "",
      connectedAt: null,
    };

    await prisma.user.update({
      where: { id: user.id },
      data: { chatbotConfig: updatedConfig },
    });

    return NextResponse.json({ success: true, connected: false, config: updatedConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao desconectar WhatsApp" }, { status: 500 });
  }
}
