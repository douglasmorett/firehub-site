/**
 * GET /api/cron/pedidos-atrasados
 *
 * Avisa o dono, pelo WhatsApp, quando um pedido passou do prazo e AINDA NÃO
 * saiu para entrega.
 *
 * ── Por que "ainda não saiu" é o corte ──────────────────────────────────────
 * Depois que o motoboy pega, o atraso vira estrada — a loja não controla e o
 * alerta não ajudaria ninguém. Antes disso é cozinha, e cozinha tem quem
 * resolva: dá para priorizar, ligar para o cliente, ou pelo menos avisar antes
 * que ele mesmo cobre. Foi assim que uma cliente esperou 1h40 sem ninguém na
 * loja saber, em 01/09/2026.
 *
 * ── Anti-spam ───────────────────────────────────────────────────────────────
 * Roda a cada 5 minutos porque atraso pede reação rápida, mas o MESMO pedido só
 * gera aviso uma vez por hora. Sem essa trava seriam doze mensagens por hora
 * por pedido, e o dono silencia o número — que é como um alerta bom vira ruído
 * e some junto com os outros.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { avisarDono } from "@/lib/alertas-do-dono";
import { pedidosAtrasados, prazoDeEntregaMin, horaLocal } from "@/lib/painel-do-dono";

export const dynamic = "force-dynamic";

/** Um aviso por pedido a cada hora. */
const INTERVALO_ENTRE_AVISOS_MS = 60 * 60 * 1000;

/** Onde os carimbos moram dentro de `User.chatbotConfig`. */
const CHAVE_AVISOS = "lateOrderAlerts";

/** No máximo isso de pedido listado; o resto vira "+ N pedido(s)". */
const MAX_NA_MENSAGEM = 8;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const agora = new Date();
  let lojasVerificadas = 0;
  let avisosEnviados = 0;

  try {
    // Só lojas que podem receber: sem número cadastrado não há para quem falar.
    const lojas = await prisma.user.findMany({
      where: { notificationPhone: { not: null }, ownerId: null },
      select: {
        id: true, storeName: true, storeTimezone: true,
        deliveryZones: true, chatbotConfig: true,
      },
    });

    for (const loja of lojas) {
      lojasVerificadas++;
      const config = (loja.chatbotConfig as any) || {};

      // O dono desligou este alerta? `avisarDono` também confere, mas conferir
      // aqui evita varrer os pedidos de quem não quer ser avisado.
      if (config?.alertas?.pedido_atrasado === false) continue;

      const prazoMin = prazoDeEntregaMin(loja.deliveryZones);
      const atrasados = await pedidosAtrasados(loja.id, prazoMin, agora);
      if (atrasados.length === 0) continue;

      const carimbos: Record<string, number> = { ...(config[CHAVE_AVISOS] || {}) };
      const novos = atrasados.filter(
        (p) => agora.getTime() - (carimbos[p.id] || 0) > INTERVALO_ENTRE_AVISOS_MS
      );
      if (novos.length === 0) continue;

      const listados = novos.slice(0, MAX_NA_MENSAGEM);
      const linhas = listados.map(
        (p) =>
          `• *${p.numero}* — ${p.cliente}\n` +
          `  entrou ${horaLocal(p.entrouEm, loja.storeTimezone)} · prazo ${p.prazoMin} min · ` +
          `já são ${p.minutosDeVida} min (*${p.minutosDeAtraso} min além do prazo*)`
      );
      const sobra = novos.length - listados.length;

      const mensagem =
        `⏰ *${novos.length === 1 ? "Pedido atrasado" : `${novos.length} pedidos atrasados`}* — ` +
        `${loja.storeName || "sua loja"}\n\n` +
        linhas.join("\n") +
        (sobra > 0 ? `\n\n+ ${sobra} pedido(s) também atrasado(s).` : "") +
        `\n\nNenhum deles saiu para entrega ainda.`;

      const enviou = await avisarDono(loja.id, "pedido_atrasado", mensagem);
      if (!enviou) continue;

      avisosEnviados++;
      // Carimba só o que foi realmente avisado: se o envio falhar, o pedido
      // continua elegível na próxima rodada em vez de ficar mudo por uma hora.
      const agoraMs = agora.getTime();
      for (const p of novos) carimbos[p.id] = agoraMs;

      // Limpa carimbo velho para o JSON não crescer para sempre.
      for (const [id, ts] of Object.entries(carimbos)) {
        if (agoraMs - (ts as number) > 24 * 60 * 60 * 1000) delete carimbos[id];
      }

      await prisma.user
        .update({
          where: { id: loja.id },
          data: { chatbotConfig: { ...config, [CHAVE_AVISOS]: carimbos } },
        })
        .catch((err) =>
          console.error(`[pedidos-atrasados] Falha ao gravar carimbos da loja ${loja.id}:`, err?.message)
        );
    }

    return NextResponse.json({ ok: true, lojasVerificadas, avisosEnviados });
  } catch (err: any) {
    console.error("[pedidos-atrasados] Falha:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
