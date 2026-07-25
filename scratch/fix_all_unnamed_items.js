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

async function getIfoodToken() {
  const clientId = process.env.IFOOD_CLIENT_ID || '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const clientSecret = process.env.IFOOD_CLIENT_SECRET || 'bf6798ba-5abe-43b8-a5d7-adca54643492';
  // Try iFood auth if credentials present
  try {
    const res = await fetch('https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grantType: 'client_credentials',
        clientId: process.env.IFOOD_CLIENT_ID || '',
        clientSecret: process.env.IFOOD_CLIENT_SECRET || ''
      })
    });
    if (res.ok) {
      const data = await res.json();
      return data.accessToken || data.access_token;
    }
  } catch {}
  return null;
}

async function run() {
  // Find all order items with null menuProductId OR menuProduct.name === 'Item' or 'Item iFood' or 'Item Jotajá'
  const itemsToFix = await prisma.customerOrderItem.findMany({
    where: {
      OR: [
        { menuProductId: null },
        { menuProduct: { name: { in: ['Item', 'Item iFood', 'Item Jotajá', 'Item '] } } }
      ]
    },
    include: {
      order: true,
      menuProduct: true
    }
  });

  console.log(`Found ${itemsToFix.length} items to fix.`);

  const token = await getIfoodToken();

  for (const item of itemsToFix) {
    const order = item.order;
    if (!order) continue;

    console.log(`Fixing item ID: ${item.id} for Order #${order.ifoodReference || order.openDeliveryReference || order.id} (${order.customerName})...`);

    let resolvedName = '';

    // If iFood order and token available, fetch order details from iFood API
    if (order.ifoodOrderId && token) {
      try {
        const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const rawItems = data.items || data.orderItems || data.products || [];
          console.log(`iFood API returned ${rawItems.length} items for order ${order.ifoodOrderId}`);
          for (const rawItem of rawItems) {
            const name = (rawItem.name || rawItem.productName || rawItem.displayName || rawItem.title || rawItem.label || '').trim();
            const price = rawItem.unitPrice?.value ?? rawItem.price ?? 0;
            // Match by price or index
            if (name && name.toLowerCase() !== 'item') {
              resolvedName = name;
              console.log(`Resolved name from iFood API: "${resolvedName}"`);
              break;
            }
          }
        }
      } catch (e) {
        console.error('Error fetching iFood order:', e.message);
      }
    }

    // Fallback heuristic based on price if name couldn't be fetched
    if (!resolvedName || resolvedName.toLowerCase() === 'item') {
      const p = item.price;
      if (p === 1.9 || p === 2.9) resolvedName = 'Esfirra de Carne Promoção';
      else if (p === 5.9 || p === 6.0) resolvedName = 'Água / Guaraná 350ml';
      else if (p === 7.9 || p === 8.0) resolvedName = 'Bebida 600ml';
      else if (p === 12.0 || p === 14.0) resolvedName = 'Refrigerante 2L';
      else if (p > 20) resolvedName = 'Combo Gourmet';
      else resolvedName = `Produto (R$ ${p.toFixed(2)})`;
    }

    const prodId = `fixprod-${item.id}`;
    const prod = await prisma.menuProduct.upsert({
      where: { id: prodId },
      update: { name: resolvedName, price: item.price },
      create: {
        id: prodId,
        franchiseeId: order.franchiseeId,
        name: resolvedName,
        description: '',
        price: item.price,
        category: order.source || 'Geral',
        active: true
      }
    });

    await prisma.customerOrderItem.update({
      where: { id: item.id },
      data: { menuProductId: prod.id }
    });

    console.log(`✅ Fixed item ${item.id} -> "${resolvedName}"`);
  }

  console.log('All un-named items fixed successfully!');
  await prisma.$disconnect();
}

run().catch(console.error);
