/**
 * O PERFIL DA LOJA — a parte que lê o banco. Junta os SINAIS de várias lojas
 * de uma vez (lib/perfil-da-loja/regras.ts monta o resto, sem banco).
 *
 * ── Custo no Neon ───────────────────────────────────────────────────────────
 *
 * Nada de buscar pedido por pedido para contar em JS (a fatura de agosto/2026
 * foi tráfego: memória neon-conta-e-consumo). Cada pergunta é UMA consulta
 * agregada para TODAS as lojas pedidas (`= ANY(ids)`), que devolve uma linha
 * por loja (ou por loja × canal). Os JSON grandes do User (chatbotConfig,
 * fiscalConfig com certificado, cardápio…) nunca saem do banco: o SQL lê só a
 * chave que interessa (`->>'enabled'`).
 *
 * Os pedidos: uma consulta no índice (franchiseeId, createdAt) cobrindo 60
 * dias, agrupada por loja e pelas colunas que decidem o canal — o canal sai de
 * `chaveDoCanal` (lib/canal-do-pedido.ts), a mesma função dos relatórios, com
 * a mesa separada como `canalDoRelatorio`. Com 200 lojas são algumas centenas
 * de linhas.
 *
 * Tabela criada no boot que não existir (ambiente novo, prévia) só deixa o
 * sinal em zero — o perfil sai do mesmo jeito (`seguro`).
 *
 * A lista inteira (admin) fica 5 minutos na memória do processo: abrir e
 * fechar a aba não refaz as ~25 consultas.
 */
import { prisma } from "@/lib/prisma";
import type { ChaveDeCanal } from "@/lib/canal-do-pedido";
import { STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";
import { canalDaLinha, janelasDaLoja, type Janelas } from "@/lib/perfil-da-loja/janelas";
import { VALOR_IMPOSSIVEL } from "@/lib/relatorios/regua-da-venda";
import { getCurrentYearMonth, isExemptAccount, lojaIsenta } from "@/lib/billing";
import { mensalidadeDoCiclo, type CicloNasRegras } from "@/lib/parceiro/regras";
import { PRECO_DO_ASSESSOR } from "@/lib/assessor/assinatura";
import { PRECOS_DO_APP } from "@/lib/app-da-loja/plano";
import { PRECO_DO_MULTIMARCAS } from "@/lib/multimarcas/preco";
import {
  montarPerfil, resumirPerfil,
  type JanelaDeVendas, type PerfilDaLoja, type PrecosDeTabela, type ResumoDoPerfil, type SinaisDaLoja, type VendasDoCanal,
} from "@/lib/perfil-da-loja/regras";

const DIA = 86_400_000;
/** Preço do totem por licença ativa — o mesmo 100 fixo do fechamento (api/cron/billing-close). */
const PRECO_DO_TOTEM = 100;
/** Semanas num mês, para a taxa semanal do tráfego virar mensal. */
const SEMANAS_NO_MES = 52 / 12;

export const PRECOS_DE_TABELA: PrecosDeTabela = {
  bill: PRECO_DO_ASSESSOR,
  appDaLoja: PRECOS_DO_APP.android,
  totem: PRECO_DO_TOTEM,
  trafego: Math.round(50 * SEMANAS_NO_MES * 100) / 100,
  multimarcas: PRECO_DO_MULTIMARCAS,
};

async function seguro<T>(nome: string, consulta: () => Promise<T[]>): Promise<T[]> {
  try {
    return await consulta();
  } catch (e) {
    console.warn(`[perfil-da-loja] ${nome}: ${String((e as Error)?.message || e).slice(0, 180)}`);
    return [];
  }
}

const porId = <T extends { id: string }>(linhas: T[]) => new Map(linhas.map((l) => [l.id, l]));
const num = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

type LinhaDeVenda = {
  id: string; src: string; od: string; ifood: boolean; tem_od: boolean; cw: boolean;
  v7: number; r7: number; v30: number; r30: number; vant: number; rant: number;
  entregas: number; com_motoboy: number; pagos_online: number; cashback: number; cupom: number;
  kds: number; nfce: number; impressos: number; contas_mesa: number;
};

/**
 * Vendas por loja × canal, nas três janelas — a régua dos relatórios: fora da
 * venda (cancelado, rascunho do robô, totem sem pagar) e reposição não entram;
 * pedido de valor impossível também não; mesa conta UMA vez por conta e o
 * acréscimo (parentOrderId) não abre venda nova.
 */
async function vendasDasLojas(ids: string[], j: Janelas): Promise<LinhaDeVenda[]> {
  if (!ids.length) return [];
  const fora = [...STATUS_FORA_DA_VENDA];
  return seguro("vendas", () => prisma.$queryRaw<LinhaDeVenda[]>`
    SELECT o."franchiseeId" AS id,
      CASE WHEN o."tableSessionId" IS NOT NULL THEN 'MESA' ELSE upper(coalesce(o.source, '')) END AS src,
      CASE WHEN o."tableSessionId" IS NOT NULL THEN '' ELSE upper(coalesce(o."openDeliveryChannel", '')) END AS od,
      (o."tableSessionId" IS NULL AND (o."ifoodOrderId" IS NOT NULL OR o."ifoodReference" IS NOT NULL)) AS ifood,
      (o."tableSessionId" IS NULL AND o."openDeliveryOrderId" IS NOT NULL) AS tem_od,
      (o."tableSessionId" IS NULL AND coalesce(o."openDeliveryOrderId", '') LIKE 'cardapioweb\\_%') AS cw,
      (count(*) FILTER (WHERE o."createdAt" >= ${j.i7} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
        + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" >= ${j.i7}))::int AS v7,
      coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" >= ${j.i7}), 0)::float AS r7,
      (count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
        + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" >= ${j.i30}))::int AS v30,
      coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" >= ${j.i30}), 0)::float AS r30,
      (count(*) FILTER (WHERE o."createdAt" < ${j.i30} AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)
        + count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" < ${j.i30}))::int AS vant,
      coalesce(sum(o."totalAmount") FILTER (WHERE o."createdAt" < ${j.i30}), 0)::float AS rant,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."deliveryType" = 'DELIVERY' AND o."tableSessionId" IS NULL AND o."parentOrderId" IS NULL)::int AS entregas,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."deliveryType" = 'DELIVERY' AND o."motoboyId" IS NOT NULL)::int AS com_motoboy,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."paymentPaidAt" IS NOT NULL AND o."gatewayProvider" IS NOT NULL)::int AS pagos_online,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND (coalesce(o."cashbackEarned", 0) > 0 OR coalesce(o."cashbackUsed", 0) > 0))::int AS cashback,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o.notes LIKE '%[Cupom:%')::int AS cupom,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND (o."kdsProductionAt" IS NOT NULL OR o."kdsFinishedAt" IS NOT NULL))::int AS kds,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."fiscalStatus" = 'EMITTED')::int AS nfce,
      count(*) FILTER (WHERE o."createdAt" >= ${j.i30} AND o."printedAt" IS NOT NULL)::int AS impressos,
      count(DISTINCT o."tableSessionId") FILTER (WHERE o."createdAt" >= ${j.i30})::int AS contas_mesa
    FROM "CustomerOrder" o
    WHERE o."franchiseeId" = ANY(${ids})
      AND o."createdAt" >= ${j.iAnt} AND o."createdAt" < ${j.fim}
      AND o.status <> ALL(${fora})
      AND o."reposicao" IS NULL
      AND o."totalAmount" < ${VALOR_IMPOSSIVEL}
    GROUP BY 1, 2, 3, 4, 5, 6`);
}

// ── Os sinais de cada loja ──────────────────────────────────────────────────

type LinhaDaLoja = {
  id: string; name: string | null; storeName: string | null; city: string | null; storePhone: string | null; email: string;
  slug: string | null; storeLogo: string | null; createdAt: Date; trialEndsAt: Date | null; planPercent: number | null;
  isFranqueadoHakim: boolean | null; storeDeliveryOnly: boolean | null; storeTimezone: string | null;
  vendedorId: string | null; ambassadorId: string | null;
  robo: boolean; ifood: boolean; f99: boolean; jotaja: boolean; brendi: boolean; kds: boolean; assistente: Date | null;
  fiscal: boolean; firecheck: boolean; cashback: boolean; carimbos: boolean; trilha: boolean; cupons: number;
  pagamento_online: boolean; meta: boolean; meta_fee: number | null; caixa_fechado: Date | null;
};

async function dadosDasLojas(ids: string[]): Promise<LinhaDaLoja[]> {
  return prisma.$queryRaw<LinhaDaLoja[]>`
    SELECT u.id, u.name, u."storeName", u.city, u."storePhone", u.email, u.slug, u."storeLogo", u."createdAt", u."trialEndsAt",
      u."planPercent", u."isFranqueadoHakim", u."storeDeliveryOnly", u."storeTimezone", u."vendedorId", u."ambassadorId",
      (coalesce(u."chatbotConfig"->>'connected', '') = 'true'
        OR (u."chatbotConfig"->>'instanceName' IS NOT NULL AND coalesce(u."chatbotConfig"->>'active', '') <> 'false')) AS robo,
      coalesce(u."ifoodConnected", false) AS ifood,
      coalesce(u."food99Connected", false) AS f99,
      coalesce(u."jotajaConnected", false) AS jotaja,
      coalesce(u."brendiConnected", false) AS brendi,
      (jsonb_typeof(u."kdsScreens"::jsonb) = 'array' AND jsonb_array_length(u."kdsScreens"::jsonb) > 0) AS kds,
      u."printQueuePolledAt" AS assistente,
      coalesce(u."fiscalConfig"->>'enabled', '') = 'true' AS fiscal,
      u."firecheckIntegracao" IS NOT NULL AS firecheck,
      (coalesce(u."storeLoyalty"->>'cashbackActive', '') = 'true'
        AND CASE WHEN coalesce(u."storeLoyalty"->>'rate', '') ~ '^[0-9]+([.][0-9]+)?$' THEN (u."storeLoyalty"->>'rate')::numeric > 0 ELSE false END) AS cashback,
      coalesce(u."storeLoyalty"->>'stampsActive', '') = 'true' AS carimbos,
      coalesce(u."storeLoyalty"->'trilha'->>'ativa', '') = 'true' AS trilha,
      (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(u."storeCoupons"::jsonb) = 'array' THEN u."storeCoupons"::jsonb ELSE '[]'::jsonb END) c
        WHERE coalesce(c->>'active', 'true') <> 'false')::int AS cupons,
      (((coalesce(u."pixOnlineAtivo", false) OR coalesce(u."cartaoOnlineAtivo", false)) AND u."asaasChaveCifrada" IS NOT NULL)
        OR u."mpAccessToken" IS NOT NULL) AS pagamento_online,
      coalesce(u."metaAdsEnabled", false) AS meta,
      u."metaAdsWeeklyFee" AS meta_fee,
      u."cashClosedAt" AS caixa_fechado
    FROM "User" u
    WHERE u.id = ANY(${ids})`;
}

type Contagem = { id: string; n: number };
type ContagemComData = Contagem & { ultimo: Date | null };

/** Todas as contagens auxiliares, em paralelo, cada uma numa consulta só para todas as lojas. */
async function contagensDasLojas(ids: string[], desde: Date, agora: Date) {
  const meses = [getCurrentYearMonth(0), getCurrentYearMonth(-1)];
  const c = <T extends { id: string }>(nome: string, q: () => Promise<T[]>) => seguro(nome, q).then(porId);
  const [
    produtos, categorias, respostas, ia, conversas, keeta, cardapioweb, mesas, garcons, motoboys, aparelhosMotoboy,
    contingencia, episodios, caixas, contas, notas, despesas, estoque, fichas, movEstoque, descartes, clientes, avaliacoes,
    billAss, billUso, appPlano, appPedidos, appAparelhos, totens, campanhasMeta, multimarcas, whatsOficial, campanhasDisparo,
    acompanhamento, lojasNaConta, garcomLogin, termos,
  ] = await Promise.all([
    c<Contagem>("produtos", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "MenuProduct" WHERE "franchiseeId" = ANY(${ids}) AND active = true GROUP BY 1`),
    c<Contagem>("categorias", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "MenuCategory" WHERE "franchiseeId" = ANY(${ids}) GROUP BY 1`),
    // UsageLog só tem índice por (franchiseeId, yearMonth): o mês entra no filtro para usá-lo.
    c<Contagem>("respostas do robô", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "UsageLog"
      WHERE "franchiseeId" = ANY(${ids}) AND "yearMonth" = ANY(${meses}) AND "createdAt" >= ${desde}
        AND category = 'WHATSAPP_MSG' AND metadata->>'direction' = 'OUTBOUND' GROUP BY 1`),
    c<Contagem>("uso de IA", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "UsageLog"
      WHERE "franchiseeId" = ANY(${ids}) AND "yearMonth" = ANY(${meses}) AND "createdAt" >= ${desde}
        AND category IN ('GEMINI_CHAT', 'GEMINI_VISION') GROUP BY 1`),
    c<Contagem>("conversas do robô", () => prisma.$queryRaw`SELECT "userId" AS id, count(*)::int AS n FROM "ChatbotConversationState"
      WHERE "userId" = ANY(${ids}) AND "lastMessageAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("keeta", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "KeetaLoja" WHERE "franchiseeId" = ANY(${ids}) AND ativa = true GROUP BY 1`),
    c<Contagem>("cardapioweb", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "CardapioWebInstalacao" WHERE "franchiseeId" = ANY(${ids}) AND ativa = true GROUP BY 1`),
    c<Contagem>("mesas", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "Table" WHERE "franchiseeId" = ANY(${ids}) AND "isActive" = true GROUP BY 1`),
    c<Contagem>("garçons", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "Waiter" WHERE "franchiseeId" = ANY(${ids}) AND active = true GROUP BY 1`),
    c<Contagem>("motoboys", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "Motoboy" WHERE "franchiseeId" = ANY(${ids}) AND active = true GROUP BY 1`),
    c<Contagem>("app do entregador", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(DISTINCT "motoboyId")::int AS n FROM "MotoboyAparelho" WHERE "lojaId" = ANY(${ids}) GROUP BY 1`),
    c<Contagem>("contingência", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "Contingencia" WHERE "lojaId" = ANY(${ids}) GROUP BY 1`),
    c<Contagem>("episódios de contingência", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "ContingenciaEpisodio" WHERE "lojaId" = ANY(${ids}) AND "subiuEm" >= ${desde} GROUP BY 1`),
    c<ContagemComData>("caixas", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*) FILTER (WHERE "createdAt" >= ${desde})::int AS n, max("openedAt") AS ultimo
      FROM "CashSession" WHERE "franchiseeId" = ANY(${ids}) GROUP BY 1`),
    c<ContagemComData>("contas a pagar", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n, max("createdAt") AS ultimo FROM "Payable" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<ContagemComData>("notas de compra", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n, max("createdAt") AS ultimo FROM "PurchaseInvoice" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<ContagemComData>("despesas", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n, max("createdAt") AS ultimo FROM "DespesaLancada" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("estoque", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "StockItem" WHERE "franchiseeId" = ANY(${ids}) AND active = true GROUP BY 1`),
    c<Contagem>("fichas técnicas", () => prisma.$queryRaw`SELECT m."franchiseeId" AS id, count(DISTINCT r."menuProductId")::int AS n
      FROM "ProductRecipe" r JOIN "MenuProduct" m ON m.id = r."menuProductId" WHERE m."franchiseeId" = ANY(${ids}) GROUP BY 1`),
    c<Contagem>("movimentos de estoque", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "StockTransaction" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("descartes do FireCheck", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "DescarteDoFirecheck" WHERE "franchiseeId" = ANY(${ids}) AND "registradoEm" >= ${desde} GROUP BY 1`),
    c<Contagem>("clientes", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "ClienteDaLoja" WHERE "lojaId" = ANY(${ids}) GROUP BY 1`),
    c<Contagem>("avaliações", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "StoreReview" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("Bill", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "AssessorAssinatura" WHERE "franchiseeId" = ANY(${ids}) AND ativo = true GROUP BY 1`),
    c<Contagem>("uso do Bill", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "AssessorRegistro" WHERE "franchiseeId" = ANY(${ids}) AND "criadoEm" >= ${desde} AND "desfeitoEm" IS NULL GROUP BY 1`),
    // O plano do app está ligado enquanto houver um trecho sem fim; o valor fica no trecho.
    c<{ id: string; valor: number | null }>("plano do app", () => prisma.$queryRaw`SELECT p."franchiseeId" AS id, max((t->>'valor')::numeric)::float AS valor
      FROM "AppDaLojaPlano" p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.trechos::jsonb) = 'array' THEN p.trechos::jsonb ELSE '[]'::jsonb END) t
      WHERE p."franchiseeId" = ANY(${ids}) AND (t->>'ate') IS NULL GROUP BY 1`),
    c<Contagem>("pedidos do app", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "AppDaLojaPedido" WHERE "lojaId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("aparelhos do app", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "AppDaLojaAparelho" WHERE "lojaId" = ANY(${ids}) AND "removidoEm" IS NULL GROUP BY 1`),
    c<Contagem>("totem", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "TotemLicense" WHERE "franchiseeId" = ANY(${ids}) AND active = true GROUP BY 1`),
    c<Contagem>("campanhas Meta", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "MetaAdsCampaign" WHERE "franchiseeId" = ANY(${ids}) AND status = 'ACTIVE' GROUP BY 1`),
    c<{ id: string; valor: number | null }>("Multimarcas", () => prisma.$queryRaw`SELECT a."franchiseeId" AS id,
        (SELECT max((t->>'valor')::numeric)::float FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.trechos::jsonb) = 'array' THEN a.trechos::jsonb ELSE '[]'::jsonb END) t WHERE (t->>'ate') IS NULL) AS valor
      FROM "MultimarcasAssinatura" a WHERE a."franchiseeId" = ANY(${ids}) AND a.ativo = true`),
    c<Contagem>("WhatsApp oficial", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "WhatsappOficial" WHERE "franchiseeId" = ANY(${ids}) AND status = 'CONECTADO' GROUP BY 1`),
    c<Contagem>("campanhas de disparo", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n FROM "DisparoCampanha" WHERE "franchiseeId" = ANY(${ids}) AND "createdAt" >= ${desde} GROUP BY 1`),
    c<Contagem>("acompanhamento iFood", () => prisma.$queryRaw`SELECT "lojaId" AS id, count(*)::int AS n FROM "AcompanhamentoIfood" WHERE "lojaId" = ANY(${ids}) AND status <> 'ENCERRADO' GROUP BY 1`),
    c<Contagem>("lojas na conta", () => prisma.$queryRaw`SELECT "accountGroupId" AS id, count(*)::int AS n FROM "User" WHERE "accountGroupId" = ANY(${ids}) AND id <> "accountGroupId" GROUP BY 1`),
    c<ContagemComData>("login de garçom", () => prisma.$queryRaw`SELECT "franchiseeId" AS id, count(*)::int AS n, max("lastLoginAt") AS ultimo FROM "Waiter" WHERE "franchiseeId" = ANY(${ids}) AND "lastLoginAt" IS NOT NULL GROUP BY 1`),
    c<ContagemComData>("termos", () => prisma.$queryRaw`SELECT "userId" AS id, count(*)::int AS n, max("aceitoEm") AS ultimo FROM "AceiteDosTermos" WHERE "userId" = ANY(${ids}) GROUP BY 1`),
  ]);
  void agora;
  return {
    produtos, categorias, respostas, ia, conversas, keeta, cardapioweb, mesas, garcons, motoboys, aparelhosMotoboy,
    contingencia, episodios, caixas, contas, notas, despesas, estoque, fichas, movEstoque, descartes, clientes, avaliacoes,
    billAss, billUso, appPlano, appPedidos, appAparelhos, totens, campanhasMeta, multimarcas, whatsOficial, campanhasDisparo,
    acompanhamento, lojasNaConta, garcomLogin, termos,
  };
}

async function ultimaVendaDasLojas(ids: string[]): Promise<Map<string, Date | null>> {
  const fora = [...STATUS_FORA_DA_VENDA];
  const linhas = await seguro("última venda", () => prisma.$queryRaw<{ id: string; ultima: Date | null }[]>`
    SELECT u.id,
      (SELECT o."createdAt" FROM "CustomerOrder" o
        WHERE o."franchiseeId" = u.id AND o.status <> ALL(${fora}) AND o."reposicao" IS NULL
        ORDER BY o."createdAt" DESC LIMIT 1) AS ultima
    FROM "User" u WHERE u.id = ANY(${ids})`);
  return new Map(linhas.map((l) => [l.id, l.ultima]));
}

const SELECT_DO_CICLO = {
  franchiseeId: true, yearMonth: true, status: true, amountDue: true, amountPending: true,
  asaasPaymentId: true, asaasBoletoUrl: true, dueDate: true, closedAt: true, paidAt: true, paidValue: true,
  paidNetValue: true, asaasStatus: true, notes: true,
} as const;

const ROTULO_DA_MENSALIDADE: Record<string, string> = {
  EM_ANDAMENTO: "em andamento", PAGA: "paga", A_VENCER: "a vencer", VENCIDA: "vencida", SEM_BOLETO: "sem boleto", SEM_COBRANCA: "sem cobrança",
};

/** Os sinais das lojas pedidas. Uma rodada de consultas agregadas, qualquer que seja o número de lojas. */
export async function sinaisDasLojas(ids: string[], agora = new Date()): Promise<SinaisDaLoja[]> {
  if (!ids.length) return [];
  const lojas = await dadosDasLojas(ids);
  if (!lojas.length) return [];
  const desde = new Date(agora.getTime() - 30 * DIA);
  const mesAtual = getCurrentYearMonth(0);

  // Uma consulta de vendas por fuso (quase todas são America/Sao_Paulo).
  const porFuso = new Map<string, string[]>();
  for (const l of lojas) {
    const tz = l.storeTimezone || "America/Sao_Paulo";
    porFuso.set(tz, [...(porFuso.get(tz) || []), l.id]);
  }

  const parceirosIds = [...new Set(lojas.flatMap((l) => [l.vendedorId, l.ambassadorId]).filter(Boolean) as string[])];
  const [vendas, aux, ultimas, ciclos, parceiros] = await Promise.all([
    Promise.all([...porFuso].map(([tz, idsDoFuso]) => vendasDasLojas(idsDoFuso, janelasDaLoja(tz, agora)))).then((x) => x.flat()),
    contagensDasLojas(lojas.map((l) => l.id), desde, agora),
    ultimaVendaDasLojas(lojas.map((l) => l.id)),
    prisma.franchiseeBillingCycle.findMany({
      where: { franchiseeId: { in: lojas.map((l) => l.id) }, OR: [{ yearMonth: mesAtual }, { status: "CLOSED", amountPending: { gt: 0 } }] },
      select: SELECT_DO_CICLO,
    }).catch(() => [] as never[]),
    parceirosIds.length ? prisma.ambassador.findMany({ where: { id: { in: parceirosIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  const nomeDoParceiro = new Map(parceiros.map((p) => [p.id, p.name]));
  const vendasDaLoja = new Map<string, LinhaDeVenda[]>();
  for (const v of vendas) vendasDaLoja.set(v.id, [...(vendasDaLoja.get(v.id) || []), v]);
  const ciclosDaLoja = new Map<string, CicloNasRegras[]>();
  for (const c of ciclos) ciclosDaLoja.set(c.franchiseeId, [...(ciclosDaLoja.get(c.franchiseeId) || []), c]);
  const n = (m: Map<string, Contagem>, id: string) => num(m.get(id)?.n);

  return lojas.map((l): SinaisDaLoja => {
    const id = l.id;
    // Vendas por canal (somando as linhas que caem no mesmo canal).
    const canais = new Map<ChaveDeCanal, VendasDoCanal>();
    let entregas = 0, comMotoboy = 0, pagosOnline = 0, cashback = 0, cupom = 0, kds = 0, nfce = 0, impressos = 0, contasMesa = 0;
    const soma = (a: JanelaDeVendas, vendasN: number, valor: number): JanelaDeVendas => ({ vendas: a.vendas + num(vendasN), valor: Math.round((a.valor + num(valor)) * 100) / 100 });
    for (const v of vendasDaLoja.get(id) || []) {
      const canal = canalDaLinha(v);
      const atual = canais.get(canal) || { canal, d7: { vendas: 0, valor: 0 }, d30: { vendas: 0, valor: 0 }, d30Anterior: { vendas: 0, valor: 0 } };
      canais.set(canal, { canal, d7: soma(atual.d7, v.v7, v.r7), d30: soma(atual.d30, v.v30, v.r30), d30Anterior: soma(atual.d30Anterior, v.vant, v.rant) });
      entregas += num(v.entregas); comMotoboy += num(v.com_motoboy); cashback += num(v.cashback); cupom += num(v.cupom);
      kds += num(v.kds); nfce += num(v.nfce); impressos += num(v.impressos); contasMesa += num(v.contas_mesa);
      // Pago online no canal PRÓPRIO (site e robô): o do marketplace é do marketplace.
      if (canal === "SITE" || canal === "WHATSAPP_IA") pagosOnline += num(v.pagos_online);
    }

    // Mensalidade do FireHub: o mês corrente e o que está em aberto (a mesma leitura do portal do parceiro).
    const doMes = ciclosDaLoja.get(id) || [];
    const atual = mensalidadeDoCiclo(doMes.find((c) => c.yearMonth === mesAtual) || null, mesAtual, mesAtual, agora);
    const abertos = doMes
      .filter((c) => c.status === "CLOSED" && c.amountPending > 0)
      .map((c) => mensalidadeDoCiclo(c, c.yearMonth, mesAtual, agora))
      .filter((m) => m.situacao === "A_VENCER" || m.situacao === "VENCIDA")
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const isenta = lojaIsenta({ email: l.email, planPercent: l.planPercent, isFranqueadoHakim: l.isFranqueadoHakim });

    // O último sinal de que alguém mexeu no sistema — não há registro de login do lojista.
    const ultimaVenda = ultimas.get(id) || null;
    const sinais: { em: Date | null; oQue: string }[] = [
      { em: ultimaVenda, oQue: "último pedido" },
      { em: l.assistente, oQue: "Assistente de impressão ligado" },
      { em: aux.caixas.get(id)?.ultimo ?? null, oQue: "caixa aberto" },
      { em: l.caixa_fechado, oQue: "caixa fechado" },
      { em: aux.contas.get(id)?.ultimo ?? null, oQue: "conta lançada no financeiro" },
      { em: aux.despesas.get(id)?.ultimo ?? null, oQue: "despesa lançada" },
      { em: aux.notas.get(id)?.ultimo ?? null, oQue: "nota de compra lançada" },
      { em: aux.garcomLogin.get(id)?.ultimo ?? null, oQue: "garçom entrou no app" },
      { em: aux.termos.get(id)?.ultimo ?? null, oQue: "aceitou os termos no painel" },
    ];
    const ultimoSinal = sinais.filter((s) => s.em).sort((a, b) => new Date(b.em!).getTime() - new Date(a.em!).getTime())[0];

    const app = aux.appPlano.get(id);
    const mm = aux.multimarcas.get(id);
    const totem = n(aux.totens, id);
    return {
      id,
      nome: l.storeName || l.name || l.email,
      dono: l.name,
      cidade: l.city,
      telefone: l.storePhone,
      email: l.email,
      slug: l.slug,
      logo: l.storeLogo,
      criadaEm: new Date(l.createdAt).toISOString(),
      testeAte: iso(l.trialEndsAt),
      isenta,
      motivoDaIsencao: !isenta ? null : l.isFranqueadoHakim ? "loja Hakim" : isExemptAccount(l.email) ? "conta da casa" : "isentada pelo admin",
      soDelivery: !!l.storeDeliveryOnly,
      vendedor: l.vendedorId ? { id: l.vendedorId, nome: nomeDoParceiro.get(l.vendedorId) || "vendedor" } : null,
      embaixador: l.ambassadorId ? { id: l.ambassadorId, nome: nomeDoParceiro.get(l.ambassadorId) || "embaixador" } : null,
      lojasNaConta: n(aux.lojasNaConta, id),

      vendasPorCanal: [...canais.values()],
      ultimaVendaEm: iso(ultimaVenda),
      entregas30: entregas,
      entregasComMotoboy30: comMotoboy,
      pagosOnlineNoCanalProprio30: pagosOnline,
      comCashback30: cashback,
      comCupom30: cupom,
      passaramNoKds30: kds,
      comNotaFiscal30: nfce,
      impressos30: impressos,

      produtos: n(aux.produtos, id),
      categorias: n(aux.categorias, id),

      roboConfigurado: !!l.robo,
      respostasDoRobo30: n(aux.respostas, id),
      conversasDoRobo30: n(aux.conversas, id),
      usosDeIa30: n(aux.ia, id),

      integracoes: {
        ifood: !!l.ifood, food99: !!l.f99, keeta: n(aux.keeta, id) > 0, cardapioweb: n(aux.cardapioweb, id) > 0, jotaja: !!l.jotaja, brendi: !!l.brendi,
      },

      mesas: n(aux.mesas, id),
      garcons: n(aux.garcons, id),
      contasDeMesa30: contasMesa,
      kdsConfigurado: !!l.kds,
      assistenteVistoEm: iso(l.assistente),
      motoboys: n(aux.motoboys, id),
      aparelhosDoEntregador: n(aux.aparelhosMotoboy, id),
      contingenciaConfigurada: n(aux.contingencia, id) > 0,
      contingenciaUsada30: n(aux.episodios, id),

      caixas30: n(aux.caixas, id),
      lancamentosFinanceiros30: n(aux.contas, id) + n(aux.notas, id) + n(aux.despesas, id),
      itensDeEstoque: n(aux.estoque, id),
      fichasTecnicas: n(aux.fichas, id),
      movimentosDeEstoque30: n(aux.movEstoque, id),
      fiscalConfigurado: !!l.fiscal,
      firecheckLigado: !!l.firecheck,
      descartesDoFirecheck30: n(aux.descartes, id),

      fidelidade: { cashback: !!l.cashback, carimbos: !!l.carimbos, trilha: !!l.trilha },
      cuponsAtivos: num(l.cupons),
      clientesNaBase: n(aux.clientes, id),
      avaliacoes30: n(aux.avaliacoes, id),

      bill: { ativo: n(aux.billAss, id) > 0, valorMensal: n(aux.billAss, id) > 0 ? PRECO_DO_ASSESSOR : null, usos30: n(aux.billUso, id) },
      appDaLoja: { ativo: !!app, valorMensal: app ? (app.valor ?? null) : null, pedidos30: n(aux.appPedidos, id), aparelhos: n(aux.appAparelhos, id) },
      totem: { licencasAtivas: totem, valorMensal: totem > 0 ? totem * PRECO_DO_TOTEM : null },
      trafego: {
        ativo: !!l.meta,
        valorMensal: l.meta ? Math.round(num(l.meta_fee ?? 50) * SEMANAS_NO_MES * 100) / 100 : null,
        campanhasAtivas: n(aux.campanhasMeta, id),
      },
      multimarcas: { ativo: !!mm, valorMensal: mm ? (mm.valor ?? PRECO_DO_MULTIMARCAS) : null },
      disparo: { conectado: n(aux.whatsOficial, id) > 0, campanhas30: n(aux.campanhasDisparo, id), saldo: null },
      pagamentoOnlineLigado: !!l.pagamento_online,
      acompanhamentoIfood: n(aux.acompanhamento, id) > 0,

      mensalidade: {
        mes: mesAtual,
        valorDoMes: isenta ? 0 : Math.round(atual.valor * 100) / 100,
        situacaoDoMes: isenta ? "isenta" : ROTULO_DA_MENSALIDADE[atual.situacao] || atual.situacao,
        emAberto: !isenta && abertos.length
          ? {
              valor: Math.round(abertos.reduce((t, m) => t + m.valor, 0) * 100) / 100,
              meses: abertos.length,
              diasDeAtraso: Math.max(0, ...abertos.map((m) => m.diasDeAtraso)),
              boletoUrl: (abertos.find((m) => m.situacao === "VENCIDA") || abertos[0]).boletoUrl,
            }
          : null,
      },
      ultimoSinalDoPainel: ultimoSinal ? { em: new Date(ultimoSinal.em!).toISOString(), oQue: ultimoSinal.oQue } : null,
    };
  });
}

// ── O que as rotas chamam ───────────────────────────────────────────────────

/** O perfil completo de uma loja (sem cache: quem abre quer o número de agora). */
export async function perfilDaLoja(id: string, agora = new Date()): Promise<PerfilDaLoja | null> {
  const [s] = await sinaisDasLojas([id], agora);
  return s ? montarPerfil(s, PRECOS_DE_TABELA, agora) : null;
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { em: number; valor: ResumoDoPerfil[] }>();

/** Os resumos das lojas (lista e relatório da carteira), 5 minutos na memória. */
export async function resumosDasLojas(ids: string[], agora = new Date()): Promise<ResumoDoPerfil[]> {
  if (!ids.length) return [];
  const chave = [...ids].sort().join(",");
  const guardado = cache.get(chave);
  if (guardado && agora.getTime() - guardado.em < CACHE_MS) return guardado.valor;
  const sinais = await sinaisDasLojas(ids, agora);
  const valor = sinais.map((s) => resumirPerfil(montarPerfil(s, PRECOS_DE_TABELA, agora)));
  cache.set(chave, { em: agora.getTime(), valor });
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return valor;
}

/** Todas as lojas clientes (o admin). */
export async function idsDeTodasAsLojas(): Promise<string[]> {
  const lojas = await prisma.user.findMany({ where: { role: "FRANCHISEE" }, select: { id: true } });
  return lojas.map((l) => l.id);
}

/**
 * As lojas que o vendedor vê no portal dele: as da CARTEIRA (User.vendedorId)
 * e as que ele INDICOU (User.ambassadorId) — as mesmas que o relatório do
 * parceiro já mostra (lib/parceiro/relatorio.ts). Nada além disso.
 */
export async function idsDaCarteira(parceiroId: string): Promise<string[]> {
  const lojas = await prisma.user.findMany({
    where: { OR: [{ vendedorId: parceiroId }, { ambassadorId: parceiroId }] },
    select: { id: true },
  });
  return lojas.map((l) => l.id);
}

/** A loja está entre as que este parceiro pode ver? */
export async function lojaEstaNaCarteira(parceiroId: string, lojaId: string): Promise<boolean> {
  const n = await prisma.user.count({ where: { id: lojaId, OR: [{ vendedorId: parceiroId }, { ambassadorId: parceiroId }] } });
  return n > 0;
}

