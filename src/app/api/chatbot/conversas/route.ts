import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import {
  clearLoopGuard,
  conversaEstaComHumano,
  passarParaAtendimentoHumano,
  registerBotReply,
  MOTIVO_PAUSA_DO_PAINEL,
  PAUSA_DO_PAINEL_MS as PAUSA_DO_PAINEL,
} from "@/lib/loop-guard";
import { pausarRobo, roboEstaPausado, retomarRobo } from "@/lib/pausa-do-robo";
import {
  conversaParaOPainel,
  listarConversasDoRobo,
  registrarMensagemDaLoja,
} from "@/lib/memoria-da-conversa-no-banco";

export const dynamic = "force-dynamic";

/**
 * O ROBÔ ATENDENDO, AO VIVO, NO PAINEL DA LOJA.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O balãozinho do painel só mostrava quem PEDIU uma pessoa. Tudo o mais que o
 * robô fazia — a conversa inteira, com todo mundo — só dava para ver abrindo o
 * WhatsApp no celular da loja. Quem quer acompanhar o robô (e é o que todo
 * lojista quer nas primeiras semanas) não tinha por onde.
 *
 * Aqui a loja vê as conversas do turno, lê o que o robô respondeu, e pode
 * PAUSAR o robô numa conversa para assumir no lugar dele — ou devolver a
 * conversa para ele — sem sair da tela.
 *
 * ── Quem pode ver ───────────────────────────────────────────────────────────
 *
 * Sessão logada, e só as conversas da PRÓPRIA loja (`ownerId || id`). São
 * conversas do WhatsApp da loja com os clientes dela: o mesmo conteúdo que
 * qualquer pessoa no balcão vê no aparelho, com a vantagem de ficar registrado
 * por pouco tempo (a memória dura horas, não dias — lib/memoria-da-conversa.ts).
 */

/**
 * Quem pode abrir isto: o dono, e o funcionário que já enxerga o painel de
 * pedidos.
 *
 * A conversa do WhatsApp tem nome, telefone, endereço e o que o cliente pediu —
 * a mesma coisa que o cartão do pedido mostra a quem tem "📊 Painel de Pedidos".
 * Quem só tem a tela da cozinha não precisa disso, e não deve poder falar pelo
 * número da loja nem desligar o robô. (A rota irmã de atendimento humano não
 * checava nada; aqui a exposição é bem maior — são TODAS as conversas.)
 */
const PERMISSAO = "orders";

/**
 * O prazo e o motivo da pausa do painel moram em lib/loop-guard.ts, junto com
 * quem os LÊ: é o motivo gravado que faz esta trava valer duas horas, e não as
 * doze do pedido de atendente.
 */
const PAUSA_DO_PAINEL_MS = PAUSA_DO_PAINEL;
const MOTIVO_DO_PAINEL = MOTIVO_PAUSA_DO_PAINEL;

async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: "Não autenticado", status: 401 as const };

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!user) return { erro: "Usuário não encontrado", status: 404 as const };

  const papel = String(user.role || "").toUpperCase();
  const dono = papel === "ADMIN" || papel === "FRANCHISEE" || !user.ownerId;
  const liberado = dono || String(user.permissions || "").split(",").includes(PERMISSAO);
  if (!liberado) {
    return {
      erro: "Você não tem acesso às conversas do WhatsApp. O dono da loja libera em Configurações → Equipe, no Painel de Pedidos.",
      status: 403 as const,
    };
  }

  return { userId: user.ownerId || user.id };
}

/**
 * O endereço de uma conversa de PESSOA. Grupo (`@g.us`) e lista de transmissão
 * ficam de fora, e o formato é conferido antes de qualquer coisa: sem isto, a
 * rota aceitaria qualquer número e viraria disparador pelo WhatsApp da loja —
 * caminho curto para o número ser banido no meio do movimento.
 */
function jidDeCliente(jid: unknown): string | null {
  const texto = String(jid || "").trim();
  return /^\d{8,15}@(s\.whatsapp\.net|lid)$/.test(texto) ? texto : null;
}

/** A conversa existe para esta loja? Só se responde e se pausa o que existe. */
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

/**
 * O nome de quem está do outro lado, quando ESTA loja já o atendeu.
 *
 * Sai dos pedidos da própria loja, e não da tabela global de clientes: lá o
 * telefone é único no sistema inteiro, então o nome cadastrado por outra loja
 * apareceria aqui — e a consulta varria a tabela de todo mundo.
 *
 * `customerPhone` é gravado em formatos diferentes conforme a origem
 * ("(22) 98112-8512", "5522981128512"), então a comparação é pelos NOVE últimos
 * dígitos limpos, que já incluem o dígito 9 do celular; oito bastavam para dois
 * números diferentes casarem. Falhar aqui não derruba a lista: sem nome,
 * mostra-se o telefone.
 */
async function nomesDosClientes(userId: string, telefones: string[]): Promise<Map<string, string>> {
  const sufixos = [...new Set(telefones.map((t) => t.slice(-9)).filter((s) => s.length === 9))];
  const mapa = new Map<string, string>();
  if (sufixos.length === 0) return mapa;
  try {
    const linhas = await prisma.$queryRaw<{ sufixo: string; nome: string }[]>`
      SELECT DISTINCT ON (sufixo) sufixo, nome FROM (
        SELECT right(regexp_replace("customerPhone", '\D', '', 'g'), 9) AS sufixo,
               "customerName" AS nome,
               "createdAt"
        FROM "CustomerOrder"
        WHERE "franchiseeId" = ${userId}
          AND "customerPhone" IS NOT NULL
          AND "customerName" IS NOT NULL
          AND "createdAt" > now() - interval '120 days'
          AND right(regexp_replace("customerPhone", '\D', '', 'g'), 9) = ANY(${sufixos}::text[])
      ) p
      ORDER BY sufixo, "createdAt" DESC
    `;
    for (const l of linhas) {
      if (!l.nome || /cliente\s*whatsapp|^\s*ifood\s*$/i.test(l.nome)) continue;
      mapa.set(l.sufixo, l.nome);
    }
  } catch (err: any) {
    console.error(`[Conversas do robô] Falha ao buscar nomes: ${err?.message || err}`);
  }
  return mapa;
}

export async function GET(req: NextRequest) {
  try {
    const loja = await lojaDaSessao();
    if ("erro" in loja) return NextResponse.json({ error: loja.erro }, { status: loja.status });

    const pedido = req.nextUrl.searchParams.get("jid");

    // Uma conversa: as mensagens dela.
    if (pedido) {
      const jid = jidDeCliente(pedido);
      if (!jid) return NextResponse.json({ error: "Conversa inválida" }, { status: 400 });
      const [mensagens, comHumano] = await Promise.all([
        conversaParaOPainel(loja.userId, jid),
        conversaEstaComHumano(loja.userId, jid),
      ]);
      return NextResponse.json({
        success: true,
        jid,
        mensagens,
        // A MESMA conta da lista. Com só a pausa de memória aqui, depois de um
        // deploy (que é a cada push) a tela dizia "robô atendendo" numa conversa
        // travada no banco por 12 h — e escondia justamente o botão que a
        // destravaria.
        pausado: comHumano || roboEstaPausado(loja.userId, jid),
      });
    }

    // A lista. `pausado` é conferido aqui porque a pausa curta mora na memória
    // do processo, não no banco (lib/pausa-do-robo.ts).
    const cruas = await listarConversasDoRobo(loja.userId);
    const nomes = await nomesDosClientes(loja.userId, cruas.map((c) => c.telefone));
    const conversas = cruas.map((c) => ({
      ...c,
      nome: nomes.get(c.telefone.slice(-9)) || "",
      pausado: c.comHumano || roboEstaPausado(loja.userId, c.remoteJid),
    }));

    return NextResponse.json({
      success: true,
      conversas,
      atendendo: conversas.filter((c) => !c.pausado).length,
      pausadas: conversas.filter((c) => c.pausado).length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Falha ao ler as conversas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const loja = await lojaDaSessao();
    if ("erro" in loja) return NextResponse.json({ error: loja.erro }, { status: loja.status });

    const { action, jid: jidCru, message } = await req.json();
    const jid = jidDeCliente(jidCru);
    if (!jid) {
      return NextResponse.json({ error: "Conversa inválida" }, { status: 400 });
    }
    // Só mexe no que já é conversa DESTA loja. Sem isto, qualquer sessão podia
    // mandar mensagem para um número qualquer pelo WhatsApp da loja.
    if (!(await conversaExiste(loja.userId, jid))) {
      return NextResponse.json({ error: "Conversa não encontrada nesta loja" }, { status: 404 });
    }

    // ── PAUSAR O ROBÔ NESTA CONVERSA ──────────────────────────────────────
    // As duas travas, como no resto do sistema: a de memória (conferida antes
    // de qualquer resposta) e a do banco (sobrevive ao deploy, que aqui é a
    // cada push). Só uma delas deixaria o robô voltar a falar sozinho.
    if (action === "pausar") {
      pausarRobo(loja.userId, jid, PAUSA_DO_PAINEL_MS);
      await passarParaAtendimentoHumano(loja.userId, jid, MOTIVO_DO_PAINEL);
      return NextResponse.json({ success: true, pausado: true });
    }

    if (action === "retomar") {
      retomarRobo(loja.userId, jid);
      await clearLoopGuard(loja.userId, jid);
      // A conversa também sai da fila de "clientes chamando": sem isto ela
      // continuaria piscando na outra aba, pedindo um atendimento que o
      // lojista acabou de devolver ao robô.
      const naFila = global.__humanSupportChats?.get(`${loja.userId}_${jid}`);
      if (naFila) {
        naFila.status = "CLOSED";
        naFila.unreadCount = 0;
      }
      return NextResponse.json({ success: true, pausado: false });
    }

    // ── RESPONDER O CLIENTE DAQUI ─────────────────────────────────────────
    if (action === "enviar") {
      if (typeof message !== "string") {
        return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
      }
      const texto = message.trim();
      if (!texto) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
      if (texto.length > 1000) {
        return NextResponse.json({ error: "Mensagem longa demais (máximo 1000 caracteres)" }, { status: 400 });
      }

      // Registrar ANTES de enviar: o WhatsApp devolve tudo que sai do número
      // como `fromMe`, e sem o hash gravado o webhook lê a própria mensagem
      // como "alguém assumiu agora" e reinicia a contagem de silêncio.
      await registerBotReply(loja.userId, jid, texto).catch(() => {});
      const enviou = await sendEvolutionMessage(loja.userId, jid, texto);
      if (!enviou) {
        // NADA de pausa quando a mensagem não saiu. Pausar antes do envio
        // calava o robô por 12 h por causa de uma instabilidade de 30 segundos:
        // o cliente não recebia a resposta da loja E deixava de receber a do
        // robô, e a tela não mostrava erro nenhum.
        return NextResponse.json(
          { error: "O WhatsApp não aceitou a mensagem. O robô continua atendendo este cliente — tente de novo." },
          { status: 502 },
        );
      }

      // A mensagem SAIU: agora sim a conversa é de quem digitou. Deixar o robô
      // solto faria os dois responderem à mesma pergunta, um por cima do outro.
      pausarRobo(loja.userId, jid, PAUSA_DO_PAINEL_MS);
      await passarParaAtendimentoHumano(loja.userId, jid, MOTIVO_DO_PAINEL);
      await registrarMensagemDaLoja(loja.userId, jid, texto, "atendente");
      // Este cliente está SENDO atendido: o chamado dele para de piscar na
      // outra aba, senão o balãozinho fica com um número vermelho preso por
      // alguém que já foi respondido.
      const chamado = global.__humanSupportChats?.get(`${loja.userId}_${jid}`);
      if (chamado && chamado.status !== "CLOSED") {
        chamado.status = "ACTIVE";
        chamado.unreadCount = 0;
        chamado.messages.push({ sender: "attendant", text: texto, timestamp: Date.now() });
        chamado.lastMessage = texto;
        chamado.updatedAt = Date.now();
      }
      return NextResponse.json({ success: true, pausado: true });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Falha na ação" }, { status: 500 });
  }
}
