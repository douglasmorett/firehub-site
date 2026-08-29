import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estadoAoVivoDoRobo, registrarEstadoDoRobo } from "@/lib/whatsapp-estado";

export const dynamic = "force-dynamic";

/**
 * GET /api/chatbot/conexao-ao-vivo
 *
 * Pergunta AO GATEWAY, agora, se o WhatsApp da loja está de pé.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ───────────────────────────────────────────
 *
 * A tela do Chatbot mostrava "WhatsApp Vinculado com Sucesso!" lendo
 * `chatbotConfig.connected` — uma bandeira gravada no banco no dia em que o QR
 * foi lido. Ela nunca era reconferida enquanto estivesse `true`: o polling da
 * tela começava com `if (config.connected) return`. Ou seja, uma vez conectado,
 * o painel dizia "conectado" para sempre, mesmo com a sessão morta há dias.
 *
 * O lojista via faixa verde, número certo, tudo com cara de normal — e nenhuma
 * mensagem sendo respondida. É o pior tipo de defeito: o sistema não erra em
 * silêncio, ele AFIRMA que está funcionando.
 *
 * ── POR QUE NÃO REAPROVEITEI /api/chatbot/qrcode ────────────────────────────
 *
 * Aquela rota, quando acha a instância fora, CRIA a instância e gera QR novo.
 * Serve para a tela de vinculação, não para uma verificação de rotina que roda
 * a cada meio minuto com a tela aberta. Aqui só se pergunta o estado.
 *
 * ── GATEWAY MUDO NÃO É LOJA DESCONECTADA ────────────────────────────────────
 *
 * Se o gateway não responder, a resposta vem com `gatewayRespondeu: false` e a
 * tela NÃO muda de estado. Trocar o falso positivo antigo por um falso alarme
 * novo — mandar o lojista ler QR à toa porque a rede piscou — só trocaria de
 * problema.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const quemPediu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!quemPediu) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  // Funcionário enxerga o robô da loja onde trabalha, não um robô próprio.
  const lojaId = quemPediu.ownerId || quemPediu.id;
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { id: true, chatbotConfig: true, storePhone: true },
  });
  if (!loja) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }

  const config = (loja.chatbotConfig as any) || {};
  const { conectada, telefone } = await estadoAoVivoDoRobo(loja.id, config);

  if (conectada === null) {
    return NextResponse.json({
      gatewayRespondeu: false,
      connected: config.connected === true,
      motivo: "Não consegui falar com o servidor de WhatsApp agora.",
    });
  }

  await registrarEstadoDoRobo(loja.id, config, conectada, telefone, loja.storePhone);

  return NextResponse.json({
    gatewayRespondeu: true,
    connected: conectada,
    phone: telefone || config.phone || null,
    desde: conectada ? null : (config.desconectadoDesde || new Date().toISOString()),
  });
}
