const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envConfig = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function priceVal(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val.value !== undefined) return Number(val.value) || 0;
  return Number(val) || 0;
}

function extractJotajaOptions(item) {
  const extracted = [];
  const optionsArr = item.options || item.subItems || item.garnishItems || item.choices || item.additions || item.customizations || item.toppings || [];
  if (Array.isArray(optionsArr)) {
    for (const opt of optionsArr) {
      if (opt.name || opt.label || opt.productName) {
        extracted.push({
          id: String(opt.id || opt.externalId || Math.random().toString(36).slice(2)),
          name: String(opt.name || opt.label || opt.productName),
          quantity: Number(opt.quantity || opt.qty || 1),
          price: priceVal(opt.price || opt.unitPrice || opt.addition),
        });
      }
    }
  }
  return extracted;
}

async function run() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { openDeliveryReference: '32528840' },
        { openDeliveryReference: '32528882' },
        { customerName: { contains: 'Suellen' } },
        { customerName: { contains: 'Hewller' } }
      ]
    }
  });

  console.log(`Found ${orders.length} orders to repopulate.`);

  const clientId = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const clientSecret = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

  const authRes = await fetch('https://api.jotaja.com/openDelivery/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.access_token || authData.accessToken;

  for (const order of orders) {
    if (!order.openDeliveryOrderId) continue;

    console.log(`Repopulating order #${order.openDeliveryReference} (${order.customerName})...`);

    const res = await fetch(`https://api.jotaja.com/openDelivery/v1/orders/${order.openDeliveryOrderId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    if (!res.ok) {
      console.log(`Failed to fetch order ${order.openDeliveryOrderId} from JotaJa: ${res.status}`);
      continue;
    }

    const orderData = await res.json();
    const rawItemsList = orderData.items || orderData.orderItems || [];

    // Clear existing items
    await prisma.customerOrderItem.deleteMany({ where: { orderId: order.id } });

    for (const i of rawItemsList) {
      const itemName = i.name || i.productName || i.title || i.label || 'Item Jotajá';
      const options = extractJotajaOptions(i);
      const optionNames = options.map(o => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
      const fullName = optionNames.length > 0 ? `${itemName} | ${optionNames.join(' | ')}` : itemName;
      const qty = i.quantity ?? 1;
      const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
      const rawTotal = priceVal(i.totalPrice) || 0;
      const itemPrice = rawUnit > 0 ? rawUnit : (rawTotal > 0 && qty > 0 ? rawTotal / qty : 0);

      const comboSelsList = options.length > 0 ? options.map(o => ({
        id: o.id,
        name: o.name,
        quantity: o.quantity ?? 1,
        price: priceVal(o.price) || 0,
      })) : null;

      const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;

      const prod = await prisma.menuProduct.upsert({
        where: { id: `jotaja-${itemId}` },
        update: { name: fullName, price: itemPrice },
        create: {
          id: `jotaja-${itemId}`,
          franchiseeId: order.franchiseeId,
          name: fullName,
          description: i.specialInstructions || '',
          price: itemPrice,
          category: 'Jotajá',
          active: true
        }
      });

      await prisma.customerOrderItem.create({
        data: {
          orderId: order.id,
          menuProductId: prod.id,
          quantity: qty,
          price: itemPrice,
          comboSelections: comboSelsList ? JSON.stringify(comboSelsList) : null
        }
      });

      console.log(`  + Item: ${qty}x ${fullName}`);
    }

    console.log(`✅ Order #${order.openDeliveryReference} (${order.customerName}) repopulated successfully!`);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
