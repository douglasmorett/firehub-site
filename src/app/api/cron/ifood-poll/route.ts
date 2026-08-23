import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processarEventosIfood } from "@/lib/ifood-eventos";
import { getTokenDaLojaIfood } from "@/lib/ifood-api";

/**
 * GET /api/cron/ifood-poll
 * Cron Job — runs every minute to poll iFood events.
 * Ensures orders are never missed, even when no dashboard is open.
 * 
 * Protected by CRON_SECRET (bypass para chamadas internas do cron-runner).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Allow up to 30s for processing

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");

    // ⚠️ Um tropeço do app CENTRALIZADO não pode abortar a função inteira: a
    // passada distribuída, mais abaixo, é a única fonte de pedidos das lojas
    // que conectam pelo painel (Pastel da Paulista, Brasa Burguer...). Antes
    // havia `return` aqui e logo depois em "0 eventos" — ou seja, no dia a dia
    // normal (fila central vazia) o código NUNCA chegava na parte distribuída.
    let token = "";
    try {
      token = await getIfoodToken();
      log.push("✅ Token obtido");
    } catch (err: any) {
      log.push(`❌ Token central falhou: ${err.message} — seguindo para as lojas distribuídas`);
    }

    // Poll events do app CENTRALIZADO
    let events: any[] = [];
    if (token) {
      const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log.push(`❌ events:polling central falhou: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
      } else {
        const eventsText = await res.text();
        const lidos = eventsText ? JSON.parse(eventsText) : [];
        events = Array.isArray(lidos) ? lidos : [];
        log.push(`📥 ${events.length} evento(s) recebido(s) no app central`);
      }
    }

    // Processamento do app CENTRALIZADO (comportamento histórico, intacto).
    const central = events.length > 0
      ? await processarEventosIfood({ events, token, log })
      : { created: 0, updated: 0, acknowledged: 0, descartados: 0 };
    const created = central.created;
    const updated = central.updated;

    // ── PASSADA DO APP DISTRIBUÍDO ────────────────────────────────────────
    // Cada loja puxa PELA PRÓPRIA CONEXÃO, como o iFood exige de um app
    // distribuído — e como o dono de cada loja precisa que seja.
    //
    // A versão anterior tentava um "token do app" via client_credentials. Isso
    // nunca poderia funcionar: a API responde
    //   400 Unsupported grant type client_credentials to client cabc4064-…
    // porque o app é do tipo Authorization Code. Agora usa-se o access_token
    // DA LOJA, renovado por refresh_token quando vencido.
    //
    // Duas trancas de isolamento:
    //   1) header x-polling-merchants com o merchant DAQUELA loja — o iFood já
    //      entrega só o que é dela;
    //   2) merchantEsperado no processamento — qualquer evento que ainda assim
    //      viesse de outro merchant é descartado antes de tocar o banco.
    // ── VÍNCULO AUTOMÁTICO DA LOJA RECÉM-CONECTADA ────────────────────────
    // Loja que acabou de colar o código ainda pode não ter merchantId: se a
    // fila estava vazia no momento da conexão, não havia evento de onde tirá-lo
    // (e o módulo Merchant não é autorizado neste app, então não há endpoint
    // para perguntar). Aqui se tenta de novo a cada rodada, até o primeiro
    // pedido revelar o ID — o lojista não precisa fazer nada.
    // Loja vinculada AGORA já consumiu uma chamada de polling na descoberta.
    // Bater de novo na mesma rodada arrisca 429 do iFood, então ela entra na
    // passada distribuída na próxima volta (60s depois).
    const vinculadasAgora = new Set<string>();

    try {
      const pendentes = await prisma.user.findMany({
        where: {
          ifoodConnected: true,
          ifoodMerchantId: null,
          ifoodAccessToken: { not: null },
        },
        select: { id: true, storeName: true, email: true },
      });

      for (const loja of pendentes) {
        const nome = loja.storeName || loja.email || loja.id;
        const tokenLoja = await getTokenDaLojaIfood(loja.id);
        if (!tokenLoja) continue;

        const { descobrirMerchantsPorEventos } = await import("@/lib/ifood-api");
        const vistos = await descobrirMerchantsPorEventos(tokenLoja);
        if (vistos.length === 0) {
          log.push(`[vínculo] ${nome}: nenhum evento ainda — tentando na próxima rodada`);
          continue;
        }

        // Um merchant que já é de outro dono nunca pode ser adotado aqui.
        const ocupadosDb = await prisma.user.findMany({
          where: { ifoodMerchantId: { in: vistos }, NOT: { id: loja.id } },
          select: { ifoodMerchantId: true },
        });
        const ocupados = new Set(ocupadosDb.map((u) => u.ifoodMerchantId).filter(Boolean) as string[]);
        const livres = vistos.filter((id) => !ocupados.has(id));

        if (livres.length !== 1) {
          log.push(`[vínculo] ${nome}: ${livres.length} merchant(s) candidato(s) — não vinculando por segurança`);
          continue;
        }

        await prisma.user.update({
          where: { id: loja.id },
          data: { ifoodMerchantId: livres[0] },
        });
        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId: loja.id, merchantId: livres[0] } },
          create: {
            userId: loja.id,
            label: loja.storeName || "Loja Principal",
            merchantId: livres[0],
            connected: true,
            active: true,
          },
          update: { connected: true, active: true },
        });
        vinculadasAgora.add(loja.id);
        log.push(`[vínculo] ${nome}: merchant ${livres[0]} vinculado automaticamente`);
        console.log(`[iFood Cron] Loja ${loja.id} vinculada ao merchant ${livres[0]} pelos eventos.`);
      }
    } catch (e: any) {
      log.push(`[vínculo] erro: ${e?.message}`);
    }

    const distribuido = { lojas: 0, eventos: 0, criados: 0, atualizados: 0, erros: 0 };
    try {
      const lojas = await prisma.user.findMany({
        where: {
          ifoodConnected: true,
          ifoodMerchantId: { not: null },
          ifoodAccessToken: { not: null },
        },
        select: { id: true, storeName: true, email: true, ifoodMerchantId: true },
      });

      log.push(`[distribuído] ${lojas.length} loja(s) com conexão própria`);

      for (const loja of lojas) {
        const nome = loja.storeName || loja.email || loja.id;
        if (vinculadasAgora.has(loja.id)) {
          log.push(`[distribuído] ${nome}: recém-vinculada, entra na próxima rodada`);
          continue;
        }
        try {
          const tokenLoja = await getTokenDaLojaIfood(loja.id);
          if (!tokenLoja) {
            distribuido.erros++;
            log.push(`[distribuído] ${nome}: sem token utilizável — precisa reconectar`);
            continue;
          }

          distribuido.lojas++;

          const evRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
            headers: {
              Authorization: `Bearer ${tokenLoja}`,
              "x-polling-merchants": loja.ifoodMerchantId as string,
            },
          });

          if (!evRes.ok) {
            distribuido.erros++;
            const corpoErro = await evRes.text().catch(() => "");
            log.push(`[distribuído] ${nome}: polling falhou ${evRes.status} ${corpoErro.slice(0, 120)}`);
            continue;
          }

          const evTexto = await evRes.text();
          const evs = evTexto ? JSON.parse(evTexto) : [];
          if (!Array.isArray(evs) || evs.length === 0) continue;

          distribuido.eventos += evs.length;
          log.push(`[distribuído] ${nome}: ${evs.length} evento(s)`);

          const r = await processarEventosIfood({
            events: evs,
            token: tokenLoja,
            log,
            merchantEsperado: loja.ifoodMerchantId,
          });
          distribuido.criados += r.created;
          distribuido.atualizados += r.updated;
        } catch (e: any) {
          distribuido.erros++;
          log.push(`[distribuído] ${nome}: erro ${e?.message}`);
        }
      }
    } catch (e: any) {
      distribuido.erros++;
      log.push(`[distribuído] erro geral: ${e.message}`);
      console.error("[iFood Cron distribuído]", e);
    }

    return NextResponse.json({
      ok: true,
      events: events.length,
      created,
      updated,
      acknowledged: central.acknowledged,
      distribuido,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[iFood Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
