import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/store/dynamic-eta
 * Implementa rigorosamente a tabela oficial "Planilha prazos de entrega Hakim":
 *  - 1 Motoboy: 38m (até 2 ped), 58m (até 3 ped), 78m (até 4 ped), > 4 ped ➔ Fechar 40m
 *  - 2 Motoboys: 38m (até 4 ped), 58m (até 6 ped), 78m (até 8 ped), > 8 ped ➔ Fechar 40m
 *  - 3 Motoboys: 38m (até 6 ped), 58m (até 9 ped), 78m (até 12 ped), > 12 ped ➔ Fechar 40m
 *  - 4 Motoboys: 38m (até 8 ped), 58m (até 12 ped), 78m (até 16 ped), > 16 ped ➔ Fechar 40m
 *  - 5 Motoboys: 38m (até 10 ped), 58m (até 15 ped), 78m (até 20 ped), > 20 ped ➔ Fechar 40m
 *  - 6 Motoboys: 38m (até 12 ped), 58m (até 18 ped), 78m (até 24 ped), > 24 ped ➔ Fechar 40m
 * Formula Geral para M motoboys:
 *  - Até 2*M ped: 38 min
 *  - Até 3*M ped: 58 min
 *  - Até 4*M ped: 78 min
 *  - Acima de 4*M ped: ALERTA DE CRÍTICO ➔ Fechar a loja por 40 min!
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-store-token",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  try {
    let franchiseeId: string | null = null;
    let storeName = "FIREHUB";

    const session = await getServerSession(authOptions);
    let sessionUser: any = null;
    if (session && (session.user as any)?.id) {
      sessionUser = session.user;
    }

    const urlToken = req.nextUrl.searchParams.get("token") || req.headers.get("x-store-token");
    let tokenUser: any = null;
    if (urlToken) {
      // Existem DOIS formatos de token vivos na rua: o id cru (extensões
      // instaladas antes da assinatura) e o `id.assinatura` que
      // /api/store/extensao-login emite hoje. Esta rota comparava o token
      // inteiro com o id, então SÓ o formato antigo passava — e /eta-config,
      // que exige assinatura para gravar, só aceita o novo. Resultado: não
      // existia um token que servisse nas duas rotas.
      //
      // Quem estava com o token antigo lia o ETA mas NÃO conseguia salvar a
      // quantidade de motoboys: o número mudava na tela, o servidor seguia com
      // o valor velho e a loja aparecia em ESTOURO o dia inteiro. Quem
      // relogasse para consertar isso perdia a rota inteira com 401.
      //
      // Aqui é LEITURA, então os dois formatos passam. Escrita continua
      // exigindo assinatura, em /eta-config.
      const { lerTokenDeExtensao } = await import("@/lib/extensao-token");
      const leitura = lerTokenDeExtensao(urlToken);
      if (leitura.valido) {
        tokenUser = await prisma.user.findFirst({
          where: { id: leitura.userId },
          select: { id: true, name: true, ownerId: true, email: true },
        });
      }
    }

    const hakimUser = null; // Removing Hakim fallback completely to enforce tenant isolation

    const targetUser = tokenUser || sessionUser;
    if (!targetUser) {
      return NextResponse.json({ error: "Loja não identificada" }, { status: 401 });
    }

    storeName = targetUser.name || "FIREHUB";

    // Verificar loja ativa selecionada (via cookie ou query storeId)
    const cookieStore = req.cookies.get("firehub_active_store")?.value;
    const queryStoreId = req.nextUrl.searchParams.get("storeId");
    const activeStoreId = queryStoreId || cookieStore;

    // Busca todos os IDs válidos de usuários e funcionários da franquia/loja
    const allStoreUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: targetUser.id },
          { ownerId: targetUser.id },
          { ownerId: targetUser.ownerId || "none" },
          { id: targetUser.ownerId || "none" },
        ]
      },
      select: { id: true }
    });

    let validFranchiseeIds = Array.from(new Set([
      ...allStoreUsers.map(u => u.id),
      targetUser.id,
      targetUser.ownerId,
      sessionUser?.id,
      sessionUser?.ownerId,
      tokenUser?.id,
      tokenUser?.ownerId,
    ].filter(Boolean))) as string[];

    // Se uma loja específica estiver selecionada, filtrar apenas os pedidos daquela loja
    if (activeStoreId && activeStoreId !== "all") {
      validFranchiseeIds = [activeStoreId];
    }

    const mode = req.nextUrl.searchParams.get("mode") || "auto";

    // ── CONTABILIZAÇÃO: ABA 'EM PRODUÇÃO' DA TELA DE PEDIDOS ──
    // Deve ser IDÊNTICO ao filtro do dashboard StoreOrdersDashboard.tsx:
    // Apenas pedidos recentes das últimas 18h em status ACEITO, PREPARANDO ou PRONTO (DELIVERY)
    const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000);
    const ordersInProduction = await prisma.customerOrder.count({
      where: {
        franchiseeId: { in: validFranchiseeIds },
        createdAt: { gte: eighteenHoursAgo },
        OR: [
          { status: "ACEITO" },
          { status: "PREPARANDO" },
          { status: "PRONTO", deliveryType: "DELIVERY" },
        ],
      },
    });

    // ── MODO MANUAL (Regras de Métricas Personalizadas) ──
    if (mode === "manual") {
      const rawRules = req.nextUrl.searchParams.get("rules");
      let rules: { maxOrders: number; minutes: number; pause?: boolean }[] = [];

      if (rawRules) {
        try {
          rules = JSON.parse(rawRules);
        } catch (e) {
          console.warn("[Dynamic ETA] Erro ao parsear regras manuais:", e);
        }
      }

      if (Array.isArray(rules) && rules.length > 0) {
        // Ordena regras por limite de pedidos crescente
        rules.sort((a, b) => (a.maxOrders || 0) - (b.maxOrders || 0));

        // Encontra a regra correspondente para a quantidade atual de pedidos
        const matchedRule = rules.find((r) => ordersInProduction <= r.maxOrders) || rules[rules.length - 1];

        const recommendedMinutes = matchedRule ? matchedRule.minutes : 58;
        const shouldPauseStore = matchedRule ? !!matchedRule.pause : false;
        const etaRangeFormatted = shouldPauseStore ? "⚠️ PAUSAR LOJA" : `${recommendedMinutes} min`;
        const matchedRuleLabel = matchedRule
          ? `Métrica Manual: Até ${matchedRule.maxOrders} ped. ➔ ${recommendedMinutes} min`
          : `Métrica Manual (${recommendedMinutes} min)`;

        return NextResponse.json({
          success: true,
          mode: "manual",
          franchiseeId: targetUser.id,
          storeName,
          ordersInProduction,
          activeMotoboys: null,
          recommendedMinutes,
          etaRangeFormatted,
          shouldPauseStore,
          pauseMinutes: shouldPauseStore ? 40 : 0,
          matchedRuleLabel,
          appliedRule: matchedRule,
          updatedAt: new Date().toISOString(),
        });
      }

      // Fallback para parâmetro manual legados simples
      const manualOrders = parseInt(req.nextUrl.searchParams.get("orders") || "10", 10);
      const manualMinutes = parseInt(req.nextUrl.searchParams.get("minutes") || "58", 10);

      return NextResponse.json({
        success: true,
        mode: "manual",
        franchiseeId: targetUser.id,
        storeName,
        ordersInProduction,
        activeMotoboys: null,
        recommendedMinutes: manualMinutes,
        etaRangeFormatted: `${manualMinutes} min`,
        shouldPauseStore: false,
        pauseMinutes: 0,
        matchedRuleLabel: `Modo Manual Fixo (${manualOrders} ped. ➔ ${manualMinutes} min)`,
        updatedAt: new Date().toISOString(),
      });
    }

    // ── MODO AUTOMÁTICO (Tabela Oficial Hakim — Baseada na aba 'Em Produção') ──
    // A quantidade de motoboys é configuração DA LOJA, persistida em User.etaConfig
    // (ver /api/store/eta-config) e vale até alguém mudar. O parâmetro ?motoboys=
    // continua aceito só como fallback para clientes antigos que ainda não
    // sincronizam com o servidor — o valor salvo tem prioridade.
    const storeEtaConfig = await prisma.user.findUnique({
      where: { id: validFranchiseeIds[0] },
      select: { etaConfig: true },
    });
    const savedMotoboys = (storeEtaConfig?.etaConfig as any)?.motoboysCount;

    const queryMotoboys = req.nextUrl.searchParams.get("motoboys");
    let activeMotoboys =
      typeof savedMotoboys === "number" && savedMotoboys > 0
        ? savedMotoboys
        : (queryMotoboys ? parseInt(queryMotoboys, 10) : 2);
    if (isNaN(activeMotoboys) || activeMotoboys < 1) activeMotoboys = 1;

    // Cálculo exato pela fórmula da Planilha Hakim:
    // Limite 28m = 1 * motoboys (1 pedido por motoboy)
    // Limite 38m = 2 * motoboys
    // Limite 58m = 3 * motoboys
    // Limite 78m = 4 * motoboys
    // Estourou (> 4 * motoboys) ➔ Fechar loja por 40 min

    const max28 = 1 * activeMotoboys;
    const max38 = 2 * activeMotoboys;
    const max58 = 3 * activeMotoboys;
    const max78 = 4 * activeMotoboys;

    let recommendedMinutes = 28;
    let etaRangeFormatted = "28 min";
    let shouldPauseStore = false;
    let pauseMinutes = 0;
    let matchedRuleLabel = "";

    if (ordersInProduction <= max28) {
      recommendedMinutes = 28;
      etaRangeFormatted = "28 min";
      matchedRuleLabel = `Até ${max28} ped. (28 min)`;
    } else if (ordersInProduction <= max38) {
      recommendedMinutes = 38;
      etaRangeFormatted = "38 min";
      matchedRuleLabel = `Até ${max38} ped. (38 min)`;
    } else if (ordersInProduction <= max58) {
      recommendedMinutes = 58;
      etaRangeFormatted = "58 min";
      matchedRuleLabel = `Até ${max58} ped. (58 min)`;
    } else if (ordersInProduction <= max78) {
      recommendedMinutes = 78;
      etaRangeFormatted = "78 min";
      matchedRuleLabel = `Até ${max78} ped. (78 min)`;
    } else {
      // ESTOURO DE CAPACIDADE ➔ FECHAR LOJA POR 40 MIN!
      recommendedMinutes = 78;
      shouldPauseStore = true;
      pauseMinutes = 40;
      etaRangeFormatted = "⚠️ PAUSAR LOJA (40 MIN)";
      matchedRuleLabel = `🚨 Estourou (${ordersInProduction} > ${max78} ped.) ➔ Pausar 40m`;
    }

    return NextResponse.json({
      success: true,
      mode: "auto",
      franchiseeId: targetUser.id,
      storeName,
      ordersInProduction,
      activeMotoboys,
      recommendedMinutes,
      etaRangeFormatted,
      shouldPauseStore,
      pauseMinutes,
      matchedRuleLabel,
      limits: { max38, max58, max78 },
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Dynamic ETA API]", err);
    return NextResponse.json({ error: err.message || "Erro ao calcular tempo dinâmico" }, { status: 500 });
  }
}
