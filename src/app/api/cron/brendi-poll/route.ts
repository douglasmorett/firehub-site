import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { garantirColunasBrendi } from "@/lib/garantir-colunas";
import { processBrendiEvent } from "@/lib/processBrendiEvent";

/**
 * GET /api/cron/brendi-poll
 * Cron Job — roda a cada minuto puxando eventos Open Delivery da Brendi.
 *
 * Clone estrutural do cron/jotaja-poll (mesmo contrato Abrasel), SEM o bloco
 * de reconciliação por GET /v1/orders?status=... — no JotaJá foi verificado
 * contra a API real que o padrão Open Delivery não define listagem de pedidos,
 * e aquele bloco nunca recuperou nada. A rede de segurança real é uma só e
 * está aqui: ACK condicionado à gravação confirmada no banco — evento que não
 * virou pedido fica na fila e o próximo ciclo tenta de novo.
 *
 * MULTI-TENANT: itera sobre TODAS as lojas com brendiConnected=true e faz
 * polling individual com as credenciais de cada uma (brendiFetch resolve a
 * credencial por loja; sem fallback ENV — lição JotaJá: fallback de credencial
 * fez loja nova herdar credencial alheia).
 *
 * Protegida por CRON_SECRET (bypass para chamadas internas do cron-runner).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

/**
 * Linha crua do User — os campos brendi* NÃO estão no Prisma Client (colunas
 * garantidas no boot ANTES do schema, regra da casa de migração sem quebrar
 * produção), então a busca de lojas conectadas é $queryRaw com tipagem manual,
 * como food99-lojas.ts faz.
 */
interface LojaConectada {
  id: string;
  email: string;
  storeName: string | null;
  ownerId: string | null;
  brendiMerchantId: string | null;
}

/** Resumo por loja que volta no corpo da resposta (e no log em caso de falha). */
interface ResumoLoja {
  eventos: number;
  criados: number;
  atualizados: number;
  ackados: number;
  falhas: number;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Defensivo e custo zero após o 1º sucesso: se o boot pegou o banco num
  // soluço, é esta chamada que conserta — sem ela a query crua abaixo falharia
  // com "column does not exist" para sempre.
  await garantirColunasBrendi();

  const startTime = Date.now();
  const MAX_SAFE_MS = 50_000; // 5s de folga antes do maxDuration derrubar tudo
  const hasTimeLeft = () => Date.now() - startTime < MAX_SAFE_MS;
  const log: string[] = [];

  try {
    // ── MULTI-TENANT: lojas realmente conectadas (flag + credenciais) ──────
    // LEFT(email, 8) em vez de LIKE 'deleted_%': o underscore é curinga no
    // LIKE e escapá-lo dentro do template literal do Prisma é armadilha.
    let stores: LojaConectada[] = [];
    try {
      stores = await prisma.$queryRaw<LojaConectada[]>`
        SELECT "id", "email", "storeName", "ownerId", "brendiMerchantId"
        FROM "User"
        WHERE "brendiConnected" = true
          AND "brendiClientId" IS NOT NULL
          AND "brendiClientSecret" IS NOT NULL
          AND LEFT("email", 8) <> 'deleted_'
      `;
    } catch {
      // Colunas ainda não criadas neste banco = integração nunca configurada.
      // Não é erro do cron: é o gate natural do deploy (nada roda).
      log.push("ℹ️ Colunas Brendi ainda não existem no banco — nada a fazer");
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    if (!Array.isArray(stores) || stores.length === 0) {
      log.push("ℹ️ Nenhuma loja com Brendi ativo encontrada");
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    log.push(`ℹ️ ${stores.length} loja(s) ativa(s) com Brendi`);

    let totalCreated = 0, totalUpdated = 0, totalDisputes = 0, totalCancelled = 0;
    let totalEvents = 0, totalAcknowledged = 0;
    const porLoja: Record<string, ResumoLoja> = {};

    // ── Polling PARALELO PER-STORE ─────────────────────────────────────────
    const CHUNK_SIZE = 5;
    for (let i = 0; i < stores.length; i += CHUNK_SIZE) {
      if (!hasTimeLeft()) {
        log.push(`⏱️ Timeout guard — ${stores.length - i} loja(s) restantes serão processadas no próximo ciclo`);
        break;
      }
      const chunk = stores.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(chunk.map(async (store) => {
        const storeId = store.ownerId || store.id;
        const storeName = store.storeName || store.email;
        const resumo: ResumoLoja = { eventos: 0, criados: 0, atualizados: 0, ackados: 0, falhas: 0 };
        porLoja[storeName] = resumo;

        try {
          const { brendiFetch, brendiMutate } = await import("@/lib/brendi-api");

          // ── Paginação dentro do budget ─────────────────────────────────
          // O feed devolve no máx. 15 itens por chamada. Loja movimentada não
          // pode acumular lag de 15/min: depois de ackar uma página cheia,
          // chamamos de novo até vir página incompleta/vazia. O teto de
          // páginas é cinto de segurança contra um feed que nunca esvazia.
          const TAMANHO_PAGINA = 15;
          const MAX_PAGINAS = 10;

          for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
            if (!hasTimeLeft()) {
              log.push(`⏱️ [${storeName}] Timeout guard — paginação interrompida (página ${pagina})`);
              break;
            }

            let res: Response;
            try {
              res = await brendiFetch("/v1/events:polling", storeId);
            } catch (err: any) {
              log.push(`❌ [${storeName}] Polling falhou: ${err.message}`);
              resumo.falhas++;
              break;
            }

            if (!res.ok) {
              const errBody = await res.text().catch(() => "");
              log.push(`❌ [${storeName}] events:polling: ${res.status} — ${errBody.slice(0, 200)}`);
              resumo.falhas++;
              break;
            }

            const eventsText = await res.text();
            let events: any[] = [];
            try {
              events = eventsText ? JSON.parse(eventsText) : [];
              if (!Array.isArray(events)) events = [events];
            } catch {
              log.push(`❌ [${storeName}] Resposta inválida (não é JSON): ${eventsText.slice(0, 100)}`);
              resumo.falhas++;
              break;
            }

            if (!events || events.length === 0) {
              if (pagina === 1) log.push(`✅ [${storeName}] 0 eventos`);
              break;
            }

            totalEvents += events.length;
            resumo.eventos += events.length;
            log.push(`📥 [${storeName}] ${events.length} evento(s) (página ${pagina})`);

            // Se algum evento ficar sem ACK, a próxima chamada do feed devolve
            // ELE de novo — paginar em cima disso seria girar em falso no mesmo
            // lote. Nesse caso a paginação para e o próximo ciclo retenta.
            let algumFicouNaFila = false;

            for (const event of events) {
              if (!hasTimeLeft()) {
                log.push(`⏱️ [${storeName}] Timeout guard — parando processamento (${events.length - events.indexOf(event)} eventos restantes)`);
                algumFicouNaFila = true;
                break;
              }

              const result = await processBrendiEvent(event, { targetFranchiseeId: storeId });
              log.push(`  ${result.action === "error" ? "❌" : result.action === "created" ? "✅" : "🔄"} ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

              // ── ACK só com o pedido confirmado no banco ──────────────────
              // O ACK apaga o evento do feed PARA SEMPRE, e presume-se (igual
              // JotaJá) que a Brendi não tem endpoint de listagem/recuperação
              // — um ACK indevido é perda definitiva do pedido. "processado"
              // não basta: um "skipped" que não gravou nada e fosse ackado
              // sumiria com a venda. Se o evento diz respeito a um pedido,
              // ele precisa EXISTIR no banco antes do acknowledgment.
              const eid = String(event?.eventId ?? event?.id ?? "").trim();
              const evOrderId = String(event?.orderId ?? "").trim();
              const podeAckar = await (async () => {
                if (result.action === "error") return false;
                if (!evOrderId) return true; // evento sem pedido (keepalive) — nada a conferir
                const gravado = await prisma.customerOrder.findFirst({
                  where: {
                    OR: [
                      { openDeliveryOrderId: evOrderId },
                      { openDeliveryOrderId: { startsWith: `${evOrderId}_` } },
                    ],
                  } as any,
                  select: { id: true },
                });
                if (!gravado) {
                  log.push(`  ⛔ [${storeName}] SEM ACK — ${result.action} não deixou pedido no banco (${evOrderId}); evento fica na fila para a próxima tentativa`);
                  console.error(`[Brendi Cron] ⛔ SEM ACK ${evOrderId}: ${result.action} sem gravar (${result.message || "-"})`);
                  // Avisa no WhatsApp em vez de deixar a falha só no log do container.
                  import("@/lib/server-monitor")
                    .then(m => m.alertarFalhaDeIntegracao("Brendi", storeName, `${result.action}: ${result.message || "pedido não gravado"}`))
                    .catch(() => {});
                  return false;
                }
                return true;
              })();

              if (podeAckar && eid) {
                try {
                  // ACK INDIVIDUAL de propósito: ackar o lote inteiro de uma
                  // vez apagaria também os eventos que falharam no meio.
                  const ackRes = await brendiMutate("POST", "/v1/events/acknowledgment", [{
                    id: eid,
                    orderId: evOrderId,
                    eventType: String(event?.eventType ?? event?.fullCode ?? event?.code ?? ""),
                  }], storeId);
                  if (ackRes.ok) {
                    totalAcknowledged++;
                    resumo.ackados++;
                  } else {
                    const ackErr = await ackRes.text().catch(() => "");
                    log.push(`  ⚠️ [${storeName}] ACK ${eid}: HTTP ${ackRes.status} — ${ackErr.slice(0, 150)}`);
                    algumFicouNaFila = true;
                  }
                } catch (ackErr: any) {
                  // Não crítico: sem ACK o evento volta no próximo polling e a
                  // idempotência do processador o descarta — pior caso é uma
                  // consulta a mais, nunca duplicata.
                  log.push(`  ⚠️ [${storeName}] ACK falhou para ${eid}: ${ackErr?.message}`);
                  algumFicouNaFila = true;
                }
              } else if (!podeAckar) {
                resumo.falhas++;
                algumFicouNaFila = true;
              }

              if (result.action === "created")   { totalCreated++;   resumo.criados++; }
              if (result.action === "updated")   { totalUpdated++;   resumo.atualizados++; }
              if (result.action === "dispute")   { totalDisputes++;  resumo.atualizados++; }
              if (result.action === "cancelled") { totalCancelled++; resumo.atualizados++; }
            }

            // Página incompleta = feed esvaziado; evento na fila = parar de
            // paginar (o feed reentregaria o mesmo lote).
            if (algumFicouNaFila || events.length < TAMANHO_PAGINA) break;
          }
        } catch (storeErr: any) {
          log.push(`❌ [${storeName}] Erro geral: ${storeErr.message}`);
          resumo.falhas++;
          console.error(`[Brendi Cron] ❌ [${storeName}] Erro geral:`, storeErr?.message);
        }
      }));

      for (const result of results) {
        if (result.status === "rejected") {
          log.push(`❌ Erro assíncrono em loja: ${result.reason?.message}`);
        }
      }
    }

    // ── O cron precisa FALAR ───────────────────────────────────────────────
    // O cron-runner descarta o corpo quando o status é 2xx — no JotaJá isso
    // custou meses de "ok (200)" no log do container enquanto pedido se
    // perdia. O que importa vai para o stdout aqui...
    const houveFalha = log.some(l => l.startsWith("❌") || l.includes("⛔"));
    if (totalEvents > 0 || houveFalha) {
      for (const linha of log) {
        if (linha.startsWith("❌") || linha.includes("⛔")) console.error(`[Brendi Cron] ${linha}`);
        else console.log(`[Brendi Cron] ${linha}`);
      }
    }
    if (totalCreated > 0 || totalUpdated > 0 || totalCancelled > 0) {
      console.log(`[Brendi Cron] 📊 ${totalCreated} criados, ${totalUpdated} atualizados, ${totalCancelled} cancelados, ${totalAcknowledged} ackados em ${Date.now() - startTime}ms`);
    }

    return NextResponse.json({
      ok: !houveFalha,
      lojas: stores.length,
      events: totalEvents,
      created: totalCreated,
      updated: totalUpdated,
      disputes: totalDisputes,
      cancelled: totalCancelled,
      acknowledged: totalAcknowledged,
      porLoja,
      durationMs: Date.now() - startTime,
      log,
      // ...e o 207 faz o cron-runner imprimir o corpo (ele só silencia em 2xx
      // puro), então uma loja falhando vira linha visível no log do container.
    }, { status: houveFalha ? 207 : 200 });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[Brendi Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
