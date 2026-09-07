import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { precoUnitarioDoItem, precoMinimoDoProduto } from "@/lib/preco-combo";
import { aplicarPrecoDoCanalComCombo } from "@/lib/preco-por-canal";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { trackSaleForBilling } from "@/lib/billing";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { disponivelHoje, diaDaSemanaDaLoja } from "@/lib/cardapio-interno";
import { estadoDaLoja } from "@/lib/loja-aberta";
import { dataDaLoja } from "@/lib/fuso";

export async function POST(req: Request) {
  try {
    // ── Rate Limiting ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`create-order:${ip}`, { windowMs: 60000, maxRequests: 20 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas requisições. Tente novamente em 1 minuto." }, { status: 429 });
    }

    const body = await req.json();
    const { franchiseeSlug, franchiseeId, customerName, customerPhone, customerAddress, deliveryType, paymentMethod, notes, items, couponCode, deliveryFee } = body;

    if ((!franchiseeSlug && !franchiseeId) || !customerName || !customerPhone || !items || items.length === 0) {
      return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    }

    // Buscar franqueado com config por ID ou Slug
    const franchisee = await prisma.user.findFirst({
      where: franchiseeId ? { id: franchiseeId } : { slug: franchiseeSlug },
      select: {
        id: true, slug: true, storeName: true, storeOpen: true, storePause: true, storeHours: true, storeTimezone: true,
        autoAcceptOrders: true, allowScheduledOrders: true, storeCoupons: true, deliveryConfig: true
      }
    });
    if (!franchisee) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

    // Validar se agendamento está desativado
    if ((body.scheduledDatetime || body.scheduledDate || body.isScheduled) && franchisee.allowScheduledOrders === false) {
      return NextResponse.json({ error: "Esta loja não está aceitando pedidos agendados no momento." }, { status: 400 });
    }

    // Verificar se loja está operando
    if (franchisee.storeOpen === false) {
      return NextResponse.json({ error: "Loja fechada no momento." }, { status: 400 });
    }

    // Fora do HORÁRIO de funcionamento também é fechada. Só o front avisava:
    // uma aba aberta desde antes do fechamento (ou um POST direto) criava
    // pedido de madrugada — que tocava na loja vazia e nunca seria feito.
    // Pedido AGENDADO passa: ele é para quando a loja estiver aberta.
    //
    // NO FUSO DA LOJA, não no do servidor. A primeira versão desta trava usava
    // `isStoreOpen` (store-hours.ts), que lê `new Date().getHours()` — a hora do
    // PROCESSO, e o container roda em UTC. Efeito medido em 06/09/2026 na Pastel
    // da Paulista (17:00–23:15): às 20:28 de Brasília o servidor já marcava
    // 23:28, respondia "Loja fechada agora — fechado · abre amanhã" e nenhum
    // cliente conseguia fechar pedido, nem entrega nem retirada, das 20:15 até
    // o fechamento de verdade — todo dia, desde o deploy de 27/08. A tela dizia
    // "Aberta" porque o navegador do cliente está no fuso certo; só o POST
    // recusava. `estadoDaLoja` é a peça feita para o servidor: usa
    // `storeTimezone` e ainda entende o turno de ontem que atravessa a madrugada.
    const ehAgendado = Boolean(body.scheduledDatetime || body.scheduledDate || body.isScheduled);
    if (!ehAgendado) {
      const estadoAgora = estadoDaLoja({
        storeHours: franchisee.storeHours,
        storePause: franchisee.storePause,
        storeOpen: franchisee.storeOpen,
        timezone: franchisee.storeTimezone,
      });
      if (!estadoAgora.aberta) {
        return NextResponse.json({ error: estadoAgora.texto }, { status: 400 });
      }
    }

    // Verificar pausa programada. Para pedido AGENDADO esta é a única trava de
    // pausa (o `estadoDaLoja` acima não roda para ele). Comparar DATA da loja
    // com data: `new Date("AAAA-MM-DDT00:00")` era meia-noite do container
    // (UTC), então a pausa começava às 21:00 da véspera e voltava a aceitar
    // pedido às 21:00 do último dia de férias.
    const pause = franchisee.storePause as any;
    if (pause?.active && pause.from && pause.to) {
      const hoje = dataDaLoja(franchisee.storeTimezone);
      if (hoje >= pause.from && hoje <= pause.to) {
        const [a, m, d] = String(pause.to).split("-");
        return NextResponse.json({ error: `Loja em pausa até ${d}/${m}/${a}.` }, { status: 400 });
      }
    }

    // Buscar produtos do menu
    // ISOLAMENTO ENTRE LOJAS: o produto TEM que ser desta loja.
    // Esta rota e PUBLICA. Sem o filtro de franchiseeId, qualquer pessoa na
    // internet mandava no carrinho da loja A um menuProductId da loja B: o
    // pedido nascia na loja A, mas a baixa de estoque seguia a ficha tecnica
    // daquele produto e derrubava o insumo DA LOJA B. De quebra, a fila de
    // impressao devolvia o objeto inteiro do produto alheio, inclusive o campo
    // `cost` — a margem do concorrente.
    const productIds = items.map((i: any) => i.menuProductId).filter(Boolean);
    const menuProducts = await prisma.menuProduct.findMany({
      // ── A MESMA REGRA DA VITRINE, e por que ela precisa estar AQUI ────────
      //
      // A vitrine (loja/[slug]) já não mostra complemento nem item desligado no
      // delivery. Mas esta rota aceitava qualquer id: bastava um POST direto —
      // ou uma aba aberta desde antes — para o "Adicional de Bacon" (preço
      // R$ 0,00, `apenasEmCombo: true`) entrar no carrinho e ser gravado. O piso
      // de `precoMinimoDoProduto` não segura: complemento não tem grupo próprio,
      // então o mínimo dele é o próprio zero, e a comanda saía com bacon de graça.
      //
      // Item não encontrado aqui já vira 400 com texto claro (logo abaixo), que é
      // exatamente o comportamento certo: recusar explicando, não cobrar zero.
      //
      // `NOT` em vez de `apenasEmCombo: false` para cobrir linha antiga com NULL.
      where: {
        id: { in: productIds },
        active: true,
        activeDelivery: true,
        franchiseeId: franchisee.id,
        NOT: { apenasEmCombo: true },
      },
      // Os grupos vêm junto porque o preço do item depende deles: sem isso o
      // servidor não tem como saber quanto custa a opção que o cliente marcou.
      include: {
        comboGroups: {
          include: { items: { include: { menuProduct: { select: { name: true, price: true } } } } },
        },
      },
    });

    // Calcular total dos produtos
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = menuProducts.find(p => p.id === item.menuProductId);
      // Antes isto era um throw solto, que caia no catch generico e virava 500
      // sem explicacao. Agora o cliente entende o que aconteceu.
      if (!product) {
        throw Object.assign(
          new Error("Um dos itens do carrinho não está mais disponível nesta loja."),
          { statusCode: 400 }
        );
      }

      // Promoção de dia específico não pode ser comprada fora do dia dela. A
      // vitrine já esconde o item, mas a aba aberta desde ontem — ou um POST
      // direto na rota — ainda mandava a esfirra de segunda no domingo, pelo
      // preço de promoção. Mesma regra do totem (api/totem/order).
      if (!disponivelHoje((product as any).availableDays, diaDaSemanaDaLoja(franchisee.storeTimezone))) {
        throw Object.assign(
          new Error(`"${product.name}" só está disponível em dias específicos e hoje não é um deles.`),
          { statusCode: 400 }
        );
      }
      // ── PREÇO COM AS OPÇÕES ESCOLHIDAS ────────────────────────────────
      // Antes somava só `product.price`, ignorando o que o cliente marcou
      // dentro do combo. No "Nugget" da Hakim, cujo preço base é R$ 0,00 e o
      // valor inteiro está nas opções (6/15/40 unidades), o pedido era gravado
      // por R$ 0,00 — a loja entregava e recebia nada. Já aconteceu uma vez,
      // por outro canal.
      //
      // A conta agora é a mesma em todo lugar (src/lib/preco-combo.ts), e
      // continua sendo feita AQUI, no servidor: o carrinho manda só o que foi
      // escolhido, nunca o preço.
      //
      // Canal DELIVERY: o preço cobrado tem que ser o MESMO que a vitrine
      // mostrou (loja/[slug] aplica o preço do canal antes de renderizar).
      // Cobrar pela base aqui seria mostrar um preço e cobrar outro.
      // ComCombo, não só o produto: nas lojas que põem o preço na OPÇÃO de
      // tamanho (base R$ 0,00), resolver só a base cobraria o preço de tabela
      // das opções — e a vitrine já mostrou o do delivery.
      const produtoNoCanal = aplicarPrecoDoCanalComCombo(product as any, "delivery");
      let precoUnitario = precoUnitarioDoItem(produtoNoCanal as any, item.comboSelections);

      // Piso: se a escolha não vier, vier vazia, ou o nome não casar com nenhuma
      // opção do grupo, o cálculo devolve só a base — e no "Nugget" (base
      // R$ 0,00) isso é um pedido de graça. Cobrar o mínimo possível é o pior
      // caso aceitável; entregar sem cobrar não é.
      const minimoDoProduto = precoMinimoDoProduto(produtoNoCanal as any);
      if (precoUnitario < minimoDoProduto) {
        console.warn(
          `[customer-order] "${product.name}" sairia por R$ ${precoUnitario} sem escolha válida ` +
          `(loja ${franchisee.id}); aplicando o mínimo R$ ${minimoDoProduto}.`
        );
        precoUnitario = minimoDoProduto;
      }

      // ── QUANTIDADE É INTEIRO POSITIVO ────────────────────────────────────
      //
      // Nada validava este campo. Com `quantity: -5` o total ficava NEGATIVO e
      // dava para zerar o pedido inteiro (comida de graça) ou até gerar
      // "crédito"; com 0.5 nascia meio hambúrguer na comanda; com 99999, um
      // pedido impossível travando a cozinha. O carrinho manda o que quiser —
      // quem decide é aqui.
      const qtd = Number(item.quantity);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 200) {
        throw Object.assign(
          new Error(`Quantidade inválida para "${product.name}". Informe um número inteiro de 1 a 200.`),
          { statusCode: 400 }
        );
      }
      item.quantity = qtd;

      totalAmount += precoUnitario * item.quantity;
      // `notes` e a observacao POR ITEM ("sem cebola"). O carrinho ja mandava
      // (CustomerStorePage envia notes em cada item) e a impressao/KDS ja liam
      // i.notes — mas aqui ela era descartada, entao nunca chegava na cozinha.
      return {
        menuProductId: product.id,
        quantity: item.quantity,
        price: precoUnitario,
        notes: typeof item.notes === "string" && item.notes.trim() ? item.notes.trim().slice(0, 500) : null,
        comboSelections: item.comboSelections || null,
      };
    });

    // Regra de Frete Grátis por valor mínimo da loja
    const delivConfig = (franchisee.deliveryConfig as any) || {};
    const isFreeShippingMin = Boolean(
      deliveryType === "DELIVERY" &&
      (delivConfig.freeShippingActive === true || delivConfig.freeShippingActive === "true") &&
      delivConfig.freeShippingMinValue &&
      Number(delivConfig.freeShippingMinValue) > 0 &&
      totalAmount >= Number(delivConfig.freeShippingMinValue)
    );

    // ── TAXA DE ENTREGA: VEM DO CLIENTE, ENTÃO NÃO SE CONFIA ──────────────
    // Esta rota é PÚBLICA e `deliveryFee` chega no corpo da requisição. Sem
    // piso, um `deliveryFee: -195` num carrinho de R$ 200 fazia o total virar
    // R$ 5,00 — e era esse valor que ia para o banco e, de lá, para a
    // cobrança no gateway. Frete negativo não existe: qualquer valor abaixo
    // de zero é descartado.
    //
    // O teto é rede de segurança contra o oposto (inflar o pedido de outra
    // pessoa): frete acima de R$ 200 ou maior que 3x o valor dos itens não é
    // frete, é erro ou abuso.
    const feeInformada = deliveryType === "DELIVERY" ? Number(deliveryFee) : 0;
    const feeEhNumero = Number.isFinite(feeInformada);

    // O teto é ABSOLUTO de propósito, não proporcional ao valor dos itens.
    // `totalAmount` sai subestimado quando o pedido tem combo com adicional
    // (bug conhecido e ainda não corrigido, fora do escopo desta mudança), e
    // amarrar o teto a ele faria frete legítimo ser zerado justamente nos
    // pedidos com combo. R$ 300 de entrega não existe em delivery de bairro.
    const TETO_FRETE = 300;
    const feeForaDaFaixa = !feeEhNumero || feeInformada < 0 || feeInformada > TETO_FRETE;

    if (deliveryType === "DELIVERY" && feeForaDaFaixa && deliveryFee !== undefined && deliveryFee !== null) {
      console.warn(
        `[customer-order] deliveryFee recusado (${JSON.stringify(deliveryFee)}) na loja ${franchisee.id} — gravando 0.`
      );
    }

    const originalFee = feeForaDaFaixa ? 0 : feeInformada;
    let fee = originalFee;
    let freeShippingNote = "";

    if (isFreeShippingMin) {
      fee = 0; // Isenta a taxa cobrada
      freeShippingNote = ` [Frete Grátis (Pedido >= R$ ${Number(delivConfig.freeShippingMinValue).toFixed(2).replace('.', ',')}) — Taxa ref: R$ ${originalFee.toFixed(2).replace('.', ',')}]`;
    }

    // Aplicar cupom de desconto
    let discount = 0;
    if (couponCode) {
      const coupons = (franchisee.storeCoupons as any[]) || [];
      const coupon = coupons.find((c: any) =>
        c.code?.toLowerCase() === couponCode.toLowerCase() && c.active !== false
      );
      if (coupon) {
        if (coupon.minOrderValue && totalAmount < coupon.minOrderValue) {
          discount = 0;
        } else {
          if (coupon.type === "free_shipping") {
            discount = fee;
            fee = 0;
          } else if (coupon.type === "fixed") {
            discount = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 0);
          } else if (coupon.type === "percent") {
            const pct = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 10);
            discount = totalAmount * (pct / 100);
          } else {
            const pct = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 10);
            discount = totalAmount * (pct / 100);
          }
          discount = Math.min(discount, totalAmount + fee);
        }
      }
    }

    // Arredonda para centavos ANTES de gravar. Em JS 29.9*3 = 89.69999999999999,
    // e era esse número que ia para o banco (`totalAmount Float`) e daí cru como
    // `transaction_amount` para o gateway — que recusa moeda com mais de 2 casas.
    const centavos = (n: number) => Math.round(n * 100) / 100;
    const finalTotal = centavos(Math.max(0, totalAmount - discount + fee));
    // A taxa é gravada ao lado do total e entra em relatório; arredondar só o
    // total deixaria os dois divergindo em frações de centavo.
    fee = centavos(fee);
    let orderNotes = notes || "";
    if (couponCode && discount > 0) {
      orderNotes = `[Cupom: ${couponCode.trim().toUpperCase()}] ${orderNotes}`.trim();
    }
    if (freeShippingNote) {
      orderNotes = `${orderNotes} ${freeShippingNote}`.trim();
    }
    const finalNotes = orderNotes || null;

    const pmUpper = (paymentMethod || "").toUpperCase().trim();
    const isOnlinePayment = pmUpper.includes("ONLINE") || pmUpper === "PIX" || pmUpper === "PIX_ONLINE" || pmUpper === "CREDITO_ONLINE" || pmUpper === "DEBITO_ONLINE";

    const initialStatus = isOnlinePayment
      ? "AGUARDANDO_PAGAMENTO"
      : franchisee.autoAcceptOrders
      ? "ACEITO"
      : "NOVO";

    const initialKdsStage = isOnlinePayment ? null : "PRODUCTION";
    const initialKdsProductionAt = isOnlinePayment ? null : new Date();

    const dailyOrderNumber = isOnlinePayment 
      ? null 
      : await generateDailyOrderNumber(franchisee.id);

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: franchisee.id,
        dailyOrderNumber,
        customerName, customerPhone,
        customerAddress: customerAddress || null,
        deliveryType: deliveryType || "DELIVERY",
        paymentMethod: paymentMethod || null,
        changeAmount: body.changeAmount ? Number(body.changeAmount) : (body.changeFor ? Number(body.changeFor) : null),
        notes: finalNotes,
        totalAmount: finalTotal,
        deliveryFee: fee,
        status: initialStatus,
        kdsStage: initialKdsStage,
        kdsProductionAt: initialKdsProductionAt,
        // Cookies do GA4 do cliente, capturados no cardápio. É o que permite o
        // `purchase` enviado pelo NOSSO servidor cair na mesma pessoa e na
        // mesma sessão que veio do anúncio — sem eles a venda aparece como
        // visitante novo, sem origem. Vazio quando o cliente bloqueia cookie
        // ou quando a loja não usa GA4: o disparo simplesmente não acontece.
        gaClientId: typeof body.gaClientId === "string" ? body.gaClientId.slice(0, 64) : null,
        gaSessionId: typeof body.gaSessionId === "string" ? body.gaSessionId.slice(0, 32) : null,
        items: { create: orderItems }
      }
    });

    // Se NÃO for pagamento online (ex: dinheiro/maquininha na entrega), envia direto para a fila de impressão da loja!
    if (!isOnlinePayment) {
      try {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        const formattedOrder = {
          id: order.id,
          dailyOrderNumber: order.id.slice(-4).toUpperCase(),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType || "DELIVERY",
          paymentMethod: order.paymentMethod || "Não informado",
          isPrepaid: false,
          items: orderItems.map((i: any) => ({
            name: menuProducts.find(p => p.id === i.menuProductId)?.name || "Item",
            qty: i.quantity,
            price: i.price,
            comboSelections: i.comboSelections,
          })),
          totalAmount: finalTotal,
          deliveryFee: fee,
          notes: finalNotes,
          createdAt: order.createdAt.toISOString(),
        };
        pushJobToPrintQueue(franchisee.id, formattedOrder, franchisee.storeName || "FIREHUB", "80mm");
      } catch (errPrint) {
        console.error("[CustomerOrder] Auto-print error:", errPrint);
      }
    }

    // Incrementar contador de pedidos (Pay as You Grow)
    await prisma.user.update({
      where: { id: franchisee.id },
      data: { storeOrderCount: { increment: 1 } }
    });

    // Envia notificação WhatsApp de confirmação de pedido recebido apenas se for pagamento presencial (não-online)
    if (!isOnlinePayment) {
      const { sendOrderNotification } = await import("@/lib/order-notifications");
      sendOrderNotification(order.id, "CREATED").catch(err =>
        console.warn("[CustomerOrder] Erro ao enviar notificação CREATED:", err)
      );

      // ── PURCHASE PARA O META, PELO SERVIDOR ───────────────────────────────
      //
      // Só no pagamento na entrega, e é aqui de propósito: nesse fluxo o pedido
      // JÁ É a venda — não existe confirmação depois. `paymentPaidAt` fica nulo
      // para sempre, então ancorar o evento em `confirmOrderPayment` mandaria
      // ZERO conversão para o tráfego real das lojas.
      //
      // O pedido de pagamento ONLINE não passa por aqui: ele dispara em
      // order-payment-confirm.ts, quando o dinheiro entra. Disparar na criação
      // contaria como venda quem desiste na tela do cartão — inflando o número
      // e ensinando o algoritmo a buscar mais gente que abandona.
      //
      // Sem await: o Meta não pode segurar a resposta do pedido.
      const { dispararCompraNoMeta } = await import("@/lib/meta-purchase");
      dispararCompraNoMeta(order.id).catch(err =>
        console.error("[Meta CAPI] Falha ao enviar Purchase:", err)
      );

      // Mesmo evento, mesma regra, para o GA4 (Measurement Protocol). Só sai
      // se a loja configurou GA4 e se o pedido guardou o `client_id` do
      // cookie — sem ele a compra viraria um visitante novo sem origem.
      const { dispararCompraNoGoogle } = await import("@/lib/ga-purchase");
      dispararCompraNoGoogle(order.id).catch(err =>
        console.error("[GA4 MP] Falha ao enviar purchase:", err)
      );
    }

    // Se auto-aceito e não-online, contabiliza no faturamento e deduz estoque imediatamente
    if (franchisee.autoAcceptOrders && !isOnlinePayment) {
      trackSaleForBilling(franchisee.id).catch(err =>
        console.error("[Billing] Erro ao atualizar ciclo:", err)
      );
      const { deductStockForOrder } = await import("@/lib/stock");
      deductStockForOrder(order.id).catch(err =>
        console.error("[Stock] Erro ao deduzir estoque auto-aceito:", err)
      );
    }

    return NextResponse.json({
      orderId: order.id,
      total: finalTotal,
      discount,
      status: initialStatus,
      autoAccepted: franchisee.autoAcceptOrders,
    });

  } catch (error: any) {
    console.error("Erro ao criar pedido:", error);
    // Erros de validacao carregam statusCode e devem chegar ao cliente como 4xx
    // com a mensagem util, em vez de virarem "Erro interno" 500.
    const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
    return NextResponse.json(
      { error: status === 500 ? "Erro interno." : error.message },
      { status }
    );
  }
}
