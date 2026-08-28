/**
 * lib/meta-ads.ts
 * Integração com a Meta Marketing API
 * 
 * Docs: https://developers.facebook.com/docs/marketing-api
 * 
 * VARIÁVEIS DE AMBIENTE necessárias:
 *   META_APP_ID        = ID do App no Meta for Developers
 *   META_APP_SECRET    = Secret do App
 *   META_SYSTEM_TOKEN  = Token do sistema (Business Manager)
 */

// v20.0 saiu em maio/2024 e está no fim do ciclo de vida. Chamadas de
// Marketing API em versões antigas passam a ser recusadas quando a versão sai
// de suporte — e aí nenhuma campanha é criada, sem erro óbvio na tela.
const META_API_VERSION = "v23.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

import { segredoObrigatorio } from "./segredos";
import { criarState } from "./meta-oauth-state";

export type MetaCampaignConfig = {
  adAccountId: string;    // act_XXXXX
  accessToken: string;    // Token OAuth do franqueado
  storeName: string;
  storeSlug: string;
  storeAddress: string;
  lat: number;
  lng: number;
  radiusKm: number;
  weeklyBudgetBRL: number;   // Em REAIS. A Meta cobra na moeda da conta (BRL).
  semanasDeVeiculacao?: number; // Padrão 4. Define o teto de gasto e a data de fim.
  adCopy: string;
  adDescription?: string; // Linha curta junto do botão (CTA) do anúncio
  adImageUrl: string;
  pageId: string;         // Página do Facebook do restaurante
};

/**
 * Cria uma campanha completa: Campaign → AdSet → Creative → Ad
 * Retorna os IDs criados para salvar no banco
 */
export async function createMetaCampaign(config: MetaCampaignConfig) {
  const token = config.accessToken;
  const acct  = config.adAccountId;

  // Teto de gasto da campanha, em centavos. É a trava dura: mesmo que algo
  // dispare o orçamento diário, a Meta para de veicular ao atingir este valor.
  // Sem isto não havia NENHUM limite superior no sistema.
  const semanas = Math.max(1, Math.min(Number(config.semanasDeVeiculacao) || 4, 52));
  const tetoCentavos = Math.round(config.weeklyBudgetBRL * semanas * 100);

  // 1. Campanha
  const campaignRes = await metaPost(`/${acct}/campaigns`, token, {
    name:          `FireHub — ${config.storeName} — Delivery`,
    // OUTCOME_TRAFFIC é o objetivo do modelo ODAX. Os nomes antigos
    // (LINK_CLICKS e afins) são anteriores a ele e a Meta deixou de aceitar a
    // criação de novos conjuntos com objetivo original — a campanha nem nasce.
    objective:     "OUTCOME_TRAFFIC",
    // Nasce PAUSADA de propósito: quem liga é o lojista, depois de ver o
    // criativo e o valor. Criar com status ACTIVE começava a gastar dinheiro no
    // mesmo instante em que o registro entrava no banco.
    status:        "PAUSED",
    spend_cap:     tetoCentavos,
    special_ad_categories: [],
  });
  const campaignId = campaignRes.id;

  // 2. Conjunto de anúncios (audiência + orçamento + localização)
  //
  // O comentário anterior dizia "aprox R$1 = US$0.20" e não convertia nada — o
  // que estava certo por acidente: a Meta cobra na MOEDA DA CONTA, e a conta é
  // em BRL. `daily_budget` é simplesmente o valor em centavos de real.
  //
  // A Meta tem mínimo diário por conjunto; abaixo dele a criação é recusada.
  // R$ 6/dia (≈ R$ 42/semana) é uma margem segura para BRL.
  const MINIMO_DIARIO_CENTAVOS = 600;
  const dailyBudgetCents = Math.max(
    MINIMO_DIARIO_CENTAVOS,
    Math.round((config.weeklyBudgetBRL / 7) * 100)
  );

  const adSetRes = await metaPost(`/${acct}/adsets`, token, {
    name:           `AdSet — ${config.storeName}`,
    campaign_id:    campaignId,
    billing_event:  "IMPRESSIONS",
    optimization_goal: "LANDING_PAGE_VIEWS",
    daily_budget:   dailyBudgetCents,
    // Data de término: mais uma trava. Se ninguém mexer, a veiculação acaba
    // sozinha em vez de gastar indefinidamente.
    end_time:       new Date(Date.now() + semanas * 7 * 24 * 60 * 60 * 1000).toISOString(),
    status:         "PAUSED",
    targeting: {
      geo_locations: {
        custom_locations: [{
          latitude:  config.lat,
          longitude: config.lng,
          radius:    config.radiusKm,
          distance_unit: "kilometer",
        }],
      },
      age_min: 18,
      age_max: 65,
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed", "story"],
      instagram_positions: ["stream", "story"],
    },
  });
  const adSetId = adSetRes.id;

  // 3. Upload da imagem para o criativo
  //
  // A Meta BAIXA a imagem da URL — "/uploads/..." relativa não existe para
  // ela. E anúncio de comida sem foto não é anúncio: se o upload falhar, a
  // criação PARA aqui com mensagem, em vez de publicar um criativo em branco
  // e cobrar gestão dele (era o que o catch silencioso de antes fazia).
  const imagemAbsoluta = /^https?:\/\//i.test(config.adImageUrl)
    ? config.adImageUrl
    : `${urlDoSite()}${config.adImageUrl.startsWith("/") ? "" : "/"}${config.adImageUrl}`;

  let imageHash = "";
  try {
    const imgRes = await metaPost(`/${acct}/adimages`, token, {
      url: imagemAbsoluta,
    });
    imageHash = Object.values(imgRes.images as Record<string, any>)[0]?.hash ?? "";
  } catch (e: any) {
    throw new Error(
      `A Meta não aceitou a imagem do anúncio (${e?.message ?? "falha no upload"}). ` +
      `Envie outra imagem e tente de novo.`
    );
  }
  if (!imageHash) {
    throw new Error("A Meta não devolveu a imagem do anúncio. Envie outra imagem e tente de novo.");
  }

  // 4. Criativo
  const creativeRes = await metaPost(`/${acct}/adcreatives`, token, {
    name: `Creative — ${config.storeName}`,
    object_story_spec: {
      page_id: config.pageId,
      link_data: {
        link:       `${urlDoSite()}/loja/${config.storeSlug}`,
        message:    config.adCopy,
        // A linha curta do CTA. O lojista editava na tela e o texto morria lá.
        ...(config.adDescription ? { description: config.adDescription } : {}),
        image_hash: imageHash,
        call_to_action: {
          type: "ORDER_NOW",
          value: { link: `${urlDoSite()}/loja/${config.storeSlug}` },
        },
      },
    },
  });
  const creativeId = creativeRes.id;

  // 5. Anúncio
  const adRes = await metaPost(`/${acct}/ads`, token, {
    name:       `Ad — ${config.storeName}`,
    adset_id:   adSetId,
    creative:   { creative_id: creativeId },
    // Pausado como a campanha e o conjunto: nada entra no ar sem o lojista
    // mandar. Quem liga é setCampaignStatus, depois da aprovação dele.
    status:     "PAUSED",
  });

  return {
    metaCampaignId:   campaignId,
    metaAdSetId:      adSetId,
    metaAdCreativeId: creativeId,
    metaAdId:         adRes.id,
  };
}

/**
 * Busca métricas de uma campanha
 */
export async function getCampaignInsights(campaignId: string, accessToken: string) {
  // action_values traz o VALOR das conversões do Pixel — é de onde sai a
  // receita atribuída. Sem ele, `revenue` ficava 0 para sempre e o lojista
  // nunca via retorno nenhum, mesmo vendendo pelos anúncios.
  //
  // date_preset=maximum: o campo é documentado como acumulado da campanha, e
  // com last_30d o gasto exibido REGREDIA depois de 30 dias de veiculação.
  const url = `${META_BASE}/${campaignId}/insights?fields=spend,impressions,clicks,actions,action_values&date_preset=maximum&access_token=${accessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);
  const data = await res.json();
  const insight = data.data?.[0] ?? {};

  const orders = (insight.actions as any[])?.find(
    (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
  )?.value ?? 0;

  const revenue = (insight.action_values as any[])?.find(
    (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
  )?.value ?? 0;

  return {
    spend:       parseFloat(insight.spend ?? "0"),
    impressions: parseInt(insight.impressions ?? "0"),
    clicks:      parseInt(insight.clicks ?? "0"),
    orders:      parseInt(orders),
    revenue:     parseFloat(revenue) || 0,
  };
}

/**
 * O que a Meta diz sobre a campanha AGORA (effective_status).
 *
 * É a fonte da verdade para a cobrança: campanha pausada no Ads Manager ou
 * encerrada pelo end_time continua "ACTIVE" no nosso banco — e sem esta
 * consulta a gestão de R$ 50/semana seguiria sendo cobrada para sempre por
 * uma campanha que não veicula.
 */
export async function statusEfetivoDaCampanha(
  campaignId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${META_BASE}/${campaignId}?fields=effective_status&access_token=${accessToken}`
    );
    if (!res.ok) return null;
    const dados = await res.json();
    return dados?.effective_status ?? null;
  } catch {
    return null;
  }
}

/**
 * Recalcula o teto de gasto da campanha quando o orçamento semanal muda.
 * Sem isto, subir o orçamento não subia o spend_cap — a campanha batia no
 * teto calculado com o valor antigo e parava de veicular sem aviso.
 */
export async function atualizarTetoDaCampanha(
  campaignId: string,
  accessToken: string,
  weeklyBudgetBRL: number,
  semanas: number = 4
) {
  const teto = Math.round(weeklyBudgetBRL * Math.max(1, Math.min(semanas, 52)) * 100);
  return metaPost(`/${campaignId}`, accessToken, { spend_cap: teto });
}

/**
 * Altera o orçamento diário do conjunto de anúncios NA META.
 *
 * A rota de update_budget só gravava no nosso banco e respondia "orçamento
 * atualizado ✅". A Meta nunca era avisada: o lojista baixava de R$ 500 para
 * R$ 100, via a confirmação, e continuava sendo cobrado R$ 500 — dinheiro dele
 * saindo por causa de uma tela que mentia.
 *
 * O orçamento mora no ad set, não na campanha. Por isso recebe o adSetId.
 */
export async function atualizarOrcamentoDoAdSet(
  adSetId: string,
  accessToken: string,
  weeklyBudgetBRL: number
) {
  const MINIMO_DIARIO_CENTAVOS = 600;
  const diarioCentavos = Math.max(
    MINIMO_DIARIO_CENTAVOS,
    Math.round((weeklyBudgetBRL / 7) * 100)
  );
  return metaPost(`/${adSetId}`, accessToken, { daily_budget: diarioCentavos });
}

/**
 * Pausa ou retoma uma campanha
 */
export async function setCampaignStatus(
  campaignId: string, accessToken: string, status: "ACTIVE" | "PAUSED"
) {
  return metaPost(`/${campaignId}`, accessToken, { status });
}

/**
 * Liga a entrega DE VERDADE: anúncio, conjunto e campanha.
 *
 * A Meta só veicula quando os TRÊS níveis estão ativos — e a criação nasce com
 * os três pausados, de propósito. O bug que este helper corrige: o "retomar"
 * ativava só a campanha, o conjunto e o anúncio continuavam PAUSED, e nada
 * nunca entrava no ar — enquanto a gestão de R$ 50/semana era cobrada.
 *
 * Filhos primeiro: com a campanha ainda pausada, nada veicula até a última
 * chamada. Se qualquer uma falhar, a campanha não liga — e quem chamou não
 * deve cobrar nem dizer que ligou.
 */
export async function ativarCampanhaCompleta(
  ids: { metaCampaignId: string; metaAdSetId?: string | null; metaAdId?: string | null },
  accessToken: string
) {
  if (ids.metaAdId) await metaPost(`/${ids.metaAdId}`, accessToken, { status: "ACTIVE" });
  if (ids.metaAdSetId) await metaPost(`/${ids.metaAdSetId}`, accessToken, { status: "ACTIVE" });
  await metaPost(`/${ids.metaCampaignId}`, accessToken, { status: "ACTIVE" });
}

/**
 * Gera URL de autorização OAuth para o franqueado conectar seu Facebook
 */
/**
 * Origem canônica do callback.
 *
 * A Meta exige que o redirect_uri do /dialog/oauth seja IDÊNTICO ao da troca
 * de código — byte a byte. Havia três grafias diferentes no projeto (a tela
 * usava `https://www.firehubfood.com.br` fixo, as funções usavam NEXTAUTH_URL,
 * e o callback caía em `https://firehubfood.com.br` sem www). Divergindo,
 * a troca falha sempre com token_exchange_failed. Agora sai tudo daqui.
 */
/** Origem do site, sem barra no fim. */
export function urlDoSite(): string {
  return (process.env.NEXTAUTH_URL || "https://firehubfood.com.br").trim().replace(/\/$/, "");
}

export function urlDoCallbackMeta(): string {
  return `${urlDoSite()}/api/meta-ads/callback`;
}

export function getMetaOAuthUrl(franchiseeId: string, investment?: number): string {
  const appId = segredoObrigatorio("META_APP_ID");
  const redirect = encodeURIComponent(urlDoCallbackMeta());
  const scopes = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_read_engagement",
    "pages_show_list",
  ].join(",");
  const state = criarState(franchiseeId, investment);

  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scopes}&state=${state}&response_type=code`;
}

/**
 * Troca o code OAuth por um Access Token de longa duração
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId     = segredoObrigatorio("META_APP_ID");
  const appSecret = segredoObrigatorio("META_APP_SECRET");
  const redirect  = urlDoCallbackMeta();

  // Short-lived token
  const shortRes = await fetch(
    `${META_BASE}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirect)}&client_secret=${appSecret}&code=${code}`
  );
  const { access_token: shortToken } = await shortRes.json();

  // Long-lived token (60 dias)
  const longRes = await fetch(
    `${META_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
  );
  const { access_token: longToken } = await longRes.json();
  return longToken;
}

/**
 * Lista contas de anúncio e páginas disponíveis para o token
 */
export async function getMetaAccounts(accessToken: string) {
  const [acctRes, pagesRes] = await Promise.all([
    // `funding_source_details` e `account_status` dizem se a conta consegue
    // veicular. Sem isso o lojista monta a campanha inteira e só descobre o
    // problema quando aperta publicar — ou pior, acha que está no ar e não está.
    fetch(`${META_BASE}/me/adaccounts?fields=id,name,account_status,currency,funding_source,funding_source_details,disable_reason&access_token=${accessToken}`),
    fetch(`${META_BASE}/me/accounts?fields=id,name,category&access_token=${accessToken}`),
  ]);
  const accounts = (await acctRes.json()).data ?? [];
  const pages    = (await pagesRes.json()).data ?? [];
  return { accounts, pages };
}

/**
 * Escolhe a MELHOR conta de anúncios entre as que o lojista tem.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 * A conexão gravava `accounts[0]` — a primeira que a Meta devolvesse, sem
 * olhar o `account_status` que a própria `getMetaAccounts` faz questão de
 * pedir. Quem já anunciou antes quase sempre tem mais de uma conta: a velha,
 * fechada, e a que usa hoje.
 *
 * Medido na conta do dono em 28/08/2026: o módulo fisgou uma conta com status
 * 101 (encerrada) e parou tudo com "sua conta de anúncios está desativada" —
 * enquanto a conta boa, com R$ 865 de histórico de veiculação, estava ali do
 * lado na mesma lista. O lojista não tem como adivinhar isso; para ele o
 * módulo simplesmente não funciona.
 *
 * Ordem de preferência: quem veicula agora > quem está em análise/carência
 * (volta sozinha) > o resto. Empate desempata por ter forma de pagamento.
 * Conta encerrada (100/101) só é escolhida se não houver absolutamente mais
 * nada — aí a mensagem de conta desativada é verdadeira.
 */
const RANK_STATUS_CONTA: Record<number, number> = {
  1: 0,    // ACTIVE — veicula agora
  8: 1,    // PENDING_SETTLEMENT
  9: 1,    // IN_GRACE_PERIOD
  7: 2,    // PENDING_RISK_REVIEW
  3: 3,    // UNSETTLED
  2: 4,    // DISABLED
  100: 5,  // PENDING_CLOSURE
  101: 6,  // CLOSED
};

export function escolherMelhorContaDeAnuncios(contas: any[]): any | null {
  const lista = Array.isArray(contas) ? contas.filter((c) => c?.id) : [];
  if (lista.length === 0) return null;

  const nota = (c: any) => {
    const status = Number(c?.account_status);
    const posicao = RANK_STATUS_CONTA[status] ?? 4;
    const temPagamento = Boolean(c?.funding_source) || Boolean(c?.funding_source_details?.id);
    // O status manda; a forma de pagamento só desempata dentro do mesmo status.
    return posicao * 2 + (temPagamento ? 0 : 1);
  };

  return [...lista].sort((a, b) => nota(a) - nota(b))[0];
}

export type ProntidaoDaConta = {
  pronta: boolean;
  motivo?: "sem_forma_de_pagamento" | "conta_desativada" | "conta_nao_encontrada" | "erro";
  detalhe?: string;
  moeda?: string;
};

/**
 * A conta consegue veicular anúncio AGORA?
 *
 * Verificado na conta real do dono em 23/08/2026: fundos R$ 0,00 e nenhuma
 * forma de pagamento cadastrada. A tela do Meta avisa que "se não houver saldo
 * disponível, os anúncios serão pausados" — ou seja, a campanha nasce e não
 * roda. Melhor dizer isso ANTES de o lojista montar o criativo.
 *
 * Importante: adicionar cartão ou fundos NÃO é possível pela API — a Meta só
 * oferece isso na interface do Ads Manager. Por isso aqui apenas se detecta o
 * estado, e a tela manda o lojista ao link certo, uma única vez.
 */
export async function verificarProntidaoDaConta(
  adAccountId: string,
  accessToken: string
): Promise<ProntidaoDaConta> {
  try {
    const campos = "account_status,disable_reason,funding_source,funding_source_details,currency";
    const res = await fetch(`${META_BASE}/${adAccountId}?fields=${campos}&access_token=${accessToken}`);
    if (!res.ok) {
      return { pronta: false, motivo: "conta_nao_encontrada", detalhe: `HTTP ${res.status}` };
    }
    const c = await res.json();

    // account_status: 1 = ativa. Qualquer outro valor não veicula.
    if (Number(c.account_status) !== 1) {
      return {
        pronta: false,
        motivo: "conta_desativada",
        detalhe: `status ${c.account_status}${c.disable_reason ? ` (motivo ${c.disable_reason})` : ""}`,
        moeda: c.currency,
      };
    }

    const temFonte = Boolean(c.funding_source) || Boolean(c.funding_source_details?.id);
    if (!temFonte) {
      return { pronta: false, motivo: "sem_forma_de_pagamento", moeda: c.currency };
    }

    return { pronta: true, moeda: c.currency };
  } catch (e: any) {
    return { pronta: false, motivo: "erro", detalhe: String(e?.message).slice(0, 120) };
  }
}

/**
 * Descobre o Pixel da conta de anúncios do lojista.
 *
 * Sem pixel não existe medição: a Meta não sabe quais cliques viraram pedido,
 * o lojista vê ROAS zero e — pior — a campanha não consegue otimizar para quem
 * costuma comprar, que é o que faz o anúncio dar retorno.
 *
 * Pedir para o lojista achar e colar o ID do pixel é atrito que a maioria não
 * vence. Como a conexão já dá acesso à conta, o pixel é descoberto sozinho.
 * Se houver mais de um, fica o primeiro — e a tela permite trocar depois.
 */
export async function descobrirPixelDaConta(
  adAccountId: string,
  accessToken: string
): Promise<{ id: string; nome: string } | null> {
  try {
    const res = await fetch(
      `${META_BASE}/${adAccountId}/adspixels?fields=id,name&limit=10&access_token=${accessToken}`
    );
    if (!res.ok) return null;
    const lista = (await res.json())?.data ?? [];
    const primeiro = lista[0];
    return primeiro?.id ? { id: String(primeiro.id), nome: primeiro.name ?? "" } : null;
  } catch {
    return null;
  }
}

export type CarteiraDaConta = {
  moeda: string;
  /** Pré-pago: crédito disponível. Pós-pago (cartão): null — não existe saldo. */
  saldoDisponivel: number | null;
  /** Fatura em aberto que a Meta ainda vai cobrar (pós-pago). */
  aFaturar: number | null;
  /** Total já gasto pela conta, histórico. */
  totalGasto: number;
  /** Teto de gasto da conta, se o lojista definiu um. */
  tetoDaConta: number | null;
  /** Limite diário que a própria Meta impõe a contas novas. */
  limiteDiarioDaMeta: number | null;
  /** true = cartão (cobrança automática). false = saldo pré-pago. */
  cobrancaAutomatica: boolean;
  formaDePagamento: string | null;
};

/**
 * Lê a "carteira" da conta de anúncios para exibir dentro do FireHub.
 *
 * Sobre RECARREGAR: não é possível por API — a Meta só permite adicionar
 * cartão ou fundos na interface do Ads Manager. O que dá para fazer, e é o que
 * se faz aqui, é MOSTRAR o estado e mandar o lojista ao lugar certo.
 *
 * A saída boa para o lojista é o cartão (pós-pago): a Meta cobra sozinha e ele
 * nunca mais precisa recarregar. No pré-pago ele tem que voltar lá sempre que
 * o saldo acaba — e, sem saldo, os anúncios param.
 *
 * Todos os valores da Meta vêm em CENTAVOS da moeda da conta.
 */
export async function lerCarteiraDaConta(
  adAccountId: string,
  accessToken: string
): Promise<CarteiraDaConta | null> {
  const campos = [
    "currency", "balance", "amount_spent", "spend_cap",
    "funding_source", "funding_source_details", "adtrust_dsl",
  ].join(",");

  try {
    const res = await fetch(`${META_BASE}/${adAccountId}?fields=${campos}&access_token=${accessToken}`);
    if (!res.ok) return null;
    const c = await res.json();

    const emReais = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n / 100 : null;
    };

    const detalhes = c.funding_source_details || {};
    const tipo = String(detalhes.type ?? "").toUpperCase();

    // A Meta não expõe um campo único e estável de "saldo pré-pago". O que
    // existe de forma consistente é `balance`, que no pré-pago se comporta como
    // crédito disponível e no pós-pago como fatura em aberto. Por isso o valor
    // é interpretado conforme o tipo de cobrança, em vez de chutar um só.
    const ehPrePago = tipo.includes("PREPAID") || tipo.includes("STORED");
    const saldo = emReais(c.balance);

    return {
      moeda: c.currency ?? "BRL",
      saldoDisponivel: ehPrePago ? saldo : null,
      aFaturar: ehPrePago ? null : saldo,
      totalGasto: emReais(c.amount_spent) ?? 0,
      tetoDaConta: c.spend_cap ? emReais(c.spend_cap) : null,
      limiteDiarioDaMeta: c.adtrust_dsl ? emReais(c.adtrust_dsl) : null,
      cobrancaAutomatica: !ehPrePago && Boolean(c.funding_source || detalhes.id),
      formaDePagamento: detalhes.display_string ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Renova o token de longa duração do lojista.
 *
 * O token do Facebook vale ~60 dias. Não havia nenhuma renovação: passados os
 * 60 dias a campanha simplesmente parava de ser sincronizada e o lojista
 * continuava pagando R$ 50/semana sem ninguém notar — nem ele, nem nós. É a
 * pior categoria de falha: silenciosa e cobrada.
 *
 * A Meta permite trocar um token de longa duração ainda válido por outro,
 * renovando o prazo. Só funciona ANTES de expirar — por isso o cron renova com
 * folga, não no dia do vencimento.
 */
export async function renovarTokenDoLojista(tokenAtual: string): Promise<string | null> {
  try {
    const appId = segredoObrigatorio("META_APP_ID");
    const appSecret = segredoObrigatorio("META_APP_SECRET");
    const res = await fetch(
      `${META_BASE}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenAtual}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.access_token ?? null;
  } catch {
    return null;
  }
}

/** O token ainda é válido? Usado para avisar o lojista antes de quebrar. */
export async function tokenAindaVale(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${META_BASE}/me?fields=id&access_token=${token}`);
    if (res.ok) return true;
    // Só declara o token MORTO quando a Meta diz isso com todas as letras
    // (OAuthException, código 190). A versão antiga devolvia false para
    // QUALQUER falha — um 429 ou uma instabilidade da Meta desligava o módulo
    // de todas as lojas de uma vez, exigindo reconexão manual de cada uma.
    if (res.status === 400 || res.status === 401) {
      const dados: any = await res.json().catch(() => ({}));
      const codigo = dados?.error?.code;
      const tipo = dados?.error?.type;
      return !(codigo === 190 || tipo === "OAuthException");
    }
    // 429/5xx/resposta estranha: indisponibilidade, não invalidez. Mantém.
    return true;
  } catch {
    // Falha de rede NOSSA não é prova contra o token do lojista.
    return true;
  }
}

/** Link direto para o lojista ADICIONAR FUNDOS / trocar a forma de pagamento. */
export function linkDeRecargaDoMeta(adAccountId: string): string {
  const semPrefixo = adAccountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/billing_hub/payment_settings?act=${semPrefixo}`;
}

/** Link direto para o lojista cadastrar a forma de pagamento no Meta. */
export function linkDeCobrancaDoMeta(adAccountId: string): string {
  const semPrefixo = adAccountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/accounts?act=${semPrefixo}&nav_entry_point=billing`;
}

// --------------- helpers ---------------
async function metaPost(path: string, token: string, body: object) {
  const res = await fetch(`${META_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Meta API error (${path}): ${JSON.stringify(data.error ?? data)}`);
  }
  return data;
}
