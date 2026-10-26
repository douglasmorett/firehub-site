import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { clearLoopGuard, registerBotReply } from "@/lib/loop-guard";
import { retomarRobo } from "@/lib/pausa-do-robo";
import { registrarMensagemDaLoja } from "@/lib/memoria-da-conversa-no-banco";
import { contaOficialDoWhatsApp } from "@/lib/contas-oficiais-whatsapp";
import { podeComoNaTela } from "@/lib/permissoes-da-equipe";
import { lembrarPor } from "@/lib/cache-curto";
import { chamadoDaConversa, chamadosAbertos, encerrarChamado, marcarLido, respostaDaLoja } from "@/lib/fila-de-atendimento-humano";
import { ehConversaDeCliente } from "@/lib/jid-de-cliente";

export const dynamic = "force-dynamic";

/**
 * A mesma régua da rota irmã (api/chatbot/conversas, caixinha "orders"): a
 * conversa tem nome, telefone e endereço do cliente, e daqui sai mensagem pelo
 * WhatsApp da loja para o jid que vier no corpo. O funcionário só da cozinha
 * mandava mensagem para qualquer número (auditoria de 23/10/2026).
 */
const TELA_DAS_CONVERSAS = "/store/pedidos-clientes";
const semAcesso = () =>
  NextResponse.json(
    { error: "Você não tem acesso às conversas do WhatsApp. O dono da loja libera em Configurações → Equipe, no Painel de Pedidos." },
    { status: 403 },
  );

// A fila mora no banco (lib/fila-de-atendimento-humano.ts): o webhook do robô
// que a enche fica num servidor, e este painel pode cair em outro.

/**
 * A conversa existe para esta loja no banco? A mesma consulta de
 * api/chatbot/conversas — a tela ainda responde à conversa que estava lendo
 * depois que o chamado sai da fila.
 */
async function conversaExiste(userId: string, jid: string): Promise<boolean> {
  try {
    const linhas = await prisma.$queryRaw<{ existe: number }[]>`
      SELECT 1 AS existe FROM "ChatbotConversationState"
      WHERE "userId" = ${userId} AND "remoteJid" = ${jid} LIMIT 1
    `;
    return linhas.length > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // 15 s em memória: o balãozinho pergunta a cada 4–10 s por aba, e a
    // consulta que importa aqui é a da fila (lib/cache-curto.ts).
    const email = session.user.email;
    const user = await lembrarPor(`fila-humana:usuario:${email}`, 15_000, () =>
      prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, role: true, permissions: true } }));

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    if (!podeComoNaTela(user, TELA_DAS_CONVERSAS)) return semAcesso();

    const targetUserId = user.ownerId || user.id;
    // Já vem sem as fechadas e na ordem (a mais recente primeiro).
    const chats = await chamadosAbertos(targetUserId);

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
      select: { id: true, ownerId: true, role: true, permissions: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    if (!podeComoNaTela(user, TELA_DAS_CONVERSAS)) return semAcesso();

    const targetUserId = user.ownerId || user.id;
    const { action, chatId, message, jid } = await req.json();

    // 1. Responder mensagem ao cliente pelo WhatsApp
    if (action === "send_message") {
      if (!jid || !message) {
        return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
      }

      // Só responde a conversa de cliente que já existe nesta loja (na fila ou
      // no banco): sem isto, o jid do corpo fazia do WhatsApp da loja um
      // disparador para qualquer número ou grupo. A régua do jid é a do webhook
      // (lib/jid-de-cliente.ts), que aceita o número cru e o @c.us que a fila guarda.
      if (
        !ehConversaDeCliente(jid) ||
        (!(await chamadoDaConversa(targetUserId, String(jid)).catch(() => null)) &&
          !(await conversaExiste(targetUserId, String(jid))))
      ) {
        return NextResponse.json({ error: "Conversa não encontrada nesta loja" }, { status: 404 });
      }

      const success = await sendEvolutionMessage(targetUserId, jid, message);

      if (!success) {
        return NextResponse.json({ error: "Falha ao enviar mensagem pelo WhatsApp" }, { status: 500 });
      }

      // A mesma resposta entra na conversa que o painel mostra na aba do robô:
      // as duas abas contam a mesma história, vista de ângulos diferentes.
      await registrarMensagemDaLoja(targetUserId, jid, message, "atendente").catch(() => {});

      await respostaDaLoja(targetUserId, jid, message);

      return NextResponse.json({ success: true, message: "Mensagem enviada com sucesso" });
    }

    // 2. Marcar como lido ao abrir a conversa
    if (action === "mark_read") {
      await marcarLido(targetUserId, jid);
      return NextResponse.json({ success: true });
    }

    // 3. Encerrar atendimento (Robô volta a atender e a conversa é fechada)
    if (action === "close_chat") {
      const chat = await encerrarChamado(targetUserId, jid);

      // ── CONTA OFICIAL DO WHATSAPP: FECHA SEM FALAR NADA ────────────────────
      //
      // Na noite de 24/09/2026 este botão foi clicado quatro vezes na conversa
      // da Divinos com o Suporte do WhatsApp — e cada clique mandava
      // "Atendimento humano finalizado" ao robô do Suporte, que respondia, e o
      // laço recomeçava. Com conta oficial não há robô para religar (o webhook
      // não responde a elas) e nenhuma mensagem para mandar.
      const contaOficial = contaOficialDoWhatsApp({ jids: [jid] });
      if (contaOficial) {
        console.log(`[HumanSupport] Conversa com ${contaOficial.quem} encerrada sem mensagem (conta oficial do WhatsApp).`);
        return NextResponse.json({
          success: true,
          semMensagem: true,
          message: `Atendimento encerrado. Esta conversa é com ${contaOficial.quem}: o robô não responde a contas oficiais do WhatsApp, e nenhuma mensagem foi enviada.`,
        });
      }

      // Fechar aqui apagava só a fila em memória. Desde que problema no pedido
      // passou a marcar a conversa no BANCO (para a pausa sobreviver ao
      // restart), fechar sem limpar essa marca deixaria o cliente sem robô até
      // o prazo de 12 h vencer — mesmo com o atendimento já resolvido.
      await clearLoopGuard(targetUserId, jid).catch(() => {});

      // E a pausa do robô, que é conferida antes de tudo no webhook. Ela
      // vivia num Map privado de lá, fora do alcance desta rota: o cliente lia
      // "nosso robô continuará te ajudando por aqui" e o robô seguia mudo por
      // até 12 horas (lib/pausa-do-robo.ts). Hoje está no banco — o webhook
      // pode estar em outro servidor.
      await retomarRobo(targetUserId, jid);

      // Conversa que caiu na fila pelo ANTI-LOOP é, quase sempre, com outro
      // robô (maquininha, banco, marketplace). Mandar "atendimento finalizado"
      // é dar a ele o assunto que reabre o laço: o robô volta a atender, mas
      // em silêncio, e só responde se o outro lado escrever.
      if (chat?.motivo === "Loop suspeito") {
        console.log(`[HumanSupport] Conversa ${jid} encerrada sem mensagem (tinha caído na fila por laço suspeito).`);
        return NextResponse.json({
          success: true,
          semMensagem: true,
          message: "Atendimento encerrado e robô reativado. Esta conversa tinha caído na fila por parecer um robô do outro lado, então nenhuma mensagem de encerramento foi enviada.",
        });
      }

      // Envia aviso ao cliente no WhatsApp
      const endMessage = "Atendimento humano finalizado com sucesso! Se precisar de mais alguma coisa, nosso robô continuará te ajudando por aqui. Obrigado! 😊";
      // Registrar ANTES de enviar. O WhatsApp devolve esta mensagem como
      // `fromMe`; sem o hash gravado, o webhook a lê como "o lojista digitou" e
      // cala o robô por 5 minutos — logo depois de prometer ao cliente que o
      // robô continua ajudando. Tem que vir depois do clearLoopGuard, que zera
      // os hashes.
      await registerBotReply(targetUserId, jid, endMessage).catch(() => {});
      await sendEvolutionMessage(targetUserId, jid, endMessage).catch(() => {});

      return NextResponse.json({ success: true, message: "Atendimento encerrado. Robô reativado." });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
