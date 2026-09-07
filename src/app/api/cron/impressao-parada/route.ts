/**
 * GET /api/cron/impressao-parada
 *
 * Avisa o dono, pelo WhatsApp, quando a impressão automática parou e há
 * pedido ficando sem comanda.
 *
 * ── Dois casos, com evidências diferentes ───────────────────────────────────
 *   A) O Assistente de Impressão do PC do caixa parou de consultar a fila da
 *      nuvem há mais de 10 minutos — E pelo menos um pedido entrou depois
 *      disso. PC desligado, dormindo, sem internet, Assistente fechado. Na
 *      loja o sintoma é só "não imprimiu", e a suspeita cai em qualquer
 *      coisa: a Brasa Burguer desligou o 99Food por isso em 04/09/2026.
 *      Sem pedido novo não há aviso — loja fechada com o PC desligado é o
 *      normal, não uma falha.
 *   B) O Assistente está vivo, mas há comanda presa (pendente) há mais de 10
 *      minutos: impressora desligada, sem papel, em erro, ou cadastrada com
 *      um nome que o Windows daquele PC não tem.
 *
 * ── Anti-spam ───────────────────────────────────────────────────────────────
 * A avisa uma vez por parada: o carimbo guarda QUAL parada (a última consulta
 * que o Assistente fez) e só repete depois de 24 h, se continuar parada e
 * continuar entrando pedido. Quando o Assistente volta, a próxima parada é
 * outra e avisa de novo. B avisa no máximo uma vez por hora. Carimbos em
 * User.chatbotConfig.printAlerts, como os de pedido atrasado.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { avisarDono } from "@/lib/alertas-do-dono";
import { sendEmail } from "@/lib/mail";
import { horaLocal } from "@/lib/painel-do-dono";
import { traduzErroDeImpressao } from "@/lib/erro-de-impressao";

export const dynamic = "force-dynamic";

const PARADO_APOS_MS = 10 * 60_000;
const PRESA_APOS_MS = 10 * 60_000;
const REAVISAR_PARADA_MS = 24 * 60 * 60_000;
const REAVISAR_PRESA_MS = 60 * 60_000;
const CHAVE_CARIMBOS = "printAlerts";
const MAX_NA_MENSAGEM = 8;
/** Pedido que não gera comanda: não conta como "ficou sem". */
const SEM_COMANDA = ["CANCELADO", "CANCELED", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"];

type Carimbos = {
  paradoDesde?: number;
  paradoAvisadoEm?: number;
  presaDesde?: number;
  presaAvisadoEm?: number;
};

const ORIGEM: Record<string, string> = {
  IFOOD: "iFood", "99FOOD": "99Food", JOTAJA: "JotaJá", BRENDI: "Brendi",
  WHATSAPP: "WhatsApp", CHATBOT: "WhatsApp", PRESENCIAL: "balcão", MESA: "mesa", TOTEM: "totem",
};

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const agora = Date.now();
  let lojasVerificadas = 0;
  let avisosEnviados = 0;

  try {
    // Toda loja cujo Assistente já consultou a fila alguma vez — sem consulta
    // nenhuma não há "parou", há "nunca vinculou", que é a faixa do painel que
    // resolve. Loja sem número de alerta entra também: o e-mail da operação
    // (abaixo) é o canal que sobra para ela — a Brasa Burguer, a loja do caso,
    // não tinha número cadastrado em 06/09/2026.
    const lojas = await prisma.user.findMany({
      where: { ownerId: null, printQueuePolledAt: { not: null } },
      select: {
        id: true, storeName: true, storeTimezone: true, chatbotConfig: true,
        printerConfig: true, printQueuePolledAt: true, printQueueEstado: true,
      },
    });

    for (const loja of lojas) {
      lojasVerificadas++;
      const config = (loja.chatbotConfig as any) || {};
      if (config?.alertas?.impressao_parada === false) continue;

      const pc: any = loja.printerConfig;
      const cadastradas: string[] = (Array.isArray(pc?.printers) ? pc.printers : [])
        .map((p: any) => String(p?.name || "").trim())
        .filter(Boolean);
      // Sem impressora cadastrada não há comanda esperada — nada a avisar.
      if (cadastradas.length === 0) continue;

      const carimbos: Carimbos = { ...(config[CHAVE_CARIMBOS] || {}) };
      const novos: Carimbos = { ...carimbos };
      const ultimaConsulta = loja.printQueuePolledAt!.getTime();
      let mensagem: string | null = null;
      let aoEnviar: (() => void) | null = null;

      if (agora - ultimaConsulta > PARADO_APOS_MS) {
        // ── A) fila muda ──────────────────────────────────────────────────
        const jaAvisada =
          carimbos.paradoDesde === ultimaConsulta &&
          agora - (carimbos.paradoAvisadoEm || 0) < REAVISAR_PARADA_MS;
        if (!jaAvisada) {
          const pedidos = await prisma.customerOrder.findMany({
            where: {
              franchiseeId: loja.id,
              createdAt: { gt: new Date(ultimaConsulta) },
              status: { notIn: SEM_COMANDA },
            },
            select: { dailyOrderNumber: true, customerName: true, createdAt: true, source: true },
            orderBy: { createdAt: "asc" },
            take: 50,
          });
          if (pedidos.length > 0) {
            mensagem = mensagemDeParada(loja, pedidos, ultimaConsulta, agora);
            aoEnviar = () => { novos.paradoDesde = ultimaConsulta; novos.paradoAvisadoEm = agora; };
          }
        }
        // Sem Assistente vivo, "comanda presa" não é medido: zera a contagem.
        delete novos.presaDesde;
      } else {
        // ── B) Assistente vivo: comanda presa? ────────────────────────────
        const estado: any = (loja as any).printQueueEstado || null;
        const presas = Math.max(0, Number(estado?.pendentes) || 0);
        if (presas > 0) {
          if (!carimbos.presaDesde) {
            // Primeira vez que se vê: espera a próxima rodada. Impressora
            // religando resolve sozinha em segundos e não merece mensagem.
            novos.presaDesde = agora;
          } else if (
            agora - carimbos.presaDesde >= PRESA_APOS_MS &&
            agora - (carimbos.presaAvisadoEm || 0) > REAVISAR_PRESA_MS
          ) {
            mensagem = mensagemDePresa(loja, presas, estado, cadastradas);
            aoEnviar = () => { novos.presaAvisadoEm = agora; };
          }
        } else {
          delete novos.presaDesde;
        }
      }

      if (mensagem && aoEnviar) {
        // Dois canais: o WhatsApp do dono (só sai se a loja cadastrou número de
        // alerta e ligou este aviso) e o e-mail da operação do FireHub, que é
        // quem liga para a loja quando ninguém lá viu. Carimba se QUALQUER um
        // saiu — sem carimbo o e-mail repetiria a cada 5 minutos; e, se nenhum
        // saiu, a loja continua elegível na próxima rodada.
        const [zap, mail] = await Promise.all([
          avisarDono(loja.id, "impressao_parada", mensagem),
          avisarOperacao(loja.storeName, mensagem),
        ]);
        if (zap || mail) { aoEnviar(); avisosEnviados++; }
      }

      if (JSON.stringify(novos) !== JSON.stringify(carimbos)) {
        await prisma.user
          .update({
            where: { id: loja.id },
            data: { chatbotConfig: { ...config, [CHAVE_CARIMBOS]: novos } },
          })
          .catch((err) =>
            console.error(`[impressao-parada] Falha ao gravar carimbos da loja ${loja.id}:`, err?.message)
          );
      }
    }

    return NextResponse.json({ ok: true, lojasVerificadas, avisosEnviados });
  } catch (err: any) {
    console.error("[impressao-parada] Falha:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

/**
 * E-mail para quem opera o FireHub (ALERTA_EMAIL_OPERACAO, o mesmo endereço do
 * aviso de queda do 99Food). Chega mesmo quando a loja não cadastrou número de
 * alerta — e é a operação quem liga para a loja.
 */
async function avisarOperacao(loja: string | null, mensagem: string): Promise<boolean> {
  const operacao = (process.env.ALERTA_EMAIL_OPERACAO || "contatohakim@gmail.com").trim();
  const seguro = mensagem.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<pre style="font-family:inherit;font-size:15px;white-space:pre-wrap">${seguro}</pre>`;
  const r = await sendEmail({
    to: operacao,
    subject: `[FireHub] Impressão parada — ${loja || "loja"}`,
    html,
    text: mensagem,
  }).catch(() => null);
  return r?.success === true;
}

type LojaAvisada = { storeName: string | null; storeTimezone: string | null };
type PedidoSemComanda = { dailyOrderNumber: number | null; customerName: string | null; createdAt: Date; source: string | null };

function mensagemDeParada(loja: LojaAvisada, pedidos: PedidoSemComanda[], ultimaConsulta: number, agora: number): string {
  const tz = loja.storeTimezone;
  const min = Math.round((agora - ultimaConsulta) / 60_000);
  const listados = pedidos.slice(0, MAX_NA_MENSAGEM).map((p) => {
    const origem = p.source && p.source !== "SITE" ? `, ${ORIGEM[p.source] || p.source.toLowerCase()}` : "";
    return `• *#${p.dailyOrderNumber ?? "?"}* — ${p.customerName || "cliente"} (${horaLocal(p.createdAt, tz)}${origem})`;
  });
  const sobra = pedidos.length - listados.length;
  const quantos = pedidos.length === 1 ? "1 pedido entrou" : `${pedidos.length} pedidos entraram`;

  return (
    `🖨️ *Impressão automática parada* — ${loja.storeName || "sua loja"}\n\n` +
    `O Assistente de Impressão do PC do caixa parou de responder às ${horaLocal(new Date(ultimaConsulta), tz)} ` +
    `(há ${min} min) e ${quantos} depois disso:\n` +
    listados.join("\n") +
    (sobra > 0 ? `\n+ ${sobra} pedido(s)` : "") +
    `\n\nEsses pedidos ficaram sem comanda automática por esse PC. Confira se ele está ligado (não dormindo), com internet, ` +
    `e se o Assistente de Impressão está aberto (ícone 🔥 perto do relógio). Quando ele voltar, as comandas que faltam saem sozinhas.` +
    `\n\nSe as comandas estão saindo normalmente por outro computador, ignore este aviso. ` +
    `Para não recebê-lo: painel → Chatbot IA → Notificações.`
  );
}

function mensagemDePresa(loja: LojaAvisada, presas: number, estado: any, cadastradas: string[]): string {
  const locais: string[] = (Array.isArray(estado?.impressoras) ? estado.impressoras : []).map((n: unknown) => String(n));
  const locaisLower = new Set(locais.map((n) => n.toLowerCase().trim()));
  const ausentes = locais.length > 0 ? cadastradas.filter((n) => !locaisLower.has(n.toLowerCase().trim())) : [];
  const erro = traduzErroDeImpressao(estado?.erro);

  const causa = ausentes.length > 0
    ? `A impressora *"${ausentes[0]}"* cadastrada no FireHub não existe nesse PC — o Windows enxerga: ${locais.join(", ")}. ` +
      `Abra Impressoras no painel e escolha a impressora da lista (o Windows pode ter renomeado, ou o PC é outro).`
    : `Confira se a impressora está ligada, com papel e sem erro no Windows.${erro ? `\nÚltimo erro: ${erro}.` : ""}`;

  return (
    `🖨️ *Comanda presa na impressora* — ${loja.storeName || "sua loja"}\n\n` +
    `${presas === 1 ? "1 comanda não saiu" : `${presas} comandas não saíram`} na impressora há mais de 10 minutos. ` +
    `O Assistente tenta de novo a cada 30 segundos até sair.\n\n${causa}`
  );
}
