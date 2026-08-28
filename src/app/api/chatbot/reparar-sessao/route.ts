import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { restartEvolutionInstance } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

/**
 * POST /api/chatbot/reparar-sessao
 *
 * Reinicia a instância do WhatsApp da loja no gateway — o botão de socorro
 * para quando as mensagens do robô chegam como "Aguardando mensagem. Essa
 * ação pode levar alguns instantes." no aparelho do dono ou dos motoboys.
 * O porquê disso está documentado em restartEvolutionInstance
 * (src/lib/whatsapp-evolution.ts).
 *
 * Não desconecta nem pede QR de novo: só derruba e recria a conexão, que é o
 * que força a renegociação das sessões de criptografia. Por isso é seguro
 * deixar na mão do lojista.
 */
export async function POST(_req: NextRequest) {
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

    // A instância é sempre a do DONO da loja: funcionário logado repara a
    // instância certa, não uma inexistente com o id dele.
    const storeId = user.ownerId || user.id;

    const ok = await restartEvolutionInstance(storeId);
    if (!ok) {
      return NextResponse.json(
        { error: "O gateway não confirmou o reinício. Aguarde um minuto e tente de novo; persistindo, verifique a conexão na aba QR Code." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Instância reiniciada. Aguarde ~1 minuto e faça um envio de teste. " +
        "Se algum contato continuar vendo 'Aguardando mensagem', peça para ELE mandar um 'oi' para o número da loja — isso refaz a criptografia daquela conversa na hora.",
    });
  } catch (err: any) {
    console.error("[Reparar Sessão] Erro:", err);
    return NextResponse.json({ error: err?.message || "Erro ao reiniciar a instância" }, { status: 500 });
  }
}
