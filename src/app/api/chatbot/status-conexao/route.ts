import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/chatbot/status-conexao
 *
 * Responde uma coisa só: esta loja precisa religar o robô agora?
 *
 * A faixa do painel chama isto a cada carregamento, então ele NÃO fala com o
 * gateway — lê a bandeira que o cron `gateway-keepalive` mantém a cada 5
 * minutos. Consultar o gateway aqui colocaria uma chamada de rede no caminho
 * de toda abertura de tela de toda loja, para uma resposta que muda de hora
 * em hora.
 *
 * A condição é a regra do dono: só avisa quem JÁ CONECTOU alguma vez. Loja que
 * nunca leu um QR não tem robô para cair — para ela isso seria propaganda, não
 * alerta, e alerta que aparece sem motivo é alerta que o lojista aprende a
 * ignorar.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ precisaReconectar: false });
  }

  try {
    const quemPediu = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!quemPediu) return NextResponse.json({ precisaReconectar: false });

    // Funcionário vê o estado da loja em que trabalha, não o dele.
    const lojaId = quemPediu.ownerId || quemPediu.id;
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { chatbotConfig: true },
    });

    const cfg = (loja?.chatbotConfig as any) || {};
    const jaConectou =
      cfg.jaConectouAlgumaVez === true || Boolean(cfg.connectedAt) || cfg.connected === true;

    // `active === false` é o lojista tendo DESLIGADO o robô de propósito.
    // Cobrar religação de quem desligou por vontade própria é implicância.
    const desligadoDeProposito = cfg.active === false;

    const precisaReconectar =
      jaConectou && !desligadoDeProposito && Boolean(cfg.desconectadoDesde) && cfg.connected !== true;

    return NextResponse.json({
      precisaReconectar,
      desde: precisaReconectar ? cfg.desconectadoDesde : null,
    });
  } catch (err: any) {
    // Falha aqui nunca pode quebrar o painel: sem resposta, sem faixa.
    console.warn("[status-conexao] Falha ao consultar:", err?.message);
    return NextResponse.json({ precisaReconectar: false });
  }
}
