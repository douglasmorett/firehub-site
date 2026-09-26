import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugAposRenomear } from "@/lib/slug-da-loja";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { fusoPorEndereco } from "@/lib/fuso-por-endereco";
import { esquecerPontoDaLoja } from "@/lib/distancia-da-entrega";
import { cadastroParaGravar, mesclarRegraDeRepasse } from "@/lib/cadastro-da-entrega";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";

/**
 * GET: o cadastro de entrega GRAVADO da loja da sessão.
 *
 * A tela de Entrega usa para duas coisas: saber a escolha "o motoboy recebe
 * um valor por faixa" (`repasseDoEntregador.separado`, que mora no
 * deliveryConfig e não chega à tela por props) e CONFERIR, depois de salvar,
 * que o que ela mandou é o que ficou no banco — o salvar dela passa pelo
 * formulário da loja, que não olha o status da resposta, e um "não salvei" do
 * servidor aparecia como "salvo".
 *
 * A loja é a do DONO (`ownerId || id`), como em /api/delivery-fee e
 * /api/store/orders/presencial, e como a página Minha Loja mostra. Lendo a
 * linha do funcionário, a tela dele via `separado: false` (a linha dele não
 * tem regra), passava para "pelo acerto" e avisava que ia apagar os valores do
 * dono; e a conferência dizia "salvo" sem nada mudar para os clientes.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const quem = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!quem) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const user = await prisma.user.findUnique({
    where: { id: quem.ownerId || quem.id },
    select: { deliveryZoneType: true, deliveryZones: true, storeLatLng: true, storeAddress: true, deliveryConfig: true },
  });
  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  return NextResponse.json({
    entrega: {
      deliveryZoneType: user.deliveryZoneType ?? null,
      deliveryZones: user.deliveryZones ?? null,
      storeLatLng: lerPontoDaLoja(user.storeLatLng),
      storeAddress: user.storeAddress ?? null,
      repasseDoEntregador: lerRegraDeRepasse(user.deliveryConfig),
    },
  });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();
  const data: any = {};

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" }
  });
  if (!currentUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const isSecondary = currentUser.role === "STAFF" || Boolean((currentUser as any).ownerId);

  // ── A ENTREGA É DA LOJA, NÃO DE QUEM ESTÁ LOGADO ─────────────────────
  //
  // Área de entrega, pino e deliveryConfig (frete grátis, pedido mínimo,
  // áreas de risco, regra do repasse) vão para a linha da LOJA — a do dono
  // (`ownerId || id`) —, que é a que o cardápio, o balcão, o robô e
  // /api/delivery-fee leem, e a que a página Minha Loja mostra. O gerente que
  // cadastrava as 9 faixas da Divinos gravava na linha DELE: a tela dizia
  // "salvo" e o cardápio continuava cobrando pela tabela do dono.
  //
  // Os outros campos seguem como sempre foram (na linha de quem salvou).
  const donoId = (currentUser as any).ownerId as string | null | undefined;
  const loja = donoId ? await prisma.user.findUnique({ where: { id: donoId } }) : currentUser;
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  /** O que vai para a linha da loja (a do dono). */
  const daLoja: any = {};

  // Nome, Cidade e E-mail só podem ser alterados pela conta principal (não secundária)
  if (!isSecondary) {
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.city !== undefined) data.city = body.city.trim();
    if (body.email !== undefined && body.email.trim()) {
      const cleanEmail = body.email.trim().toLowerCase();
      if (cleanEmail !== currentUser.email) {
        const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (existing) {
          return NextResponse.json({ error: "Este e-mail já está em uso por outra conta." }, { status: 400 });
        }
        data.email = cleanEmail;
      }
    }
  }

  // CPF/CNPJ (editável pelo dono da loja)
  if (body.cpfCnpj !== undefined) data.cpfCnpj = body.cpfCnpj;

  // Store settings — campos permitidos
  for (const key of [
    "storeName", "storePhone", "notificationPhone", "storeAddress", "storeBanner", "storeLogo",
    // deliveryZoneType, deliveryZones e storeLatLng NÃO entram aqui: são
    // validados logo abaixo antes de gravar (ver "ÁREA DE ENTREGA").
    "storeHours", "paymentFees",
    "storeCoupons", "storePause",
    "facebookPixelId",   // Meta Pixel ID
    "metaPixelId",       // Mesmo pixel, campo usado pelo módulo Meta Ads
    "metaCapiToken",     // Token da API de Conversões (venda enviada pelo servidor)
    "gaMeasurementId",   // GA4 — ID de métrica (G-XXXXXXXXXX)
    "gaApiSecret",       // GA4 — segredo do Measurement Protocol (venda pelo servidor)
    "gtmContainerId",    // Google Tag Manager — container (GTM-XXXXXXX)
    "storeLoyalty",      // Programa de fidelidade/cashback
    "city",              // Cidade / Estado (ex: Rio de Janeiro - RJ)
    "storeTimezone",     // Fuso Horário (ex: America/Sao_Paulo)
    "repasseConfig",     // Configurações de Repasse Automático (Brendi Flow)
  ]) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  // O VÍDEO DA CAPA vai para a linha da LOJA, que é a que o cardápio lê. Só
  // aceita o que o nosso upload gravou (lib/video-enviado.ts conferiu tipo,
  // codec e tamanho): URL de fora nem tocaria, o CSP do cardápio só carrega
  // mídia do próprio site.
  if (body.storeBannerVideo !== undefined) {
    const video = typeof body.storeBannerVideo === "string" ? body.storeBannerVideo.trim() : "";
    if (!video) {
      daLoja.storeBannerVideo = null;
    } else if (/^\/uploads\/lojas\/[\w.-]+\.(mp4|webm)$/i.test(video)) {
      daLoja.storeBannerVideo = video;
    } else {
      return NextResponse.json({ error: "Vídeo da capa inválido: envie o arquivo pelo botão do vídeo da capa." }, { status: 400 });
    }
  }

  // ── ÁREA DE ENTREGA: VALIDADA E NORMALIZADA ANTES DE GRAVAR ──────────
  //
  // Até 25/09/2026 as faixas eram gravadas como viessem: km repetido ou zero,
  // taxa negativa, tempo zero, JSON qualquer pela API. A regra está em
  // lib/cadastro-da-entrega.ts, e a tela de Entrega roda a MESMA antes de
  // mandar — aqui é a garantia para quem chama a API direto (ou uma tela
  // antiga ainda aberta no navegador de alguém).
  //
  // Só valida o que MUDOU. As outras seções do painel ("Salvar Tudo") mandam
  // tipo e zonas junto sem mexer neles; revalidar aí travaria o salvar do nome
  // da loja por causa de uma faixa antiga. Essa faixa é corrigida quando a
  // loja abre a tela de Entrega, que não deixa salvar sem acertar.
  //
  // Nulo não apaga: `deliveryZones` nulo é loja "sem área", e sem área a loja
  // atende qualquer endereço do mundo (lib/area-de-entrega.ts). Apagar o
  // cadastro de entrega não acontece por um campo vazio no corpo.
  const avisos: string[] = [];
  const decisao = cadastroParaGravar(
    { tipo: (loja as any).deliveryZoneType ?? null, zonas: (loja as any).deliveryZones ?? null },
    { deliveryZoneType: body.deliveryZoneType, deliveryZones: body.deliveryZones },
  );
  if (decisao.acao === "recusar") {
    return NextResponse.json({ error: decisao.erro, erros: decisao.erros }, { status: 400 });
  }
  if (decisao.acao === "gravar") {
    daLoja.deliveryZoneType = decisao.tipo;
    daLoja.deliveryZones = decisao.zonas;
    avisos.push(...decisao.avisos);
  }

  // O pino da loja: objeto {lat,lng} de verdade, ou nada. Um (0,0) ou um texto
  // quebrado aqui mudava o ponto de onde se mede TODA entrega da loja.
  if (body.storeLatLng !== undefined && body.storeLatLng !== null) {
    const ponto = lerPontoDaLoja(body.storeLatLng);
    if (!ponto) {
      return NextResponse.json({ error: "Não salvei: o ponto da loja no mapa é inválido. Marque a loja no mapa de novo." }, { status: 400 });
    }
    daLoja.storeLatLng = { lat: ponto.lat, lng: ponto.lng };
  }

  // ── TROCAR O NOME DA LOJA TROCA O LINK DO CARDÁPIO ───────────────────
  //
  // O slug nascia no cadastro e ficava congelado. Quem errava o nome ali — e
  // muita gente erra, porque a consulta de CNPJ de MEI devolve a RAZÃO SOCIAL
  // (o número do CNPJ mais o nome da pessoa) — ficava com o link errado para
  // sempre, sem jeito de consertar sozinho.
  //
  // O anterior vai para `slugsAntigos` e a página do cardápio redireciona:
  // QR já impresso em comanda e link no Instagram continuam funcionando.
  if (data.storeName !== undefined && String(data.storeName || "").trim()) {
    const troca = slugAposRenomear(
      data.storeName,
      (currentUser as any)?.slug,
      (currentUser as any)?.slugsAntigos,
    );
    if (troca) {
      // Slug é único no banco: se outra loja já ocupa esse endereço, mantém o
      // atual em vez de derrubar o salvamento inteiro. O nome muda, o link
      // não — e isso é melhor que a loja não conseguir salvar nada.
      const ocupado = await prisma.user.findFirst({
        where: { slug: troca.slug, NOT: { id: currentUser.id } },
        select: { id: true },
      }).catch(() => null);
      if (!ocupado) {
        data.slug = troca.slug;
        data.slugsAntigos = troca.slugsAntigos;
      }
    }
  }

  // ── `deliveryConfig` É MESCLADO, NUNCA SUBSTITUÍDO ───────────────────
  //
  // Ele guarda coisas de telas DIFERENTES: frete grátis e pedido mínimo vêm
  // da aba de Informações; as áreas de risco vêm do mapa de entrega. Cada
  // tela manda só o que conhece, e substituir o objeto fazia a última a
  // salvar apagar o que a outra tinha acabado de gravar — a loja desenhava a
  // área de risco, ia salvar o pedido mínimo e as áreas sumiam sem aviso.
  if (body.deliveryConfig !== undefined && body.deliveryConfig !== null) {
    const atual = (loja as any)?.deliveryConfig;
    const base = atual && typeof atual === "object" && !Array.isArray(atual) ? atual : {};
    const novo = typeof body.deliveryConfig === "object" && !Array.isArray(body.deliveryConfig) ? body.deliveryConfig : {};
    daLoja.deliveryConfig = { ...base, ...novo };
  }

  // ── ÁREAS DE RISCO ENTRAM SEM APAGAR O RESTO ─────────────────────────
  //
  // Elas moram dentro do `deliveryConfig`, que tambem guarda frete gratis e
  // outras coisas. A tela de entrega nao conhece esses outros campos, entao
  // ela manda so `areasDeRisco` e a mesclagem acontece AQUI — mandar o
  // deliveryConfig inteiro de la apagaria o frete gratis da loja.
  if (body.areasDeRisco !== undefined) {
    const atual = (loja as any)?.deliveryConfig;
    const base = atual && typeof atual === "object" && !Array.isArray(atual) ? atual : {};
    const limpas = (Array.isArray(body.areasDeRisco) ? body.areasDeRisco : [])
      .map((a: any) => ({
        nome: String(a?.nome || "Área de risco").slice(0, 80),
        ativa: a?.ativa !== false,
        pontos: (Array.isArray(a?.pontos) ? a.pontos : [])
          .map((p: any) => [Number(p?.[0] ?? p?.lat), Number(p?.[1] ?? p?.lng)])
          .filter((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .slice(0, 200),
      }))
      .filter((a: any) => a.pontos.length >= 3)
      .slice(0, 50);
    // Sobre o que ja tiver sido mesclado acima, nao sobre o do banco: as duas
    // coisas podem vir no MESMO salvar.
    const jaMontado = daLoja.deliveryConfig && typeof daLoja.deliveryConfig === "object" ? daLoja.deliveryConfig : base;
    daLoja.deliveryConfig = { ...jaMontado, areasDeRisco: limpas };
  }

  // ── PAGAMENTO DO ENTREGADOR ──────────────────────────────────────────
  //
  // `separado` diz que a loja informa os dois valores (cliente e motoboy) por
  // faixa/bairro; `marketplace` diz, em pedido de app, se o entregador recebe
  // o que veio do app ou o da tabela da loja. Mesma mesclagem das áreas de
  // risco, e pelo mesmo motivo: a tela de entrega não conhece os outros
  // campos do deliveryConfig e não pode apagá-los.
  if (body.repasseDoEntregador !== undefined && body.repasseDoEntregador !== null) {
    const atual = (loja as any)?.deliveryConfig;
    const base = atual && typeof atual === "object" && !Array.isArray(atual) ? atual : {};
    const jaMontado = daLoja.deliveryConfig && typeof daLoja.deliveryConfig === "object" ? daLoja.deliveryConfig : base;
    // ── CADA TELA MANDA SÓ O QUE ELA DECIDE ────────────────────────────
    //
    // `separado` é decidido na tela de Entrega ("o motoboy recebe um valor
    // por faixa"); `marketplace` e `valorFixoApp` ("FIXO" = valor fixo por
    // entrega de app, guardado mesmo quando a loja troca de modo), na aba
    // Motoboys. Campo ausente no corpo mantém o que está gravado
    // (lib/cadastro-da-entrega.ts, mesclarRegraDeRepasse).
    daLoja.deliveryConfig = {
      ...jaMontado,
      repasseDoEntregador: mesclarRegraDeRepasse(jaMontado.repasseDoEntregador, body.repasseDoEntregador),
    };
  }

  // O fuso segue o ENDEREÇO. Se cidade, endereço ou o próprio fuso vieram no
  // corpo, deriva de novo: quando o cadastro diz o estado, é ele que vale, e o
  // seletor só decide quando o endereço não diz nada. Uma loja de Manaus com
  // "America/Sao_Paulo" esquecido no cadastro fechava o delivery uma hora antes.
  if (data.city !== undefined || data.storeAddress !== undefined || data.storeTimezone !== undefined) {
    const peloEndereco = fusoPorEndereco({
      city: data.city !== undefined ? data.city : currentUser.city,
      storeAddress: data.storeAddress !== undefined ? data.storeAddress : currentUser.storeAddress,
    });
    if (peloEndereco) data.storeTimezone = peloEndereco.fuso;
  }
  if (body.storeDeliveryOnly !== undefined) data.storeDeliveryOnly = body.storeDeliveryOnly;
  if (body.showAddressOnMenu !== undefined) data.showAddressOnMenu = Boolean(body.showAddressOnMenu);
  if (body.showReviewsOnMenu !== undefined) data.showReviewsOnMenu = Boolean(body.showReviewsOnMenu);
  if (body.autoAcceptOrders !== undefined) data.autoAcceptOrders = Boolean(body.autoAcceptOrders);
  if (body.allowScheduledOrders !== undefined) data.allowScheduledOrders = Boolean(body.allowScheduledOrders);
  if (body.storeAlertSound !== undefined) data.storeAlertSound = body.storeAlertSound;
  // A sincronização do tempo com o iFood está DESLIGADA (ver o fim desta
  // rota): o campo só aceita ser desligado.
  if (body.ifoodSyncDeliveryTime === false) data.ifoodSyncDeliveryTime = false;
  else if (body.ifoodSyncDeliveryTime === true) avisos.push("A sincronização do tempo de entrega com o iFood está desligada até ser corrigida.");
  // O que a loja mostra na barra do painel de pedidos. Só booleanos entram: é
  // config de exibição, e aceitar objeto solto aqui viraria porta para gravar
  // qualquer coisa no registro da loja.
  if (body.painelPedidosConfig !== undefined) {
    const bruto = body.painelPedidosConfig;
    if (bruto === null) {
      data.painelPedidosConfig = null; // volta ao padrão: tudo ligado
    } else if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
      const limpo: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(bruto)) {
        if (/^[a-zA-Z0-9_]{1,40}$/.test(k)) limpo[k] = Boolean(v);
      }
      data.painelPedidosConfig = limpo;
    }
  }
  // O que o app dos entregadores faz na hora da entrega — só as chaves
  // conhecidas, só booleano (lib/app-motoboy-config.ts).
  if (body.appMotoboyConfig !== undefined) {
    const { limparAppMotoboyConfig } = await import("@/lib/app-motoboy-config");
    data.appMotoboyConfig = limparAppMotoboyConfig(body.appMotoboyConfig);
  }

  // ── Abre e fecha sozinha no horário (lib/abertura-da-loja.ts) ──────────
  // É da LOJA: o cron lê o registro do dono, então vai para o dono mesmo
  // quando quem salva é funcionário. Ligar limpa o carimbo do turno — senão
  // um turno que a abertura já tinha carimbado antes de ser desligada não
  // abriria de novo, e "liguei e nada aconteceu" seria a primeira impressão.
  if (typeof body.aberturaAutomatica === "boolean") {
    const lojaId = (currentUser as any).ownerId || currentUser.id;
    const dono = await prisma.user.findUnique({ where: { id: lojaId }, select: { aberturaEstado: true } });
    const estado: any = { ...((dono?.aberturaEstado as any) || {}) };
    if (body.aberturaAutomatica) {
      delete estado.abriu;
      delete estado.fechou;
    }
    await prisma.user.update({
      where: { id: lojaId },
      data: { aberturaAutomatica: body.aberturaAutomatica, aberturaEstado: estado },
    });
  }

  if (loja.id === currentUser.id) {
    await prisma.user.update({ where: { id: currentUser.id }, data: { ...data, ...daLoja } });
  } else {
    // Conta de funcionário: o dele na linha dele, a entrega na do dono — as
    // duas juntas ou nenhuma.
    await prisma.$transaction([
      prisma.user.update({ where: { id: currentUser.id }, data }),
      ...(Object.keys(daLoja).length ? [prisma.user.update({ where: { id: loja.id }, data: daLoja })] : []),
    ]);
  }

  // ── Sincronizar cidade e dados da loja para todos os funcionários da equipe ──
  if (data.city !== undefined || data.storeName !== undefined || data.cpfCnpj !== undefined || data.storeTimezone !== undefined) {
    const staffUpdates: any = {};
    if (data.city !== undefined) staffUpdates.city = data.city;
    if (data.storeName !== undefined) staffUpdates.storeName = data.storeName;
    if (data.cpfCnpj !== undefined) staffUpdates.cpfCnpj = data.cpfCnpj;
    if (data.storeTimezone !== undefined) staffUpdates.storeTimezone = data.storeTimezone;

    await prisma.user.updateMany({
      where: { ownerId: currentUser.id },
      data: staffUpdates,
    });
  }

  // O ponto da loja e o modo de medição ficam em cache por 10 min para não
  // consultar o banco a cada pedido importado (lib/distancia-da-entrega.ts).
  // Quem acabou de arrastar o pino no mapa não pode esperar esses 10 minutos
  // para o próximo pedido nascer com a distância certa.
  esquecerPontoDaLoja(loja.id);

  // ── SINCRONIZAÇÃO DE TEMPO COM O iFOOD: DESLIGADA ────────────────────
  //
  // Existia aqui um bloco que, com `ifoodSyncDeliveryTime` ligado, listava
  // TODOS os merchants do token centralizado do iFood (client_credentials,
  // lib/ifood-api.ts), mudava o tempo de PREPARO do primeiro que aceitasse —
  // que podia ser OUTRA loja da plataforma — e gravava o id desse merchant no
  // `ifoodMerchantId` desta loja. E o tempo mandado era a MÉDIA das faixas de
  // entrega, não o preparo. Nenhuma loja tinha o toggle ligado em 25/09/2026 e
  // a tela não o mostra, mas bastava uma chamada à API para escrever na loja
  // errada. Volta quando usar só o merchant da própria loja (contextoIfood),
  // sem iterar lista, e mandar o tempo de preparo de verdade.
  //
  // `ifoodSync: null` fica na resposta para as telas que ainda leem o campo.
  return NextResponse.json({ success: true, ifoodSync: null, ...(avisos.length ? { avisos } : {}) });
}
