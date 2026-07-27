import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processChatbotAI } from "@/lib/chatbot-ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const { message, history } = await req.json();
    if (!message) {
      return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
    }

    const res = await processChatbotAI(user.id, message, history);
    return NextResponse.json(res);
  } catch (err: any) {
    console.error("[Simulate Chatbot Error]", err);
    return NextResponse.json({ error: err.message || "Erro na simulação do chatbot" }, { status: 500 });
  }
}
