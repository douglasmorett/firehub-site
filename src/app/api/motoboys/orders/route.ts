import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { viradaDoExpedienteDaLoja } from "@/lib/fuso";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { gpsForaDoHorario } from "@/lib/app-motoboy/gps-no-horario";
import { lerAppMotoboyConfig } from "@/lib/app-motoboy-config";
import { cobrancaNaEntrega, FORMAS_DE_PAGAMENTO_NA_ENTREGA } from "@/lib/pagamento-na-entrega";
import { camposDoApp, pontoNoMapa } from "@/lib/app-motoboy/pedido-no-app";
import { previsaoDaEntrega } from "@/lib/previsao-da-entrega";
import { limitesDoAlerta } from "@/lib/relatorios/tempos";
import { ehPedido99Food } from "@/lib/food99-status";
import { codigoJaConferido, jaSaiuNoParceiro } from "@/lib/codigo-de-entrega";
import { podeMarcarEntregueDepoisDeCancelado } from "@/lib/entregue-depois-de-cancelado";
import { despacharRota, ofereceARota, outrosDaRota, podePuxarARota } from "@/lib/despacho-da-rota";
import { lerRoteirizacaoAutomatica, type QuemPuxa } from "@/lib/roteirizacao-automatica/config";
import { avisoDaRotaFoiComOutro, quemPerdeAChamada } from "@/lib/roteirizacao-automatica/chamada";
import { registrarNaRota } from "@/lib/roteirizacao-automatica/historico-da-rota";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // O app nativo chama com a sessão assinada e `formato=app`; a página web,
    // com o par solto na URL. Sessão que não confere não cai para o par.
    const { temSessaoAssinada, exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const daSessao = temSessaoAssinada(req) ? await exigirMotoboy(req) : null;
    if (temSessaoAssinada(req) && !daSessao) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
    }
    const motoboyId = daSessao?.id ?? searchParams.get("motoboyId");
    const storeId = daSessao?.franchiseeId ?? searchParams.get("storeId");
    const formatoDoApp = searchParams.get("formato") === "app";

    if (!motoboyId || !storeId) {
      return NextResponse.json({ error: "motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    // Entregador desativado no painel para de ver pedido NA HORA. Antes o
    // `active` só era conferido no login — e a sessão do app vive para sempre
    // no localStorage, então demitido continuava dentro.
    const motoboy = await prisma.motoboy.findFirst({
      where: { id: motoboyId, franchiseeId: storeId, active: true },
      select: { id: true },
    });
    if (!motoboy) {
      return NextResponse.json({ error: "Acesso encerrado. Fale com a loja.", precisaRelogar: true }, { status: 401 });
    }

    const storeOwner = await prisma.user.findUnique({
      where: { id: storeId },
      select: { storeTimezone: true, printerConfig: true, appMotoboyConfig: true, timeAlertConfig: true }
    });
    const tz = storeOwner?.storeTimezone || "America/Sao_Paulo";
    // O que o dono configurou para a hora da entrega (lembrar bebidas, pedir
    // o código do iFood). Vai junto com os pedidos, como as palavras de bebida.
    const appConfig = lerAppMotoboyConfig(storeOwner?.appMotoboyConfig);

    // As palavras de bebida PERSONALIZADAS da loja ("guaravita", marca local…)
    // valem para o aviso do motoboy tanto quanto para a etiqueta da impressora.
    // Sem elas, a bebida que só a loja conhece passava sem o "você entregou?".
    const customBeverageKeywords = (storeOwner?.printerConfig as any)?.customBeverageKeywords || "";

    // Janela pelo EXPEDIENTE (vira às 5h), não pela meia-noite: o contador
    // "CONCLUÍDAS HOJE" zerava às 00:00 no meio do turno, enquanto a tela de
    // motoboys da loja — que já usa expediente — seguia mostrando o total e
    // pagando a diária em cima dele.
    // E começa às 5h, não à meia-noite do dia operacional: com a meia-noite, a
    // entrega da 1h contava no turno dela e de novo no da noite seguinte
    // (viradaDoExpedienteDaLoja). Vale o carimbo da ENTREGA (deliveredAt), que
    // não muda depois; `updatedAt` só para pedido antigo sem carimbo.
    const todayStart = viradaDoExpedienteDaLoja(tz);

    // Piso para os PENDENTES: pedido esquecido de semanas atrás ficava na tela
    // do entregador para sempre, ocupando vaga do take:100 e abrindo espaço
    // para baixa acidental. 7 dias cobre qualquer pendência legítima.
    const pisoPendentes = new Date(Date.now() - 7 * 24 * 3600_000);

    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: storeId,
        motoboyId: motoboyId,
        OR: [
          // 1. Pedidos ativos pendentes de entrega (até 7 dias). As TRÊS
          // grafias de cancelado fora: só as inglesas eram filtradas — e o
          // sistema grava "CANCELADO": pedido cancelado com motoboy atribuído
          // era reenviado ao celular como pendente a cada 10s, para sempre.
          { status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] }, createdAt: { gte: pisoPendentes } },
          // 2. Pedidos entregues NESTE EXPEDIENTE por este motoboy
          { status: { in: [...STATUS_FINALIZADOS] }, deliveredAt: { gte: todayStart } },
          { status: { in: [...STATUS_FINALIZADOS] }, deliveredAt: null, updatedAt: { gte: todayStart } },
          // 3. Cancelados NESTE EXPEDIENTE que estavam com ele. Continuam na
          // tela, à parte e marcados CANCELADO (nunca como pendente): o
          // cliente cancela com o motoboy já na rua, recebe e paga — e é ele
          // quem informa "entregue mesmo cancelado" (Allan, Delícias de Casa,
          // 17/10/2026; lib/entregue-depois-de-cancelado.ts).
          { status: { in: [...STATUS_CANCELADOS] }, cancelledAt: { gte: todayStart } },
        ]
      },
      // ⚠️ `select` explícito, não `include`. O include trazia TODAS as colunas
      // do pedido e do produto para uma rota que não tem sessão: CPF do
      // cliente (customerCpfCnpj), QR do PIX, dados fiscais e até o CUSTO de
      // cada produto da loja. Nada disso é usado na tela do entregador.
      select: {
        id: true,
        dailyOrderNumber: true,
        ifoodReference: true,
        openDeliveryReference: true,
        customerName: true,
        customerPhone: true,
        customerAddress: true,
        // Só o app nativo usa (navegar pelo pino exato); sai da resposta da web.
        customerLatLng: true,
        // A previsão de entrega (lib/previsao-da-entrega.ts, a mesma da comanda).
        scheduledDatetime: true,
        tempoEntregaMin: true,
        paymentMethod: true,
        totalAmount: true,
        deliveryFee: true,
        changeAmount: true,
        notes: true,
        status: true,
        source: true,
        deliveryType: true,
        createdAt: true,
        updatedAt: true,
        motoboyPuxadoEm: true,
        // Para o app saber ANTES de dar baixa que este pedido do iFood exige o
        // código do cliente. O ifoodOrderId sai da resposta logo abaixo — o
        // app não precisa dele, e id de parceiro não viaja para o celular.
        ifoodDropCodeRequired: true,
        ifoodOrderId: true,
        // O código já conferido nesta entrega (o passo do código vem antes do
        // pagamento e da bebida): o app não pergunta de novo. Também sai da
        // resposta — o que o cliente ditou não viaja de volta.
        ifoodDropCodeInfo: true,
        // 99Food com entrega própria: todo pedido tem código do cliente.
        deliveryBy: true,
        openDeliveryOrderId: true,
        openDeliveryChannel: true,
        // O cancelado da lista (item 3 do OR): quando e por quê, e o que a
        // regra do "entregue mesmo cancelado" lê para dizer se ele pode
        // informar a entrega. Os de gateway, mesa e reposição saem da resposta.
        cancelledAt: true,
        cancelReason: true,
        tableSessionId: true,
        gatewayProvider: true,
        gatewayPaymentId: true,
        reposicao: true,
        items: {
          select: {
            quantity: true,
            productName: true,
            notes: true,
            comboSelections: true,
            menuProduct: { select: { name: true, category: true, isBeverage: true } },
          },
        },
        // Nome e cor da rota, para o app dizer DE QUAL rota cada parada é.
        routeSchedule: {
          select: { id: true, routeNumber: true, color: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    // A sequência da parada (1º, 2º, 3º…) mora numa coluna fora do schema
    // (ver /api/admin/coluna-sequencia-rota), então vem por SQL cru e é
    // mesclada aqui. Sem a coluna, todo mundo fica sem sequência e o app
    // ordena como sempre ordenou — nada quebra.
    let sequencias: Record<string, number> = {};
    try {
      const ids = orders.map((o) => o.id);
      if (ids.length > 0) {
        const rows = await prisma.$queryRaw<{ id: string; routeSequence: number | null }[]>`
          SELECT "id", "routeSequence" FROM "CustomerOrder"
          WHERE "id" = ANY(${ids}) AND "routeSequence" IS NOT NULL
        `;
        rows.forEach((r) => { if (r.routeSequence != null) sequencias[r.id] = Number(r.routeSequence); });
      }
    } catch {}

    const ordersComSequencia = orders.map(({ ifoodOrderId, ifoodDropCodeRequired, ifoodDropCodeInfo, deliveryBy, openDeliveryOrderId, openDeliveryChannel, tableSessionId, gatewayProvider, gatewayPaymentId, reposicao, ...o }) => {
      // Cancelado com ele neste expediente: a regra do "entregue mesmo
      // cancelado" decide AQUI se ele pode informar (só pedido da própria
      // loja) — o app e a página só olham o booleano.
      const cancelado = (STATUS_CANCELADOS as readonly string[]).includes(String(o.status));
      const podeInformarEntregue = cancelado && podeMarcarEntregueDepoisDeCancelado({
        ...o, ifoodOrderId, openDeliveryOrderId, openDeliveryChannel, tableSessionId, gatewayProvider, gatewayPaymentId, reposicao,
      }).pode;
      // O iFood marca "exige código" também em pedido que ELE entrega (195 no
      // banco em 11/09/2026, nenhum com motoboy da loja) — ali quem confere é o
      // entregador do iFood, não o nosso.
      const pedeIfood = appConfig.pedirCodigoEntrega && Boolean(ifoodDropCodeRequired) && Boolean(ifoodOrderId) && deliveryBy !== "IFOOD";
      const pede99 =
        appConfig.pedirCodigo99Food &&
        ehPedido99Food({ source: o.source, openDeliveryChannel, openDeliveryOrderId }) &&
        deliveryBy === "MERCHANT";
      // Código já aprovado nesta entrega (o app fechou entre o código e a
      // baixa): o próximo toque vai direto ao pagamento e à bebida.
      const jaConferido =
        (pedeIfood && codigoJaConferido(ifoodDropCodeInfo, "iFood")) ||
        (pede99 && codigoJaConferido(ifoodDropCodeInfo, "99Food"));
      // ── QUANTO RECEBER NA PORTA ──────────────────────────────────────
      //
      // Decidido AQUI, no servidor, e não no celular: a regra de "está pago
      // ou não" é leitura de texto livre (lib/pagamento-na-entrega.ts) e
      // precisa ser a mesma da comanda. Espalhar essa leitura pelas telas é
      // como o selo do canal acabou dizendo "Online" para pedido do 99Food.
      //
      // Sai `null` quando a loja desligou o aviso ou o pedido já está pago —
      // assim o app não precisa saber a regra, só olhar se veio algo.
      // Cancelado não tem o que receber (até alguém informar que entregou).
      const cobranca = appConfig.cobrarNaEntrega && !cancelado ? cobrancaNaEntrega(o as any) : null;
      const { customerLatLng, scheduledDatetime, tempoEntregaMin, ...semPonto } = o;
      const pedido = {
        ...semPonto,
        // Até quando o cliente espera receber: o motoboy vê a hora e a cor da
        // urgência (Lucas, Frangoso, 03/10/2026: "tinha que aparecer o
        // horário da entrega").
        previsaoEntrega: previsaoDaEntrega({ createdAt: o.createdAt, scheduledDatetime, tempoEntregaMin, deliveryType: o.deliveryType }),
        // O ponto para o entregador VER no mapa (pode ser aproximado).
        mapa: pontoNoMapa(customerLatLng),
        routeSequence: sequencias[o.id] ?? null,
        pedeCodigoEntrega: (pedeIfood || pede99) && !jaConferido,
        canalDoCodigo: pedeIfood ? "iFood" : pede99 ? "99Food" : null,
        codigoJaConferido: Boolean(jaConferido),
        cobrarNaEntrega: cobranca && cobranca.cobrar ? cobranca : null,
        cancelado,
        podeInformarEntregue,
      };
      if (!formatoDoApp) return pedido;
      return {
        ...pedido,
        ...camposDoApp(
          { ...pedido, customerLatLng },
          { palavrasDeBebida: customBeverageKeywords, lembrarBebidas: appConfig.lembrarBebidas },
        ),
      };
    });

    return NextResponse.json({
      success: true,
      orders: ordersComSequencia,
      customBeverageKeywords,
      appConfig,
      // Fora do horário da loja o app não liga o GPS (lib/app-motoboy/gps-no-horario.ts).
      ...(formatoDoApp ? { gpsForaDoHorario: await gpsForaDoHorario(storeId, motoboyId) } : {}),
      // As cores de urgência: os mesmos minutos do KDS e do painel (Alertas de
      // Produção). A conta é no celular, porque o relógio anda entre as buscas.
      alertaDeTempo: limitesDoAlerta(storeOwner?.timeAlertConfig),
      // As formas do "o cliente pagou com", na ordem da página web.
      ...(formatoDoApp ? { formasDePagamento: FORMAS_DE_PAGAMENTO_NA_ENTREGA } : {}),
    });

  } catch (err: any) {
    console.error("[Motoboy Orders API Error]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}

/**
 * PATCH /api/motoboys/orders  { orderId, motoboyId, storeId }
 *
 * O motoboy confirma a entrega — e a confirmação passa a EXISTIR.
 *
 * ── O botão nunca funcionou ─────────────────────────────────────────────────
 *
 * O app do motoboy chamava `PATCH /api/customer-order/status`, que só exporta
 * GET e PUT: todo toque devolvia 405. E mesmo que fosse PUT, aquela rota exige
 * sessão do painel (next-auth), que o motoboy não tem — o login dele é outro.
 * Como o app só tratava `res.ok` sem `else`, o entregador via o spinner rodar e
 * NADA acontecia, sem nenhuma mensagem. O pedido ficava pendente até alguém da
 * loja dar baixa à mão.
 *
 * ── Quem pode dar baixa em quê ──────────────────────────────────────────────
 *
 * A credencial aqui é a amarração: só se entrega pedido que está ATRIBUÍDO a
 * este motoboy NESTA loja. Um orderId de outra loja, ou de outro entregador,
 * não passa — é o mesmo vínculo que decide para quem o pedido aparece no app.
 *
 * ── Entregar não é só mudar status ──────────────────────────────────────────
 *
 * A rota do painel avisa o parceiro (iFood dispatch, Jotajá delivered, 99Food
 * delivered), dispara o WhatsApp do cliente e conta a venda no faturamento.
 * Quando o parceiro pede o código do cliente, é a conferência dele que fecha o
 * pedido lá (iFood CONCLUDED, 99Food 600).
 * Dar baixa por aqui sem esses efeitos deixaria o pedido "entregue" no FireHub
 * e aberto no parceiro — no 99Food, pedido aberto é cancelado por eles. Então
 * os mesmos efeitos rodam aqui, e nenhum deles pode derrubar a baixa em si:
 * falha de sync vira log, não erro para o entregador na rua.
 */
/**
 * POST /api/motoboys/orders  { codigo }   — PUXAR um pedido pela comanda
 * DELETE /api/motoboys/orders { codigo }  — soltar (10 min de arrependimento)
 *
 * O verbo do QR da comanda. O QR carrega só `AAAAMMDD-numero` (o número que já
 * sai impresso em corpo dobrado no topo do MESMO papel) — nada de token no
 * papel: a via grampeada no saco e a comanda no lixo não valem nada sozinhas.
 * Quem autoriza é a SESSÃO ASSINADA do motoboy logado (Authorization: Bearer),
 * obrigatória desde o primeiro dia: sem ela, isto seria um endpoint público de
 * escrita que destrava WhatsApp, iFood conclude e NFC-e.
 *
 * `motoboyId`/`storeId` NÃO viajam no corpo — saem da sessão. É o ponto todo.
 */
export async function POST(req: NextRequest) {
  try {
    const { exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const mb = await exigirMotoboy(req);
    if (!mb) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true }, { status: 401 });
    }

    const { checkRateLimit } = await import("@/lib/rateLimit");
    const rl = checkRateLimit(`motoboy-puxar:${mb.id}`, { windowMs: 60_000, maxRequests: 20 });
    if (!rl.allowed) return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });

    const { codigo, puxarRota } = await req.json().catch(() => ({} as any));
    // "Sim, puxar todos": levar a rota automática inteira deste pedido (§4.8).
    const querARota = puxarRota === true;
    const bruto = String(codigo || "").trim();
    // QR: AAAAMMDD-numero. Digitado: só o numero.
    const mQr = bruto.match(/^(\d{8})-(\d{1,6})$/);
    const mNum = bruto.match(/^(\d{1,6})$/);
    if (!mQr && !mNum) {
      return NextResponse.json({ error: "Código inválido. Use o número da comanda." }, { status: 400 });
    }

    const { chaveDoDiaSP, inicioDoDiaSP } = await import("@/lib/qr-puxar");
    const numero = Number(mQr ? mQr[2] : mNum![1]);

    // O contador diário reseta à MEIA-NOITE de SP, mas o expediente vira às 5h:
    // entre 00:00 e 05:00 o mesmo número existe duas vezes dentro do turno.
    // Quem digitasse "47" à 00:30 sem isto puxaria o pedido de OUTRO cliente.
    const agora = new Date();
    const hojeSP = chaveDoDiaSP(agora);
    const horaSP = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora));
    const ontemSP = chaveDoDiaSP(new Date(agora.getTime() - 24 * 3600_000));
    const chavesValidas = horaSP < 5 ? [hojeSP, ontemSP] : [hojeSP];

    let chaves: string[];
    if (mQr) {
      if (!chavesValidas.includes(mQr[1])) {
        return NextResponse.json({ error: "Esta comanda não é do expediente de hoje." }, { status: 409 });
      }
      chaves = [mQr[1]];
    } else {
      chaves = chavesValidas;
    }

    const { STATUS_PUXAVEIS, STATUS_FINALIZADOS, STATUS_CANCELADOS } = await import("@/lib/status-pedido");
    const { infoDaEntrega } = await import("@/lib/entrega-parceira");

    // Candidatos por dia-chave (o índice franchiseeId+createdAt já existe).
    const candidatos: any[] = [];
    for (const chave of chaves) {
      const inicio = inicioDoDiaSP(chave);
      const achados = await prisma.customerOrder.findMany({
        where: {
          franchiseeId: mb.franchiseeId,
          dailyOrderNumber: numero,
          createdAt: { gte: inicio, lt: new Date(inicio.getTime() + 24 * 3600_000) },
        },
        select: {
          id: true, status: true, motoboyId: true, deliveryType: true, deliveryBy: true,
          source: true, openDeliveryChannel: true, ifoodDriverName: true,
          ifoodDriverStatus: true, ifoodPickupCode: true, dailyOrderNumber: true,
          motoboy: { select: { name: true } },
          // Para avisar os parceiros que o pedido saiu (bloco depois do claim).
          franchiseeId: true, ifoodOrderId: true, openDeliveryOrderId: true,
          openDeliveryReference: true, food99AppShopId: true,
          // A rota do pedido: a automática oferece levar o grupo (§4.8).
          routeId: true,
        },
      });
      candidatos.push(...achados);
    }

    if (candidatos.length === 0) {
      return NextResponse.json({ error: `Não achei o pedido #${numero} de hoje. Confira o número.` }, { status: 404 });
    }

    // `dailyOrderNumber` é da LOJA INTEIRA: mesa, balcão, totem e marketplaces
    // usam a mesma sequência. Sem este filtro dava para puxar — e "entregar" —
    // a comanda de quem está comendo no salão, disparando NFC-e e o WhatsApp
    // "seu pedido chegou". Entrega parceira (motoboy do iFood) também fica fora.
    const entregaveis = candidatos.filter(
      (p) => p.deliveryType === "DELIVERY" && !infoDaEntrega(p).parceira
    );
    if (entregaveis.length === 0) {
      return NextResponse.json({ error: "Este pedido não é uma entrega da loja." }, { status: 409 });
    }

    const puxaveis = entregaveis.filter((p) => (STATUS_PUXAVEIS as readonly string[]).includes(p.status) && !p.motoboyId);
    const alvo = puxaveis[0] ?? entregaveis[0];
    if (entregaveis.length > 1 && puxaveis.length !== 1) {
      return NextResponse.json({ error: "Há mais de um pedido com este número. Confirme com a loja." }, { status: 409 });
    }

    // ── A ROTA 100% AUTOMATIZADA: DE QUEM É A ROTA CHAMADA ──────────────────
    //
    // 22/10/2026 (plano "despacho automático", D11/D12): o servidor monta a
    // rota sem motoboy e, quando fica pronta, CHAMA um (o que chegou primeiro
    // na loja) ou todos (ninguém na loja). Com "só o chamado" (o padrão), outro
    // entregador que escanear um pedido dela é barrado ANTES do claim — nem um
    // pedido só sai do grupo; trocar é com a loja, no card da rota. Chamada
    // para todos, ou com "quem escanear primeiro", passa e ele vira o chamado.
    // Rota montada à mão não entra aqui (v1): o puxar segue como sempre.
    const rota = alvo.routeId ? await rotaAutomaticaAberta(alvo.routeId) : null;
    let quemPuxa: QuemPuxa = "chamado";
    let lojaId = mb.franchiseeId;
    if (rota) {
      const dono = await prisma.user.findUnique({ where: { id: mb.franchiseeId }, select: { ownerId: true, deliveryConfig: true } });
      const loja = dono?.ownerId
        ? await prisma.user.findUnique({ where: { id: dono.ownerId }, select: { deliveryConfig: true } })
        : dono;
      lojaId = dono?.ownerId || mb.franchiseeId;
      quemPuxa = lerRoteirizacaoAutomatica(loja?.deliveryConfig).quemPuxa;
      // O pedido que já é dele (duplo toque) não muda de dono: só barra quem
      // vai levar algo — o pedido livre, ou o resto da rota.
      if (rota.chamadaEm && (!alvo.motoboyId || querARota)) {
        const recusa = await reservarARota(rota, quemPuxa, mb);
        if (recusa) return recusa;
      }
    }

    // ── ESCRITA ATÔMICA: o Postgres decide a corrida de dois motoboys ───────
    // `motoboyId: null` no WHERE — o segundo scan espera o lock, reavalia
    // contra o commit do primeiro, casa zero linhas. Sem findFirst+update, que
    // é como se perde a corrida em silêncio.
    const r = await prisma.customerOrder.updateMany({
      where: {
        id: alvo.id,
        franchiseeId: mb.franchiseeId,
        motoboyId: null,
        deliveryType: "DELIVERY",
        status: { in: [...STATUS_PUXAVEIS] },
      },
      data: { motoboyId: mb.id, motoboyPuxadoEm: new Date() },
    });

    if (r.count === 0) {
      const agora2 = await prisma.customerOrder.findUnique({
        where: { id: alvo.id },
        select: { status: true, motoboyId: true, motoboy: { select: { name: true } } },
      });
      if (agora2?.motoboyId === mb.id) {
        // Duplo toque ou 4G repetindo o request: o pedido já é dele. Tela
        // vermelha aqui seria pior que o problema.
        // É também o caminho do "Sim, puxar todos": o pedido do QR já é dele
        // desde o primeiro POST, e agora leva o resto da rota.
        avisarSeLevouAChamadaDeTodos(rota, mb);
        if (rota && querARota) return puxarARota(rota, lojaId, mb, alvo.id, numero);
        const daRota = rota ? await rotaNaResposta(rota, quemPuxa, mb, alvo.id) : undefined;
        return NextResponse.json({ success: true, jaEraSeu: true, orderId: alvo.id, numero, ...(daRota ? { rota: daRota } : {}) });
      }
      if (agora2?.motoboyId) {
        const primeiroNome = String(agora2.motoboy?.name || "outro entregador").split(/\s+/)[0];
        return NextResponse.json({ erro: "PEGO", error: `Este pedido já foi puxado por ${primeiroNome}. Fale com a loja.` }, { status: 409 });
      }
      if (agora2 && (STATUS_FINALIZADOS as readonly string[]).includes(agora2.status)) {
        return NextResponse.json({ error: "Este pedido já foi finalizado." }, { status: 409 });
      }
      if (agora2 && (STATUS_CANCELADOS as readonly string[]).includes(agora2.status)) {
        return NextResponse.json({ error: "Este pedido foi CANCELADO — não entregue. Confirme com a loja." }, { status: 409 });
      }
      return NextResponse.json({ error: "Não consegui puxar este pedido. Confirme com a loja." }, { status: 409 });
    }

    console.log(`[Motoboy Puxou] pedido ${alvo.id} #${numero} loja ${mb.franchiseeId} por ${mb.id}/${mb.name}`);
    // Só depois do claim: o puxar que perdeu a corrida do pedido não "levou" nada.
    avisarSeLevouAChamadaDeTodos(rota, mb);

    // "Sim, puxar todos" mandado já no primeiro POST: o pedido do QR sai junto
    // com o resto, pelo despacho da rota (um caminho só de efeitos).
    if (rota && querARota) return puxarARota(rota, lojaId, mb, alvo.id, numero);

    // Puxou um pedido só de uma rota: vai para o histórico oculto dela
    // (historico-da-rota.ts). O "puxar todos" anota no `puxarARota`.
    if (alvo.routeId) await registrarNaRota(alvo.routeId, [{ quem: `motoboy ${mb.name}`, acao: "puxou", pedido: numero, motivo: "só este, pelo QR" }]);

    // ── PUXOU = SAIU PARA ENTREGA ───────────────────────────────────────────
    //
    // O entregador escaneia a comanda com o saco na mão, na porta da loja. Isso
    // É o pedido saindo — e até aqui o puxar só gravava o nome dele: o card
    // ficava em "Em Produção" com o motoboy na rua, o iFood continuava "pronto
    // para retirada" (só descobria na entrega, pelo despacho tardio do PATCH), e
    // o cliente não recebia o "saiu para entrega" no WhatsApp. A Frangoso
    // resumiu como "quando o entregador pega o pedido, não atualiza sozinho"
    // (17/09/2026): a loja tinha que voltar ao painel e clicar em "Saiu".
    //
    // Agora o puxar faz o que o botão "Saiu" do painel faz (customer-order/
    // status): muda o status e avisa cada parceiro pelo seu caminho. O status
    // só avança — pedido já em rota não volta —, e a escrita é condicional
    // como o claim: quem perder a corrida com o painel não regride nada.
    // Os efeitos rodam em segundo plano e falham sozinhos: a resposta ao app
    // não espera parceiro nenhum. O "soltar" (DELETE) não desfaz o status —
    // o iFood já foi avisado; a loja arrasta o card de volta se for engano.
    const { STATUS_ANTES_DE_SAIR } = await import("@/lib/status-pedido");
    const saiuAgora =
      (STATUS_ANTES_DE_SAIR as readonly string[]).includes(alvo.status) &&
      (await prisma.customerOrder.updateMany({
        where: { id: alvo.id, motoboyId: mb.id, status: { in: [...STATUS_ANTES_DE_SAIR] } },
        data: { status: "SAIU_ENTREGA" },
      })).count === 1;

    if (saiuAgora) {
      console.log(`[Motoboy Puxou] pedido ${alvo.id} #${numero}: ${alvo.status} → SAIU_ENTREGA`);
      const pedido = alvo as any;
      // O cliente fica sabendo que saiu — a mesma mensagem do botão do painel.
      // Fora do bloco dos parceiros de propósito: lá dentro o aviso esperava
      // iFood/99Food/Brendi/Wabiz/JotaJá responderem (até dezenas de segundos)
      // e, se um travasse, o cliente nunca sabia que o pedido saiu.
      import("@/lib/order-notifications")
        .then((m) => m.sendOrderNotification(alvo.id, "SAIU_ENTREGA"))
        .catch(() => {});
      (async () => {
        const rotulo = "Motoboy Puxou → parceiro";
        if (pedido.ifoodOrderId) {
          try {
            const { acaoNoPedidoIfood, despacharNoIfood } = await import("@/lib/ifood-pedido");
            // Pedido que a loja ainda não aceitou no painel: o iFood exige o
            // confirm antes de qualquer outro passo. `despacharNoIfood` sobe o
            // resto da escada (startPreparation → readyToPickup → dispatch).
            if (pedido.status === "NOVO") await acaoNoPedidoIfood(pedido, "confirm", { rotulo });
            await despacharNoIfood(pedido, rotulo);
          } catch (e: any) {
            console.warn(`[${rotulo} iFood] erro:`, e?.message);
          }
        }
        if (pedido.openDeliveryOrderId) {
          try {
            const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
            const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");
            const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
            const { ehPedidoKeeta, sincronizarKeeta } = await import("@/lib/keeta/status");
            const { ehPedidoCardapioWeb, sincronizarCardapioWeb } = await import("@/lib/cardapioweb/status");
            const base = { openDeliveryOrderId: String(pedido.openDeliveryOrderId), franchiseeId: pedido.franchiseeId, status: pedido.status, deliveryBy: pedido.deliveryBy };
            if (ehPedidoKeeta(pedido)) {
              // Keeta antes de tudo: fora desta cadeia ela cairia no ramo do JotaJá.
              const r = await sincronizarKeeta({ ...base, deliveryType: pedido.deliveryType }, "SAIU_ENTREGA");
              if (r.erros.length > 0) console.error(`[${rotulo} Keeta] ${pedido.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
            } else if (ehPedidoCardapioWeb(pedido)) {
              // CardápioWeb também antes do ramo do JotaJá, pelo mesmo motivo.
              const r = await sincronizarCardapioWeb({ ...base, deliveryType: pedido.deliveryType }, "SAIU_ENTREGA", { limiteMs: 30_000 });
              if (r.erros.length > 0) console.error(`[${rotulo} CardápioWeb] ${pedido.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
            } else if (ehPedido99Food(pedido)) {
              // O 99Food quer saber quem leva: o mesmo entregador que puxou.
              const entregador = await prisma.motoboy
                .findUnique({ where: { id: mb.id }, select: { id: true, name: true, phone: true } })
                .catch(() => null);
              const r = await sincronizar99Food(
                { ...base, entregador: entregador ? { nome: entregador.name, telefone: entregador.phone, id: entregador.id } : { nome: mb.name, id: mb.id }, appShopId: pedido.food99AppShopId ?? null },
                "SAIU_ENTREGA",
              );
              if (r.erros.length > 0) console.error(`[${rotulo} 99Food] ${pedido.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
            } else if (ehPedidoBrendi(pedido)) {
              const r = await sincronizarBrendi({ ...base, openDeliveryOrderId: base.openDeliveryOrderId.replace(/_recovered$/, "") }, "SAIU_ENTREGA");
              if (r.erros.length > 0) console.error(`[${rotulo} Brendi] ${pedido.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
            } else if (ehPedidoWabiz(pedido)) {
              const r = await sincronizarWabiz(
                { openDeliveryOrderId: base.openDeliveryOrderId, openDeliveryReference: pedido.openDeliveryReference, franchiseeId: pedido.franchiseeId, deliveryType: pedido.deliveryType },
                "SAIU_ENTREGA",
              );
              if (r.erros.length > 0) console.error(`[${rotulo} Wabiz] ${pedido.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
            } else {
              // JotaJá: o Open Delivery recusa dispatch em pedido que não entrou em preparo.
              const { jotajaMutate } = await import("@/lib/jotaja-api");
              const odId = String(pedido.openDeliveryOrderId);
              if (pedido.status === "ACEITO" || pedido.status === "NOVO") {
                await jotajaMutate(`/v1/orders/${odId}/startPreparation`, { method: "POST" }, pedido.franchiseeId);
              }
              const r = await jotajaMutate(`/v1/orders/${odId}/dispatch`, { method: "POST" }, pedido.franchiseeId);
              console.log(`[${rotulo} JotaJá] dispatch ${odId}: ${r.status}`);
            }
          } catch (e: any) {
            console.warn(`[${rotulo}] erro:`, e?.message);
          }
        }
        // Puxar é a SAÍDA: é aqui que a NFC-e tem de sair (lib/fiscal-momento).
        try {
          const { emitirNfceAutomatica } = await import("@/lib/fiscal-automatico");
          emitirNfceAutomatica(alvo.id).catch(() => {});
        } catch {}
      })();
    }

    // Resposta MÍNIMA de propósito: o app refaz o GET. Devolver o pedido aqui
    // transformaria o claim num endpoint de leitura paginada de clientes.
    // A rota automática vai junto só com os NÚMEROS dos outros pedidos dela —
    // é o que a pergunta "puxar também?" mostra, antes de serem dele.
    const daRota = rota ? await rotaNaResposta(rota, quemPuxa, mb, alvo.id) : undefined;
    return NextResponse.json({ success: true, orderId: alvo.id, numero, saiuParaEntrega: saiuAgora, ...(daRota ? { rota: daRota } : {}) });
  } catch (err: any) {
    console.error("[Motoboy Puxar Error]", err);
    return NextResponse.json({ error: "Erro ao puxar o pedido" }, { status: 500 });
  }
}

// ── PUXAR A ROTA INTEIRA (Rota 100% automatizada, 22/10/2026) ──────────────
//
// O motoboy escaneia UM pedido de uma rota automática e o app pergunta "tem
// mais 2 com ele, puxar também?" (plano "despacho automático", D12). As
// regras puras (quem pode, quem é "outro da rota") moram em
// lib/despacho-da-rota.ts, com teste em scripts/teste-puxar-a-rota.ts.

type RotaAutomatica = {
  id: string;
  routeNumber: string;
  status: string;
  origem: string | null;
  chamadaEm: Date | null;
  chamadaMotoboyId: string | null;
  /** Só nesta requisição: este puxar tirou a rota da chamada para todos (ver `reservarARota`). */
  levouAChamadaDeTodos?: boolean;
};
type MotoboyDaSessao = { id: string; name: string; franchiseeId: string };

/**
 * A rota do pedido, se for AUTOMÁTICA e ainda aberta. `origem`, `chamadaEm` e
 * `chamadaMotoboyId` estão no schema, mas o client gerado de alguns ambientes
 * ainda não as conhece — daí o `as any`. Erro de leitura (coluna ainda não
 * criada pelo garantir-colunas) = sem rota: o puxar de um pedido nunca para
 * por causa disto.
 */
async function rotaAutomaticaAberta(routeId: string): Promise<RotaAutomatica | null> {
  try {
    const r = (await prisma.routeSchedule.findUnique({
      where: { id: routeId },
      select: { id: true, routeNumber: true, status: true, origem: true, chamadaEm: true, chamadaMotoboyId: true } as any,
    })) as unknown as RotaAutomatica | null;
    return r && ofereceARota(r) ? r : null;
  } catch (e: any) {
    console.warn("[Motoboy Puxou] rota automática ilegível:", e?.message);
    return null;
  }
}

/** O 409 de quem escaneou a rota chamada para OUTRO, com o primeiro nome dele. */
async function recusaRotaDeOutro(chamadaMotoboyId: string) {
  const outro = await prisma.motoboy.findUnique({ where: { id: chamadaMotoboyId }, select: { name: true } }).catch(() => null);
  const nome = String(outro?.name || "").trim().split(/\s+/)[0];
  return NextResponse.json(
    { erro: "ROTA_DE_OUTRO", error: `Esta rota é ${nome ? `do ${nome}` : "de outro entregador"}. Peça para a loja trocar.` },
    { status: 409 },
  );
}

/**
 * D11. Barra quem não pode levar a rota chamada; quem pode e ainda não era o
 * chamado VIRA o chamado. Condicional como o claim: dois motoboys escaneando
 * a rota chamada para todos no mesmo segundo — o Postgres decide e, com "só o
 * chamado", o segundo recebe a recusa.
 *
 * O push ROTA_FOI_COM_OUTRO só sai quando havia um chamado DE NOME e outro
 * levou: com "só o chamado" isso não acontece (o outro é barrado acima, e a
 * chamada para todos não tem nome); com "quem escanear primeiro" acontece se
 * a loja trocou para um entregador (card da rota) e outro escaneou antes.
 */
async function reservarARota(rota: RotaAutomatica, quemPuxa: QuemPuxa, mb: MotoboyDaSessao): Promise<NextResponse | null> {
  const motoboyId = mb.id;
  if (!podePuxarARota({ quemPuxa, chamadaEm: rota.chamadaEm, chamadaMotoboyId: rota.chamadaMotoboyId, motoboyId })) {
    return recusaRotaDeOutro(rota.chamadaMotoboyId!);
  }
  if (rota.chamadaMotoboyId === motoboyId) return null;
  const anterior = rota.chamadaMotoboyId;
  const r = await prisma.routeSchedule.updateMany({
    where: {
      id: rota.id,
      chamadaEm: { not: null },
      ...(quemPuxa === "chamado" ? { OR: [{ chamadaMotoboyId: null }, { chamadaMotoboyId: motoboyId }] } : {}),
    },
    data: { chamadaMotoboyId: motoboyId },
  } as any);
  if (r.count === 0 && quemPuxa === "chamado") {
    const agora = (await prisma.routeSchedule.findUnique({
      where: { id: rota.id },
      select: { chamadaMotoboyId: true } as any,
    })) as unknown as { chamadaMotoboyId: string | null } | null;
    if (agora?.chamadaMotoboyId && agora.chamadaMotoboyId !== motoboyId) return recusaRotaDeOutro(agora.chamadaMotoboyId);
  }
  const perdeu = r.count > 0 ? quemPerdeAChamada(anterior, motoboyId) : null;
  if (perdeu) {
    import("@/lib/app-motoboy/aparelhos")
      .then(({ avisarMotoboy }) => avisarMotoboy(perdeu, avisoDaRotaFoiComOutro(rota, mb.name)))
      .catch(() => {});
  }
  // A chamada era para TODOS e este é o primeiro dono: os outros livres
  // receberam "quem chegar primeiro sai com ela" e precisam saber que alguém
  // chegou (ROTA_JA_SAIU). O aviso sai depois do claim do pedido
  // (`avisarSeLevouAChamadaDeTodos`), não aqui — o claim ainda pode perder.
  // Com "só o chamado" a rota agora é dele (os outros são barrados acima);
  // com "quem escanear primeiro" o resto ainda pode ser escaneado por outro,
  // mas a corrida que o push anunciou tem vencedor — e é a ele que o app
  // oferece o resto.
  if (r.count > 0 && !anterior) rota.levouAChamadaDeTodos = true;
  rota.chamadaMotoboyId = motoboyId;
  return null;
}

/** O ROTA_JA_SAIU aos outros livres (executar.ts), em segundo plano, uma vez por requisição. */
function avisarSeLevouAChamadaDeTodos(rota: RotaAutomatica | null, mb: MotoboyDaSessao) {
  if (!rota?.levouAChamadaDeTodos) return;
  rota.levouAChamadaDeTodos = false;
  import("@/lib/roteirizacao-automatica/executar")
    .then(({ avisarQueARotaJaSaiu }) => avisarQueARotaJaSaiu({ rotaId: rota.id, quemLevou: { id: mb.id, nome: mb.name } }))
    .catch(() => {});
}

/** Os pedidos da rota, só com o que decide o puxar — nada do cliente. */
function pedidosDaRotaParaPuxar(rotaId: string, franchiseeId: string) {
  return prisma.customerOrder.findMany({
    where: { routeId: rotaId, franchiseeId },
    select: {
      id: true, dailyOrderNumber: true, motoboyId: true, deliveryType: true, deliveryBy: true, status: true,
      source: true, openDeliveryChannel: true, ifoodDriverName: true, ifoodDriverStatus: true, ifoodPickupCode: true,
    },
  });
}

/** Só os NÚMEROS, em ordem: é tudo o que a folha mostra antes de o pedido ser dele. */
const numerosDe = (pedidos: { dailyOrderNumber: number | null }[]): { numero: number }[] =>
  pedidos
    .map((p) => p.dailyOrderNumber)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)
    .map((numero) => ({ numero }));

/** O `rota` da resposta: só quando há outros para levar e ESTE motoboy pode levá-los. */
async function rotaNaResposta(rota: RotaAutomatica, quemPuxa: QuemPuxa, mb: MotoboyDaSessao, alvoId: string) {
  if (!podePuxarARota({ quemPuxa, chamadaEm: rota.chamadaEm, chamadaMotoboyId: rota.chamadaMotoboyId, motoboyId: mb.id })) return undefined;
  try {
    const outros = numerosDe(outrosDaRota(await pedidosDaRotaParaPuxar(rota.id, mb.franchiseeId), alvoId));
    if (outros.length === 0) return undefined;
    return { id: rota.id, routeNumber: rota.routeNumber, origem: "AUTO" as const, outros };
  } catch (e: any) {
    console.warn("[Motoboy Puxou] outros da rota:", e?.message);
    return undefined;
  }
}

/**
 * "Sim, puxar todos". O claim atômico de TODOS os puxáveis da rota (o mesmo
 * `motoboyId: null` no WHERE do pedido único: o que outro entregador pegou no
 * meio fica com ele) e o despacho da rota pelo caminho do /dispatch — rota
 * DISPATCHED, SAIU_ENTREGA, cliente avisado, iFood/99/Brendi/…, NFC-e e o
 * WhatsApp das paradas, depois da resposta. Sem o push "N entregas para
 * você": quem puxou foi ele.
 */
async function puxarARota(rota: RotaAutomatica, lojaId: string, mb: MotoboyDaSessao, alvoId: string, numero: number) {
  const { STATUS_PUXAVEIS, STATUS_ANTES_DE_SAIR } = await import("@/lib/status-pedido");
  const livres = outrosDaRota(await pedidosDaRotaParaPuxar(rota.id, mb.franchiseeId), alvoId);
  if (livres.length > 0) {
    await prisma.customerOrder.updateMany({
      where: {
        id: { in: livres.map((p) => p.id) },
        routeId: rota.id,
        franchiseeId: mb.franchiseeId,
        motoboyId: null,
        deliveryType: "DELIVERY",
        status: { in: [...STATUS_PUXAVEIS] },
      },
      data: { motoboyId: mb.id, motoboyPuxadoEm: new Date() },
    });
  }

  // Saem agora os da rota que são DELE e ainda não saíram: os que acabou de
  // ganhar, o do QR quando veio direto com `puxarRota` (do primeiro POST ele
  // já saiu sozinho) e um claim que ficou pela metade numa tentativa anterior
  // — repetir o "Sim" conserta. A rota vira DISPATCHED mesmo sem nenhum: os
  // pedidos dela já estão todos na rua com ele.
  const aSair = await prisma.customerOrder.findMany({
    where: { routeId: rota.id, franchiseeId: mb.franchiseeId, motoboyId: mb.id, status: { in: [...STATUS_ANTES_DE_SAIR] } },
    select: { id: true },
  });
  const d = await despacharRota({
    lojaId,
    rotaId: rota.id,
    motoboyId: mb.id,
    pedidoIds: aSair.map((p) => p.id),
    semPushAoMotoboy: true,
    agendar: after,
  });
  if (!d.ok) console.warn(`[Motoboy Puxou a Rota] ${rota.id}: despacho recusado (${d.erro})`);
  else if (d.mudou) {
    await registrarNaRota(rota.id, [{ quem: `motoboy ${mb.name}`, acao: "despachou", pedido: numero, motivo: "puxou a rota toda pelo QR" }]);
  }

  const depois = await pedidosDaRotaParaPuxar(rota.id, mb.franchiseeId);
  const meus = depois.filter((p) => p.motoboyId === mb.id && p.id !== alvoId && !(STATUS_CANCELADOS as readonly string[]).includes(p.status));
  const numeros = [numero, ...numerosDe(meus).map((n) => n.numero)];
  console.log(`[Motoboy Puxou a Rota] ${rota.routeNumber} (${rota.id}) loja ${mb.franchiseeId} por ${mb.id}/${mb.name}: #${numeros.join(", #")}`);

  return NextResponse.json({
    success: true,
    orderId: alvoId,
    numero,
    numeros,
    saiuParaEntrega: true,
    rota: { id: rota.id, routeNumber: rota.routeNumber, origem: "AUTO", outros: numerosDe(outrosDaRota(depois, alvoId)) },
  });
}

/** Soltar um pedido puxado por engano — só o PRÓPRIO, e só por 10 minutos. */
export async function DELETE(req: NextRequest) {
  try {
    const { exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const mb = await exigirMotoboy(req);
    if (!mb) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true }, { status: 401 });
    }
    const { checkRateLimit } = await import("@/lib/rateLimit");
    // 5/hora: "soltar" ilimitado fecharia o laço puxar→ler→soltar→N+1, que
    // vira um exportador paginado de clientes. Curto + logado + atribuível.
    const rl = checkRateLimit(`motoboy-soltar:${mb.id}`, { windowMs: 3_600_000, maxRequests: 5 });
    if (!rl.allowed) return NextResponse.json({ error: "Limite de devoluções por hora. Fale com a loja." }, { status: 429 });

    const { orderId } = await req.json().catch(() => ({} as any));
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const { STATUS_FINALIZADOS, STATUS_CANCELADOS } = await import("@/lib/status-pedido");
    const r = await prisma.customerOrder.updateMany({
      where: {
        id: String(orderId),
        franchiseeId: mb.franchiseeId,
        motoboyId: mb.id,
        motoboyPuxadoEm: { gte: new Date(Date.now() - 10 * 60_000) },
        status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
      },
      data: { motoboyId: null, motoboyPuxadoEm: null },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não dá mais para devolver este pedido — fale com a loja." }, { status: 409 });
    }
    console.log(`[Motoboy Soltou] pedido ${orderId} loja ${mb.franchiseeId} por ${mb.id}/${mb.name}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Motoboy Soltar Error]", err);
    return NextResponse.json({ error: "Erro ao devolver o pedido" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => ({} as any));
    const { orderId, codigo, semCodigo, pagamento } = corpo;
    // Só o passo do código, sem dar baixa: o app confere o código ANTES de
    // perguntar pagamento e bebida (lib/codigo-de-entrega.ts → codigoJaConferido).
    const apenasConferirCodigo = corpo?.apenasConferirCodigo === true;
    // App nativo: quem dá a baixa sai da sessão assinada, nunca do corpo.
    const { temSessaoAssinada, exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const daSessao = temSessaoAssinada(req) ? await exigirMotoboy(req) : null;
    if (temSessaoAssinada(req) && !daSessao) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
    }
    const motoboyId = daSessao?.id ?? corpo.motoboyId;
    const storeId = daSessao?.franchiseeId ?? corpo.storeId;
    if (!orderId || !motoboyId || !storeId) {
      return NextResponse.json({ error: "orderId, motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    // Demitido não dá baixa: `active` vale em toda rota de execução, não só
    // no login (a sessão do app vive para sempre no localStorage).
    const motoboyAtivo = await prisma.motoboy.findFirst({
      where: { id: String(motoboyId), franchiseeId: String(storeId), active: true },
      select: { id: true, name: true },
    });
    if (!motoboyAtivo) {
      return NextResponse.json({ error: "Acesso encerrado. Fale com a loja.", precisaRelogar: true }, { status: 401 });
    }

    const order = await prisma.customerOrder.findFirst({
      where: { id: String(orderId), franchiseeId: String(storeId), motoboyId: String(motoboyId) },
    });
    if (!order) {
      return NextResponse.json(
        { error: "Pedido não encontrado para este entregador nesta loja." },
        { status: 404 }
      );
    }

    // ── ENTREGUE MESMO DEPOIS DE CANCELADO ──────────────────────────────────
    //
    // O cliente cancelou com o motoboy já na rua, recebeu e pagou na porta
    // (Allan, Delícias de Casa, 17/10/2026). O pedido cancelado continua na
    // lista dele, marcado CANCELADO, e ele informa a entrega com a forma de
    // pagamento — o dinheiro entra no acerto dele e no caixa. A regra (só
    // pedido da própria loja, nunca de iFood/99/Keeta…) e a gravação são as
    // mesmas do painel (lib/entregue-depois-de-cancelado*.ts). É um caminho à
    // parte da baixa normal: sem código do parceiro, sem bebida, sem aviso ao
    // cliente (que recebeu o "cancelado").
    if (corpo?.entregueMesmoCancelado === true) {
      const { marcarEntregueDepoisDeCancelado, efeitosDoEntregueDepoisDeCancelado } = await import("@/lib/entregue-depois-de-cancelado-no-banco");
      const r = await marcarEntregueDepoisDeCancelado({
        pedidoId: order.id,
        lojaIds: [String(storeId)],
        motoboyId: String(motoboyId),
        forma: pagamento,
        trocoPara: corpo?.trocoPara,
        quem: `Motoboy ${motoboyAtivo.name}`,
      });
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
      if (!r.jaEstava) efeitosDoEntregueDepoisDeCancelado(r.pedido.id, r.pedido.franchiseeId);
      return NextResponse.json({ success: true, jaEntregue: r.jaEstava, entregueMesmoCancelado: true });
    }

    if ((STATUS_FINALIZADOS as readonly string[]).includes(order.status)) {
      return NextResponse.json({ success: true, jaEntregue: true });
    }
    if ((STATUS_CANCELADOS as readonly string[]).includes(order.status)) {
      return NextResponse.json({ error: "Este pedido foi CANCELADO — não entregue. Confirme com a loja." }, { status: 409 });
    }

    // ── CÓDIGO DE ENTREGA: CONFERE, MAS NUNCA PRENDE O ENTREGADOR ──────────
    //
    // Pedido que recebeu DELIVERY_DROP_CODE_REQUESTED só está entregue para o
    // iFood depois de verifyDeliveryCode com os 4 dígitos que o cliente dita.
    // Dar baixa sem isso deixava o pedido "entregue" aqui e sem confirmação
    // lá — e o iFood cancela por entrega não confirmada. A regra é da loja
    // (App Motoboys → configurações). `semCodigo` é a saída para o cliente
    // que não tem o código; fica no log com o entregador que decidiu.
    //
    // No 99Food a regra é outra: não há aviso por pedido — o guia oficial
    // trata o código como parte de toda entrega feita pela loja. Então todo
    // pedido do 99 com entrega própria pede, e a conferência é o endpoint
    // verifyDeliveryCode deles (23/07/2026), que já conclui o pedido lá.
    //
    // ── POR QUE FALHA TÉCNICA NÃO BLOQUEIA (correção de 12/09/2026) ─────────
    //
    // A primeira versão devolvia 502 quando o parceiro não respondia "sim" nem
    // "código errado" — e o entregador ficava preso na porta do cliente com
    // "O iFood não respondeu à conferência do código (403)". Era a maioria das
    // entregas: o dono mandou o print às 19:29 com o cliente esperando.
    //
    // A conta é assimétrica. Bloquear custa uma entrega parada na rua, um
    // cliente irritado e um motoboy sem saber o que fazer. Deixar passar custa
    // uma conferência que o parceiro não registrou — e a entrega, essa, foi
    // feita de verdade; quem prova isso é o entregador na porta.
    //
    // Então só UMA resposta bloqueia: o parceiro dizer, com todas as letras,
    // que o código está ERRADO. Todo o resto (403, 401, 5xx, timeout, loja sem
    // credencial) grava o diagnóstico em ifoodDropCodeInfo, conclui a entrega e
    // devolve um aviso para a tela do entregador.
    //
    // ── O 403 ERA O ENDPOINT, NÃO A LOJA (12/09/2026, noite) ────────────────
    //
    // O registro acima fez o que devia: as três entregas da Frangoso - Trindade
    // gravaram 403 "User is forbidden to access this resource" em TODAS as
    // credenciais. A conferência ia para o verifyDeliveryCode do módulo
    // Logistics, que o FireHub ainda não homologou. O de entrega própria é o do
    // módulo Order (ver conferirCodigoDeEntrega em lib/ifood-pedido.ts) — e é a
    // conferência aceita que conclui o pedido no iFood. A lojista via o motoboy
    // digitar o código e o pedido seguir aberto no iFood.
    const exigeCodigo =
      Boolean((order as any).ifoodDropCodeRequired) &&
      Boolean((order as any).ifoodOrderId) &&
      (order as any).deliveryBy !== "IFOOD"; // entrega do iFood: quem confere é o entregador deles
    const eh99Propria = ehPedido99Food(order as any) && (order as any).deliveryBy === "MERCHANT";
    let codigoConferido = false;
    let codigoConferido99 = false;
    /** O despacho no iFood já saiu nesta baixa, antes de conferir o código. */
    let despachouIfoodAgora = false;
    /** Vira aviso na tela do entregador quando a conferência não aconteceu. */
    let avisoCodigo: string | null = null;
    /** O que gravar no pedido sobre a tentativa (diagnóstico e auditoria). */
    let infoCodigo: Record<string, unknown> | null = null;
    // O código já foi aprovado no passo próprio (antes do pagamento e da
    // bebida). A plataforma já concluiu o pedido: conferir de novo seria
    // recusa ("já confirmado"/sem permissão) e prenderia uma entrega pronta.
    const jaConferido =
      (exigeCodigo && codigoJaConferido((order as any).ifoodDropCodeInfo, "iFood")) ||
      (!exigeCodigo && eh99Propria && codigoJaConferido((order as any).ifoodDropCodeInfo, "99Food"));
    if (jaConferido) {
      if (exigeCodigo) codigoConferido = true;
      else codigoConferido99 = true;
      if (apenasConferirCodigo) return NextResponse.json({ success: true, codigoConferido: true, jaConferido: true });
    }
    if ((exigeCodigo || eh99Propria) && !semCodigo && !jaConferido) {
      const loja = await prisma.user.findUnique({ where: { id: String(storeId) }, select: { appMotoboyConfig: true } });
      const cfg = lerAppMotoboyConfig(loja?.appMotoboyConfig);
      const canal = exigeCodigo ? "iFood" : "99Food";
      if (exigeCodigo ? cfg.pedirCodigoEntrega : cfg.pedirCodigo99Food) {
        const digitado = String(codigo ?? "").replace(/\D/g, "");
        if (!digitado) {
          return NextResponse.json(
            { error: `Este pedido do ${canal} pede o código de entrega do cliente.`, precisaCodigo: true, canalDoCodigo: canal },
            { status: 428 },
          );
        }
        // ── SEM CONFIRMAÇÃO DA PLATAFORMA, NÃO FECHA (04/10/2026) ───────────
        //
        // Até aqui, quando o iFood/99 não conferia (403 "Access Denied",
        // "No permission", rede), a entrega era concluída com qualquer código
        // — o Lucas (Frangoso) viu código errado finalizando. O dono decidiu:
        // "se eles não liberaram, não vai, e avisa código errado". O 403 do
        // iFood é intermitente (a reconferência do cron passava na 2ª), então
        // antes de recusar o servidor tenta de novo, até 3 vezes. A tentativa
        // recusada fica em ifoodDropCodeInfo como "nao-confirmado" (o cron de
        // reconferência só olha "indisponivel" — não mexe neste pedido aberto).
        const naoConfirmado = async (info: Record<string, unknown>, texto: string) => {
          await prisma.customerOrder
            .update({ where: { id: order.id }, data: { ifoodDropCodeInfo: { ...info, resultado: "nao-confirmado", quando: new Date().toISOString() } as any } })
            .catch(() => {});
          console.warn(`[Motoboy Entrega] ${canal} não confirmou o código de ${order.id} — entrega NÃO concluída (${JSON.stringify(info).slice(0, 200)})`);
          return NextResponse.json({ error: texto, codigoIncorreto: true, naoConfirmado: true }, { status: 422 });
        };
        const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

        if (!exigeCodigo) {
          const { conferirCodigoEntrega99 } = await import("@/lib/food99-status");
          const textoDoErro = (x: { errno: unknown; errmsg?: unknown }) => `${x.errno} ${x.errmsg || ""}`.toLowerCase();
          const ehErradoNo99 = (t: string) => /c[oó]digo|delivery_?code|verif|invalid|incorrect|wrong|not match|n[aã]o confere/.test(t);
          let r = await conferirCodigoEntrega99(
            { openDeliveryOrderId: String((order as any).openDeliveryOrderId), franchiseeId: order.franchiseeId },
            digitado,
          );
          for (let tentativa = 2; tentativa <= 3 && !r.conferido && !ehErradoNo99(textoDoErro(r)); tentativa++) {
            await esperar(1200);
            r = await conferirCodigoEntrega99(
              { openDeliveryOrderId: String((order as any).openDeliveryOrderId), franchiseeId: order.franchiseeId },
              digitado,
            );
          }
          // O que no 99Food significa "esse código está errado". Ainda não
          // sabemos o errno exato (nenhuma loja usou até hoje), então a
          // decisão é pela MENSAGEM — e, na dúvida, deixa passar. Cada
          // resposta real fica gravada abaixo, e é ela que vai fechar
          // esta lista.
          const textoErro = `${r.errno} ${r.errmsg || ""}`.toLowerCase();
          const ehCodigoErrado = /c[oó]digo|delivery_?code|verif|invalid|incorrect|wrong|not match|n[aã]o confere/.test(textoErro);
          infoCodigo = {
            canal: "99Food", digitado, errno: r.errno, resposta: String(r.errmsg || "").slice(0, 300),
            resultado: r.conferido ? "conferido" : ehCodigoErrado ? "errado" : "indisponivel",
            motoboyId: String(motoboyId),
          };
          if (r.conferido) {
            codigoConferido99 = true;
          } else if (ehCodigoErrado) {
            return NextResponse.json(
              { error: `O 99Food não aceitou este código (${r.errmsg}). Confira com o cliente e digite de novo.`, codigoIncorreto: true },
              { status: 422 },
            );
          } else {
            return naoConfirmado(infoCodigo, `O 99Food não confirmou este código. Confira com o cliente e digite de novo.`);
          }
        } else try {
          const { conferirCodigoDeEntrega, despacharNoIfood } = await import("@/lib/ifood-pedido");
          const rotulo = "Motoboy Entrega → iFood";
          // Pedido que não passou por SAIU_ENTREGA (o puxado pelo QR, ou a loja
          // que não despachou) ainda está na loja para o iFood. Despacha antes:
          // o guia do módulo Order põe o despacho antes da confirmação.
          if (order.deliveryType === "DELIVERY" && !jaSaiuNoParceiro(order.status)) {
            await despacharNoIfood(order as any, rotulo);
            despachouIfoodAgora = true;
          }
          let r = await conferirCodigoDeEntrega(order as any, digitado, rotulo);
          for (let tentativa = 2; tentativa <= 3 && r.resultado === "indisponivel"; tentativa++) {
            await esperar(1200);
            r = await conferirCodigoDeEntrega(order as any, digitado, rotulo);
          }
          infoCodigo = {
            canal: "iFood", endpoint: "order", digitado, status: r.status, origem: r.origem ?? null,
            resposta: String(r.texto || "").slice(0, 300),
            resultado: r.resultado, motoboyId: String(motoboyId),
          };
          if (r.resultado === "conferido") {
            codigoConferido = true;
            console.log(`[Motoboy Entrega] 🔐 código conferido no iFood para ${order.id}`);
          } else if (r.resultado === "errado") {
            return NextResponse.json(
              { error: "Código não confere. Confira com o cliente e digite de novo.", codigoIncorreto: true },
              { status: 422 },
            );
          } else {
            return naoConfirmado(infoCodigo, "O iFood não confirmou este código. Confira com o cliente e digite de novo.");
          }
        } catch (e: any) {
          return naoConfirmado(
            { canal: "iFood", digitado, status: 0, resposta: String(e?.message || "erro").slice(0, 300), motoboyId: String(motoboyId) },
            "Não consegui confirmar o código com o iFood. Tente de novo em instantes.",
          );
        }
      }
    }
    if ((exigeCodigo || eh99Propria) && semCodigo && !jaConferido) {
      // "O cliente não tem o código" só vale se a loja deixou (App Motoboys →
      // configurações; o dono, 04/10/2026: "escolhe na configuração").
      const lojaDoSem = await prisma.user.findUnique({ where: { id: String(storeId) }, select: { appMotoboyConfig: true } });
      if (!lerAppMotoboyConfig(lojaDoSem?.appMotoboyConfig).permitirSemCodigo) {
        return NextResponse.json(
          { error: "A loja não permite finalizar sem o código. Peça o código ao cliente ou fale com a loja.", semCodigoBloqueado: true },
          { status: 403 },
        );
      }
      console.warn(`[Motoboy Entrega] ⚠️ pedido ${order.id} (${exigeCodigo ? "iFood" : "99Food"}) baixado SEM código de entrega (motoboy ${motoboyId})`);
      infoCodigo = {
        canal: exigeCodigo ? "iFood" : "99Food", digitado: null,
        resultado: "sem-codigo", resposta: "cliente não tinha o código", motoboyId: String(motoboyId),
      };
    }

    // ── SÓ O PASSO DO CÓDIGO: GRAVA E VOLTA, SEM BAIXA ──────────────────────
    //
    // O entregador só abre a bag com o código aprovado; pagamento e bebida vêm
    // depois, e a baixa reconhece este registro (jaConferido, acima). Pedido
    // que não pede código (loja desligou, entrega do parceiro) segue direto.
    if (apenasConferirCodigo) {
      if (codigoConferido || codigoConferido99) {
        await prisma.customerOrder.update({
          where: { id: order.id },
          data: { ifoodDropCodeInfo: { ...(infoCodigo || {}), resultado: "conferido", quando: new Date().toISOString() } as any },
        });
        console.log(`[Motoboy Entrega] 🔐 código de ${order.id} aprovado antes da baixa (${exigeCodigo ? "iFood" : "99Food"})`);
        return NextResponse.json({ success: true, codigoConferido: true });
      }
      return NextResponse.json({ success: true, codigoDispensado: true });
    }

    // ── O CLIENTE PAGOU DE OUTRO JEITO ──────────────────────────────────────
    //
    // "Tava dinheiro e pagou no débito": o entregador informa na baixa e o
    // pedido passa a dizer a verdade. Sem isto o acerto do motoboy
    // (api/motoboy-report) cobrava dele um dinheiro que ele não recebeu, o
    // fechamento de caixa fechava na forma errada, e a loja consertava no
    // caderno (dono, 17/09/2026). Só quando não é pagamento online, e só se a
    // forma realmente mudou — confirmar "Dinheiro" num pedido em dinheiro não
    // vira registro. O rastro fica em editHistory, com o nome do entregador.
    //
    // A NFC-e normalmente já saiu quando o pedido saiu (lib/fiscal-momento),
    // com a forma de antes — e fica assim: a troca vale para o caixa e o
    // acerto, não para a nota, e o rastro diz com que forma a nota ficou
    // (avisoDaNotaNaTrocaDePagamento). Travar a troca por causa da nota
    // deixava o "Débito (Cobrar na Entrega)" pago em dinheiro com a forma
    // errada para sempre. Pedido que foi para a rua sem nota: a emissão logo
    // abaixo lê o pedido DEPOIS desta escrita e já sai na forma certa.
    const formaInformada = String(pagamento || "").trim();
    let trocaDePagamento: Record<string, unknown> = {};
    if (formaInformada) {
      const { FORMAS_DE_PAGAMENTO_NA_ENTREGA, formaCanonica, podeTrocarPagamento } = await import("@/lib/pagamento-na-entrega");
      const { avisoDaNotaNaTrocaDePagamento, empilharEdicao } = await import("@/lib/edicao-de-pedido");
      const valida = (FORMAS_DE_PAGAMENTO_NA_ENTREGA as readonly string[]).includes(formaInformada);
      const mudou = formaCanonica(order.paymentMethod) !== formaInformada;
      if (valida && mudou && podeTrocarPagamento(order as any).pode) {
        const notaFica = avisoDaNotaNaTrocaDePagamento(order, formaInformada);
        trocaDePagamento = {
          paymentMethod: formaInformada,
          // Troco é conta de dinheiro; em cartão, pix ou vale não existe.
          changeAmount: formaInformada === "Dinheiro" ? ((order as any).changeAmount ?? null) : null,
          ...((order as any).paymentMethods != null ? { paymentMethods: Prisma.DbNull } : {}),
          editHistory: empilharEdicao((order as any).editHistory, {
            quando: new Date().toISOString(),
            quem: `Motoboy ${motoboyAtivo.name}`,
            acao: "PAGAMENTO",
            descricao:
              `Pagamento: ${order.paymentMethod || "não informado"} → ${formaInformada} (informado na entrega)` +
              (notaFica ? ` — ${notaFica.rastro}` : ""),
            totalAntes: order.totalAmount,
            totalDepois: order.totalAmount,
          }),
        };
        console.log(`[Motoboy Entrega] 💳 pagamento de ${order.id}: ${order.paymentMethod} → ${formaInformada} (${motoboyAtivo.name})`);
      }
    }

    // ── ESCRITA ATÔMICA: o Postgres decide a corrida ────────────────────────
    //
    // Dois toques rápidos no botão (ou o mesmo request duplicado pelo 4G)
    // passavam os DOIS pelo findFirst acima — e cada um disparava iFood
    // conclude, WhatsApp "seu pedido chegou", faturamento e NFC-e. Em dobro.
    //
    // O updateMany condicional só casa a linha cujo status AINDA não é final:
    // o segundo request espera o lock, reavalia o WHERE contra o commit do
    // primeiro, casa zero linhas — e os efeitos só rodam quando count === 1.
    const escrita = await prisma.customerOrder.updateMany({
      where: {
        id: order.id,
        status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
      },
      data: {
        status: "ENTREGUE", kdsStage: "FINISHED", kdsStationId: null,
        // A forma de pagamento real, se o entregador informou outra (acima).
        ...trocaDePagamento,
        // ⚠️ NÃO carimbar `ifoodDriverStatus: "DELIVERED"` aqui.
        //
        // Quem confere o código neste caminho é o motoboy DA LOJA, em entrega
        // própria. `ifoodDriverStatus` descreve o entregador DO IFOOD, e
        // DELIVERED é um dos estados que o painel e `infoDaEntrega` aceitam
        // como prova de entrega parceira. O carimbo, copiado da aba Entrega
        // (que é do entregador parceiro), fazia todo pedido conferido pelo app
        // virar "Motoboy iFood" ao chegar em Finalizado, com o entregador que
        // fez a corrida sumindo do card. A Frangoso - Trindade teve 53 pedidos
        // assim entre 12 e 17/09/2026 — a única loja conferindo código pelo
        // app, e a maioria dos pedidos dela nasce sem `deliveryBy`, então nem a
        // regra "entrega própria declarada" segurava.
        //
        // A conferência já fica registrada em ifoodDropCodeInfo (resultado:
        // "conferido"), que é o que interessa para auditoria.
        //
        // Fica no pedido: o que o entregador digitou e o que o parceiro
        // respondeu. Sem isto, "deu erro" é tudo o que se sabe no dia seguinte.
        ...(infoCodigo ? { ifoodDropCodeInfo: { ...infoCodigo, quando: new Date().toISOString() } } : {}),
      },
    });
    if (escrita.count === 0) {
      const agora = await prisma.customerOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      if (agora && (STATUS_CANCELADOS as readonly string[]).includes(agora.status)) {
        return NextResponse.json({ error: "Este pedido foi CANCELADO — não entregue. Confirme com a loja." }, { status: 409 });
      }
      return NextResponse.json({ success: true, jaEntregue: true });
    }

    // ── Efeitos da entrega, em segundo plano ────────────────────────────────
    // O entregador está na porta do cliente com o celular na mão: a resposta
    // não espera parceiro nenhum. Cada efeito falha sozinho e vira log.
    (async () => {
      // iFood: o pedido de entrega própria fecha lá pela conferência do código
      // (feita acima) ou sozinho, 4h depois ("16. Conclusão automática" do
      // guia do módulo Order). O `conclude` que era chamado aqui não existe na
      // lista de endpoints do módulo — o que resta a fazer é garantir que o
      // iFood saiba que o pedido saiu. Com a credencial do dono do pedido: o
      // app do motoboy não tem sessão de lojista.
      if ((order as any).ifoodOrderId && order.deliveryType === "DELIVERY" && !codigoConferido && !despachouIfoodAgora) {
        try {
          const { acaoNoPedidoIfood, despacharNoIfood } = await import("@/lib/ifood-pedido");
          const rotulo = "Motoboy Entrega → iFood";
          if (jaSaiuNoParceiro(order.status)) {
            await acaoNoPedidoIfood(order, "dispatch", { rotulo });
          } else {
            await despacharNoIfood(order as any, rotulo);
          }
        } catch (e: any) {
          console.warn("[Motoboy Entrega → iFood] erro:", e?.message);
        }
      }

      // 99Food e Jotajá dividem o campo openDeliveryOrderId; o canal separa.
      if ((order as any).openDeliveryOrderId) {
        try {
          const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
          const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
          const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");
          const { ehPedidoKeeta, sincronizarKeeta } = await import("@/lib/keeta/status");
          const { ehPedidoCardapioWeb, sincronizarCardapioWeb } = await import("@/lib/cardapioweb/status");
          // Keeta e CardápioWeb antes de tudo: fora desta cadeia cairiam no ramo do JotaJá.
          if (ehPedidoKeeta(order as any)) {
            await sincronizarKeeta(
              {
                openDeliveryOrderId: (order as any).openDeliveryOrderId,
                franchiseeId: order.franchiseeId,
                status: order.status,
                deliveryBy: (order as any).deliveryBy,
                deliveryType: (order as any).deliveryType,
              },
              "ENTREGUE"
            );
          } else if (ehPedidoCardapioWeb(order as any)) {
            // Sobe o que faltar (despachar, entregue) e finaliza lá.
            await sincronizarCardapioWeb(
              {
                openDeliveryOrderId: (order as any).openDeliveryOrderId,
                franchiseeId: order.franchiseeId,
                status: order.status,
                deliveryBy: (order as any).deliveryBy,
                deliveryType: (order as any).deliveryType,
                notes: (order as any).notes,
              },
              "ENTREGUE",
              { limiteMs: 30_000 }
            );
          } else if (ehPedidoWabiz(order as any)) {
            await sincronizarWabiz(
              {
                openDeliveryOrderId: (order as any).openDeliveryOrderId,
                openDeliveryReference: (order as any).openDeliveryReference,
                franchiseeId: order.franchiseeId,
                deliveryType: (order as any).deliveryType,
              },
              "ENTREGUE"
            );
          } else if (ehPedidoBrendi(order as any)) {
            // ── A BAIXA DO ENTREGADOR FECHA O PEDIDO NA BRENDI ──────────────
            //
            // Aqui havia um ramo VAZIO, com o comentário "a Brendi não recebe
            // `delivered` por aqui" — que só dizia que ela não é JotaJá, não um
            // motivo. Resultado: a entrega dada pelo app do motoboy, que é como
            // a loja fecha o pedido no dia a dia, nunca chegava à Brendi. O
            // pedido ficava "saiu para entrega" no painel deles para sempre, e
            // o cliente sem a confirmação.
            //
            // `sincronizarBrendi` sobe a escada inteira que faltar (confirm →
            // preparing → readyForPickup → dispatch → delivered) e respeita as
            // bandeiras do pedido — `sendPickedUp` fecha retirada,
            // `sendDelivered` fecha entrega. Falha aqui nunca derruba a baixa:
            // a função não lança, e o pedido já está ENTREGUE no FireHub.
            await sincronizarBrendi(
              {
                openDeliveryOrderId: String((order as any).openDeliveryOrderId).replace(/_recovered$/, ""),
                franchiseeId: order.franchiseeId,
                status: order.status,
                deliveryBy: (order as any).deliveryBy,
              },
              "ENTREGUE"
            );
          } else if (ehPedido99Food(order as any) && codigoConferido99) {
            // O verifyDeliveryCode já concluiu o pedido lá (status 600); o
            // `delivered` em cima disso seria recusa à toa no log.
            console.log(`[Motoboy Entrega → 99Food] ${(order as any).openDeliveryOrderId} concluído pelo código de entrega`);
          } else if (ehPedido99Food(order as any)) {
            await sincronizar99Food(
              {
                openDeliveryOrderId: (order as any).openDeliveryOrderId,
                franchiseeId: order.franchiseeId,
                status: order.status,
                deliveryBy: (order as any).deliveryBy,
              },
              "ENTREGUE"
            );
          } else {
            const { jotajaMutate } = await import("@/lib/jotaja-api");
            const r = await jotajaMutate(`/v1/orders/${(order as any).openDeliveryOrderId}/delivered`, { method: "POST" }, order.franchiseeId);
            console.log(`[Motoboy Entrega → Jotajá] delivered ${(order as any).openDeliveryOrderId}: ${r.status}`);
          }
        } catch (e: any) {
          console.warn("[Motoboy Entrega → parceiro] erro:", e?.message);
        }
      }

      // Cliente fica sabendo que chegou; venda entra no ciclo do faturamento.
      try {
        const { sendOrderNotification } = await import("@/lib/order-notifications");
        sendOrderNotification(order.id, "ENTREGUE").catch(() => {});
      } catch {}
      try {
        const { trackSaleForBilling } = await import("@/lib/billing");
        trackSaleForBilling(order.franchiseeId).catch(() => {});
      } catch {}
      // NFC-e automática, se a loja marcou esta forma de pagamento na tela
      // fiscal. Normalmente ela já saiu no "puxar" (a saída); aqui é o
      // último momento para o pedido que foi para a rua sem passar por lá.
      try {
        const { emitirNfceAutomatica } = await import("@/lib/fiscal-automatico");
        emitirNfceAutomatica(order.id).catch(() => {});
      } catch {}
    })();

    return NextResponse.json({ success: true, ...(avisoCodigo ? { avisoCodigo } : {}) });
  } catch (err: any) {
    console.error("[Motoboy Orders PATCH Error]", err);
    return NextResponse.json({ error: "Erro ao confirmar a entrega" }, { status: 500 });
  }
}
