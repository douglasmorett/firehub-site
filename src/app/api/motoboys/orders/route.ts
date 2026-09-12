import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inicioDoExpedienteDaLoja } from "@/lib/fuso";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { lerAppMotoboyConfig } from "@/lib/app-motoboy-config";
import { ehPedido99Food } from "@/lib/food99-status";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const motoboyId = searchParams.get("motoboyId");
    const storeId = searchParams.get("storeId");

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
      select: { storeTimezone: true, printerConfig: true, appMotoboyConfig: true }
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
    const todayStart = inicioDoExpedienteDaLoja(tz);

    // Piso para os PENDENTES: pedido esquecido de semanas atrás ficava na tela
    // do entregador para sempre, ocupando vaga do take:100 e abrindo espaço
    // para baixa acidental. 7 dias cobre qualquer pendência legítima.
    const pisoPendentes = new Date(Date.now() - 7 * 24 * 3600_000);

    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: storeId,
        motoboyId: motoboyId,
        // As TRÊS grafias de cancelado. Só as inglesas eram filtradas — e o
        // sistema grava "CANCELADO": pedido cancelado com motoboy atribuído
        // era reenviado ao celular a cada 10s, para sempre.
        status: { notIn: [...STATUS_CANCELADOS] },
        OR: [
          // 1. Pedidos ativos pendentes de entrega (até 7 dias)
          { status: { notIn: [...STATUS_FINALIZADOS] }, createdAt: { gte: pisoPendentes } },
          // 2. Pedidos entregues NESTE EXPEDIENTE por este motoboy
          {
            status: { in: [...STATUS_FINALIZADOS] },
            updatedAt: { gte: todayStart }
          }
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
        // 99Food com entrega própria: todo pedido tem código do cliente.
        deliveryBy: true,
        openDeliveryOrderId: true,
        openDeliveryChannel: true,
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

    const ordersComSequencia = orders.map(({ ifoodOrderId, ifoodDropCodeRequired, deliveryBy, openDeliveryOrderId, openDeliveryChannel, ...o }) => {
      // O iFood marca "exige código" também em pedido que ELE entrega (195 no
      // banco em 11/09/2026, nenhum com motoboy da loja) — ali quem confere é o
      // entregador do iFood, não o nosso.
      const pedeIfood = appConfig.pedirCodigoEntrega && Boolean(ifoodDropCodeRequired) && Boolean(ifoodOrderId) && deliveryBy !== "IFOOD";
      const pede99 =
        appConfig.pedirCodigo99Food &&
        ehPedido99Food({ source: o.source, openDeliveryChannel, openDeliveryOrderId }) &&
        deliveryBy === "MERCHANT";
      return {
        ...o,
        routeSequence: sequencias[o.id] ?? null,
        pedeCodigoEntrega: pedeIfood || pede99,
        canalDoCodigo: pedeIfood ? "iFood" : pede99 ? "99Food" : null,
      };
    });

    return NextResponse.json({ success: true, orders: ordersComSequencia, customBeverageKeywords, appConfig });

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
 * A rota do painel avisa o parceiro (iFood conclude, Jotajá delivered, 99Food
 * delivered), dispara o WhatsApp do cliente e conta a venda no faturamento.
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

    const { codigo } = await req.json().catch(() => ({} as any));
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
        return NextResponse.json({ success: true, jaEraSeu: true, orderId: alvo.id, numero });
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
    // Resposta MÍNIMA de propósito: o app refaz o GET. Devolver o pedido aqui
    // transformaria o claim num endpoint de leitura paginada de clientes.
    return NextResponse.json({ success: true, orderId: alvo.id, numero });
  } catch (err: any) {
    console.error("[Motoboy Puxar Error]", err);
    return NextResponse.json({ error: "Erro ao puxar o pedido" }, { status: 500 });
  }
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
    const { orderId, motoboyId, storeId, codigo, semCodigo } = await req.json().catch(() => ({} as any));
    if (!orderId || !motoboyId || !storeId) {
      return NextResponse.json({ error: "orderId, motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    // Demitido não dá baixa: `active` vale em toda rota de execução, não só
    // no login (a sessão do app vive para sempre no localStorage).
    const motoboyAtivo = await prisma.motoboy.findFirst({
      where: { id: String(motoboyId), franchiseeId: String(storeId), active: true },
      select: { id: true },
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
    // devolve um aviso para a tela do entregador. O 403 fica registrado pedido
    // a pedido — é assim que se descobre se falta escopo do módulo Logistics
    // na credencial da loja, em vez de adivinhar.
    const exigeCodigo =
      Boolean((order as any).ifoodDropCodeRequired) &&
      Boolean((order as any).ifoodOrderId) &&
      (order as any).deliveryBy !== "IFOOD"; // entrega do iFood: quem confere é o entregador deles
    const eh99Propria = ehPedido99Food(order as any) && (order as any).deliveryBy === "MERCHANT";
    let codigoConferido = false;
    let codigoConferido99 = false;
    /** Vira aviso na tela do entregador quando a conferência não aconteceu. */
    let avisoCodigo: string | null = null;
    /** O que gravar no pedido sobre a tentativa (diagnóstico e auditoria). */
    let infoCodigo: Record<string, unknown> | null = null;
    if ((exigeCodigo || eh99Propria) && !semCodigo) {
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
        if (!exigeCodigo) {
          const { conferirCodigoEntrega99 } = await import("@/lib/food99-status");
          const r = await conferirCodigoEntrega99(
            { openDeliveryOrderId: String((order as any).openDeliveryOrderId), franchiseeId: order.franchiseeId },
            digitado,
          );
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
            avisoCodigo = `Entrega confirmada. O 99Food não conferiu o código agora (${r.errno}: ${r.errmsg}) — a loja foi avisada.`;
            console.warn(`[Motoboy Entrega] 99Food verifyDeliveryCode ${order.id}: ${r.errno} ${r.errmsg} — entrega concluída mesmo assim`);
          }
        } else try {
          const { contextoDoPedido } = await import("@/lib/ifood-token");
          const { validarCodigoEntrega } = await import("@/lib/ifood-logistics");
          const ctx = await contextoDoPedido(order as any);
          const r = await validarCodigoEntrega(ctx, String((order as any).ifoodOrderId), digitado);
          const codigoErrado = r.status === 422 || (r.ok && r.data?.success === false);
          infoCodigo = {
            canal: "iFood", digitado, status: r.status, origem: r.origem ?? null,
            resposta: String(r.texto || "").slice(0, 300),
            resultado: r.conferido ? "conferido" : codigoErrado ? "errado" : "indisponivel",
            motoboyId: String(motoboyId),
          };
          if (r.conferido) {
            codigoConferido = true;
            console.log(`[Motoboy Entrega] 🔐 código conferido no iFood para ${order.id}`);
          } else if (codigoErrado) {
            return NextResponse.json(
              { error: "Código não confere. Confira com o cliente e digite de novo.", codigoIncorreto: true },
              { status: 422 },
            );
          } else {
            // 403 é o caso do print de 12/09: a credencial da loja responde,
            // mas o módulo Logistics recusa a chamada. Nada disso é problema do
            // entregador — a entrega segue.
            console.warn(`[Motoboy Entrega] verifyDeliveryCode ${order.id}: ${r.status} ${String(r.texto || "").slice(0, 200)} — entrega concluída mesmo assim`);
            avisoCodigo =
              r.status === 403
                ? "Entrega confirmada. O iFood não aceita a conferência do código nesta loja — avise o suporte do FireHub."
                : `Entrega confirmada. Não consegui conferir o código com o iFood agora (${r.status || "sem resposta"}).`;
          }
        } catch (e: any) {
          console.warn(`[Motoboy Entrega] verifyDeliveryCode ${order.id} falhou: ${e?.message} — entrega concluída mesmo assim`);
          infoCodigo = {
            canal: "iFood", digitado, status: 0, resposta: String(e?.message || "erro").slice(0, 300),
            resultado: "indisponivel", motoboyId: String(motoboyId),
          };
          avisoCodigo = "Entrega confirmada. Não consegui falar com o iFood para conferir o código.";
        }
      }
    }
    if ((exigeCodigo || eh99Propria) && semCodigo) {
      console.warn(`[Motoboy Entrega] ⚠️ pedido ${order.id} (${exigeCodigo ? "iFood" : "99Food"}) baixado SEM código de entrega (motoboy ${motoboyId})`);
      infoCodigo = {
        canal: exigeCodigo ? "iFood" : "99Food", digitado: null,
        resultado: "sem-codigo", resposta: "cliente não tinha o código", motoboyId: String(motoboyId),
      };
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
        // Mesmo carimbo que a aba Entrega do painel grava quando confere o código.
        ...(codigoConferido ? { ifoodDriverStatus: "DELIVERED" } : {}),
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
      // iFood: conclude fecha o pedido (dispatch antes, se for entrega).
      // Com a credencial do dono do pedido — o app do motoboy não tem sessão
      // de lojista, e o token central só alcança a Hakim.
      if ((order as any).ifoodOrderId) {
        const { acaoNoPedidoIfood } = await import("@/lib/ifood-pedido");
        const rotulo = "Motoboy Entrega → iFood";
        if (order.deliveryType === "DELIVERY") {
          await acaoNoPedidoIfood(order, "dispatch", { rotulo });
        }
        await acaoNoPedidoIfood(order, "conclude", { rotulo });
      }

      // 99Food e Jotajá dividem o campo openDeliveryOrderId; o canal separa.
      if ((order as any).openDeliveryOrderId) {
        try {
          const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
          if (ehPedido99Food(order as any) && codigoConferido99) {
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
      // fiscal. Mesmo caminho da entrega confirmada pelo painel.
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
