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

    const { phone, message } = await req.json();

    if (!phone || !message) {
      return NextResponse.json({ error: "Telefone e mensagem são obrigatórios" }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

    // A instância é a do DONO da loja: funcionário logado testava contra uma
    // instância inexistente (firehub_<id do funcionário>) e via "falha ao
    // enviar" com o WhatsApp da loja perfeitamente conectado.
    const success = await sendEvolutionMessage(user.ownerId || user.id, fullPhone, message);

    if (success) {
      return NextResponse.json({ success: true, message: "Mensagem enviada com sucesso!" });
    } else {
      return NextResponse.json({ error: "Falha ao enviar mensagem. Verifique se o WhatsApp está conectado." }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[Test Send Error]", err);
    return NextResponse.json({ error: err.message || "Erro ao enviar mensagem de teste" }, { status: 500 });
  }
}
