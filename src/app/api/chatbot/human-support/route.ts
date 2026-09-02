import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { clearLoopGuard } from "@/lib/loop-guard";

export const dynamic = "force-dynamic";

// In-memory store for pending human support chats
// In production serverless environments, this can also sync via global cache or DB
export interface HumanSupportChat {
  id: string;
  userId: string;
  jid: string;
  phone: string;
  clientName: string;
  status: "PENDING" | "ACTIVE" | "CLOSED";
  /** Por que caiu na fila ("Reclamação", "Pediu atendente"). Vazio = entrada antiga. */
  motivo?: string;
  unreadCount: number;
  lastMessage: string;
  updatedAt: number;
  messages: Array<{
    sender: "user" | "attendant" | "bot";
    text: string;
    timestamp: number;
  }>;
}

// Global cache for human support requests
declare global {
  var __humanSupportChats: Map<string, HumanSupportChat> | undefined;
}

function getSupportStore(): Map<string, HumanSupportChat> {
  if (!global.__humanSupportChats) {
    global.__humanSupportChats = new Map<string, HumanSupportChat>();
  }
  return global.__humanSupportChats;
}

export async function GET(req: NextRequest) {
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

    const targetUserId = user.ownerId || user.id;
    const store = getSupportStore();

    const chats: HumanSupportChat[] = [];
    for (const chat of store.values()) {
      if (chat.userId === targetUserId && chat.status !== "CLOSED") {
        chats.push(chat);
      }
    }

    chats.sort((a, b) => b.updatedAt - a.updatedAt);

    const totalUnread = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

    return NextResponse.json({
      success: true,
      totalUnread,
      chats,
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
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetUserId = user.ownerId || user.id;
    const { action, chatId, message, jid } = await req.json();
    const store = getSupportStore();

    // 1. Responder mensagem ao cliente pelo WhatsApp
    if (action === "send_message") {
      if (!jid || !message) {
        return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
      }

      const key = `${targetUserId}_${jid}`;
      let chat = store.get(key);

      const success = await sendEvolutionMessage(targetUserId, jid, message);

      if (!success) {
        return NextResponse.json({ error: "Falha ao enviar mensagem pelo WhatsApp" }, { status: 500 });
      }

      if (chat) {
        chat.messages.push({
          sender: "attendant",
          text: message,
          timestamp: Date.now(),
        });
        chat.lastMessage = message;
        chat.updatedAt = Date.now();
        chat.status = "ACTIVE";
      }

      return NextResponse.json({ success: true, message: "Mensagem enviada com sucesso" });
    }

    // 2. Marcar como lido ao abrir a conversa
    if (action === "mark_read") {
      const key = `${targetUserId}_${jid}`;
      const chat = store.get(key);
      if (chat) {
        chat.unreadCount = 0;
        chat.status = "ACTIVE";
      }
      return NextResponse.json({ success: true });
    }

    // 3. Encerrar atendimento (Robô volta a atender e a conversa é fechada)
    if (action === "close_chat") {
      const key = `${targetUserId}_${jid}`;
      const chat = store.get(key);
      if (chat) {
        chat.status = "CLOSED";
        chat.unreadCount = 0;
      }

      // Fechar aqui apagava só a fila em memória. Desde que problema no pedido
      // passou a marcar a conversa no BANCO (para a pausa sobreviver ao
      // restart), fechar sem limpar essa marca deixaria o cliente sem robô até
      // o prazo de 12 h vencer — mesmo com o atendimento já resolvido.
      await clearLoopGuard(targetUserId, jid).catch(() => {});

      // Envia aviso ao cliente no WhatsApp
      const endMessage = "Atendimento humano finalizado com sucesso! Se precisar de mais alguma coisa, nosso robô continuará te ajudando por aqui. Obrigado! 😊";
      await sendEvolutionMessage(targetUserId, jid, endMessage).catch(() => {});

      return NextResponse.json({ success: true, message: "Atendimento encerrado. Robô reativado." });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
