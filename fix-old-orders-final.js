/**
 * fix-old-orders-final.js
 * 1. Remove pedidos antigos reimportados (referências <= 32777566)
 * 2. Puxa o pedido NOVO da Lara Ouverney Magariños (#32795316)
 * 3. Verifica estado final
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Referências de pedidos ANTIGOS (de antes de hoje) que NÃO devem existir
const OLD_REFS = ['32775858', '32776862', '32777566'];

async function main() {
  console.log('🔧 LIMPEZA + IMPORTAÇÃO FINAL\n');

  // 1. Encontrar e remover TODOS os pedidos com referências antigas
  console.log('═══ 1. REMOVENDO PEDIDOS ANTIGOS ═══');
  for (const ref of OLD_REFS) {
    const oldOrders = await prisma.customerOrder.findMany({
      where: {
        OR: [
          { openDeliveryReference: ref },
          { openDeliveryReference: { contains: ref } },
        ],
        openDeliveryChannel: 'JOTAJA',
      },
      select: { id: true, customerName: true, openDeliveryReference: true, openDeliveryOrderId: true, createdAt: true },
    });

    for (const o of oldOrders) {
      // Deletar itens e pedido
      await prisma.customerOrderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.customerOrder.delete({ where: { id: o.id } });
      console.log(`   🗑️ REMOVIDO: ${o.customerName} #${o.openDeliveryReference} (DB: ${o.id}, criado: ${o.createdAt.toISOString()})`);
    }
    if (oldOrders.length === 0) {
      console.log(`   ✅ Ref #${ref}: nenhum pedido encontrado (já limpo)`);
    }
  }

  // 2. Verificar se tem mais algum pedido antigo (criado antes de hoje) com source JOTAJA
  console.log('\n═══ 2. VERIFICANDO OUTROS PEDIDOS ANTIGOS ═══');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const allJotaja = await prisma.customerOrder.findMany({
    where: {
      openDeliveryChannel: 'JOTAJA',
      // Pedidos criados nos últimos 30 min (importados por mim ou pelo cron)
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    select: { id: true, customerName: true, openDeliveryReference: true, openDeliveryOrderId: true, createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  // Referências conhecidas de pedidos VÁLIDOS de hoje
  const VALID_TODAY_REFS = ['32790382', '32791436', '32792367', '32792869', '32792997', '32793103', '32793249', '32794625', '32794683', '32795092', '32795316'];
  
  for (const o of allJotaja) {
    const ref = o.openDeliveryReference;
    const isValid = VALID_TODAY_REFS.some(v => ref?.includes(v));
    if (!isValid && ref) {
      // Check if ref number is lower than today's orders (meaning it's old)
      const refNum = parseInt(ref);
      if (refNum > 0 && refNum < 32790000) {
        console.log(`   ⚠️ SUSPEITO: ${o.customerName} #${ref} (DB: ${o.id}) — referência menor que pedidos de hoje`);
        // Remove it
        await prisma.customerOrderItem.deleteMany({ where: { orderId: o.id } });
        await prisma.customerOrder.delete({ where: { id: o.id } });
        console.log(`   🗑️ REMOVIDO`);
      } else {
        console.log(`   ✅ OK: ${o.customerName} #${ref}`);
      }
    }
  }

  // 3. Agora puxar o pedido NOVO da Lara Ouverney (#32795316)
  console.log('\n═══ 3. IMPORTANDO LARA OUVERNEY MAGARIÑOS (#32795316) ═══');
  
  const BASE = 'https://api.jotaja.com/openDelivery';
  const CID = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const CSEC = 'bf6798ba-5abe-43b8-a5d7-adca54643492';
  
  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC }),
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token || tokenData.accessToken;

  async function jGet(path) {
    return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
  }
  async function jPost(path, body) {
    return fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  }

  // Check if Lara's order already exists
  const laraExists = await prisma.customerOrder.findFirst({
    where: { OR: [{ openDeliveryReference: '32795316' }, { openDeliveryReference: { contains: '32795316' } }] }
  });
  
  if (laraExists) {
    console.log(`   ⏭️ Lara Ouverney já existe: ${laraExists.id}`);
  } else {
    // Poll events to find UUID
    const evRes = await jGet('/v1/events:polling');
    let targetUUID = null, targetEvent = null;
    if (evRes.ok) {
      const evs = JSON.parse(await evRes.text() || '[]');
      console.log(`   📥 ${evs.length} evento(s) pendente(s)`);
      for (const ev of evs) {
        if (!ev.orderId) continue;
        const cr = await jGet(`/v1/orders/${ev.orderId}`);
        if (!cr.ok) continue;
        const cd = await cr.json();
        const did = String(cd.displayId || '');
        if (did.includes('32795316') || (cd.customer?.name || '').toLowerCase().includes('lara ouverney') || (cd.customer?.name || '').toLowerCase().includes('magari')) {
          targetUUID = ev.orderId; targetEvent = ev;
          console.log(`   ✅ UUID: ${targetUUID} (${cd.customer?.name} #${did})`);
          break;
        }
      }
    }

    if (targetUUID) {
      const od = await (await jGet(`/v1/orders/${targetUUID}`)).json();
      const displayId = od.displayId || targetUUID.slice(-6);
      const customerName = od.customer?.name || 'Lara Ouverney Magariños';
      
      // Extract items
      const rawItems = od.items ?? [];
      console.log(`   📝 ${rawItems.length} item(s):`);

      function priceVal(p) { if (p == null) return 0; if (typeof p === 'object') return p.value ?? 0; return typeof p === 'number' ? p : 0; }
      function extractOptions(item) {
        if (!item || typeof item !== 'object') return [];
        const raw = (Array.isArray(item.options) && item.options.length ? item.options : null) ?? (Array.isArray(item.subItems) && item.subItems.length ? item.subItems : null) ?? (Array.isArray(item.sub_items) && item.sub_items.length ? item.sub_items : null) ?? (Array.isArray(item.garnishItems) && item.garnishItems.length ? item.garnishItems : null) ?? (Array.isArray(item.choices) && item.choices.length ? item.choices : null) ?? (Array.isArray(item.items) && item.items.length ? item.items : null) ?? (Array.isArray(item.additions) && item.additions.length ? item.additions : null) ?? (Array.isArray(item.customizations) && item.customizations.length ? item.customizations : null) ?? (Array.isArray(item.toppings) && item.toppings.length ? item.toppings : null) ?? [];
        const out = [];
        for (const o of raw) { const n2 = extractOptions(o); if (n2.length) { out.push(...n2); } else { const nm = o.name || o.productName || o.label || o.optionName || o.description || ''; if (nm) out.push({ id: o.id || `o-${Math.random().toString(36).slice(2)}`, name: nm, quantity: o.quantity ?? 1, price: priceVal(o.unitPrice) || priceVal(o.price) || priceVal(o.totalPrice) || 0 }); } }
        return out;
      }
      const BEV = ['coca','pepsi','fanta','guaraná','guarana','sprite','suco','água','agua','cerveja','refri','refrigerante','lata','pet','litro','energético','h2o','monster','red bull','chá','cha'];
      function isBev(n) { if (!n) return false; const l = n.toLowerCase(); return BEV.some(k => l.includes(k)); }

      const franchisee = await prisma.user.findFirst({ where: { email: 'contatohakim@gmail.com' } });
      const franchiseeId = franchisee.ownerId || franchisee.id;

      const items = rawItems.map(i => {
        const itemName = i.name || i.productName || 'Item Jotajá';
        const options = extractOptions(i);
        const optNames = options.map(o => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
        const fullName = optNames.length ? `${itemName} | ${optNames.join(' | ')}` : itemName;
        const qty = i.quantity ?? 1;
        const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
        const rawTotal = priceVal(i.totalPrice) || priceVal(i.total) || 0;
        const optSum = options.reduce((s, o) => s + (priceVal(o.price) || 0) * (o.quantity || 1), 0);
        let itemPrice = 0;
        if (rawTotal > 0 && qty > 0 && (rawTotal / qty) > rawUnit) itemPrice = rawTotal / qty;
        else if (rawUnit > 0 || optSum > 0) itemPrice = rawUnit + optSum;
        else if (rawTotal > 0 && qty > 0) itemPrice = rawTotal / qty;
        const comboSels = options.length ? options.map(o => ({ id: o.id, name: o.name, quantity: o.quantity ?? 1, price: priceVal(o.price) || 0 })) : null;
        const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;
        console.log(`      • ${qty}x ${fullName} — R$ ${(itemPrice * qty).toFixed(2)}`);
        return { price: itemPrice, quantity: qty, comboSelections: comboSels ? JSON.stringify(comboSels) : null, menuProduct: { connectOrCreate: { where: { id: `jotaja-${itemId}` }, create: { id: `jotaja-${itemId}`, franchiseeId: franchisee.id, name: fullName, description: i.specialInstructions || '', price: itemPrice, category: i.category || 'Jotajá', isBeverage: isBev(fullName) || options.some(o => isBev(o.name)), active: true } } } };
      });

      const total = priceVal(od.total?.orderAmount ?? od.total?.subTotal ?? od.totalPrice ?? od.total);
      let deliveryFee = priceVal(od.total?.deliveryFee) || priceVal(od.delivery?.deliveryFee) || priceVal(od.deliveryFee) || 0;
      const benefits = od.benefits ?? []; let dT = 0, dP = 0, dM = 0; const dD = [];
      for (const b of benefits) { const v = b.value ?? 0; dT += v; const sps = Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues : []; let bp = 0, bm = 0; for (const sp of sps) { if ((sp.name ?? '').toUpperCase() === 'MERCHANT') bm += sp.value ?? 0; else bp += sp.value ?? 0; } if (!sps.length && v > 0) { if ((b.sponsorship ?? '').toUpperCase() === 'MERCHANT') bm += v; else bp += v; } dP += bp; dM += bm; dD.push({ target: b.target ?? 'CART', value: v, platform: bp, merchant: bm }); }
      if (deliveryFee === 0 && od.total?.orderAmount && od.total?.subTotal) { const cf = priceVal(od.total.orderAmount) - priceVal(od.total.subTotal) + dT; if (cf > 0 && cf < 100) deliveryFee = Math.round(cf * 100) / 100; }

      const createdMs = od.createdAt ? new Date(od.createdAt).getTime() : Date.now();
      const isTakeout = od.orderType === 'TAKEOUT' || Boolean(od.takeout);
      let sched = null;
      if (od.orderTiming === 'SCHEDULED') { const rs = od.schedule?.scheduledDatetimeEnd ?? od.schedule?.scheduledDatetimeStart; if (rs) sched = new Date(rs); }
      else if (isTakeout) { const re = od.takeout?.estimatedTakeoutWindow?.end; sched = re && new Date(re).getTime() > createdMs + 300000 ? new Date(re) : new Date(createdMs + 2400000); }
      else { const re = od.delivery?.deliveryDeadline || od.delivery?.estimatedDeliveryWindow?.end; sched = re && new Date(re).getTime() > createdMs + 300000 ? new Date(re) : new Date(createdMs + 3000000); }

      // Payment
      const po = od?.payments || {}; const pm = po.methods ?? (Array.isArray(po) ? po : []); const pl = Array.isArray(pm) ? pm : []; const f = pl[0] || {};
      const cp = pl.find(p => p.method === 'CASH' || (p.name && p.name.toLowerCase().includes('dinheir')));
      const ca = cp?.changeFor ?? cp?.cash?.changeFor ?? null;
      const tp = typeof po.prepaid === 'number' ? po.prepaid : priceVal(po.prepaid); const tpn = typeof po.pending === 'number' ? po.pending : priceVal(po.pending);
      const io = f.prepaid === false || f.type === 'OFFLINE' || f.type === 'PENDING' || tpn > 0 || Boolean(cp);
      const ip = !io && (tp > 0 || f.prepaid === true || f.type === 'ONLINE' || f.type === 'PREPAID' || f.method === 'DIGITAL_WALLET' || f.method === 'ONLINE');
      const rn = (f.name || f.description || '').toString().trim(); const rm = (f.method || '').toString().toUpperCase();
      let bn = 'Cartão';
      if (cp || rm === 'CASH' || rm.includes('DINHEIR') || rn.toLowerCase().includes('dinheir')) bn = 'Dinheiro';
      else if (rm === 'DEBIT' || rm.includes('DEBITO') || rn.toLowerCase().includes('débit') || rn.toLowerCase().includes('debit')) bn = 'Débito';
      else if (rm.includes('CREDIT') || rm.includes('CREDITO') || rn.toLowerCase().includes('crédit') || rn.toLowerCase().includes('credit')) bn = 'Crédito';
      else if (rm.includes('PIX') || rn.toLowerCase().includes('pix')) bn = 'Pix';
      else if (rm === 'DIGITAL_WALLET' || rm === 'ONLINE' || rm === 'APP') bn = 'JotaJá App';
      let dd = rn || bn; dd = dd.replace(/\s*\((cobrar na entrega|pago online|online)\)/gi, '').trim();
      const paymentMethod = ip ? `${dd} (JotaJá Pago Online)` : `${dd} (Cobrar na Entrega)`;

      const phone = od.customer?.phone; const phoneNum = phone?.number ?? (typeof phone === 'string' ? phone : ''); const phoneLoc = phone?.localizer;
      const custNote = od.extraInfo ?? od.delivery?.observations ?? od.customer?.customerNote ?? null;
      let addr = '';
      const a = od.delivery?.deliveryAddress;
      if (a) { const st = a.streetName ? `${a.streetName}${a.streetNumber ? `, ${a.streetNumber}` : ''}${a.complement ? `, ${a.complement}` : ''}` : a.formattedAddress || ''; const nb = a.neighborhood || ''; const ct = a.city || ''; const parts = []; if (st) parts.push(st); if (nb && (!st || !st.toLowerCase().includes(nb.toLowerCase()))) parts.push(nb); if (ct) parts.push(ct); addr = parts.join(' - '); }
      const ot2 = (od.orderType || '').toUpperCase();
      const delType = ot2 === 'TAKEOUT' || ot2 === 'PICKUP' || Boolean(od.takeout) || (!a?.streetName && !a?.formattedAddress && deliveryFee === 0) ? 'RETIRADA' : 'DELIVERY';
      const itemNotes = (od.items ?? []).filter(i => i.specialInstructions?.trim()).map(i => `${i.name}: ${i.specialInstructions.trim()}`);
      const notes = [`Pedido Jotajá #${String(displayId).toUpperCase()}`, sched ? `📅 AGENDADO para ${sched.toLocaleString('pt-BR')}` : null, dT > 0 ? `🏷️ Desconto R$${dT.toFixed(2)}` : null, custNote ? `📝 OBS: ${custNote}` : null, ...itemNotes.map(n => `📝 ${n}`)].filter(Boolean).join('\n');

      console.log(`   💰 Total: R$ ${total.toFixed(2)} | Taxa: R$ ${deliveryFee.toFixed(2)} | ${paymentMethod}`);
      console.log(`   📍 ${addr || 'Sem endereço'} | ${delType}`);

      const newOrder = await prisma.customerOrder.create({
        data: {
          franchiseeId, openDeliveryOrderId: targetUUID, openDeliveryReference: String(displayId), openDeliveryChannel: 'JOTAJA',
          scheduledDatetime: sched, changeAmount: ca, customerCpfCnpj: od.customer?.taxPayerIdentificationNumber ?? null,
          discountTotal: dT > 0 ? dT : null, discountIfood: dP > 0 ? dP : null, discountMerchant: dM > 0 ? dM : null, discountDetails: dD.length > 0 ? dD : undefined,
          source: 'JOTAJA', customerName, customerPhone: phoneLoc ? `${phoneNum} ID: ${phoneLoc}` : phoneNum, customerAddress: addr,
          deliveryType: delType, paymentMethod, totalAmount: total, deliveryFee, status: 'NOVO', kdsStage: 'PRODUCTION', notes,
          createdAt: new Date(),
          items: { create: items },
        },
      });
      console.log(`   ✅ IMPORTADO! DB id: ${newOrder.id}`);
      try { await jPost(`/v1/orders/${targetUUID}/confirm`); console.log('   ✅ Auto-confirmado'); } catch {}
      if (targetEvent) { const eid = targetEvent.eventId || targetEvent.id; if (eid) try { await jPost('/v1/events/acknowledgment', [{ id: eid, orderId: targetEvent.orderId || '', eventType: targetEvent.eventType || '' }]); } catch {} }
    } else {
      console.log('   ❌ Não encontrado nos eventos. Pode já ter sido importado pelo dashboard poll.');
    }
  }

  // 4. Estado final
  console.log('\n═══ 4. ESTADO FINAL — Pedidos Jajá recentes ═══');
  const finalOrders = await prisma.customerOrder.findMany({
    where: { openDeliveryChannel: 'JOTAJA', createdAt: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
    select: { id: true, customerName: true, openDeliveryReference: true, totalAmount: true, status: true, kdsStage: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   Total: ${finalOrders.length} pedido(s)`);
  for (const o of finalOrders) {
    const refNum = parseInt(o.openDeliveryReference || '0');
    const flag = refNum < 32790000 ? ' ⚠️ ANTIGO!' : '';
    console.log(`   • #${o.openDeliveryReference} - ${o.customerName} - R$ ${o.totalAmount.toFixed(2)} - ${o.status} - ${o.kdsStage}${flag}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('❌', e); prisma.$disconnect(); process.exit(1); });
