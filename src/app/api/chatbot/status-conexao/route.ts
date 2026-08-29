import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estadoAoVivoDoRobo, registrarEstadoDoRobo } from "@/lib/whatsapp-estado";

export const dynamic = "force-dynamic";

/**
 * De quanto em quanto tempo esta rota confere o estado no gateway, em vez de
 * confiar na bandeira do banco.
 *
 * 10 minutos é o meio-termo: a faixa não depende mais de nenhum agendador
 * externo estar de pé (o `gateway-keepalive` é chamado de fora do sistema, e
 * se ele parar ninguém percebe), e mesmo assim uma loja com o painel aberto o
 * dia inteiro gera 6 consultas por hora, não uma por carregamento de tela.
 */
const REVERIFICAR_APOS_MS = 10 * 60_000;

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
      select: { chatbotConfig: true, storePhone: true },
    });

    let cfg = (loja?.chatbotConfig as any) || {};

    // ── RECONFERÊNCIA AO VIVO ─────────────────────────────────────────────
    //
    // O comentário original desta rota dizia para NÃO falar com o gateway,
    // confiando na bandeira que o cron `gateway-keepalive` mantém. O problema
    // é que esse cron é disparado de fora do sistema: se o agendador cair, a
    // bandeira congela no último valor conhecido — e o valor congelado mais
    // comum é `connected: true`. Foi assim que uma loja passou dias com o
    // painel verde e o robô mudo, sem nenhum alerta.
    //
    // A conferência agora acontece aqui mesmo, no máximo a cada 10 minutos por
    // loja. Só entra nela quem JÁ CONECTOU alguma vez e não desligou o robô de
    // propósito — as outras não têm o que verificar.
    const jaConectouAntes =
      cfg.jaConectouAlgumaVez === true || Boolean(cfg.connectedAt) || cfg.connected === true;
    const verificadoEm = cfg.verificadoEm ? new Date(cfg.verificadoEm).getTime() : 0;
    const venceu = Date.now() - verificadoEm >= REVERIFICAR_APOS_MS;

    if (jaConectouAntes && cfg.active !== false && venceu) {
      const { conectada, telefone } = await estadoAoVivoDoRobo(lojaId, cfg);
      // `null` é "não sei" — gateway mudo. Fica com o que já se sabia; inventar
      // uma queda aqui mandaria o lojista ler QR à toa a cada piscada de rede.
      if (conectada !== null) {
        await registrarEstadoDoRobo(lojaId, cfg, conectada, telefone, loja?.storePhone);
        const atualizada = await prisma.user.findUnique({
          where: { id: lojaId },
          select: { chatbotConfig: true },
        });
        cfg = (atualizada?.chatbotConfig as any) || cfg;
      }
    }

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
