/**
 * pull-jotaja-orders.js
 * SCRIPT DE EMERGÊNCIA — Puxa pedidos pendentes do Jajá para o FireHub.
 *
 * GARANTIAS:
 *   • createdAt = new Date() → pedidos entram NO FINAL da fila
 *   • Itens puxados EXATAMENTE da API do Jajá (nada inventado)
 *   • Nenhum pedido existente é alterado
 *   • KDS: kdsStage = "PRODUCTION", status = "NOVO"
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'https://api.jotaja.com/openDelivery';
const CID = '92c66502-57ce-4563-a9e3-0df07dda5a38';
const CSEC = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

// Jajá display IDs conhecidos das screenshots (para matching)
const KNOWN_DISPLAY_IDS = ['4689', '4696', '4700', '4701', '4702', '4703'];
const KNOWN_PEDIDO_IDS = ['32790382', '32791438', '32792669', '32792997', '32793103', '32793249'];

let _token = null;

async function getToken() {
  if (_token) return _token;
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CID,
      client_secret: CSEC,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Auth falhou: ${res.status} — ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  _token = data.access_token || data.accessToken;
  return _token;
}

async function jGet(path) {
  const token = await getToken();
  return fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

async function jPost(path, body) {
  const token = await getToken();
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Helpers (espelho exato do processJotajaEvent.ts) ─────────────────────────

function priceVal(p) {
  if (p === null || p === undefined) return 0;
  if (typeof p === 'object' && p !== null) return p.value ?? 0;
  return typeof p === 'number' ? p : 0;
}

function extractOptions(item) {
  if (!item || typeof item !== 'object') return [];
  const rawList =
    (Array.isArray(item.options) && item.options.length > 0 ? item.options : null) ??
    (Array.isArray(item.subItems) && item.subItems.length > 0 ? item.subItems : null) ??
    (Array.isArray(item.sub_items) && item.sub_items.length > 0 ? item.sub_items : null) ??
    (Array.isArray(item.garnishItems) && item.garnishItems.length > 0 ? item.garnishItems : null) ??
    (Array.isArray(item.choices) && item.choices.length > 0 ? item.choices : null) ??
    (Array.isArray(item.items) && item.items.length > 0 ? item.items : null) ??
    (Array.isArray(item.additions) && item.additions.length > 0 ? item.additions : null) ??
    (Array.isArray(item.customizations) && item.customizations.length > 0 ? item.customizations : null) ??
    (Array.isArray(item.toppings) && item.toppings.length > 0 ? item.toppings : null) ??
    [];

  const extracted = [];
  for (const o of rawList) {
    const nested = extractOptions(o);
    if (nested.length > 0) {
      extracted.push(...nested);
    } else {
      const name = o.name || o.productName || o.label || o.optionName || o.description || o.nameOption || '';
      if (name) {
        extracted.push({
          id: o.id || `opt-${Math.random().toString(36).slice(2)}`,
          name,
          quantity: o.quantity ?? o.qty ?? 1,
          price: priceVal(o.unitPrice) || priceVal(o.price) || priceVal(o.totalPrice) || priceVal(o.addition) || 0,
        });
      }
    }
  }
  return extracted;
}

const BEV_KW = ['coca', 'pepsi', 'fanta', 'guaraná', 'guarana', 'sprite', 'suco', 'água', 'agua',
  'cerveja', 'refri', 'refrigerante', 'lata', 'pet', 'litro', 'energético', 'energetico',
  'h2o', 'schweppes', 'kuat', 'dolly', 'monster', 'red bull', 'chá', 'cha'];

function isBev(name) {
  if (!name) return false;
  const l = name.toLowerCase();
  return BEV_KW.some(kw => l.includes(kw));
}

function parsePayment(orderData) {
  const paymentsObj = orderData?.payments || {};
  const paymentMethods = paymentsObj.methods ?? (Array.isArray(paymentsObj) ? paymentsObj : []);
  const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];
  const first = paymentList[0] || {};
  const totalPrepaid = typeof paymentsObj.prepaid === 'number' ? paymentsObj.prepaid : priceVal(paymentsObj.prepaid);
  const totalPending = typeof paymentsObj.pending === 'number' ? paymentsObj.pending : priceVal(paymentsObj.pending);

  const cashPay = paymentList.find(p => p.method === 'CASH' || (p.name && p.name.toLowerCase().includes('dinheir')));
  const changeAmount = cashPay?.changeFor ?? cashPay?.cash?.changeFor ?? null;

  const isOffline = first.prepaid === false || first.type === 'OFFLINE' || first.type === 'PENDING' || totalPending > 0 || Boolean(cashPay);
  const isPrepaid = !isOffline && (totalPrepaid > 0 || first.prepaid === true || first.type === 'ONLINE' || first.type === 'PREPAID' || first.method === 'DIGITAL_WALLET' || first.method === 'ONLINE');

  const rawName = (first.name || first.description || '').toString().trim();
  const rawMethod = (first.method || '').toString().toUpperCase();

  let baseName = 'Cartão';
  if (cashPay || rawMethod === 'CASH' || rawMethod.includes('DINHEIR') || rawName.toLowerCase().includes('dinheir')) baseName = 'Dinheiro';
  else if (rawMethod === 'DEBIT' || rawMethod.includes('DEBITO') || rawName.toLowerCase().includes('débit') || rawName.toLowerCase().includes('debit')) baseName = 'Débito';
  else if (rawMethod.includes('MEAL_VOUCHER') || rawMethod.includes('FOOD_VOUCHER') || rawMethod.includes('VALE') || rawMethod.includes('VOUCHER') || rawName.toLowerCase().includes('vale')) baseName = 'Vale Refeição';
  else if (rawMethod.includes('CREDIT') || rawMethod.includes('CREDITO') || rawName.toLowerCase().includes('crédit') || rawName.toLowerCase().includes('credit')) baseName = 'Crédito';
  else if (rawMethod.includes('PIX') || rawName.toLowerCase().includes('pix')) baseName = 'Pix';
  else if (rawMethod === 'DIGITAL_WALLET' || rawMethod === 'ONLINE' || rawMethod === 'APP') baseName = 'JotaJá App';

  let display = rawName || baseName;
  display = display.replace(/\s*\((cobrar na entrega|pago online|online)\)/gi, '').trim();

  const paymentMethod = isPrepaid ? `${display} (JotaJá Pago Online)` : `${display} (Cobrar na Entrega)`;
  return { paymentMethod, changeAmount };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 ═══════════════════════════════════════════════════════════');
  console.log('   IMPORTAÇÃO DE EMERGÊNCIA — Pedidos Jajá → FireHub');
  console.log('   ═══════════════════════════════════════════════════════════\n');

  // 1. Achar o franqueado
  const franchisee = await prisma.user.findFirst({ where: { email: 'contatohakim@gmail.com' } });
  if (!franchisee) { console.error('❌ contatohakim@gmail.com não encontrado no banco!'); process.exit(1); }
  const franchiseeId = franchisee.ownerId || franchisee.id;
  console.log(`✅ Franqueado: ${franchisee.name || franchisee.email} (id: ${franchiseeId})`);
  console.log(`   storeName: ${franchisee.storeName || 'N/A'}\n`);

  // 2. Auth com Jajá
  console.log('🔑 Autenticando com Jajá API...');
  await getToken();
  console.log('✅ Token obtido\n');

  // 3. Poll eventos pendentes
  console.log('📥 Polling eventos pendentes do Jajá...');
  let events = [];
  try {
    const evRes = await jGet('/v1/events:polling');
    if (evRes.ok) {
      const evText = await evRes.text();
      events = evText ? JSON.parse(evText) : [];
      console.log(`   ${events.length} evento(s) encontrado(s)`);
    } else {
      console.log(`   ⚠️ Polling retornou ${evRes.status}: ${await evRes.text().catch(() => '')}`);
    }
  } catch (e) {
    console.log(`   ⚠️ Polling falhou: ${e.message}`);
  }

  // Coletar UUIDs de pedidos dos eventos
  const orderMap = new Map(); // uuid → event
  for (const ev of events) {
    if (ev.orderId && !orderMap.has(ev.orderId)) {
      const et = (ev.eventType || ev.fullCode || ev.code || '').toUpperCase();
      console.log(`   → Evento: ${et} | orderId: ${ev.orderId}`);
      orderMap.set(ev.orderId, ev);
    }
  }

  // Se não encontrou eventos, tentar buscar diretamente pelos IDs numéricos
  if (orderMap.size === 0) {
    console.log('\n⚠️ Nenhum evento pendente. Tentando buscar pedidos diretamente pelos IDs...');
    for (const numId of KNOWN_PEDIDO_IDS) {
      try {
        const res = await jGet(`/v1/orders/${numId}`);
        if (res.ok) {
          const data = await res.json();
          console.log(`   ✅ Pedido ${numId} encontrado: ${data.customer?.name || '?'}`);
          orderMap.set(numId, { orderId: numId, eventType: 'CREATED' });
        } else {
          console.log(`   ❌ Pedido ${numId}: ${res.status}`);
        }
      } catch (e) {
        console.log(`   ❌ Pedido ${numId}: ${e.message}`);
      }
    }
  }

  if (orderMap.size === 0) {
    console.log('\n❌ Nenhum pedido encontrado para importar!');
    console.log('   Os eventos podem já ter sido acknowledged. Verifique o painel do Jajá.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n📋 ${orderMap.size} pedido(s) para processar\n`);

  // 4. Processar cada pedido
  let imported = 0, skipped = 0, failed = 0;
  const processedEventIds = [];
  let orderCounter = 0;

  for (const [orderId, ev] of orderMap) {
    orderCounter++;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 Pedido ${orderCounter}/${orderMap.size}: ${orderId}`);
    console.log(`${'─'.repeat(60)}`);

    // Checar idempotência
    const existing = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { openDeliveryOrderId: orderId },
          { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          { openDeliveryReference: orderId },
        ],
      },
    });

    if (existing) {
      console.log(`   ⏭️ JÁ EXISTE no banco (id: ${existing.id}, status: ${existing.status})`);
      skipped++;
      const eid = ev.eventId || ev.id;
      if (eid) processedEventIds.push({ id: eid, orderId: ev.orderId || '', eventType: ev.eventType || ev.fullCode || ev.code || '' });
      continue;
    }

    // Buscar dados completos do pedido na API do Jajá
    let orderData;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await jGet(`/v1/orders/${orderId}`);
        if (res.ok) {
          orderData = await res.json();
          break;
        } else {
          const errBody = await res.text().catch(() => '');
          console.log(`   ⚠️ Tentativa ${attempt}/3 falhou: ${res.status} ${errBody.slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`   ⚠️ Tentativa ${attempt}/3 erro: ${e.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 500));
    }

    if (!orderData) {
      console.log(`   ❌ Não conseguiu buscar dados do pedido após 3 tentativas`);
      failed++;
      continue;
    }

    const displayId = orderData.displayId || orderData.orderSeqNumber || orderId.slice(-6);
    const customerName = orderData.customer?.name || 'Cliente Jotajá';
    console.log(`   👤 ${customerName} | Jajá #${displayId}`);

    // ── ITENS ────────────────────────────────────────────────────────────────
    const rawItems =
      (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
      (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
      (Array.isArray(orderData.order?.items) && orderData.order?.items.length > 0 ? orderData.order?.items : null) ??
      (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
      (Array.isArray(orderData.cart?.items) && orderData.cart?.items.length > 0 ? orderData.cart?.items : null) ??
      [];

    console.log(`   📝 ${rawItems.length} item(s):`);

    const items = rawItems.map(i => {
      const itemName = i.name || i.productName || i.title || i.label || 'Item Jotajá';
      const options = extractOptions(i);
      const optionNames = options.map(o => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
      const fullName = optionNames.length > 0 ? `${itemName} | ${optionNames.join(' | ')}` : itemName;
      const qty = i.quantity ?? i.qty ?? 1;
      const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
      const rawTotal = priceVal(i.totalPrice) || priceVal(i.total) || 0;
      const optionsSum = options.reduce(
        (sum, o) => sum + (priceVal(o.price) || priceVal(o.addition) || priceVal(o.unitPrice) || 0) * (o.quantity || 1), 0
      );

      let itemPrice = 0;
      if (rawTotal > 0 && qty > 0 && (rawTotal / qty) > rawUnit) itemPrice = rawTotal / qty;
      else if (rawUnit > 0 || optionsSum > 0) itemPrice = rawUnit + optionsSum;
      else if (rawTotal > 0 && qty > 0) itemPrice = rawTotal / qty;

      const comboSelsList = options.length > 0 ? options.map(o => ({
        id: o.id, name: o.name, quantity: o.quantity ?? 1, price: priceVal(o.price) || 0,
      })) : null;

      const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;
      console.log(`      • ${qty}x ${fullName} — R$ ${(itemPrice * qty).toFixed(2)}`);

      return {
        price: itemPrice,
        quantity: qty,
        comboSelections: comboSelsList ? JSON.stringify(comboSelsList) : null,
        menuProduct: {
          connectOrCreate: {
            where: { id: `jotaja-${itemId}` },
            create: {
              id: `jotaja-${itemId}`,
              franchiseeId: franchisee.id,
              name: fullName,
              description: i.specialInstructions || i.observations || i.notes || '',
              price: itemPrice,
              category: i.category || 'Jotajá',
              isBeverage: isBev(fullName) || options.some(o => isBev(o.name)),
              active: true,
            },
          },
        },
      };
    });

    // ── TOTAIS ────────────────────────────────────────────────────────────────
    const rawTotal = orderData.total?.orderAmount ?? orderData.total?.subTotal ?? orderData.totalPrice ?? orderData.total;
    const total = priceVal(rawTotal);

    let deliveryFee = priceVal(orderData.total?.deliveryFee) || priceVal(orderData.delivery?.deliveryFee) || priceVal(orderData.deliveryFee) || 0;
    if (!deliveryFee && Array.isArray(orderData.otherFees)) {
      const df = orderData.otherFees.find(f => (f.type || f.name || '').toUpperCase().match(/DELIVERY|FRETE|FEE/));
      if (df) deliveryFee = priceVal(df.price ?? df.value);
    }

    // Descontos
    const benefits = orderData.benefits ?? [];
    let discountTotal = 0, discountPlatform = 0, discountMerchant = 0;
    const discountDetails = [];
    for (const b of benefits) {
      const v = b.value ?? 0; discountTotal += v;
      const sps = Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues : b.sponsorshipValues ? [b.sponsorshipValues] : [];
      let bp = 0, bm = 0;
      for (const sp of sps) { const n = (sp.name ?? sp.sponsorship ?? '').toUpperCase(); const sv = sp.value ?? 0; if (n === 'MERCHANT') bm += sv; else bp += sv; }
      if (sps.length === 0 && v > 0) { if ((b.sponsorship ?? '').toUpperCase() === 'MERCHANT') bm += v; else bp += v; }
      discountPlatform += bp; discountMerchant += bm;
      discountDetails.push({ target: b.target ?? 'CART', value: v, platform: bp, merchant: bm, description: b.campaign?.name ?? b.description ?? null });
    }

    // Delivery fee fallback
    if (deliveryFee === 0 && (orderData.total?.orderAmount || orderData.totalPrice) && orderData.total?.subTotal) {
      const ot = priceVal(orderData.total?.orderAmount ?? orderData.totalPrice);
      const st = priceVal(orderData.total?.subTotal);
      const cf = ot - st + (discountTotal || 0);
      if (cf > 0 && cf < 100) deliveryFee = Math.round(cf * 100) / 100;
    }

    // Tipo de entrega
    const isTakeout = orderData.orderType === 'TAKEOUT' || Boolean(orderData.takeout) || orderData.deliveryType === 'TAKEOUT' || orderData.deliveryType === 'RETIRADA';

    // Prazo
    const createdMs = orderData.createdAt ? new Date(orderData.createdAt).getTime() : Date.now();
    const isScheduled = orderData.orderTiming === 'SCHEDULED' || Boolean(orderData.schedule?.scheduledDatetimeEnd) || Boolean(orderData.schedule?.scheduledDatetimeStart);
    let scheduledDatetime = null;
    if (isScheduled) {
      const rs = orderData.schedule?.scheduledDatetimeEnd ?? orderData.schedule?.scheduledDatetimeStart ?? orderData.scheduledDatetime;
      if (rs) scheduledDatetime = new Date(rs);
    } else if (isTakeout) {
      const re = orderData.takeout?.estimatedTakeoutWindow?.end || orderData.takeout?.takeoutDeadline;
      scheduledDatetime = re && new Date(re).getTime() > createdMs + 5 * 60000 ? new Date(re) : new Date(createdMs + 40 * 60000);
    } else {
      const re = orderData.delivery?.deliveryDeadline || orderData.delivery?.estimatedDeliveryWindow?.end;
      scheduledDatetime = re && new Date(re).getTime() > createdMs + 5 * 60000 ? new Date(re) : new Date(createdMs + 50 * 60000);
    }

    // Pagamento
    const { paymentMethod, changeAmount } = parsePayment(orderData);

    // Cliente
    const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? orderData.customer?.documentNumber ?? null;
    const customerNote = orderData.extraInfo ?? orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;
    const phone = orderData.customer?.phone;
    const phoneNumber = phone?.number ?? (typeof phone === 'string' ? phone : '');
    const phoneLocalizer = phone?.localizer;

    // Notas
    const itemNotes = (orderData.items ?? []).filter(i => i.specialInstructions?.trim()).map(i => `${i.name}: ${i.specialInstructions.trim()}`);
    const notes = [
      `Pedido Jotajá #${String(displayId).toUpperCase()}`,
      scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString('pt-BR')}` : null,
      discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
      customerNote ? `📝 OBS: ${customerNote}` : null,
      ...itemNotes.map(n => `📝 ${n}`),
    ].filter(Boolean).join('\n');

    // Endereço
    let customerAddress = '';
    const addr = orderData.delivery?.deliveryAddress;
    if (addr) {
      const formatted = addr.formattedAddress || '';
      const street = addr.streetName ? `${addr.streetName}${addr.streetNumber ? ` ${addr.streetNumber}` : ''}${addr.complement ? ` ${addr.complement}` : ''}` : formatted;
      const neighborhood = addr.neighborhood || '';
      const city = addr.city || '';
      const parts = [];
      if (street) parts.push(street);
      if (neighborhood && (!street || !street.toLowerCase().includes(neighborhood.toLowerCase()))) parts.push(neighborhood);
      if (city) parts.push(city);
      customerAddress = parts.join(' - ');
    }

    // Delivery type
    const ot = (orderData.orderType || '').toUpperCase();
    const dm = (orderData.deliveryMode || orderData.takeoutMode || '').toUpperCase();
    const deliveryType =
      ot === 'TAKEOUT' || ot === 'TOGO' || ot === 'PICKUP' || ot === 'RETIRADA' || ot === 'IN_STORE' ||
      Boolean(orderData.takeout) || (dm !== '' && dm !== 'DELIVERY') ||
      (!addr?.streetName && !addr?.formattedAddress && deliveryFee === 0) ? 'RETIRADA' : 'DELIVERY';

    console.log(`   💰 Total: R$ ${total.toFixed(2)} | Taxa: R$ ${deliveryFee.toFixed(2)} | ${paymentMethod}`);
    console.log(`   📍 ${customerAddress || 'Sem endereço'} | ${deliveryType}`);
    console.log(`   📞 ${phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber || 'N/A'}`);

    // ── CRIAR NO BANCO ───────────────────────────────────────────────────────
    try {
      const newOrder = await prisma.customerOrder.create({
        data: {
          franchiseeId: franchiseeId,
          openDeliveryOrderId: orderId,
          openDeliveryReference: String(displayId),
          openDeliveryChannel: 'JOTAJA',
          scheduledDatetime,
          changeAmount,
          customerCpfCnpj,
          discountTotal: discountTotal > 0 ? discountTotal : null,
          discountIfood: discountPlatform > 0 ? discountPlatform : (discountTotal > discountMerchant ? discountTotal - discountMerchant : null),
          discountMerchant: discountMerchant > 0 ? discountMerchant : null,
          discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
          source: 'JOTAJA',
          customerName,
          customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
          customerAddress,
          deliveryType,
          paymentMethod,
          totalAmount: total,
          deliveryFee,
          status: 'NOVO',
          kdsStage: 'PRODUCTION',
          notes,
          createdAt: new Date(), // CRÍTICO: garante entrada no FINAL da fila
          items: { create: items },
        },
      });

      console.log(`   ✅ IMPORTADO! DB id: ${newOrder.id}`);
      imported++;

      // Auto-confirmar no Jajá (não-bloqueante)
      try {
        await jPost(`/v1/orders/${orderId}/confirm`);
        console.log(`   ✅ Auto-confirmado no Jajá`);
      } catch { console.log(`   ⚠️ Auto-confirmação opcional falhou (pedido já pode estar confirmado)`); }

    } catch (createErr) {
      console.error(`   ❌ ERRO ao criar: ${createErr.message}`);
      if (createErr.message.includes('Unique constraint')) {
        console.log('   ℹ️ Pedido já existia (constraint unique). Pulando.');
        skipped++;
      } else {
        failed++;
      }
    }

    // Delay para garantir timestamps únicos de createdAt (ordem na fila)
    await new Promise(r => setTimeout(r, 200));

    // Coleta evento para acknowledge
    const eid = ev.eventId || ev.id;
    if (eid) processedEventIds.push({ id: eid, orderId: ev.orderId || '', eventType: ev.eventType || ev.fullCode || ev.code || '' });
  }

  // 5. Acknowledge eventos processados no Jajá
  if (processedEventIds.length > 0) {
    try {
      await jPost('/v1/events/acknowledgment', processedEventIds);
      console.log(`\n✅ ${processedEventIds.length} evento(s) acknowledged no Jajá`);
    } catch (e) {
      console.log(`\n⚠️ Acknowledge falhou (não-crítico): ${e.message}`);
    }
  }

  // 6. Resumo
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 RESULTADO FINAL:`);
  console.log(`   ✅ Importados: ${imported}`);
  console.log(`   ⏭️ Já existiam: ${skipped}`);
  console.log(`   ❌ Falharam: ${failed}`);
  console.log(`${'═'.repeat(60)}\n`);

  if (imported > 0) {
    console.log('🎯 Os pedidos foram inseridos NO FINAL da fila.');
    console.log('   Eles aparecerão como NOVOS no KDS com kdsStage=PRODUCTION.');
    console.log('   A numeração dos pedidos existentes NÃO foi alterada.');
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('\n❌ ERRO FATAL:', e);
  prisma.$disconnect();
  process.exit(1);
});
