/**
 * Avisos que a loja manda para o WhatsApp do dono.
 *
 * ── Por que não basta o balãozinho do painel ────────────────────────────────
 * A fila de atendimento humano só existe dentro de `/store`: quem não está com
 * o painel aberto naquele instante não fica sabendo de nada. Num sábado à noite
 * o painel está aberto; às 21h de uma terça, com o dono na cozinha, não está —
 * e é justamente aí que um cliente esperando 1h40 fica sem ninguém do outro
 * lado, agora que o robô aprendeu a calar.
 *
 * O alerta vai pelo mesmo WhatsApp que o robô já usa, para o `notificationPhone`
 * cadastrado no perfil da loja. Sem número cadastrado, nada é enviado — e isso
 * não é falha: é a loja que ainda não escolheu receber.
 *
 * ── O que o dono controla ───────────────────────────────────────────────────
 * Cada tipo pode ser ligado ou desligado em Chatbot IA → Notificações. A
 * configuração mora em `chatbotConfig.alertas`, e o padrão de quem nunca mexeu
 * está em `ALERTAS_PADRAO`: liga o que é urgente e cala o que é rotina, porque
 * alerta demais é a maneira mais rápida de fazer o dono ignorar todos.
 */
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { registerBotReply } from "@/lib/loop-guard";

export type TipoDeAlerta =
  /** Cliente com problema no pedido — o robô saiu e alguém precisa entrar. */
  | "problema_no_pedido"
  /** Cliente pediu atendente com todas as letras. */
  | "pedido_de_atendente"
  /** O robô caiu / desconectou do WhatsApp. */
  | "robo_desconectado";

export const ALERTAS_PADRAO: Record<TipoDeAlerta, boolean> = {
  problema_no_pedido: true,
  pedido_de_atendente: true,
  robo_desconectado: true,
};

export const ROTULO_DO_ALERTA: Record<TipoDeAlerta, string> = {
  problema_no_pedido: "Cliente com problema no pedido (atraso, item faltando, reclamação)",
  pedido_de_atendente: "Cliente pediu para falar com atendente",
  robo_desconectado: "Robô desconectou do WhatsApp",
};

/** O dono ligou este alerta? Sem config salva, vale o padrão. */
export function alertaLigado(chatbotConfig: any, tipo: TipoDeAlerta): boolean {
  const escolhido = chatbotConfig?.alertas?.[tipo];
  return typeof escolhido === "boolean" ? escolhido : ALERTAS_PADRAO[tipo];
}

/**
 * Manda o alerta, se houver para quem e se o dono quiser receber.
 *
 * Nunca lança: um aviso que falha não pode derrubar o atendimento que o
 * originou. O retorno diz se saiu, para o log de quem chamou.
 */
export async function avisarDono(
  userId: string,
  tipo: TipoDeAlerta,
  mensagem: string
): Promise<boolean> {
  try {
    const loja = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPhone: true, chatbotConfig: true, ownerId: true },
    });

    // Funcionário não tem número próprio de alerta: quem recebe é o dono.
    //
    // Só o DESTINO e a configuração mudam. Quem envia continua sendo a loja que
    // recebeu a mensagem, porque a instância conectada do WhatsApp é dela — o
    // dono pode nem ter robô no número próprio, e mandar por uma instância que
    // não existe é alerta que morre no caminho.
    let destino = loja?.notificationPhone;
    let config = loja?.chatbotConfig as any;

    if (!destino && loja?.ownerId) {
      const dono = await prisma.user.findUnique({
        where: { id: loja.ownerId },
        select: { notificationPhone: true, chatbotConfig: true },
      });
      destino = dono?.notificationPhone ?? null;
      config = dono?.chatbotConfig as any;
    }

    const numero = (destino || "").replace(/\D/g, "");
    if (!numero || numero.length < 10) return false;

    if (!alertaLigado(config, tipo)) return false;

    // ── O robô não pode avisar a si mesmo ────────────────────────────────
    // Se o número de alerta for o mesmo que está conectado ao robô, a mensagem
    // sai e volta como mensagem recebida da própria loja — conversa do robô
    // com ele mesmo, com chamada de IA a cada volta.
    const numeroDoRobo = String(config?.phone || "").replace(/\D/g, "");
    if (numeroDoRobo && numeroDoRobo.slice(-10) === numero.slice(-10)) {
      console.warn(
        `[Alertas] Alerta "${tipo}" não enviado: o número de notificação é o próprio número do robô.`
      );
      return false;
    }

    const jid = `${numero.startsWith("55") ? numero : `55${numero}`}@s.whatsapp.net`;

    // Registrar antes de enviar, pelo mesmo motivo de `replyToCustomer`: o eco
    // do WhatsApp chega em milissegundos e, sem o hash gravado, o robô leria o
    // próprio alerta como "o lojista assumiu" e se calaria na conversa dele.
    await registerBotReply(userId, jid, mensagem).catch(() => {});
    await sendEvolutionMessage(userId, jid, mensagem);
    return true;
  } catch (err: any) {
    console.error(`[Alertas] Falha ao avisar o dono (${tipo}):`, err?.message);
    return false;
  }
}

/** Texto do alerta de cliente que ficou sem robô e precisa de gente. */
export function textoDeProblemaNoPedido(opts: {
  nomeDoCliente: string;
  telefone: string;
  motivo: string;
  mensagemDoCliente: string;
}) {
  const trecho = opts.mensagemDoCliente.trim().slice(0, 180);
  return (
    `🚨 *Cliente precisando de atendimento*\n\n` +
    `*${opts.nomeDoCliente}* (${opts.telefone})\n` +
    `Motivo: ${opts.motivo}\n\n` +
    `_"${trecho}"_\n\n` +
    `O robô parou de responder essa conversa e está esperando alguém da equipe. ` +
    `Responda pelo WhatsApp ou pelo balãozinho vermelho do painel.`
  );
}
