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

// ── VERSÃO DA API: são DOIS relógios, não um ────────────────────────────────
// O erro anterior (v23.0) veio de olhar a tabela errada. O MESMO número de
// versão tem dois prazos: na Graph API a v23.0 vale até 08/10/2027, mas na
// MARKETING API ela foi desligada em 09/06/2026 — ou seja, o módulo inteiro
// (criar campanha, ler métrica, pausar, mudar orçamento) estava apontando para
// uma versão morta. Conferido em 28/08/2026 na tabela oficial da Marketing API:
// só v24.0 (morre em 06/10/2026), v25.0 e v26.0 seguem vivas.
//
// Alvo: v25.0. Não v24.0 (vence em cinco semanas) e não v26.0 (saiu em
// 29/07/2026 e chegou cortando endpoints; um mês de estrada é pouco para um
// módulo que cobra do lojista). A v25.0 é a que a própria Meta recomenda como
// destino de migração e não muda nada do que se usa aqui: campanha
// OUTCOME_TRAFFIC + ad set + criativo + anúncio (as quebras da v25 foram em
// Advantage+ Shopping/App, que este módulo não cria).
const META_API_VERSION = "v25.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// O diálogo de OAuth roda em www.facebook.com e segue o relógio da GRAPH API,
// não o da Marketing. Fica numa constante própria justamente para as duas não
// voltarem a divergir em silêncio quando uma delas vencer antes da outra.
const META_OAUTH_VERSION = "v25.0";

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
  adHeadline?: string;    // Título em negrito do anúncio. Ver LIMITES_DE_TEXTO.
  adDescription?: string; // Linha curta junto do botão (CTA) do anúncio
  adImageUrl: string;
  pageId: string;         // Página do Facebook do restaurante
};

// Tamanhos que a Meta REALMENTE mostra no feed. Não havia limite nenhum: o
// lojista escrevia 300 caracteres de descrição, a tela aceitava calada e o
// anúncio saía cortado no meio da frase — ele nunca via o que publicou.
const LIMITES_DE_TEXTO = { titulo: 40, descricao: 30, texto: 500 } as const;

function cortar(texto: string, limite: number): string {
  const limpo = (texto ?? "").trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`;
}

/**
 * Cria uma campanha completa: Campaign → AdSet → Creative → Ad
 * Retorna os IDs criados para salvar no banco
 */
export async function createMetaCampaign(config: MetaCampaignConfig) {
  const token = config.accessToken;
  const acct  = config.adAccountId;

  // ── Pré-condições, ANTES de criar qualquer coisa na conta do lojista ──────
  // Sem Página do Facebook o passo do criativo é recusado de forma
  // determinística — só que isso acontecia DEPOIS de campanha e conjunto já
  // existirem, e o lojista recebia o JSON cru da Meta na tela sem entender
  // nada. Falhar aqui custa uma frase em português e zero lixo na conta dele.
  if (!config.pageId || !String(config.pageId).trim()) {
    throw new Error(
      "Não encontrei a Página do Facebook do seu restaurante. O anúncio precisa ser " +
      "publicado por uma Página. Crie ou libere a Página no Facebook e conecte de novo."
    );
  }

  const site = urlDoSite();
  const linkDaLoja = `${site}/loja/${config.storeSlug}`;
  // Se a origem do site vier quebrada (ver urlDoSite), o anúncio iria ao ar
  // apontando para lugar nenhum e o lojista pagaria por cliques que não chegam
  // no cardápio. Melhor não nascer.
  if (!/^https?:\/\/[^\s"]+$/i.test(linkDaLoja)) {
    throw new Error(
      "O endereço do site do FireHub está mal configurado no servidor (NEXTAUTH_URL). " +
      "O anúncio não foi criado porque o link do cardápio sairia quebrado."
    );
  }

  // Teto de gasto da campanha, em centavos. É a trava dura: mesmo que algo
  // dispare o orçamento diário, a Meta para de veicular ao atingir este valor.
  // Sem isto não havia NENHUM limite superior no sistema.
  const semanas = Math.max(1, Math.min(Number(config.semanasDeVeiculacao) || 4, 52));
  const tetoCentavos = Math.round(config.weeklyBudgetBRL * semanas * 100);

  // ── 1. Imagem PRIMEIRO ────────────────────────────────────────────────────
  // A ordem era campanha → conjunto → imagem, e o (correto) "anúncio de comida
  // sem foto não vai ao ar" derrubava a criação com dois objetos já pendurados
  // na conta do lojista. Cada nova tentativa deixava mais um par órfão,
  // invisível para o FireHub. Um adimage não custa nada nem cria objeto de
  // veiculação: subindo a foto antes, imagem ruim falha sem sujar nada.
  //
  // A Meta BAIXA a imagem da URL — "/uploads/..." relativa não existe para ela.
  const imagemAbsoluta = /^https?:\/\//i.test(config.adImageUrl)
    ? config.adImageUrl
    : `${site}${config.adImageUrl.startsWith("/") ? "" : "/"}${config.adImageUrl}`;

  let imageHash = "";
  try {
    const imgRes = await metaPost(`/${acct}/adimages`, token, { url: imagemAbsoluta });
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

  // Daqui para baixo já existem objetos na conta do lojista. Qualquer falha
  // apaga o que foi criado antes de propagar o erro — apagar a campanha leva
  // junto conjunto, criativo e anúncio.
  let campaignId = "";
  try {
    // 2. Campanha
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
    campaignId = campaignRes.id;

    // 3. Conjunto de anúncios (audiência + orçamento + localização)
    //
    // O comentário anterior dizia "aprox R$1 = US$0.20" e não convertia nada — o
    // que estava certo por acidente: a Meta cobra na MOEDA DA CONTA, e a conta é
    // em BRL. `daily_budget` é simplesmente o valor em centavos de real.
    //
    // A Meta tem mínimo diário por conjunto; abaixo dele a criação é recusada.
    // R$ 6/dia (≈ R$ 42/semana) é uma margem segura para BRL.
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
      //
      // ATENÇÃO a quem mexer aqui: este prazo mora no AD SET, e é ele que
      // encerra a entrega. Quem decide se ainda há veiculação (e portanto se
      // ainda se pode cobrar a gestão) é statusEfetivoDaCampanha — que precisa
      // ler este end_time, porque a CAMPANHA continua "ACTIVE" para sempre.
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

    // 4. Criativo
    //
    // `name` é o TÍTULO em negrito do anúncio. Não era enviado: a Meta então
    // preenchia aquele espaço — o pedaço de texto mais visível do anúncio — com
    // o que achasse na página de destino, que são as tags do FireHub. Ou seja,
    // o lojista pagava a mídia dele e a manchete anunciava o FireHub.
    const titulo = cortar(config.adHeadline || `Peça agora — ${config.storeName}`, LIMITES_DE_TEXTO.titulo);
    const descricao = config.adDescription ? cortar(config.adDescription, LIMITES_DE_TEXTO.descricao) : "";

    const creativeRes = await metaPost(`/${acct}/adcreatives`, token, {
      name: `Creative — ${config.storeName}`,
      object_story_spec: {
        page_id: config.pageId,
        link_data: {
          link:       linkDaLoja,
          message:    cortar(config.adCopy, LIMITES_DE_TEXTO.texto),
          name:       titulo,
          // A linha curta do CTA. O lojista editava na tela e o texto morria lá.
          ...(descricao ? { description: descricao } : {}),
          image_hash: imageHash,
          call_to_action: {
            type: "ORDER_NOW",
            value: { link: linkDaLoja },
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
  } catch (e) {
    // Sem isto, cada tentativa falha deixava campanha + conjunto pendurados na
    // conta do lojista, invisíveis para o FireHub (o registro no banco só nasce
    // depois). Apagar é melhor-esforço: se a limpeza falhar, o erro original é
    // o que interessa para o lojista.
    if (campaignId) await apagarObjetoNaMeta(campaignId, token);
    throw e;
  }
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
  //
  // inline_link_clicks: `clicks` sozinho é o "Cliques (todos)" da Meta — conta
  // curtida, comentário, compartilhamento, expandir a foto e "ver mais". O que
  // o lojista contratou (e para o que o conjunto é otimizado) é visita ao
  // cardápio, que é `inline_link_clicks`. A diferença é de 1,5x a 3x: ele lia
  // "300 cliques, 4 pedidos", achava o anúncio péssimo e desligava algo que
  // estava funcionando.
  const campos = "spend,impressions,clicks,inline_link_clicks,actions,action_values";
  const r = await metaFetch(
    `${META_BASE}/${campaignId}/insights?fields=${campos}&date_preset=maximum&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!r.ok) throw new Error(`Meta API error (insights ${campaignId}): ${mensagemDoErro(r)}`);
  const insight = r.json?.data?.[0] ?? {};

  const orders = (insight.actions as any[])?.find(
    (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
  )?.value ?? 0;

  const revenue = (insight.action_values as any[])?.find(
    (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
  )?.value ?? 0;

  // A Meta omite o campo quando não houve NENHUM clique no link — e nesse caso
  // o número honesto é zero mesmo. Cair de volta em `clicks` aqui seria repetir
  // justamente o erro: mostrar engajamento como se fosse visita ao cardápio.
  const cliquesTodos = parseInt(insight.clicks ?? "0") || 0;
  const cliquesNoLink = parseInt(insight.inline_link_clicks ?? "0") || 0;

  return {
    spend:       parseFloat(insight.spend ?? "0"),
    impressions: parseInt(insight.impressions ?? "0"),
    clicks:      cliquesNoLink,
    cliquesTodos,
    orders:      parseInt(orders),
    revenue:     parseFloat(revenue) || 0,
  };
}

/**
 * A campanha ainda ENTREGA alguma coisa AGORA?
 *
 * É a fonte da verdade para a cobrança: sem esta consulta a gestão de
 * R$ 50/semana seguiria sendo cobrada para sempre por uma campanha que não
 * veicula mais.
 *
 * ── O defeito que isto corrige ───────────────────────────────────────────────
 * A versão anterior lia só o `effective_status` da CAMPANHA. Só que o prazo de
 * veiculação (end_time) mora no AD SET, e a campanha NÃO herda o fim do filho:
 * o enum dela (ACTIVE, PAUSED, DELETED, ARCHIVED, IN_PROCESS, WITH_ISSUES) não
 * tem nenhum estado que signifique "acabou". Resultado: no dia 29 a entrega era
 * zero, a campanha continuava respondendo ACTIVE, o cron não via nada de
 * errado e seguia lançando R$ 50 por semana, para sempre — cobrança por serviço
 * que não é entregue, que é exatamente o que esta função existe para impedir.
 *
 * Agora olha os três motivos reais de parada: campanha desligada, teto de gasto
 * atingido e prazo do ad set vencido. "COMPLETED" é o valor que o cron já
 * traduz para ENDED — nunca chegava por não ser produzido pela campanha.
 */
export async function statusEfetivoDaCampanha(
  campaignId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const campanha = await metaFetch(
      `${META_BASE}/${campaignId}?fields=effective_status,spend_cap&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!campanha.ok) return null;

    const status: string | null = campanha.json?.effective_status ?? null;
    // Desligada/arquivada/apagada: quem chamou já trata, e nem vale gastar as
    // outras chamadas.
    if (typeof status === "string" && status !== "ACTIVE") return status;

    // Prazo do ad set. Vale para todos: se NENHUM conjunto está veiculando,
    // a campanha não entrega nada, por mais "ACTIVE" que ela diga estar.
    const conjuntos = await metaFetch(
      `${META_BASE}/${campaignId}/adsets?fields=effective_status,end_time&limit=50&access_token=${encodeURIComponent(accessToken)}`
    );
    const lista: any[] = Array.isArray(conjuntos.json?.data) ? conjuntos.json.data : [];
    if (conjuntos.ok && lista.length > 0) {
      const agora = Date.now();
      const algumEntregando = lista.some((c) => {
        const st = String(c?.effective_status ?? "ACTIVE");
        // O effective_status do ad set também NÃO vira "COMPLETED" quando o
        // prazo passa — quem manda no fim é o end_time. Aqui só se descarta o
        // que está explicitamente desligado.
        if (["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "DELETED", "ARCHIVED"].includes(st)) return false;
        if (!c?.end_time) return true; // conjunto sem prazo: segue veiculando
        const fim = Date.parse(String(c.end_time));
        return !Number.isFinite(fim) || fim > agora;
      });
      if (!algumEntregando) return "COMPLETED";
    }

    // Teto de gasto atingido: a Meta para a entrega e NÃO mexe no status — a
    // campanha segue dizendo ACTIVE com zero impressão. Comparado contra o
    // gasto real (e não contra `budget_remaining`, que numa campanha com
    // orçamento no ad set não significa o que parece).
    const tetoCentavos = Number(campanha.json?.spend_cap);
    if (Number.isFinite(tetoCentavos) && tetoCentavos > 0) {
      const gastoCentavos = Math.round((await gastoAcumuladoBRL(campaignId, accessToken)) * 100);
      if (gastoCentavos >= tetoCentavos) return "COMPLETED";
    }

    return status;
  } catch {
    return null;
  }
}

/**
 * Recalcula o teto de gasto da campanha quando o orçamento semanal muda.
 * Sem isto, subir o orçamento não subia o spend_cap — a campanha batia no
 * teto calculado com o valor antigo e parava de veicular sem aviso.
 *
 * O teto parte do que a campanha JÁ GASTOU. Antes era sempre
 * `semanal × 4` contado do zero, e a Meta recusa spend_cap abaixo do gasto
 * acumulado: numa campanha em andamento, BAIXAR o orçamento passava a falhar
 * sempre (R$ 500 → R$ 100 dá teto de R$ 400, e no 6º dia a campanha já gastou
 * mais que isso). Como a alteração do ad set acontecia antes, a Meta ficava com
 * o valor novo e o painel dizia ao lojista que nada tinha mudado.
 */
export async function atualizarTetoDaCampanha(
  campaignId: string,
  accessToken: string,
  weeklyBudgetBRL: number,
  semanas: number = 4
) {
  const janela = Math.max(1, Math.min(semanas, 52));
  const jaGasto = await gastoAcumuladoBRL(campaignId, accessToken);
  const teto = Math.round((jaGasto + weeklyBudgetBRL * janela) * 100);
  return metaPost(`/${campaignId}`, accessToken, { spend_cap: teto });
}

// A Meta tem mínimo diário por conjunto; abaixo dele a alteração é recusada.
const MINIMO_DIARIO_CENTAVOS = 600;

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
  const diarioCentavos = Math.max(
    MINIMO_DIARIO_CENTAVOS,
    Math.round((weeklyBudgetBRL / 7) * 100)
  );
  return metaPost(`/${adSetId}`, accessToken, { daily_budget: diarioCentavos });
}

/**
 * Muda o orçamento inteiro (teto + diário) em uma operação só.
 *
 * São duas escritas na Meta e não existe transação: feitas na ordem errada e
 * sem desfazer, uma falha no meio deixava o dinheiro do lojista saindo num
 * ritmo que o painel não mostrava, com a tela dizendo "não consegui, tente de
 * novo". Aqui o TETO vai primeiro — mexer só no teto nunca faz gastar mais
 * rápido — e, se o diário falhar depois, o teto volta ao que era.
 */
export async function atualizarOrcamentoCompleto(
  ids: { metaCampaignId?: string | null; metaAdSetId?: string | null },
  accessToken: string,
  weeklyBudgetBRL: number,
  semanas: number = 4
) {
  let tetoAnterior: number | null = null;

  if (ids.metaCampaignId) {
    const atual = await metaFetch(
      `${META_BASE}/${ids.metaCampaignId}?fields=spend_cap&access_token=${encodeURIComponent(accessToken)}`
    );
    const bruto = Number(atual.json?.spend_cap);
    tetoAnterior = atual.ok && Number.isFinite(bruto) ? bruto : null;
    await atualizarTetoDaCampanha(ids.metaCampaignId, accessToken, weeklyBudgetBRL, semanas);
  }

  if (!ids.metaAdSetId) return;

  try {
    await atualizarOrcamentoDoAdSet(ids.metaAdSetId, accessToken, weeklyBudgetBRL);
  } catch (e) {
    if (ids.metaCampaignId && tetoAnterior !== null) {
      // Melhor-esforço: se nem o desfazer funcionar, o erro que sobe é o
      // original — o teto sozinho não gasta dinheiro nenhum.
      await metaPost(`/${ids.metaCampaignId}`, accessToken, { spend_cap: tetoAnterior }).catch(() => {});
    }
    throw e;
  }
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
 * chamada. Se qualquer uma falhar, o que já foi ligado é desligado de volta —
 * ficar meio ligado é o estado em que ninguém sabe se está gastando ou não.
 */
export async function ativarCampanhaCompleta(
  ids: { metaCampaignId: string; metaAdSetId?: string | null; metaAdId?: string | null },
  accessToken: string
) {
  const ligados: string[] = [];
  try {
    if (ids.metaAdId) {
      await metaPost(`/${ids.metaAdId}`, accessToken, { status: "ACTIVE" });
      ligados.push(ids.metaAdId);
    }
    if (ids.metaAdSetId) {
      await metaPost(`/${ids.metaAdSetId}`, accessToken, { status: "ACTIVE" });
      ligados.push(ids.metaAdSetId);
    }
    await metaPost(`/${ids.metaCampaignId}`, accessToken, { status: "ACTIVE" });
  } catch (e) {
    for (const id of ligados) {
      await metaPost(`/${id}`, accessToken, { status: "PAUSED" }).catch(() => {});
    }
    // A Meta recusa ligar um conjunto cujo prazo já venceu, e o erro cru dela
    // chegava ao lojista como "não consegui executar a ação" num botão de
    // Retomar que nunca mais ia funcionar. Dizer o que aconteceu é o que lhe dá
    // uma saída: campanha encerrada não retoma, cria-se outra.
    if (ids.metaAdSetId && (await prazoDoAdSetVenceu(ids.metaAdSetId, accessToken))) {
      throw new Error(
        "O prazo de veiculação desta campanha já terminou no Facebook, por isso ela não pode " +
        "ser retomada. Crie uma nova campanha para voltar a anunciar."
      );
    }
    throw e;
  }
}

/** O ad set já passou da data de término? (só para explicar a falha ao lojista) */
async function prazoDoAdSetVenceu(adSetId: string, accessToken: string): Promise<boolean> {
  const r = await metaFetch(
    `${META_BASE}/${adSetId}?fields=end_time&access_token=${encodeURIComponent(accessToken)}`
  );
  const fim = Date.parse(String(r.json?.end_time ?? ""));
  return r.ok && Number.isFinite(fim) && fim <= Date.now();
}

/**
 * Desliga a entrega nos três níveis.
 *
 * Existe para quem chamou ativarCampanhaCompleta conseguir VOLTAR ATRÁS: se a
 * gravação no banco falhar depois da ativação, a campanha fica viva na Meta
 * gastando o dinheiro do lojista sem nenhum registro no FireHub — invisível no
 * painel e impossível de pausar por lá.
 */
export async function pausarCampanhaCompleta(
  ids: { metaCampaignId: string; metaAdSetId?: string | null; metaAdId?: string | null },
  accessToken: string
) {
  // A campanha primeiro: é o nível que corta a entrega inteira de uma vez.
  await metaPost(`/${ids.metaCampaignId}`, accessToken, { status: "PAUSED" });
  if (ids.metaAdSetId) await metaPost(`/${ids.metaAdSetId}`, accessToken, { status: "PAUSED" }).catch(() => {});
  if (ids.metaAdId) await metaPost(`/${ids.metaAdId}`, accessToken, { status: "PAUSED" }).catch(() => {});
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
/**
 * Origem do site, sem barra no fim.
 *
 * A validação não é firula: neste ambiente (Coolify) o NEXTAUTH_URL já veio
 * mascarado como "[SENSITIVE]" — há três dumps de .env no repositório com esse
 * valor. Sem a guarda, essa string entrava no redirect_uri do OAuth (e o
 * lojista não conseguia nem conectar) e no link de destino do anúncio. Os
 * arquivos vizinhos já se defendiam disso; esta função, que monta as duas
 * coisas, era a única desprotegida.
 */
export function urlDoSite(): string {
  const bruto = (process.env.NEXTAUTH_URL || "").trim();
  const ok = Boolean(bruto) && !bruto.includes("[SENSITIVE]") && bruto.startsWith("http");
  return (ok ? bruto : "https://firehubfood.com.br").replace(/\/$/, "");
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
    // pages_show_list só LISTA a Página e pages_read_engagement só LÊ conteúdo:
    // nenhuma das duas autoriza o app a anunciar em nome da Página, que é o que
    // o criativo faz (object_story_spec.page_id). Sem isto, lojista que
    // administra a Página por Business Manager pode ver o /adcreatives recusado
    // no último passo do assistente. Permissão que a Meta não tiver aprovado
    // para o app é simplesmente ignorada no diálogo — pedir não quebra nada.
    "pages_manage_ads",
  ].join(",");
  const state = criarState(franchiseeId, investment);

  return `https://www.facebook.com/${META_OAUTH_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scopes}&state=${state}&response_type=code`;
}

/**
 * Troca o code OAuth por um Access Token de longa duração
 *
 * As duas respostas eram desestruturadas sem olhar res.ok nem data.error: a
 * Meta responde erro em JSON com HTTP 400, então nada estourava — o token
 * virava undefined, a SEGUNDA chamada era disparada com
 * `fb_exchange_token=undefined`, e toda causa possível (code já usado, secret
 * rotacionado, redirect_uri divergente, rate limit) chegava ao lojista como o
 * mesmo "Erro ao conectar. Tente novamente." sem UM byte de diagnóstico no log.
 * Conectar o Facebook é o portão do módulo inteiro: quebrar aqui sem sinal
 * nenhum é o pior lugar possível para se ficar cego.
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId     = segredoObrigatorio("META_APP_ID");
  const appSecret = segredoObrigatorio("META_APP_SECRET");
  const redirect  = urlDoCallbackMeta();

  // Short-lived token
  const curto = await metaFetch(
    `${META_BASE}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirect)}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
  );
  const shortToken: string = curto.json?.access_token ?? "";
  if (!curto.ok || !shortToken) {
    throw new Error(`Meta recusou a troca do código: ${mensagemDoErro(curto)}`);
  }

  // Long-lived token (60 dias)
  const longo = await metaFetch(
    `${META_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`
  );
  const longToken: string = longo.json?.access_token ?? "";
  if (!longo.ok || !longToken) {
    // O token curto é VÁLIDO e vale ~1h. Jogá-lo fora por causa de um 429 na
    // segunda troca desconectava o lojista sem necessidade. O cron renova
    // depois — é o mesmo grant_type.
    console.warn(`[MetaAds OAuth] token de longa duração falhou (${mensagemDoErro(longo)}); seguindo com o de curta duração.`);
    return shortToken;
  }
  return longToken;
}

/**
 * Lista contas de anúncio e páginas disponíveis para o token
 *
 * Nenhuma das duas respostas era verificada: `(await res.json()).data ?? []`
 * transformava QUALQUER erro (rate limit, instabilidade, permissão desmarcada
 * no diálogo do Facebook) em "zero contas, zero páginas". O callback então
 * gravava metaAdAccountId/metaFbPageId como null POR CIMA de valores que
 * funcionavam e mandava o lojista "criar uma conta de anúncios" que ele já
 * tinha. Falhar alto preserva a configuração boa — e um segundo clique em
 * conectar resolve o caso transitório.
 */
export async function getMetaAccounts(accessToken: string) {
  const [contas, paginas] = await Promise.all([
    // `funding_source_details` e `account_status` dizem se a conta consegue
    // veicular. Sem isso o lojista monta a campanha inteira e só descobre o
    // problema quando aperta publicar — ou pior, acha que está no ar e não está.
    coletarPaginado(
      `${META_BASE}/me/adaccounts?fields=${CAMPOS_DE_CONTA}&limit=100&access_token=${encodeURIComponent(accessToken)}`
    ),
    // limit=100 + paginação: o padrão do Graph é 25 por página e quem acumulou
    // Páginas ao longo dos anos simplesmente não tinha a do restaurante na
    // lista. `tasks` é o que diz se aquela Página aceita anúncio.
    coletarPaginado(
      `${META_BASE}/me/accounts?fields=id,name,category,tasks&limit=100&access_token=${encodeURIComponent(accessToken)}`
    ),
  ]);

  if (contas.erro) throw new Error(`Meta não devolveu as contas de anúncio: ${contas.erro}`);
  if (paginas.erro) throw new Error(`Meta não devolveu as Páginas do Facebook: ${paginas.erro}`);

  return { accounts: contas.dados, pages: paginas.dados };
}

/**
 * Escolhe a Página que vai ASSINAR o anúncio.
 *
 * A escolha era `pages[0]` — a ordem em que a Meta devolveu. Quem tem mais de
 * uma Página (a do restaurante, uma antiga, uma de um amigo) via o anúncio sair
 * pela marca errada, gastando a verba dele para promover outra coisa; ou, se a
 * Página sorteada não pudesse anunciar, recebia o JSON cru da Meta no último
 * passo. Página com a tarefa ADVERTISE vem primeiro; sem informação de tarefas,
 * mantém-se a ordem da Meta.
 */
export function escolherMelhorPagina(paginas: any[]): any | null {
  const lista = Array.isArray(paginas) ? paginas.filter((p) => p?.id) : [];
  if (lista.length === 0) return null;
  const podeAnunciar = (p: any) => {
    const tarefas = Array.isArray(p?.tasks) ? p.tasks.map((t: any) => String(t).toUpperCase()) : [];
    return tarefas.includes("ADVERTISE") || tarefas.includes("MANAGE");
  };
  return lista.find(podeAnunciar) ?? lista[0];
}

const CAMPOS_DE_CONTA =
  "id,name,account_status,currency,funding_source,funding_source_details,disable_reason";

/**
 * TODAS as contas de anúncio que este token alcança — não só as pessoais.
 *
 * ── Por que não basta /me/adaccounts ────────────────────────────────────────
 * Esse endpoint lista as contas em que a PESSOA é usuária direta. Quem
 * organiza o negócio como a Meta manda tem a conta dentro de um Business
 * Manager, e ali ela some dessa lista.
 *
 * Foi o caso do dono em 28/08/2026: `/me/adaccounts` devolvia apenas uma conta
 * encerrada (status 101), enquanto a conta que ele realmente usa — ativa, com
 * histórico de veiculação — pertencia ao business "Fire Delivery" e nunca
 * chegava até aqui. O módulo dizia "sua conta de anúncios está desativada" e
 * não havia nada que o lojista pudesse fazer na tela para sair disso.
 *
 * Agora se varre também cada business: as contas que ele POSSUI
 * (owned_ad_accounts) e as que ele administra para terceiros
 * (client_ad_accounts) — este segundo caso é o de agência, comum em quem
 * contrata alguém para cuidar do marketing.
 *
 * Falha de um caminho não derruba os outros: cada erro é registrado e o que
 * deu certo continua valendo — é melhor achar uma conta do que nenhuma.
 */
export async function listarTodasAsContasDeAnuncio(accessToken: string): Promise<{
  contas: any[];
  porCaminho: Record<string, string>;
  erros: string[];
}> {
  const token = encodeURIComponent(accessToken);
  const contasPorId = new Map<string, any>();
  const porCaminho: Record<string, string> = {};
  const erros: string[] = [];

  const buscar = async (url: string, caminho: string) => {
    const { dados, erro } = await coletarPaginado(url);
    if (erro) erros.push(`${caminho}: ${erro}`);
    for (const c of dados) {
      if (!c?.id || contasPorId.has(c.id)) continue;
      contasPorId.set(c.id, c);
      porCaminho[c.id] = caminho;
    }
  };

  // 1. As contas pessoais.
  await buscar(`${META_BASE}/me/adaccounts?fields=${CAMPOS_DE_CONTA}&limit=100&access_token=${token}`, "pessoal");

  // 2. As contas de cada business — o caminho que faltava.
  const negocios = await coletarPaginado(`${META_BASE}/me/businesses?fields=id,name&limit=50&access_token=${token}`);
  if (negocios.erro) erros.push(`negócios: ${negocios.erro}`);
  for (const negocio of negocios.dados) {
    if (!negocio?.id) continue;
    const rotulo = negocio.name ? `negócio "${negocio.name}"` : `negócio ${negocio.id}`;
    await buscar(
      `${META_BASE}/${negocio.id}/owned_ad_accounts?fields=${CAMPOS_DE_CONTA}&limit=100&access_token=${token}`,
      `${rotulo} (própria)`
    );
    await buscar(
      `${META_BASE}/${negocio.id}/client_ad_accounts?fields=${CAMPOS_DE_CONTA}&limit=100&access_token=${token}`,
      `${rotulo} (gerenciada)`
    );
  }

  return { contas: [...contasPorId.values()], porCaminho, erros };
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
    const r = await metaFetch(
      `${META_BASE}/${adAccountId}?fields=${campos}&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!r.ok) {
      return { pronta: false, motivo: "conta_nao_encontrada", detalhe: mensagemDoErro(r).slice(0, 120) };
    }
    const c = r.json;

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
    const r = await metaFetch(
      `${META_BASE}/${adAccountId}/adspixels?fields=id,name&limit=10&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!r.ok) return null;
    const lista = r.json?.data ?? [];
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

// funding_source_details.type é um CÓDIGO NUMÉRICO (uint32), não texto.
// Estes são os que representam saldo pré-pago: 2 FACEBOOK_WALLET,
// 3 FACEBOOK_PAID_CREDIT, 15 EXTERNAL_DEPOSIT, 20 STORED_BALANCE.
const TIPOS_PRE_PAGOS = new Set([2, 3, 15, 20]);
// E estes são os que a Meta cobra sozinha: 1 CREDIT_CARD,
// 4 FACEBOOK_EXTENDED_CREDIT, 6 INVOICE, 12/13 PayPal, 17 DIRECT_DEBIT,
// 19 ALTPAY (onde entra boleto/Pix recorrente).
const TIPOS_COBRANCA_AUTOMATICA = new Set([1, 4, 6, 12, 13, 17, 19]);

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
 * ── O defeito que isto corrige ──────────────────────────────────────────────
 * O pré-pago era detectado procurando os textos "PREPAID"/"STORED" dentro de
 * `funding_source_details.type`. Só que esse campo é um CÓDIGO NUMÉRICO: a Meta
 * devolve 20, e `String(20)` nunca contém "STORED". `ehPrePago` era false para
 * 100% das contas do mundo — o que zerava as duas pontas do aviso de saldo
 * (saldoDisponivel ficava sempre null e cobrancaAutomatica sempre true). A tela
 * dizia "Tudo certo, sua conta está pronta" e "o Facebook cobra automaticamente
 * — você não precisa recarregar" para uma conta pré-paga com R$ 0,00: o lojista
 * publicava, era cobrado a gestão de R$ 50 e o anúncio não rodava. Era
 * exatamente a falha que esta função existe para impedir.
 *
 * Agora manda o `is_prepay_account` (booleano da própria Meta), com o código
 * numérico como reserva. E na dúvida ERRA PARA O LADO SEGURO: se não dá para
 * PROVAR que a cobrança é automática, mostra o saldo e o aviso — melhor um
 * aviso a mais do que campanha paga que não veicula.
 *
 * Todos os valores da Meta vêm em CENTAVOS da moeda da conta.
 */
export async function lerCarteiraDaConta(
  adAccountId: string,
  accessToken: string
): Promise<CarteiraDaConta | null> {
  const campos = [
    "currency", "balance", "amount_spent", "spend_cap", "is_prepay_account",
    "funding_source", "funding_source_details", "adtrust_dsl",
  ].join(",");

  try {
    let r = await metaFetch(
      `${META_BASE}/${adAccountId}?fields=${campos}&access_token=${encodeURIComponent(accessToken)}`
    );

    // ── UM CAMPO RECUSADO DERRUBA A LEITURA INTEIRA ──────────────────────────
    //
    // A Graph API não devolve "os campos que deu": um único nome que a versão
    // não conheça (ou que a conta não exponha) faz a requisição toda voltar
    // 400. Como o retorno era `null` mudo, o efeito prático era o pior
    // possível: a tela dizia "Tudo certo" com a conta zerada, porque o aviso de
    // saldo só existe quando a carteira é lida. Medido em produção em
    // 28/08/2026 — carteira nula numa conta ativa e saudável.
    //
    // Então: se a consulta cheia falhar, tenta de novo com o conjunto mínimo
    // que toda conta de anúncios expõe. Meia carteira é muito melhor do que
    // carteira nenhuma, e o motivo da primeira falha vai para o log em vez de
    // sumir.
    if (!r.ok) {
      console.warn(
        `[Meta Ads] carteira de ${adAccountId}: consulta completa recusada ` +
          `(${JSON.stringify(r.json?.error ?? r.json ?? {}).slice(0, 200)}). Tentando campos básicos.`
      );
      r = await metaFetch(
        `${META_BASE}/${adAccountId}?fields=currency,balance,amount_spent,funding_source,funding_source_details&access_token=${encodeURIComponent(accessToken)}`
      );
      if (!r.ok) {
        console.error(
          `[Meta Ads] carteira de ${adAccountId} indisponível: ` +
            `${JSON.stringify(r.json?.error ?? r.json ?? {}).slice(0, 200)}`
        );
        return null;
      }
    }
    const c = r.json;

    const emReais = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n / 100 : null;
    };

    const detalhes = c.funding_source_details || {};
    const tipo = Number(detalhes.type);
    const tipoConhecido = Number.isFinite(tipo);

    const ehPrePago =
      c.is_prepay_account === true ||
      (c.is_prepay_account !== false &&
        (TIPOS_PRE_PAGOS.has(tipo) || !(tipoConhecido && TIPOS_COBRANCA_AUTOMATICA.has(tipo))));

    // `balance` no pré-pago se comporta como crédito disponível e no pós-pago
    // como fatura em aberto — por isso é lido conforme o tipo de cobrança.
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
  } catch (e: any) {
    // Silêncio aqui é o que fazia a tela prometer "Tudo certo" para uma conta
    // que não consegue gastar: o aviso de saldo depende desta leitura.
    console.error(`[Meta Ads] falha ao ler a carteira de ${adAccountId}: ${e?.message}`);
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
    const r = await metaFetch(
      `${META_BASE}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(tokenAtual)}`
    );
    if (!r.ok) {
      // Sem este log, a renovação falhava em silêncio e a loja só descobria no
      // dia 60, quando o token morre de vez.
      console.warn(`[MetaAds] renovação de token recusada: ${mensagemDoErro(r)}`);
      return null;
    }
    return r.json?.access_token ?? null;
  } catch {
    return null;
  }
}

// Códigos que significam TOKEN MORTO de verdade. 190 é o "invalid/expired
// access token" (os subcódigos 458-467 — app removido, senha trocada, sessão
// expirada — vêm dentro dele) e 102 é sessão inválida.
const CODIGOS_DE_TOKEN_MORTO = new Set([102, 190]);

/** O token ainda é válido? Usado para avisar o lojista antes de quebrar. */
export async function tokenAindaVale(token: string): Promise<boolean> {
  try {
    const r = await metaFetch(`${META_BASE}/me?fields=id&access_token=${encodeURIComponent(token)}`);
    if (r.ok) return true;

    // Só declara o token MORTO quando o CÓDIGO diz isso. A versão anterior
    // aceitava qualquer `type === "OAuthException"` — e esse `||` anulava por
    // completo o teste do código 190, porque a Meta devolve os estouros de
    // limite (4, 17, 32, 613, 80xxx) e os erros genéricos (1, 2) exatamente
    // assim: HTTP 400 com type OAuthException. Um único throttle marcava tokens
    // perfeitamente válidos como mortos, o cron desligava o módulo dessas lojas
    // e — como o laço de renovação só olha quem está ligado — elas nunca mais
    // eram renovadas: o token morria de verdade 60 dias depois, sozinho.
    if (r.status === 400 || r.status === 401) {
      const codigo = Number(r.json?.error?.code);
      return !CODIGOS_DE_TOKEN_MORTO.has(codigo);
    }
    // 429/5xx/rede/resposta estranha: indisponibilidade, não invalidez. Mantém.
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

type RespostaMeta = { ok: boolean; status: number; json: any };

// Nenhuma das chamadas tinha prazo. Uma resposta pendurada da Meta segurava a
// rota até o Node desistir (minutos) — e no meio da criação de campanha é
// justamente isso que produz campanha viva na conta do lojista sem registro
// no FireHub.
const TIMEOUT_META_MS = 15000;

// Estouro de limite da Meta. Vale esperar e tentar de novo — em LEITURA.
const CODIGOS_DE_LIMITE = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006]);

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Toda chamada à Meta passa por aqui: prazo + repetição com espera crescente.
 *
 * `tentativas` é 1 por padrão em ESCRITA (metaPost) de propósito: sem chave de
 * idempotência, repetir um POST que talvez tenha sido processado criaria uma
 * segunda campanha gastando o dinheiro do lojista. Leitura pode repetir à
 * vontade.
 */
async function metaFetch(url: string, init?: RequestInit, tentativas = 3): Promise<RespostaMeta> {
  let ultima: RespostaMeta = { ok: false, status: 0, json: { error: { message: "sem resposta" } } };

  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await esperar(500 * 2 ** (i - 1) + Math.floor(Math.random() * 250));

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_META_MS) });
    } catch (e: any) {
      ultima = { ok: false, status: 0, json: { error: { message: String(e?.message ?? e).slice(0, 160) } } };
      continue; // rede/timeout: vale insistir
    }

    const texto = await res.text().catch(() => "");
    let json: any = {};
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch {
      json = { error: { message: texto.slice(0, 200) || `HTTP ${res.status}` } };
    }

    const resposta: RespostaMeta = { ok: res.ok && !json?.error, status: res.status, json };
    if (resposta.ok) return resposta;

    ultima = resposta;
    const codigo = Number(json?.error?.code);
    const vaiPassar = res.status >= 500 || res.status === 429 || CODIGOS_DE_LIMITE.has(codigo);
    if (!vaiPassar) return resposta; // erro de verdade: insistir só atrasa
  }

  return ultima;
}

/** A mensagem que a Meta mandou, legível. Era isto que se jogava fora. */
function mensagemDoErro(r: RespostaMeta): string {
  const erro = r.json?.error;
  if (!erro) return `HTTP ${r.status}`;
  const partes = [erro.message, erro.error_user_msg].filter(Boolean).join(" — ");
  const codigos = [erro.code, erro.error_subcode].filter((v) => v != null).join("/");
  return `${partes || `HTTP ${r.status}`}${codigos ? ` [${codigos}]` : ""}`;
}

/**
 * Lista completa de uma edge.
 *
 * O Graph pagina em 25 por padrão e ninguém seguia `paging.next`: quem
 * administra muitas Páginas ou muitas contas simplesmente não tinha a do
 * restaurante na lista.
 */
async function coletarPaginado(
  urlInicial: string,
  maxPaginas = 5
): Promise<{ dados: any[]; erro: string | null }> {
  const dados: any[] = [];
  let url: string | null = urlInicial;

  for (let i = 0; i < maxPaginas && url; i++) {
    const r: RespostaMeta = await metaFetch(url);
    if (!r.ok) return { dados, erro: mensagemDoErro(r) };
    const lote = Array.isArray(r.json?.data) ? r.json.data : [];
    dados.push(...lote);
    const proxima = r.json?.paging?.next;
    url = typeof proxima === "string" && proxima ? proxima : null;
  }

  return { dados, erro: null };
}

/** Quanto a campanha já gastou, em reais. 0 se não der para saber. */
async function gastoAcumuladoBRL(campaignId: string, accessToken: string): Promise<number> {
  const r = await metaFetch(
    `${META_BASE}/${campaignId}/insights?fields=spend&date_preset=maximum&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!r.ok) return 0;
  const gasto = parseFloat(r.json?.data?.[0]?.spend ?? "0");
  return Number.isFinite(gasto) ? gasto : 0;
}

/** Remove um objeto da conta do lojista. Apagar a campanha leva os filhos. */
async function apagarObjetoNaMeta(id: string, token: string): Promise<void> {
  try {
    await metaFetch(`${META_BASE}/${id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" }, 1);
  } catch {
    // Limpeza é melhor-esforço: o erro que importa para o lojista é o original.
  }
}

async function metaPost(path: string, token: string, body: object) {
  const r = await metaFetch(
    `${META_BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, access_token: token }),
    },
    1 // escrita NÃO repete: sem idempotência, repetir pode duplicar campanha
  );
  if (!r.ok) {
    throw new Error(`Meta API error (${path}): ${mensagemDoErro(r)}`);
  }
  return r.json;
}
