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

const META_API_VERSION = "v20.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export type MetaCampaignConfig = {
  adAccountId: string;    // act_XXXXX
  accessToken: string;    // Token OAuth do franqueado
  storeName: string;
  storeSlug: string;
  storeAddress: string;
  lat: number;
  lng: number;
  radiusKm: number;
  weeklyBudgetBRL: number;   // Em reais — convertemos para centavos de USD (aprox)
  adCopy: string;
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

  // 1. Campanha
  const campaignRes = await metaPost(`/${acct}/campaigns`, token, {
    name:          `FireHub — ${config.storeName} — Delivery`,
    objective:     "LINK_CLICKS",
    status:        "ACTIVE",
    special_ad_categories: [],
  });
  const campaignId = campaignRes.id;

  // 2. Conjunto de anúncios (audiência + orçamento + localização)
  // Converte R$/semana → centavos por dia (aprox R$1 = US$0.20 → *100 centavos / 7 dias)
  const dailyBudgetCents = Math.round((config.weeklyBudgetBRL / 7) * 100);

  const adSetRes = await metaPost(`/${acct}/adsets`, token, {
    name:           `AdSet — ${config.storeName}`,
    campaign_id:    campaignId,
    billing_event:  "LINK_CLICKS",
    optimization_goal: "LINK_CLICKS",
    daily_budget:   dailyBudgetCents,
    status:         "ACTIVE",
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
  let imageHash = "";
  try {
    const imgRes = await metaPost(`/${acct}/adimages`, token, {
      url: config.adImageUrl,
    });
    imageHash = Object.values(imgRes.images as Record<string, any>)[0]?.hash ?? "";
  } catch {
    console.warn("[MetaAds] Falha no upload da imagem, usando hash vazio");
  }

  // 4. Criativo
  const creativeRes = await metaPost(`/${acct}/adcreatives`, token, {
    name: `Creative — ${config.storeName}`,
    object_story_spec: {
      page_id: config.pageId,
      link_data: {
        link:       `https://www.firehubfood.com.br/loja/${config.storeSlug}`,
        message:    config.adCopy,
        image_hash: imageHash || undefined,
        call_to_action: {
          type: "ORDER_NOW",
          value: { link: `https://www.firehubfood.com.br/loja/${config.storeSlug}` },
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
    status:     "ACTIVE",
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
  const url = `${META_BASE}/${campaignId}/insights?fields=spend,impressions,clicks,actions&date_preset=last_30d&access_token=${accessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`);
  const data = await res.json();
  const insight = data.data?.[0] ?? {};

  const orders = (insight.actions as any[])?.find(
    (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
  )?.value ?? 0;

  return {
    spend:       parseFloat(insight.spend ?? "0"),
    impressions: parseInt(insight.impressions ?? "0"),
    clicks:      parseInt(insight.clicks ?? "0"),
    orders:      parseInt(orders),
  };
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
 * Gera URL de autorização OAuth para o franqueado conectar seu Facebook
 */
export function getMetaOAuthUrl(franchiseeId: string): string {
  const appId = process.env.META_APP_ID || "4084810071817607";
  const redirect = encodeURIComponent(
    `${process.env.NEXTAUTH_URL ?? "https://www.firehubfood.com.br"}/api/meta-ads/callback`
  );
  const scopes = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_read_engagement",
    "pages_show_list",
  ].join(",");
  const state = Buffer.from(JSON.stringify({ franchiseeId })).toString("base64");

  return `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scopes}&state=${state}&response_type=code`;
}

/**
 * Troca o code OAuth por um Access Token de longa duração
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId     = process.env.META_APP_ID || "4084810071817607";
  const appSecret = process.env.META_APP_SECRET || "310b254fc74098ebf4a36f2bc9f3b83a";
  const redirect  = `${process.env.NEXTAUTH_URL ?? "https://www.firehubfood.com.br"}/api/meta-ads/callback`;

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
    fetch(`${META_BASE}/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`),
    fetch(`${META_BASE}/me/accounts?fields=id,name,category&access_token=${accessToken}`),
  ]);
  const accounts = (await acctRes.json()).data ?? [];
  const pages    = (await pagesRes.json()).data ?? [];
  return { accounts, pages };
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
