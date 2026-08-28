/**
 * GET  /api/meta-ads/campaign  → retorna campanha ativa do franqueado
 * POST /api/meta-ads/campaign  → cria nova campanha
 * PUT  /api/meta-ads/campaign  → pausa/retoma campanha ou atualiza orçamento
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createMetaCampaign,
  getCampaignInsights,
  setCampaignStatus,
  ativarCampanhaCompleta,
  atualizarOrcamentoCompleto,
  verificarProntidaoDaConta,
  lerCarteiraDaConta,
  linkDeCobrancaDoMeta,
  linkDeRecargaDoMeta,
} from "@/lib/meta-ads";
import { segredoOpcional } from "@/lib/segredos";

/** Piso do Meta: abaixo de ~R$ 10/dia o conjunto de anúncios nem é aceito. */
const INVESTIMENTO_MINIMO = 70;
/** Teto de sanidade: um zero a mais digitado não pode virar verba de verdade. */
const INVESTIMENTO_MAXIMO = 20_000;
const RAIO_MINIMO_KM = 1;
const RAIO_MAXIMO_KM = 50;
const RAIO_PADRAO_KM = 3;
/**
 * Status intermediário, gravado ANTES de falar com a Meta. É a reserva que
 * impede duas requisições concorrentes de criarem duas campanhas ao vivo.
 */
const STATUS_CRIANDO = "CREATING";
/** Passado disso, uma reserva só pode ser resto de requisição que morreu. */
const LIMITE_DA_RESERVA_MS = 15 * 60_000;
/** Métrica mais nova que isto não vale uma chamada à Graph API. */
const FRESCOR_DAS_METRICAS_MS = 5 * 60_000;
const SETE_DIAS_MS = 7 * 86_400_000;

/** Explicações da prontidão da conta, no mesmo tom de /api/meta-ads/status. */
const CONTA_NAO_PRONTA: Record<string, string> = {
  sem_forma_de_pagamento:
    "Sua conta de anúncios ainda não tem forma de pagamento no Facebook — a campanha seria " +
    "criada e não veicularia. Cadastre um cartão (o Facebook cobra sozinho) ou adicione " +
    "crédito por Pix/boleto e volte aqui. Nada foi criado nem cobrado.",
  conta_desativada:
    "Sua conta de anúncios está desativada no Facebook (costuma ser cobrança pendente ou " +
    "revisão de política). Resolva no painel do Facebook e tente de novo. Nada foi cobrado.",
  conta_nao_encontrada:
    "Não conseguimos acessar sua conta de anúncios. Reconecte o Facebook para renovar a " +
    "permissão e tente de novo. Nada foi cobrado.",
  erro:
    "Não conseguimos falar com o Facebook agora para conferir sua conta. Tente de novo em " +
    "alguns instantes — nada foi criado nem cobrado.",
};

/**
 * Coordenada da loja, tolerante ao formato.
 *
 * `storeLatLng` é Json? e o único escritor é o mapa de zona de entrega, mas
 * geocoding.ts registra que o campo pode ter sido gravado como STRING JSON em
 * dados antigos. Lido só como objeto, `?.lat` dava undefined e a campanha caía
 * no fallback mesmo para quem tinha preenchido o mapa.
 */
function lerCoordenadaDaLoja(valor: unknown): { lat: number; lng: number } | null {
  let bruto: any = valor;
  if (typeof bruto === "string") {
    try {
      bruto = JSON.parse(bruto);
    } catch {
      return null;
    }
  }
  const lat = Number(bruto?.lat);
  const lng = Number(bruto?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0,0) é o Atlântico: dado de teste, não loja.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Maior raio que a loja realmente entrega, a partir das zonas já desenhadas
 * em Minha Loja. Zonas por bairro não têm raio — nesse caso devolve null e o
 * chamador usa o padrão.
 */
function raioDasZonasDeEntrega(zonas: unknown): number | null {
  if (!Array.isArray(zonas)) return null;
  const raios = zonas
    .map((z: any) => Number(z?.km ?? z?.radius))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!raios.length) return null;
  return Math.max(...raios);
}

/**
 * Traduz a falha da Meta para uma frase que um dono de restaurante entende.
 *
 * `metaPost` lança `Meta API error (/act_123/adcreatives): {"message":...}` —
 * despejar isso no banner vermelho deixava o lojista travado diante de um JSON
 * em inglês, sem saber o que fazer nem para onde ir. O texto técnico continua
 * indo em `detalheTecnico`, para o suporte.
 */
function erroDaMetaEmPortugues(mensagemTecnica: string): string {
  const t = mensagemTecnica.toLowerCase();
  if (t.includes("imagem")) {
    return "O Facebook não aceitou a foto do anúncio. Envie outra imagem (JPG ou PNG, boa resolução) e tente de novo. Nada foi cobrado.";
  }
  if (t.includes('"code":190') || t.includes("session has expired") || t.includes("access token")) {
    return "Sua conexão com o Facebook expirou. Reconecte sua conta nesta tela e crie a campanha de novo. Nada foi cobrado.";
  }
  if (t.includes("page") && (t.includes("permission") || t.includes("does not exist") || t.includes("page_id"))) {
    return "O Facebook recusou publicar pela sua Página. Confira se a Página do restaurante existe e se você é administrador, depois reconecte o Facebook. Nada foi cobrado.";
  }
  if (t.includes("payment") || t.includes("funding") || t.includes("billing") || t.includes("spend limit")) {
    return "O Facebook recusou por causa da forma de pagamento da conta de anúncios. Abra o painel do Facebook, ajuste o pagamento e tente de novo. Nada foi cobrado.";
  }
  if (t.includes("permission") || t.includes("ads_management")) {
    return "Faltam permissões de anúncios na sua conexão com o Facebook. Reconecte a conta autorizando todas as opções e tente de novo. Nada foi cobrado.";
  }
  if (t.includes("policy") || t.includes("policies")) {
    return "O Facebook reprovou o anúncio pelas políticas de publicidade dele. Troque a foto ou o texto e tente de novo. Nada foi cobrado.";
  }
  return "O Facebook recusou a criação da campanha. Nada foi criado no ar e nada foi cobrado — tente de novo em alguns minutos ou fale com o suporte.";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  // Opcional aqui de propósito: `segredoObrigatorio` LANÇA quando a variável
  // não existe — este GET virava 500 e o "needsSetup" abaixo era código morto.
  // Sem a credencial, a tela precisa carregar e dizer que falta configurar.
  const appId = segredoOpcional("META_APP_ID");
  if (!appId) {
    return NextResponse.json({ campaigns: [], needsSetup: true });
  }

  // Verifica se o Facebook está conectado
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { metaFbAccessToken: true, metaAdAccountId: true, metaFbPageId: true, metaAdsEnabled: true },
  });

  const campaigns = await prisma.metaAdsCampaign.findMany({
    where: { franchiseeId },
    orderBy: { createdAt: "desc" },
  });

  // Busca métricas atualizadas para campanhas ativas
  let metricasDesatualizadas = false;
  for (const campaign of campaigns) {
    if (campaign.status !== "ACTIVE" || !campaign.metaCampaignId || !user?.metaFbAccessToken) continue;

    // O painel recarrega sozinho a cada 60 s e a cada ação do lojista. Bater na
    // Graph API em todas essas vezes é queimar cota à toa: o cron já persiste
    // spend/impressões/cliques. Só vale nova chamada quando o que está no banco
    // envelheceu — e, quando a Meta recusa, a tela precisa saber que o número
    // exibido é velho, em vez de o catch mudo fazer parecer atualizado.
    const idadeDoDado = Date.now() - new Date(campaign.updatedAt).getTime();
    if (idadeDoDado < FRESCOR_DAS_METRICAS_MS) continue;

    try {
      const live = await getCampaignInsights(campaign.metaCampaignId, user.metaFbAccessToken);
      const metrics = {
        spend: (live as any).spend,
        impressions: (live as any).impressions,
        clicks: (live as any).clicks,
        ordersGenerated: (live as any).ordersGenerated ?? (live as any).orders ?? 0,
        revenue: (live as any).revenue ?? 0,
      };
      Object.assign(campaign, metrics);
      await prisma.metaAdsCampaign.update({
        where: { id: campaign.id },
        data: { ...metrics, updatedAt: new Date() } as any,
      });
    } catch {
      metricasDesatualizadas = true; // não falha se API tiver offline
    }
  }

  return NextResponse.json({
    campaigns,
    connected: Boolean(user?.metaFbAccessToken),
    hasAdAccount: Boolean(user?.metaAdAccountId),
    hasPage: Boolean(user?.metaFbPageId),
    metricasDesatualizadas,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  // ── VALIDAÇÃO DO BODY ────────────────────────────────────────────────────
  // O corpo é entrada de rede, não contrato. Antes, um campo com tipo errado
  // atravessava as checagens (`"abc" < 70` é false), a campanha subia, era
  // ATIVADA, a taxa era lançada — e só então o Prisma estourava no insert,
  // deixando anúncio no ar sem linha no banco para pausar.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Não entendi os dados enviados. Recarregue a página e tente de novo." }, { status: 400 });
  }

  const weeklyBudget = Number(body?.weeklyBudget ?? 100);
  if (!Number.isFinite(weeklyBudget) || weeklyBudget < INVESTIMENTO_MINIMO) {
    return NextResponse.json(
      { error: "O investimento mínimo é R$ 70/semana (R$ 10/dia — mínimo do Meta)." },
      { status: 400 }
    );
  }
  if (weeklyBudget > INVESTIMENTO_MAXIMO) {
    return NextResponse.json(
      { error: `O investimento máximo por esta tela é R$ ${INVESTIMENTO_MAXIMO.toLocaleString("pt-BR")}/semana. Para valores maiores, fale com o suporte.` },
      { status: 400 }
    );
  }

  let raioPedido: number | null = null;
  if (body?.radiusKm !== undefined && body?.radiusKm !== null) {
    const r = Number(body.radiusKm);
    if (!Number.isFinite(r) || r < RAIO_MINIMO_KM || r > RAIO_MAXIMO_KM) {
      return NextResponse.json(
        { error: `O raio do anúncio precisa ficar entre ${RAIO_MINIMO_KM} e ${RAIO_MAXIMO_KM} km.` },
        { status: 400 }
      );
    }
    raioPedido = r;
  }

  const adCopy = typeof body?.adCopy === "string" && body.adCopy.trim() ? body.adCopy.trim() : undefined;
  const adDescription =
    typeof body?.adDescription === "string" && body.adDescription.trim() ? body.adDescription.trim() : undefined;
  const adImageUrl =
    typeof body?.adImageUrl === "string" && body.adImageUrl.trim() ? body.adImageUrl.trim() : undefined;

  // Busca dados do franqueado
  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  if (!user.metaFbAccessToken || !user.metaAdAccountId) {
    return NextResponse.json({ error: "Conta Facebook não conectada" }, { status: 400 });
  }
  const accessToken = user.metaFbAccessToken;
  const adAccountId = user.metaAdAccountId;

  // O criativo é publicado POR uma Página. Sem ela a Meta recusa /adcreatives
  // com um JSON em inglês, depois de campanha e conjunto já criados. Dizer
  // isto antes evita o beco sem saída e o lixo na conta do lojista.
  if (!user.metaFbPageId) {
    return NextResponse.json(
      {
        error:
          "Sua conta não tem uma Página do Facebook vinculada, e todo anúncio é publicado por uma Página. " +
          "Crie a Página do seu restaurante no Facebook e reconecte a conta aqui.",
        proximoPasso: "sem_pagina",
      },
      { status: 400 }
    );
  }

  // Sem slug o link do anúncio sai como ".../loja/" — 404. A campanha veicula,
  // cada clique pago cai numa página de erro e a verba da semana inteira vai
  // embora. Contas criadas pelo admin ou por convite de equipe nascem assim.
  const storeSlug = (user.slug ?? "").trim();
  if (!storeSlug) {
    return NextResponse.json(
      {
        error:
          "Sua loja ainda não tem o endereço do cardápio online (o link público). Sem ele o anúncio levaria " +
          "para uma página de erro. Finalize o cadastro da loja e tente de novo.",
        proximoPasso: "sem_slug",
        linkParaResolver: "/store/minha-loja",
      },
      { status: 400 }
    );
  }

  // Sem coordenada NÃO se cria campanha. O código antigo caía em -23.55/-46.63
  // (Praça da Sé): uma loja de Recife anunciava para quem está a 2.000 km e não
  // consegue pedir — verba inteira perdida, mais R$ 50 de gestão, sem nenhum
  // aviso na tela. Chutar localização é pior do que recusar.
  const coordenada = lerCoordenadaDaLoja(user.storeLatLng);
  if (!coordenada) {
    return NextResponse.json(
      {
        error:
          "Antes de anunciar, marque no mapa onde fica sua loja (Minha Loja → Área de entrega). " +
          "Sem esse ponto o anúncio seria exibido para gente que não consegue receber seu pedido.",
        proximoPasso: "sem_localizacao",
        linkParaResolver: "/store/minha-loja",
      },
      { status: 409 }
    );
  }

  // O raio nasce da área que a loja REALMENTE entrega. Fixo em 3 km, quem
  // entrega em 10 km pagava CPM de um público artificialmente pequeno e quem
  // entrega em 1,5 km pagava cliques de quem está fora da área.
  const raioBruto = raioPedido ?? raioDasZonasDeEntrega(user.deliveryZones) ?? RAIO_PADRAO_KM;
  const radiusKm = Math.min(RAIO_MAXIMO_KM, Math.max(RAIO_MINIMO_KM, Math.ceil(raioBruto)));

  // ── A CONTA CONSEGUE VEICULAR AGORA? ─────────────────────────────────────
  // Esta era a falha que mais custava caro: sem forma de pagamento (ou
  // pré-paga zerada), a Meta aceita criar E aceita o ACTIVE, e simplesmente
  // não entrega. A tela dizia "seus anúncios já estão rodando", os R$ 50 de
  // gestão entravam no ciclo e o cron repetia a cobrança toda semana, para
  // sempre, por zero entrega. A verificação já existia — só não era consultada
  // antes de o dinheiro sair.
  const prontidao = await verificarProntidaoDaConta(adAccountId, accessToken);
  if (!prontidao.pronta) {
    return NextResponse.json(
      {
        error: CONTA_NAO_PRONTA[prontidao.motivo ?? "erro"] ?? CONTA_NAO_PRONTA.erro,
        proximoPasso: prontidao.motivo,
        linkParaResolver: linkDeCobrancaDoMeta(adAccountId),
        detalheTecnico: prontidao.detalhe,
      },
      { status: 409 }
    );
  }

  // Pré-pago com saldo R$ 0,00 PASSA na prontidão (tem forma de pagamento e
  // conta ativa) e mesmo assim não entrega — é o caso mais comum no Brasil,
  // Pix/boleto. Só a carteira enxerga isso.
  const carteira = await lerCarteiraDaConta(adAccountId, accessToken);
  if (
    carteira &&
    !carteira.cobrancaAutomatica &&
    carteira.saldoDisponivel !== null &&
    carteira.saldoDisponivel <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Sua conta de anúncios está no modo pré-pago e o saldo acabou — a campanha seria criada e não " +
          "rodaria. Adicione crédito por Pix ou boleto (ou troque para cartão, que o Facebook cobra " +
          "sozinho) e volte aqui. Nada foi criado nem cobrado.",
        proximoPasso: "sem_saldo",
        linkParaResolver: linkDeRecargaDoMeta(adAccountId),
      },
      { status: 409 }
    );
  }

  // ── UMA CAMPANHA POR LOJA, INCLUSIVE SOB CORRIDA ─────────────────────────
  // A trava antiga lia aqui e só escrevia ~10 s depois (5 chamadas à Meta mais
  // 3 de ativação). Duas requisições dentro dessa janela — duas abas, ou o
  // retry depois de "erro de conexão" enquanto a primeira ainda rodava — liam
  // "nenhuma ativa" as duas: duas campanhas ao vivo, verba dobrada no Meta e
  // R$ 50 cobrados duas vezes, toda semana, pelo cron.
  const agora = Date.now();
  const concorrentes = await prisma.metaAdsCampaign.findMany({
    where: { franchiseeId, status: { in: ["ACTIVE", STATUS_CRIANDO] } },
    select: { id: true, status: true, createdAt: true },
  });

  // Reserva órfã (processo morreu no meio da criação) não pode trancar a loja
  // para sempre: vira PAUSED. Se chegou a ter IDs da Meta, o "Retomar" resgata;
  // se não chegou, o painel manda criar outra. Sempre existe saída.
  const abandonadas = concorrentes.filter(
    (c) => c.status === STATUS_CRIANDO && agora - c.createdAt.getTime() > LIMITE_DA_RESERVA_MS
  );
  if (abandonadas.length) {
    await prisma.metaAdsCampaign.updateMany({
      where: { id: { in: abandonadas.map((c) => c.id) } },
      data: { status: "PAUSED" },
    });
  }
  if (concorrentes.length > abandonadas.length) {
    return NextResponse.json(
      { error: "Você já tem uma campanha ativa. Pause a campanha atual antes de criar outra." },
      { status: 409 }
    );
  }

  // A linha existe ANTES de qualquer chamada à Meta. Dois motivos: ela é a
  // reserva contra a corrida acima, e garante que nenhuma campanha possa
  // existir na Meta sem dono no banco — o que antes deixava anúncio gastando
  // sem aparecer no painel e sem botão de pausar em lugar nenhum.
  const reserva = await prisma.metaAdsCampaign.create({
    data: {
      franchiseeId,
      status: STATUS_CRIANDO,
      weeklyBudget,
      radiusKm,
      adCopy,
      adImageUrl,
      // A campanha real é criada com OUTCOME_TRAFFIC; deixar o default
      // LINK_CLICKS aqui era o banco descrevendo uma campanha que não existe.
      objective: "OUTCOME_TRAFFIC",
    },
  });

  // Leitura depois da escrita: as duas requisições concorrentes já gravaram a
  // própria reserva antes desta consulta, então uma delas enxerga a outra.
  // Desiste a mais nova — sem ter criado nada na Meta e sem cobrar nada.
  const outrasReservas = await prisma.metaAdsCampaign.findMany({
    where: { franchiseeId, id: { not: reserva.id }, status: { in: ["ACTIVE", STATUS_CRIANDO] } },
    select: { id: true, createdAt: true },
  });
  const perdemosACorrida = outrasReservas.some((o) => {
    const diferenca = o.createdAt.getTime() - reserva.createdAt.getTime();
    return diferenca < 0 || (diferenca === 0 && o.id < reserva.id);
  });
  if (perdemosACorrida) {
    await prisma.metaAdsCampaign.delete({ where: { id: reserva.id } }).catch(() => undefined);
    return NextResponse.json(
      { error: "Você já tem uma campanha ativa. Pause a campanha atual antes de criar outra." },
      { status: 409 }
    );
  }

  let idsNaMeta: Awaited<ReturnType<typeof createMetaCampaign>> | null = null;

  try {
    // Cria campanha no Meta (os três níveis nascem PAUSADOS, de propósito)
    idsNaMeta = await createMetaCampaign({
      adAccountId,
      accessToken,
      storeName: user.storeName ?? user.name,
      storeSlug,
      storeAddress: user.storeAddress ?? "",
      lat: coordenada.lat,
      lng: coordenada.lng,
      radiusKm,
      weeklyBudgetBRL: weeklyBudget,
      adCopy: adCopy ?? `🍔 Peça agora em ${user.storeName ?? user.name}! Entrega rápida, cardápio completo. Clique e aproveite!`,
      adDescription,
      adImageUrl: adImageUrl ?? user.storeBanner ?? user.storeLogo ?? "",
      pageId: user.metaFbPageId,
    });

    // Os IDs entram no banco ANTES da ativação, e o status PAUSED é a verdade
    // neste instante. Daqui em diante, qualquer falha deixa uma campanha
    // visível e pausável no painel — nunca um anúncio no ar sem registro.
    const campanhaPausada = await prisma.metaAdsCampaign.update({
      where: { id: reserva.id },
      data: { ...idsNaMeta, status: "PAUSED" },
    });

    // A criação na Meta nasce com campanha, conjunto e anúncio PAUSADOS (é o
    // desenho seguro da lib). O clique em "criar campanha" — depois dos termos
    // e do aviso de cobrança — é a ordem do lojista para LIGAR. Sem esta
    // ativação dos três níveis, nada jamais veiculava: o banco dizia ACTIVE,
    // a tela dizia "rodando" e a Meta estava 100% pausada.
    try {
      await ativarCampanhaCompleta(idsNaMeta, accessToken);
    } catch (e: any) {
      // Não ligou = não cobra e não diz que rodou. Os objetos criados ficam
      // pausados na Meta; o lojista tenta ativar pelo "Retomar".
      console.error("[MetaAds] campanha criada mas a ativação falhou:", e?.message);
      return NextResponse.json(
        {
          campaign: campanhaPausada,
          error:
            "A campanha foi criada no Facebook mas ainda não está no ar — a ativação falhou. " +
            "Use o botão Retomar no painel para tentar ligar de novo. Nada foi cobrado.",
          detalheTecnico: String(e?.message ?? "").slice(0, 300),
        },
        { status: 502 }
      );
    }

    // Só depois de veicular DE VERDADE o banco pode dizer ACTIVE. Se esta
    // gravação falhar, o catch externo devolve a campanha ao estado pausado na
    // Meta — nunca sobra anúncio gastando dinheiro que o painel não mostra.
    const campaign = await prisma.metaAdsCampaign.update({
      where: { id: reserva.id },
      data: { status: "ACTIVE" },
    });

    // A primeira semana de gestão é cobrada NA CRIAÇÃO — mesma regra da
    // reativação ("ligou, pagou a semana"). Antes, lastBilledAt nascia nulo e
    // o cron só cobrava no 7º dia: a primeira semana saía de graça, diferente
    // do que a tela avisa. A cobrança é o ÚLTIMO passo, depois de a campanha
    // estar no ar e registrada: cobrar antes disso era arriscar cobrar por uma
    // campanha que ainda podia não existir para o lojista.
    const taxaSemanal = user.metaAdsWeeklyFee ?? 50;
    let cobrancaGravada = false;
    try {
      const { getCurrentYearMonth } = await import("@/lib/billing");
      const yearMonth = getCurrentYearMonth(0, user.storeTimezone || "America/Sao_Paulo");
      await prisma.franchiseeBillingCycle.upsert({
        where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
        update: { metaAdsFee: { increment: taxaSemanal } },
        create: {
          franchiseeId,
          yearMonth,
          planPercent: user.planPercent ?? 1,
          metaAdsFee: taxaSemanal,
          status: "OPEN",
        },
      });
      cobrancaGravada = true;
    } catch (e: any) {
      console.error("[MetaAds] falha ao lançar a taxa da primeira semana:", e?.message);
    }

    if (cobrancaGravada) {
      try {
        const comCarimbo = await prisma.metaAdsCampaign.update({
          where: { id: reserva.id },
          data: { feeAccrued: taxaSemanal, lastBilledAt: new Date() },
        });
        return NextResponse.json({ campaign: comCarimbo });
      } catch (e: any) {
        // Taxa já lançada e carimbo perdido: o cron conta a partir de
        // `createdAt` quando lastBilledAt é nulo, então a próxima cobrança cai
        // no 7º dia — atrasada no pior caso, nunca em dobro.
        console.error("[MetaAds] taxa lançada mas o carimbo da campanha falhou:", e?.message);
      }
    }

    return NextResponse.json({ campaign });
  } catch (err: any) {
    console.error("[MetaAds] Erro ao criar campanha:", err?.message);

    // Chegar aqui é sempre ANTES da cobrança — ela é o último passo do fluxo.
    // Por isso todas as mensagens abaixo podem afirmar que nada foi cobrado.
    let mensagem: string;

    if (idsNaMeta) {
      // Rede de segurança: chegou a existir na Meta e o fluxo quebrou depois.
      // Desliga lá para não deixar verba queimando fora do controle do painel,
      // e deixa a linha pausada com os IDs — assim o lojista vê e resolve.
      await setCampaignStatus(idsNaMeta.metaCampaignId, accessToken, "PAUSED").catch(() => undefined);
      await prisma.metaAdsCampaign
        .update({ where: { id: reserva.id }, data: { ...idsNaMeta, status: "PAUSED" } })
        .catch(() => undefined);
      mensagem =
        "A campanha foi criada no Facebook, mas deu erro ao registrar aqui. Por segurança ela foi " +
        "PAUSADA — não está gastando nada e nada foi cobrado. Recarregue o painel: ela aparece na " +
        "lista e o botão Retomar liga quando você quiser.";
    } else {
      // Nada existe na Meta: a reserva some para o lojista poder tentar de novo
      // na hora, sem esbarrar na própria trava de campanha única.
      await prisma.metaAdsCampaign.delete({ where: { id: reserva.id } }).catch(() => undefined);
      mensagem = erroDaMetaEmPortugues(String(err?.message ?? ""));
    }

    return NextResponse.json(
      {
        error: mensagem,
        detalheTecnico: String(err?.message ?? "").slice(0, 300),
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Não entendi os dados enviados. Recarregue a página e tente de novo." }, { status: 400 });
  }
  // action: "pause" | "resume" | "update_budget"
  const action = typeof corpo?.action === "string" ? corpo.action : "";
  const weeklyBudget = corpo?.weeklyBudget;
  const campaignId = typeof corpo?.campaignId === "string" ? corpo.campaignId : undefined;

  const campaign = campaignId
    ? await prisma.metaAdsCampaign.findFirst({ where: { id: campaignId, franchiseeId } })
    : await prisma.metaAdsCampaign.findFirst({
        where: { franchiseeId },
        orderBy: { createdAt: "desc" },
      });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user?.metaFbAccessToken) return NextResponse.json({ error: "Token expirado" }, { status: 400 });
  const accessToken = user.metaFbAccessToken;

  // Sem id na Meta não há o que pausar/retomar — responder "success" aqui era
  // no-op silencioso: a tela dizia "retomada!" e a cobrança seguia correndo.
  if ((action === "pause" || action === "resume") && !campaign.metaCampaignId) {
    return NextResponse.json(
      { error: "Esta campanha não tem vínculo com o Facebook. Crie uma nova campanha." },
      { status: 409 }
    );
  }

  if (action === "pause" && campaign.metaCampaignId) {
    // A chamada à Meta pode falhar (token morto, rate limit, instabilidade) e
    // ela LANÇA. Sem este try/catch a rota devolvia 500 genérico e o banco
    // ficava dizendo ACTIVE — que é exatamente o pior desfecho possível aqui:
    // o anúncio segue gastando o dinheiro do lojista, a tela mostra "rodando"
    // com um botão que não funciona, e o cron continua cobrando os R$ 50/semana
    // de uma campanha que ele está tentando parar desde ontem.
    try {
      await setCampaignStatus(campaign.metaCampaignId, accessToken, "PAUSED");
    } catch (e: any) {
      console.error("[MetaAds] falha ao PAUSAR a campanha:", e?.message);
      return NextResponse.json(
        {
          error:
            erroDaMetaEmPortugues(String(e?.message ?? "")) +
            " Sua campanha pode continuar veiculando — se o problema persistir, pause direto no Gerenciador de Anúncios do Facebook.",
          linkParaResolver: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(user?.metaAdAccountId ?? "").replace(/^act_/, "")}`,
          detalheTecnico: String(e?.message ?? "").slice(0, 300),
        },
        { status: 502 }
      );
    }
    // NÃO se toca em `lastBilledAt` aqui. Ele é o marco da última semana PAGA.
    // Gravar a data da pausa reiniciava o relógio: pausar no 6º dia e religar
    // em seguida empurrava a cobrança seguinte para o 13º dia e, repetindo o
    // gesto a cada 6 dias, a loja anunciava para sempre com uma única cobrança.
    // O risco que o comentário antigo temia ("volta cobrando 3 semanas") não
    // existe: o cron só varre campanha ACTIVE, e o "retomar" cobra UMA taxa
    // fixa, não uma por semana parada.
    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED" },
    });
  } else if (action === "resume" && campaign.metaCampaignId) {
    // O guard de campanha única existia só na criação. Sem ele aqui, retomar
    // uma campanha antiga enquanto outra roda deixava DUAS entregando: verba
    // dobrada na Meta, os dois anúncios do lojista disputando o mesmo leilão e
    // R$ 50 + R$ 50 por semana de gestão numa loja que contratou uma campanha.
    const outraAtiva = await prisma.metaAdsCampaign.findFirst({
      where: { franchiseeId, status: { in: ["ACTIVE", STATUS_CRIANDO] }, id: { not: campaign.id } },
    });
    if (outraAtiva) {
      return NextResponse.json(
        { error: "Você já tem outra campanha ativa. Pause a que está rodando antes de retomar esta." },
        { status: 409 }
      );
    }

    // Os TRÊS níveis, não só a campanha: a Meta exige anúncio, conjunto e
    // campanha ativos para veicular. Ativar só a campanha deixava o resto
    // pausado — a tela dizia "rodando", a taxa corria e nada entrava no ar.
    // Também conserta campanhas antigas criadas com os filhos pausados.
    try {
      await ativarCampanhaCompleta(
        {
          metaCampaignId: campaign.metaCampaignId,
          metaAdSetId: campaign.metaAdSetId,
          metaAdId: campaign.metaAdId,
        },
        accessToken
      );
    } catch (e: any) {
      // Não ligou = não marca ACTIVE e não cobra. O erro cru da Graph API não
      // vai para a tela: o lojista precisa de instrução, não de JSON.
      console.error("[MetaAds] falha ao retomar a campanha:", e?.message);
      return NextResponse.json(
        {
          error: erroDaMetaEmPortugues(String(e?.message ?? "")),
          detalheTecnico: String(e?.message ?? "").slice(0, 300),
        },
        { status: 502 }
      );
    }

    // ── COBRANÇA NA ATIVAÇÃO ─────────────────────────────────────────────
    // Regra do produto: a semana é cobrada INTEIRA ao ativar. Ligou e usou um
    // dia, pagou os R$ 50 — e isso está avisado na tela antes de confirmar.
    //
    // A trava dos 7 dias evita a cobrança dupla óbvia: pausar e religar no
    // mesmo dia não gera uma segunda cobrança, porque a semana paga ainda está
    // correndo. Sem isso, alguém que pausasse e voltasse três vezes num dia
    // pagaria R$ 150.
    const ultimaCobranca = campaign.lastBilledAt ? new Date(campaign.lastBilledAt) : null;
    const diasDesdeACobranca = ultimaCobranca
      ? (Date.now() - ultimaCobranca.getTime()) / 86_400_000
      : Infinity;
    const devecobrar = diasDesdeACobranca >= 7;

    const taxaSemanal = user.metaAdsWeeklyFee ?? 50;

    // O ciclo mensal PRIMEIRO, com os MESMOS campos do cron. A versão antiga
    // usava `userId`/`month` — que não existem no modelo (é
    // `franchiseeId`/`yearMonth`): o Prisma lançava, o catch engolia e a taxa
    // de reativação nunca chegava a um boleto. E o contador da campanha subia
    // ANTES da gravação: se o ciclo falhasse, o cron via lastBilledAt recente
    // e a semana se perdia em silêncio. Agora o contador só avança se a taxa
    // entrou no ciclo — senão, fica para o cron cobrar na próxima passagem.
    let cobrancaGravada = false;
    if (devecobrar) {
      try {
        const { getCurrentYearMonth } = await import("@/lib/billing");
        const yearMonth = getCurrentYearMonth(0, user.storeTimezone || "America/Sao_Paulo");
        await prisma.franchiseeBillingCycle.upsert({
          where: { franchiseeId_yearMonth: { franchiseeId: campaign.franchiseeId, yearMonth } },
          update: { metaAdsFee: { increment: taxaSemanal } },
          create: {
            franchiseeId: campaign.franchiseeId,
            yearMonth,
            planPercent: user.planPercent ?? 1,
            metaAdsFee: taxaSemanal,
            status: "OPEN",
          },
        });
        cobrancaGravada = true;
      } catch (e: any) {
        console.error("[MetaAds] falha ao lançar a taxa de ativação:", e?.message);
      }
    }

    // Quando a taxa não entrou no ciclo, o marco recua exatamente 7 dias em vez
    // de ficar onde estava. Sem isso, uma campanha parada por meses seria
    // cobrada por TODAS as semanas paradas na próxima passagem do cron, que
    // multiplica por `Math.floor(dias / 7)`. Recuando 7 dias, ele cobra uma
    // única semana: a que começa agora, com o anúncio de fato no ar.
    const carimbo = devecobrar ? (cobrancaGravada ? new Date() : new Date(Date.now() - SETE_DIAS_MS)) : null;

    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "ACTIVE",
        ...(carimbo ? { lastBilledAt: carimbo } : {}),
        ...(devecobrar && cobrancaGravada ? { feeAccrued: (campaign.feeAccrued ?? 0) + taxaSemanal } : {}),
      },
    });
  } else if (action === "update_budget") {
    // O `&& weeklyBudget` que ficava aqui deixava o valor 0 (campo apagado na
    // tela) escapar de TODA a cadeia e cair no `{success:true}` do fim: o
    // lojista via "orçamento atualizado" e seguia gastando o valor antigo.
    const valor = Number(weeklyBudget);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });
    }
    // Mesmo piso da criação. Abaixo disso o mínimo diário da Meta (R$ 6/dia)
    // faria a conta gastar MAIS do que o lojista pediu — sem ele perceber.
    if (valor < INVESTIMENTO_MINIMO) {
      return NextResponse.json(
        { error: "O investimento mínimo é R$ 70/semana (R$ 10/dia — mínimo do Meta)." },
        { status: 400 }
      );
    }
    if (valor > INVESTIMENTO_MAXIMO) {
      return NextResponse.json(
        { error: `O investimento máximo por esta tela é R$ ${INVESTIMENTO_MAXIMO.toLocaleString("pt-BR")}/semana. Para valores maiores, fale com o suporte.` },
        { status: 400 }
      );
    }

    // A Meta PRIMEIRO. Se ela recusar, o banco não pode dizer que mudou —
    // era exatamente essa a mentira: o painel confirmava e a cobrança seguia
    // no valor antigo.
    if (campaign.metaAdSetId) {
      try {
        // TETO primeiro, diário depois — e desfaz o teto se o diário falhar.
        //
        // Na ordem inversa, uma falha no meio deixava o pior arranjo possível:
        // gasto diário NOVO com teto de gasto ANTIGO. Subindo o investimento,
        // a campanha bate no teto velho e para de veicular no meio da semana
        // com o lojista pagando a gestão; e a rota respondia erro, então nem
        // ele nem o painel ficavam sabendo que metade da mudança valeu.
        // Mexer só no teto não acelera gasto nenhum, então é a ponta segura
        // para começar.
        await atualizarOrcamentoCompleto(
          { metaCampaignId: campaign.metaCampaignId, metaAdSetId: campaign.metaAdSetId },
          accessToken,
          valor
        );
      } catch (e: any) {
        console.error("[MetaAds] falha ao atualizar orçamento na Meta:", e?.message);
        return NextResponse.json(
          { error: "Não consegui alterar o orçamento no Facebook. Tente de novo." },
          { status: 502 }
        );
      }
    }

    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: { weeklyBudget: valor },
    });
  } else {
    // Fechamento da cadeia. Sem ele, qualquer ação desconhecida caía no
    // `{success:true}` abaixo e a tela confirmava o que nunca aconteceu.
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
