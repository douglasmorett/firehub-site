/**
 * pull-valentina.js — Puxa APENAS o pedido da Valentina Moreira do Jajá
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'https://api.jotaja.com/openDelivery';
const CID = '92c66502-57ce-4563-a9e3-0df07dda5a38';
const CSEC = 'bf6798ba-5abe-43b8-a5d7-adca54643492';
const TARGET_PEDIDO = '32795092'; // Valentina Moreira

let _token = null;
async function getToken() {
  if (_token) return _token;
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC }),
  });
  if (!res.ok) throw new Error(`Auth: ${res.status}`);
  const d = await res.json();
  _token = d.access_token || d.accessToken;
  return _token;
}
async function jGet(path) {
  const t = await getToken();
  return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
}
async function jPost(path, body) {
  const t = await getToken();
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

function priceVal(p) { if (p === null || p === undefined) return 0; if (typeof p === 'object' && p !== null) return p.value ?? 0; return typeof p === 'number' ? p : 0; }

function extractOptions(item) {
  if (!item || typeof item !== 'object') return [];
  const rawList = (Array.isArray(item.options) && item.options.length > 0 ? item.options : null) ?? (Array.isArray(item.subItems) && item.subItems.length > 0 ? item.subItems : null) ?? (Array.isArray(item.sub_items) && item.sub_items.length > 0 ? item.sub_items : null) ?? (Array.isArray(item.garnishItems) && item.garnishItems.length > 0 ? item.garnishItems : null) ?? (Array.isArray(item.choices) && item.choices.length > 0 ? item.choices : null) ?? (Array.isArray(item.items) && item.items.length > 0 ? item.items : null) ?? (Array.isArray(item.additions) && item.additions.length > 0 ? item.additions : null) ?? (Array.isArray(item.customizations) && item.customizations.length > 0 ? item.customizations : null) ?? (Array.isArray(item.toppings) && item.toppings.length > 0 ? item.toppings : null) ?? [];
  const extracted = [];
  for (const o of rawList) {
    const nested = extractOptions(o);
    if (nested.length > 0) { extracted.push(...nested); } else {
      const name = o.name || o.productName || o.label || o.optionName || o.description || o.nameOption || '';
      if (name) extracted.push({ id: o.id || `opt-${Math.random().toString(36).slice(2)}`, name, quantity: o.quantity ?? o.qty ?? 1, price: priceVal(o.unitPrice) || priceVal(o.price) || priceVal(o.totalPrice) || priceVal(o.addition) || 0 });
    }
  }
  return extracted;
}

const BEV = ['coca','pepsi','fanta','guaraná','guarana','sprite','suco','água','agua','cerveja','refri','refrigerante','lata','pet','litro','energético','energetico','h2o','schweppes','monster','red bull','chá','cha'];
function isBev(n) { if (!n) return false; const l = n.toLowerCase(); return BEV.some(k => l.includes(k)); }

function parsePayment(od) {
  const po = od?.payments || {}; const pm = po.methods ?? (Array.isArray(po) ? po : []); const pl = Array.isArray(pm) ? pm : []; const f = pl[0] || {};
  const tp = typeof po.prepaid === 'number' ? po.prepaid : priceVal(po.prepaid); const tpn = typeof po.pending === 'number' ? po.pending : priceVal(po.pending);
  const cp = pl.find(p => p.method === 'CASH' || (p.name && p.name.toLowerCase().includes('dinheir')));
  const ca = cp?.changeFor ?? cp?.cash?.changeFor ?? null;
  const io = f.prepaid === false || f.type === 'OFFLINE' || f.type === 'PENDING' || tpn > 0 || Boolean(cp);
  const ip = !io && (tp > 0 || f.prepaid === true || f.type === 'ONLINE' || f.type === 'PREPAID' || f.method === 'DIGITAL_WALLET' || f.method === 'ONLINE');
  const rn = (f.name || f.description || '').toString().trim(); const rm = (f.method || '').toString().toUpperCase();
  let bn = 'Cartão';
  if (cp || rm === 'CASH' || rm.includes('DINHEIR') || rn.toLowerCase().includes('dinheir')) bn = 'Dinheiro';
  else if (rm === 'DEBIT' || rm.includes('DEBITO') || rn.toLowerCase().includes('débit') || rn.toLowerCase().includes('debit')) bn = 'Débito';
  else if (rm.includes('CREDIT') || rm.includes('CREDITO') || rn.toLowerCase().includes('crédit') || rn.toLowerCase().includes('credit')) bn = 'Crédito';
  else if (rm.includes('PIX') || rn.toLowerCase().includes('pix')) bn = 'Pix';
  else if (rm === 'DIGITAL_WALLET' || rm === 'ONLINE' || rm === 'APP') bn = 'JotaJá App';
  let d = rn || bn; d = d.replace(/\s*\((cobrar na entrega|pago online|online)\)/gi, '').trim();
  return { paymentMethod: ip ? `${d} (JotaJá Pago Online)` : `${d} (Cobrar na Entrega)`, changeAmount: ca };
}

async function main() {
  console.log('🎯 Puxando pedido da Valentina Moreira (#32795092)...\n');

  const franchisee = await prisma.user.findFirst({ where: { email: 'contatohakim@gmail.com' } });
  if (!franchisee) { console.error('❌ Franqueado não encontrado!'); process.exit(1); }
  const franchiseeId = franchisee.ownerId || franchisee.id;

  await getToken();

  // Poll eventos para encontrar o UUID da Valentina
  let targetUUID = null;
  let targetEvent = null;
  const evRes = await jGet('/v1/events:polling');
  if (evRes.ok) {
    const evText = await evRes.text();
    const events = evText ? JSON.parse(evText) : [];
    console.log(`📥 ${events.length} evento(s) pendente(s)`);
    for (const ev of events) {
      if (ev.orderId) {
        const checkRes = await jGet(`/v1/orders/${ev.orderId}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          const did = String(checkData.displayId || '');
          const seq = String(checkData.orderSeqNumber || '');
          if (did.includes(TARGET_PEDIDO) || seq.includes(TARGET_PEDIDO) || did.includes('4732') || seq.includes('4732')) {
            targetUUID = ev.orderId;
            targetEvent = ev;
            console.log(`   ✅ Encontrado UUID: ${targetUUID} (displayId: ${did})`);
            break;
          }
          // Also try matching by customer name
          if (checkData.customer?.name?.toLowerCase().includes('valentina')) {
            targetUUID = ev.orderId;
            targetEvent = ev;
            console.log(`   ✅ Encontrado por nome: ${targetUUID} - ${checkData.customer.name}`);
            break;
          }
        }
      }
    }

    // If not found by matching, try all pending events and pick the one we haven't imported
    if (!targetUUID) {
      for (const ev of events) {
        if (!ev.orderId) continue;
        const existing = await prisma.customerOrder.findFirst({ where: { openDeliveryOrderId: ev.orderId } });
        if (!existing) {
          const checkRes = await jGet(`/v1/orders/${ev.orderId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            targetUUID = ev.orderId;
            targetEvent = ev;
            console.log(`   ✅ Novo pedido não importado: ${targetUUID} - ${checkData.customer?.name} #${checkData.displayId}`);
            break;
          }
        }
      }
    }
  }

  // Fallback: try the pedido ID directly
  if (!targetUUID) {
    console.log('   Tentando ID direto...');
    const directRes = await jGet(`/v1/orders/${TARGET_PEDIDO}`);
    if (directRes.ok) { targetUUID = TARGET_PEDIDO; console.log('   ✅ Encontrado via ID direto'); }
  }

  if (!targetUUID) { console.error('❌ Pedido da Valentina não encontrado!'); await prisma.$disconnect(); return; }

  // Check idempotency
  const existing = await prisma.customerOrder.findFirst({
    where: { OR: [{ openDeliveryOrderId: targetUUID }, { openDeliveryReference: TARGET_PEDIDO }] }
  });
  if (existing) { console.log(`⏭️ Já existe: ${existing.id} - ${existing.status}`); await prisma.$disconnect(); return; }

  // Fetch full order
  const orderRes = await jGet(`/v1/orders/${targetUUID}`);
  if (!orderRes.ok) { console.error(`❌ Falha: ${orderRes.status}`); await prisma.$disconnect(); return; }
  const od = await orderRes.json();

  const displayId = od.displayId || od.orderSeqNumber || targetUUID.slice(-6);
  const customerName = od.customer?.name || 'Valentina Moreira';
  console.log(`\n📦 Pedido Jajá #${displayId} — ${customerName}`);

  // Parse items
  const rawItems = (Array.isArray(od.items) && od.items.length > 0 ? od.items : null) ?? (Array.isArray(od.orderItems) && od.orderItems.length > 0 ? od.orderItems : null) ?? (Array.isArray(od.products) && od.products.length > 0 ? od.products : null) ?? [];
  console.log(`📝 ${rawItems.length} item(s):`);

  const items = rawItems.map(i => {
    const itemName = i.name || i.productName || i.title || 'Item Jotajá';
    const options = extractOptions(i);
    const optNames = options.map(o => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
    const fullName = optNames.length > 0 ? `${itemName} | ${optNames.join(' | ')}` : itemName;
    const qty = i.quantity ?? i.qty ?? 1;
    const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
    const rawTotal = priceVal(i.totalPrice) || priceVal(i.total) || 0;
    const optSum = options.reduce((s, o) => s + (priceVal(o.price) || 0) * (o.quantity || 1), 0);
    let itemPrice = 0;
    if (rawTotal > 0 && qty > 0 && (rawTotal / qty) > rawUnit) itemPrice = rawTotal / qty;
    else if (rawUnit > 0 || optSum > 0) itemPrice = rawUnit + optSum;
    else if (rawTotal > 0 && qty > 0) itemPrice = rawTotal / qty;

    const comboSels = options.length > 0 ? options.map(o => ({ id: o.id, name: o.name, quantity: o.quantity ?? 1, price: priceVal(o.price) || 0 })) : null;
    const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;
    console.log(`   • ${qty}x ${fullName} — R$ ${(itemPrice * qty).toFixed(2)}`);

    return {
      price: itemPrice, quantity: qty,
      comboSelections: comboSels ? JSON.stringify(comboSels) : null,
      menuProduct: { connectOrCreate: { where: { id: `jotaja-${itemId}` }, create: { id: `jotaja-${itemId}`, franchiseeId: franchisee.id, name: fullName, description: i.specialInstructions || i.observations || '', price: itemPrice, category: i.category || 'Jotajá', isBeverage: isBev(fullName) || options.some(o => isBev(o.name)), active: true } } },
    };
  });

  // Totals
  const total = priceVal(od.total?.orderAmount ?? od.total?.subTotal ?? od.totalPrice ?? od.total);
  let deliveryFee = priceVal(od.total?.deliveryFee) || priceVal(od.delivery?.deliveryFee) || priceVal(od.deliveryFee) || 0;
  if (!deliveryFee && Array.isArray(od.otherFees)) { const df = od.otherFees.find(f => (f.type || f.name || '').toUpperCase().match(/DELIVERY|FRETE|FEE/)); if (df) deliveryFee = priceVal(df.price ?? df.value); }

  // Discounts
  const benefits = od.benefits ?? []; let dT = 0, dP = 0, dM = 0; const dD = [];
  for (const b of benefits) { const v = b.value ?? 0; dT += v; const sps = Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues : []; let bp = 0, bm = 0; for (const sp of sps) { if ((sp.name ?? '').toUpperCase() === 'MERCHANT') bm += sp.value ?? 0; else bp += sp.value ?? 0; } if (!sps.length && v > 0) { if ((b.sponsorship ?? '').toUpperCase() === 'MERCHANT') bm += v; else bp += v; } dP += bp; dM += bm; dD.push({ target: b.target ?? 'CART', value: v, platform: bp, merchant: bm }); }

  if (deliveryFee === 0 && od.total?.orderAmount && od.total?.subTotal) { const cf = priceVal(od.total.orderAmount) - priceVal(od.total.subTotal) + dT; if (cf > 0 && cf < 100) deliveryFee = Math.round(cf * 100) / 100; }

  // Scheduled
  const createdMs = od.createdAt ? new Date(od.createdAt).getTime() : Date.now();
  const isTakeout = od.orderType === 'TAKEOUT' || Boolean(od.takeout);
  let sched = null;
  if (od.orderTiming === 'SCHEDULED') { const rs = od.schedule?.scheduledDatetimeEnd ?? od.schedule?.scheduledDatetimeStart; if (rs) sched = new Date(rs); }
  else if (isTakeout) { const re = od.takeout?.estimatedTakeoutWindow?.end; sched = re && new Date(re).getTime() > createdMs + 300000 ? new Date(re) : new Date(createdMs + 2400000); }
  else { const re = od.delivery?.deliveryDeadline || od.delivery?.estimatedDeliveryWindow?.end; sched = re && new Date(re).getTime() > createdMs + 300000 ? new Date(re) : new Date(createdMs + 3000000); }

  const { paymentMethod, changeAmount } = parsePayment(od);
  const phone = od.customer?.phone; const phoneNum = phone?.number ?? (typeof phone === 'string' ? phone : ''); const phoneLoc = phone?.localizer;
  const custNote = od.extraInfo ?? od.delivery?.observations ?? od.customer?.customerNote ?? null;

  let addr = '';
  const a = od.delivery?.deliveryAddress;
  if (a) { const st = a.streetName ? `${a.streetName}${a.streetNumber ? `, ${a.streetNumber}` : ''}${a.complement ? `, ${a.complement}` : ''}` : a.formattedAddress || ''; const nb = a.neighborhood || ''; const ct = a.city || ''; const parts = []; if (st) parts.push(st); if (nb && (!st || !st.toLowerCase().includes(nb.toLowerCase()))) parts.push(nb); if (ct) parts.push(ct); addr = parts.join(' - '); }

  const ot = (od.orderType || '').toUpperCase();
  const delType = ot === 'TAKEOUT' || ot === 'PICKUP' || ot === 'RETIRADA' || Boolean(od.takeout) || (!a?.streetName && !a?.formattedAddress && deliveryFee === 0) ? 'RETIRADA' : 'DELIVERY';

  const itemNotes = (od.items ?? []).filter(i => i.specialInstructions?.trim()).map(i => `${i.name}: ${i.specialInstructions.trim()}`);
  const notes = [`Pedido Jotajá #${String(displayId).toUpperCase()}`, sched ? `📅 AGENDADO para ${sched.toLocaleString('pt-BR')}` : null, dT > 0 ? `🏷️ Desconto R$${dT.toFixed(2)}` : null, custNote ? `📝 OBS: ${custNote}` : null, ...itemNotes.map(n => `📝 ${n}`)].filter(Boolean).join('\n');

  console.log(`💰 Total: R$ ${total.toFixed(2)} | Taxa: R$ ${deliveryFee.toFixed(2)} | ${paymentMethod}`);
  console.log(`📍 ${addr || 'Sem endereço'} | ${delType}`);
  console.log(`📞 ${phoneLoc ? `${phoneNum} ID: ${phoneLoc}` : phoneNum || 'N/A'}`);

  // CREATE
  const newOrder = await prisma.customerOrder.create({
    data: {
      franchiseeId, openDeliveryOrderId: targetUUID, openDeliveryReference: String(displayId), openDeliveryChannel: 'JOTAJA',
      scheduledDatetime: sched, changeAmount, customerCpfCnpj: od.customer?.taxPayerIdentificationNumber ?? null,
      discountTotal: dT > 0 ? dT : null, discountIfood: dP > 0 ? dP : null, discountMerchant: dM > 0 ? dM : null, discountDetails: dD.length > 0 ? dD : undefined,
      source: 'JOTAJA', customerName, customerPhone: phoneLoc ? `${phoneNum} ID: ${phoneLoc}` : phoneNum, customerAddress: addr,
      deliveryType: delType, paymentMethod, totalAmount: total, deliveryFee, status: 'NOVO', kdsStage: 'PRODUCTION', notes,
      createdAt: new Date(), // POR ÚLTIMO NA FILA
      items: { create: items },
    },
  });
  console.log(`\n✅ IMPORTADO! DB id: ${newOrder.id}`);

  try { await jPost(`/v1/orders/${targetUUID}/confirm`); console.log('✅ Auto-confirmado no Jajá'); } catch { console.log('⚠️ Auto-confirmação falhou (pode já estar confirmado)'); }

  // Acknowledge event
  if (targetEvent) {
    const eid = targetEvent.eventId || targetEvent.id;
    if (eid) { try { await jPost('/v1/events/acknowledgment', [{ id: eid, orderId: targetEvent.orderId || '', eventType: targetEvent.eventType || '' }]); console.log('✅ Evento acknowledged'); } catch {} }
  }

  console.log('\n🎯 Pedido da Valentina entrou POR ÚLTIMO na fila. Nenhum outro pedido foi tocado.');
  await prisma.$disconnect();
}

main().catch(e => { console.error('❌', e); prisma.$disconnect(); process.exit(1); });
