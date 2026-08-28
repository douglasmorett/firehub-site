import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getCurrentYearMonth } from "@/lib/billing";

/**
 * GET /api/cron/meta-ads-sync
 * Cron job — sincroniza métricas das campanhas ativas com o Meta, cobra a
 * gestão de R$ 50 por semana ATIVA (não é percentual do gasto) e renova os
 * tokens do Facebook antes que expirem.
 */
export const dynamic = "force-dynamic";
// As conferências de veiculação (anúncio + insights da semana) só entram nas
// campanhas com algo errado ou na virada da semana, mas somadas ao alerta de
// WhatsApp no fim da rodada elas cabem mal em 30s. Estourar o prazo no meio do
// laço deixaria as últimas lojas da lista sem sincronizar TODA rodada — sempre
// as mesmas, porque a ordem é estável.
export const maxDuration = 60;

// ── VERSÃO DA GRAPH API ──────────────────────────────────────────────────────
// PRECISA acompanhar META_API_VERSION de src/lib/meta-ads.ts. As consultas
// abaixo (status do anúncio e entrega da semana) não existem como helper
// exportado de lá e são o que impede cobrar por anúncio que não veicula, então
// ficam aqui — com a versão à vista, para a divergência ser visível num grep e
// não numa fatura errada.
const META_BASE = "https://graph.facebook.com/v25.0";
const TIMEOUT_META_MS = 15000;

/**
 * O que cada `effective_status` de CAMPANHA significa para a cobrança.
 *
 * A regra anterior era uma lista negra invertida — "qualquer coisa != ACTIVE
 * rebaixa" — e isso matava a campanha no FireHub para sempre: IN_PROCESS e
 * WITH_ISSUES são estados TRANSITÓRIOS da Meta (processamento, revisão de
 * anúncio), a Meta volta a entregar sozinha minutos depois, e aqui a linha já
 * tinha virado PAUSED. Como o laço só varria `status: "ACTIVE"`, ela nunca mais
 * era reexaminada: métricas congeladas na tela do lojista, campanha gastando o
 * cartão dele e a gestão de R$ 50/semana nunca mais cobrada. Estado permanente
 * que não se cura sozinho.
 *
 * Agora só rebaixa quem REALMENTE parou de entregar; o resto continua ACTIVE e
 * segue sendo sincronizado — quem decide se pode cobrar é a prova de veiculação
 * (`houveEntregaNaSemana`), não o rótulo de status.
 */
const STATUS_ENCERRADO = new Set(["ARCHIVED", "DELETED", "COMPLETED"]);
const STATUS_INTERROMPIDO = new Set([
  "PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "DISAPPROVED", "PENDING_BILLING_INFO",
]);

function classificarStatusDaCampanha(status: string): "ENCERRADO" | "INTERROMPIDO" | "SEGUE" {
  if (STATUS_ENCERRADO.has(status)) return "ENCERRADO";
  if (STATUS_INTERROMPIDO.has(status)) return "INTERROMPIDO";
  return "SEGUE";
}

/**
 * Estados do ANÚNCIO que significam criativo barrado pela Meta.
 *
 * Reprovação de criativo é o modo de falha mais comum de anúncio de comida
 * (texto na imagem, foto ruim, política de alimentos) e acontece no nível do
 * ANÚNCIO: o ad fica DISAPPROVED e a CAMPANHA continua respondendo ACTIVE, por
 * isso nenhuma checagem de campanha pega isso.
 *
 * PENDING_REVIEW/PREAPPROVED ficam de fora de propósito: são as primeiras horas
 * normais de qualquer anúncio, não é motivo para marcar a campanha como
 * quebrada (mas também não rendem cobrança — quem paga a semana é a entrega).
 */
const ANUNCIO_REPROVADO = new Set(["DISAPPROVED", "WITH_ISSUES"]);

type EstadoDoAnuncio = { status: string; reprovado: boolean; motivo: string | null };

/**
 * O anúncio está no ar? E, se não está, por quê?
 *
 * `ad_review_feedback` é o texto da própria Meta explicando a reprovação — é a
 * única coisa que dá ao lojista um caminho de volta ("troque a imagem"), então
 * vai para o log e para o alerta de WhatsApp do suporte.
 */
async function lerEstadoDoAnuncio(adId: string, token: string): Promise<EstadoDoAnuncio | null> {
  try {
    const r = await fetch(
      `${META_BASE}/${adId}?fields=effective_status,ad_review_feedback&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(TIMEOUT_META_MS) }
    );
    const json: any = await r.json().catch(() => null);
    const status: unknown = json?.effective_status;
    if (!r.ok || json?.error || typeof status !== "string" || !status) return null;

    const feedback = json?.ad_review_feedback?.global ?? json?.ad_review_feedback ?? null;
    const motivo = feedback && typeof feedback === "object"
      ? Object.values(feedback as Record<string, unknown>)
          .filter((v): v is string => typeof v === "string")
          .join(" · ")
          .slice(0, 300)
      : null;

    return { status, reprovado: ANUNCIO_REPROVADO.has(status), motivo: motivo || null };
  } catch {
    // Falha de rede nossa não é prova de nada sobre o anúncio do lojista.
    return null;
  }
}

/**
 * A campanha entregou ALGUMA COISA nos últimos 7 dias?
 *
 * Esta é a trava que sustenta a promessa do módulo: R$ 50 é a gestão de uma
 * semana VEICULADA. Sem ela, qualquer forma de parada que a Meta não reflita no
 * status da campanha — criativo reprovado, conta pré-paga zerada, anúncio
 * pausado direto no Ads Manager — virava R$ 50 por semana para sempre por zero
 * impressão. `date_preset=maximum` (o que o painel usa) não serve aqui: o gasto
 * ACUMULADO continua positivo para sempre depois que a entrega morre.
 *
 * null = não deu para saber. Quem chamou NÃO cobra e também não anda o relógio:
 * a semana fica pendente para a próxima rodada, em vez de ser perdoada por uma
 * instabilidade da Meta.
 */
async function houveEntregaNaSemana(campaignId: string, token: string): Promise<boolean | null> {
  try {
    const r = await fetch(
      `${META_BASE}/${campaignId}/insights?fields=spend,impressions&date_preset=last_7d` +
      `&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(TIMEOUT_META_MS) }
    );
    const json: any = await r.json().catch(() => null);
    if (!r.ok || json?.error || !Array.isArray(json?.data)) return null;

    // Sem linha nenhuma na janela: a Meta não tem o que reportar porque não
    // houve veiculação. É resposta válida, não falha.
    const linha = json.data[0];
    if (!linha) return false;

    const gasto = parseFloat(linha.spend ?? "0");
    const impressoes = parseInt(linha.impressions ?? "0");
    return (Number.isFinite(gasto) && gasto > 0) || (Number.isFinite(impressoes) && impressoes > 0);
  } catch {
    return null;
  }
}

/**
 * Lança a taxa de gestão num ciclo que AINDA PODE virar boleto, e devolve o mês
 * em que ela caiu.
 *
 * Dois defeitos moravam no upsert anterior:
 *
 *  1. Ele montava o `yearMonth` com o fuso DA LOJA, enquanto o billing-close
 *     fecha `getCurrentYearMonth(-1)` no fuso de São Paulo. Para uma loja em
 *     Manaus/Cuiabá/Rio Branco há uma janela de 1 a 2 horas na virada do mês em
 *     que os dois lados discordam sobre qual mês é. A taxa de gestão é serviço
 *     do FireHub, não evento de venda da loja: alinhar com o fechamento é o que
 *     faz os dois lados sempre concordarem.
 *
 *  2. `upsert` incrementa em QUALQUER linha existente, inclusive CLOSED/PAID —
 *     ciclo cujo boleto já saiu e que nada reprocessa. O valor ficava órfão na
 *     linha, com o log dizendo "+R$50,00 lançados". Perda 100% silenciosa.
 *
 * Agora o incremento só acerta ciclo OPEN; se o mês corrente já fechou (corrida
 * com o billing-close ou fechamento manual), a taxa cai no mês seguinte, que é
 * onde ela ainda vira dinheiro.
 */
async function lancarTaxaNoCicloAberto(
  franchiseeId: string,
  planPercent: number,
  valor: number
): Promise<string> {
  const candidatos = [getCurrentYearMonth(0), getCurrentYearMonth(1)];

  for (const yearMonth of candidatos) {
    const atualizados = await prisma.franchiseeBillingCycle.updateMany({
      where: { franchiseeId, yearMonth, status: "OPEN" },
      data: { metaAdsFee: { increment: valor } },
    });
    if (atualizados.count > 0) return yearMonth;

    const existente = await prisma.franchiseeBillingCycle.findUnique({
      where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
      select: { id: true },
    });
    if (existente) continue; // existe e não está OPEN: tenta o mês seguinte

    try {
      await prisma.franchiseeBillingCycle.create({
        data: { franchiseeId, yearMonth, planPercent, metaAdsFee: valor, status: "OPEN" },
      });
      return yearMonth;
    } catch {
      // Corrida com o ensureCycle do faturamento: o ciclo nasceu entre a
      // consulta e o create. Incrementa no que existe agora.
      const segunda = await prisma.franchiseeBillingCycle.updateMany({
        where: { franchiseeId, yearMonth, status: "OPEN" },
        data: { metaAdsFee: { increment: valor } },
      });
      if (segunda.count > 0) return yearMonth;
    }
  }

  throw new Error("nenhum ciclo aberto aceitou a taxa");
}

/** Campanha pausada mais velha que isto não volta: o ad set dura 4 semanas. */
const LIMITE_DE_REEXAME_DIAS = 90;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  // Tudo que precisa de gente para resolver. Vai num único alerta de WhatsApp
  // no fim da rodada: o cooldown do server-monitor é por canal, então mandar um
  // por loja faria só o primeiro chegar.
  const alertas: string[] = [];
  let synced = 0;
  let falhas = 0;

  try {
    const { getCampaignInsights, renovarTokenDoLojista, tokenAindaVale, statusEfetivoDaCampanha } =
      await import("@/lib/meta-ads");

    // ── RENOVAÇÃO DOS TOKENS ────────────────────────────────────────────────
    // O token do Facebook vale ~60 dias e não havia nenhuma renovação: depois
    // disso a campanha parava de sincronizar e o lojista seguia pagando R$ 50
    // por semana sem ninguém perceber. Falha silenciosa e cobrada — a pior
    // combinação.
    //
    // A troca só funciona com token AINDA válido, então roda com folga, a cada
    // passagem do cron, em vez de esperar o vencimento.
    try {
      const comToken = await prisma.user.findMany({
        where: { metaFbAccessToken: { not: null }, metaAdsEnabled: true },
        select: { id: true, storeName: true, metaFbAccessToken: true },
      });

      for (const loja of comToken) {
        const atual = loja.metaFbAccessToken as string;
        const novo = await renovarTokenDoLojista(atual);

        if (novo && novo !== atual) {
          await prisma.user.update({
            where: { id: loja.id },
            data: { metaFbAccessToken: novo },
          });
          log.push(`🔑 token renovado: ${loja.storeName ?? loja.id}`);
          continue;
        }

        // Não renovou: só é problema se o token atual já morreu. Aí a loja
        // precisa reconectar, e é melhor desligar o módulo do que seguir
        // cobrando por um serviço que parou.
        if (!(await tokenAindaVale(atual))) {
          await prisma.user.update({
            where: { id: loja.id },
            data: { metaAdsEnabled: false },
          });
          log.push(`⚠️ token expirado: ${loja.storeName ?? loja.id} — precisa reconectar o Facebook`);
          console.warn(`[MetaAds] token expirado na loja ${loja.id}; módulo desligado até reconectar.`);
          // Este é o pior caso silencioso do módulo: a campanha continua
          // veiculando na Meta gastando o cartão do lojista, o painel congela e
          // a gestão para de ser cobrada. Sem aviso, ninguém olha por dias.
          alertas.push(
            `${loja.storeName ?? loja.id}: token do Facebook expirou — módulo desligado, métricas e cobrança parados até o lojista reconectar`
          );
        }
      }
    } catch (e: any) {
      log.push(`⚠️ renovação de tokens: ${e?.message}`);
      alertas.push(`renovação de tokens falhou: ${e?.message}`);
    }

    // Campanhas ligadas — e também as rebaixadas, para poderem VOLTAR.
    //
    // Varrer só `status: "ACTIVE"` era uma porta de mão única: nenhum caminho do
    // sistema devolve PAUSED → ACTIVE além do lojista clicar "Retomar", então
    // uma campanha rebaixada por engano (ou por saldo que depois foi recarregado
    // na Meta) ficava congelada aqui para sempre enquanto entregava lá.
    // Campanha pausada pelo próprio lojista continua PAUSED na Meta e é
    // classificada como INTERROMPIDA logo abaixo — não sobe de novo.
    const campaigns = await (prisma as any).metaAdsCampaign.findMany({
      where: {
        OR: [
          { status: "ACTIVE" },
          {
            status: "PAUSED",
            createdAt: { gte: new Date(Date.now() - LIMITE_DE_REEXAME_DIAS * 86_400_000) },
          },
        ],
      },
      include: {
        franchisee: {
          select: {
            id: true, storeName: true, metaFbAccessToken: true,
            metaAdsWeeklyFee: true, storeTimezone: true, planPercent: true,
          },
        },
      },
    });

    log.push(`📊 ${campaigns.length} campanhas em acompanhamento`);

    for (const campaign of campaigns) {
      const nomeDaLoja: string = campaign.franchisee?.storeName ?? campaign.franchiseeId;

      if (!campaign.metaCampaignId || !campaign.franchisee?.metaFbAccessToken) {
        log.push(`⏭️ ${campaign.id}: sem campaignId ou token`);
        if (campaign.status === "ACTIVE") {
          falhas++;
          alertas.push(`${nomeDaLoja}: campanha ativa sem token do Facebook — não sincroniza nem cobra`);
        }
        continue;
      }

      const token: string = campaign.franchisee.metaFbAccessToken;

      try {
        // A Meta é a fonte da verdade do status. Campanha pausada no Ads
        // Manager, arquivada, com o teto de gasto batido ou com o prazo do ad
        // set vencido continuava "ACTIVE" no banco — e a gestão de R$ 50/semana
        // era cobrada PARA SEMPRE por uma campanha que não veicula.
        const statusNaMeta = await statusEfetivoDaCampanha(campaign.metaCampaignId, token);
        // null = não deu para ler (token/instabilidade). Não é motivo para
        // rebaixar nada: o insights logo abaixo falha e a rodada é contada como
        // falha de verdade.
        const situacao = statusNaMeta ? classificarStatusDaCampanha(statusNaMeta) : "SEGUE";

        if (situacao === "ENCERRADO") {
          if (campaign.status !== "ENDED") {
            await (prisma as any).metaAdsCampaign.update({
              where: { id: campaign.id },
              data: { status: "ENDED", lastBilledAt: new Date(), updatedAt: new Date() },
            });
            log.push(`🏁 ${campaign.id}: ${statusNaMeta} na Meta → ENDED aqui; cobrança encerrada`);
          }
          synced++;
          continue;
        }

        if (situacao === "INTERROMPIDO") {
          if (campaign.status !== "PAUSED") {
            await (prisma as any).metaAdsCampaign.update({
              where: { id: campaign.id },
              // Zera o relógio da cobrança: a semana em que a campanha parou
              // não se cobra, e o "Retomar" não pode achar que há 3 semanas
              // pendentes de uma campanha que estava desligada.
              data: { status: "PAUSED", lastBilledAt: new Date(), updatedAt: new Date() },
            });
            log.push(`⏸️ ${campaign.id}: ${statusNaMeta} na Meta → PAUSED aqui; cobrança interrompida`);
          }
          synced++;
          continue;
        }

        const insights = await getCampaignInsights(campaign.metaCampaignId, token);
        const newSpend = Number((insights as any).spend ?? 0);
        const impressoes = Number((insights as any).impressions ?? 0);

        const dados: Record<string, unknown> = {
          spend: newSpend,
          impressions: impressoes,
          clicks: (insights as any).clicks ?? 0,
          ordersGenerated: (insights as any).orders ?? 0,
          revenue: (insights as any).revenue ?? 0,
          updatedAt: new Date(),
        };

        // Modelo R$50/semana de gestão
        const weeklyFee: number = campaign.franchisee.metaAdsWeeklyFee ?? 50;
        const lastBilled = campaign.lastBilledAt
          ? new Date(campaign.lastBilledAt)
          : new Date(campaign.createdAt);
        const daysSinceLastBill = (Date.now() - lastBilled.getTime()) / (1000 * 60 * 60 * 24);
        const fechouSemana = daysSinceLastBill >= 7;

        // O anúncio custa uma chamada, então só é consultado quando muda algo:
        // na virada da semana (antes de cobrar), ao reexaminar uma campanha
        // rebaixada, ou quando nada foi entregue até agora — que é justamente a
        // assinatura de criativo reprovado.
        let anuncio: EstadoDoAnuncio | null = null;
        if (campaign.metaAdId && (fechouSemana || campaign.status === "PAUSED" || impressoes === 0)) {
          anuncio = await lerEstadoDoAnuncio(String(campaign.metaAdId), token);
        }

        if (anuncio?.reprovado) {
          // Anúncio reprovado = zero impressão, zero clique, R$ 0,00 de gasto —
          // e a campanha continua ACTIVE na Meta. Sem esta parada o lojista
          // pagava R$ 50 por semana, indefinidamente, por um anúncio que nunca
          // apareceu para ninguém. Marcar PAUSED aqui também é o que tira o
          // "✅ Ativo" da tela e devolve um caminho de volta a ele.
          if (campaign.status !== "PAUSED") {
            dados.status = "PAUSED";
            dados.lastBilledAt = new Date();
            alertas.push(
              `${nomeDaLoja}: anúncio ${anuncio.status} (reprovado pela Meta)` +
              `${anuncio.motivo ? ` — ${anuncio.motivo}` : ""}. Cobrança suspensa; ` +
              `o criativo precisa ser refeito numa campanha nova.`
            );
          }
          await (prisma as any).metaAdsCampaign.update({ where: { id: campaign.id }, data: dados });
          log.push(`🚫 ${campaign.id}: anúncio ${anuncio.status} — sem veiculação, nada cobrado`);
          synced++;
          continue;
        }

        if (campaign.status === "PAUSED") {
          if (anuncio && anuncio.status !== "ACTIVE") {
            // Campanha liberada mas anúncio ainda parado/em análise: continua
            // parada aqui, só as métricas são atualizadas.
            await (prisma as any).metaAdsCampaign.update({ where: { id: campaign.id }, data: dados });
            log.push(`⏸️ ${campaign.id}: campanha liberada, mas anúncio ${anuncio.status} — segue pausada`);
            synced++;
            continue;
          }
          // A cobrança recomeça DAQUI, não do rebaixamento: o período parado não
          // foi entregue e não se cobra retroativamente.
          dados.status = "ACTIVE";
          dados.lastBilledAt = new Date();
          await (prisma as any).metaAdsCampaign.update({ where: { id: campaign.id }, data: dados });
          log.push(`▶️ ${campaign.id}: voltou a veicular na Meta — reativada aqui, cobrança recomeça agora`);
          synced++;
          continue;
        }

        // ── COBRANÇA DA SEMANA ───────────────────────────────────────────────
        let feeAcumulada: number = campaign.feeAccrued ?? 0;

        if (fechouSemana) {
          const entregou = await houveEntregaNaSemana(campaign.metaCampaignId, token);

          if (entregou === false) {
            // Semana inteira sem uma impressão: não há gestão a cobrar. Anda o
            // relógio mesmo assim — senão a semana morta ficaria acumulando em
            // `Math.floor(dias/7)` e seria cobrada de uma vez quando a entrega
            // voltasse, que é exatamente o que não pode acontecer.
            dados.lastBilledAt = new Date();
            log.push(`⏭️ ${campaign.id}: nenhuma veiculação nos últimos 7 dias — semana NÃO cobrada`);
            alertas.push(
              `${nomeDaLoja}: campanha ativa e sem veiculação há 7 dias — semana não cobrada. ` +
              `Conferir saldo/forma de pagamento na conta de anúncios e o criativo.`
            );
          } else if (entregou === null) {
            // Não deu para confirmar: nada de cobrar no escuro, e o relógio não
            // anda — a semana fica pendente para a próxima rodada.
            log.push(`⚠️ ${campaign.id}: veiculação da semana não confirmada; cobrança adiada`);
          } else {
            const semanas = Math.floor(daysSinceLastBill / 7);
            const feeToAdd = weeklyFee * semanas;
            try {
              // A taxa entra no ciclo ANTES de o contador da campanha avançar.
              //
              // Na ordem antiga a campanha era atualizada primeiro: se a
              // gravação no ciclo falhasse, `feeAccrued` já tinha subido e a
              // rodada seguinte não via mais diferença nenhuma — a semana era
              // perdida em silêncio.
              const yearMonth = await lancarTaxaNoCicloAberto(
                campaign.franchiseeId,
                campaign.franchisee.planPercent ?? 1,
                feeToAdd
              );
              feeAcumulada += feeToAdd;
              dados.feeAccrued = feeAcumulada;
              dados.lastBilledAt = new Date();
              log.push(`  💸 +R$${feeToAdd.toFixed(2)} de gestão no ciclo ${yearMonth}`);
            } catch (billingErr: any) {
              // Não avança o contador: a taxa fica pendente para a próxima rodada.
              log.push(`  ❌ FALHA ao lançar R$${feeToAdd.toFixed(2)} de ${campaign.franchiseeId}: ${billingErr.message}`);
              console.error("[meta-ads-sync] taxa de gestão não lançada", {
                franchiseeId: campaign.franchiseeId, feeToAdd, erro: billingErr.message,
              });
              // Uma falha determinística aqui (foi o caso do bug de nomes de
              // campo, que nunca chegou a um boleto) se repetiria para sempre
              // com um console.error como único sinal.
              alertas.push(
                `${nomeDaLoja}: R$${feeToAdd.toFixed(2)} de gestão NÃO entraram no ciclo — ${billingErr.message}`
              );
            }
          }
        }

        await (prisma as any).metaAdsCampaign.update({ where: { id: campaign.id }, data: dados });

        log.push(`✅ ${campaign.id}: spend=R$${newSpend.toFixed(2)}, fee=R$${feeAcumulada.toFixed(2)}`);
        synced++;
      } catch (err: any) {
        falhas++;
        log.push(`❌ ${campaign.id}: ${err.message}`);
        alertas.push(`${nomeDaLoja}: falha ao sincronizar a campanha — ${err.message}`);
      }
    }

    // Todo o diagnóstico da rodada vivia neste array `log`, devolvido no corpo
    // da resposta — e ninguém lê esse corpo: o cron-runner olha só o código HTTP
    // e imprime "✅ ok (200)". Com a rota devolvendo 200 incondicionalmente, uma
    // quebra passava DIAS despercebida (o cron roda a cada 6h).
    await avisarSuporte(alertas);

    return NextResponse.json(
      { ok: falhas === 0, synced, falhas, total: campaigns.length, log },
      // Nenhuma campanha sincronizou e houve falha: a rodada inteira quebrou, e
      // o cron-runner precisa registrar isso em vez de um ✅.
      { status: falhas > 0 && synced === 0 ? 500 : 200 }
    );
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    await avisarSuporte([`sincronização do tráfego pago abortou: ${err.message}`]);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}

/** Um único alerta de WhatsApp por rodada, com tudo que precisa de gente. */
async function avisarSuporte(alertas: string[]): Promise<void> {
  if (alertas.length === 0) return;
  try {
    const { alertarFalhaDeIntegracao } = await import("@/lib/server-monitor");
    await alertarFalhaDeIntegracao(
      "Meta Ads (tráfego pago)",
      alertas.length === 1 ? "1 loja" : `${alertas.length} lojas`,
      alertas.slice(0, 8).join(" || ").slice(0, 1200)
    );
  } catch (e: any) {
    console.error("[meta-ads-sync] não consegui alertar o suporte:", e?.message);
  }
}
