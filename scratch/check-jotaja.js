// scratch/check-jotaja.js — Diagnóstico da integração JotaJá (via driver Neon serverless)
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  console.log('DB URL host:', dbUrl?.split('@')[1]?.split('/')[0] || 'N/A');
  
  // Converter pooler URL para direct URL para serverless driver
  const directUrl = dbUrl.replace('-pooler.', '.');
  console.log('Direct URL host:', directUrl?.split('@')[1]?.split('/')[0] || 'N/A');
  
  const sql = neon(directUrl);

  // 1. Lojas com JotaJá ativo
  const stores = await sql`
    SELECT id, email, "storeName", "ownerId", "jotajaMerchantId",
           CASE WHEN "jotajaClientId" IS NOT NULL THEN 'SIM' ELSE 'NAO' END as has_client_id,
           CASE WHEN "jotajaClientSecret" IS NOT NULL THEN 'SIM' ELSE 'NAO' END as has_client_secret,
           "jotajaConnected"
    FROM "User"
    WHERE "jotajaConnected" = true
      AND email NOT LIKE 'deleted_%'
  `;

  console.log('\n=== LOJAS COM JOTAJÁ ATIVO ===');
  for (const s of stores) {
    console.log(`  📍 ${s.storeName || s.email}`);
    console.log(`     id: ${s.id} | ownerId: ${s.ownerId || 'N/A'}`);
    console.log(`     merchantId: ${s.jotajaMerchantId || 'N/A'}`);
    console.log(`     clientId: ${s.has_client_id === 'SIM' ? '✅' : '❌'} | clientSecret: ${s.has_client_secret === 'SIM' ? '✅' : '❌'}`);
  }

  // 2. Últimos 10 pedidos JotaJá
  const recentOrders = await sql`
    SELECT id, "dailyOrderNumber", "openDeliveryOrderId", "openDeliveryReference",
           "customerName", "totalAmount", status, "createdAt", source
    FROM "CustomerOrder"
    WHERE source = 'JOTAJA' OR "openDeliveryChannel" = 'JOTAJA'
    ORDER BY "createdAt" DESC
    LIMIT 10
  `;

  console.log('\n=== ÚLTIMOS 10 PEDIDOS JOTAJÁ ===');
  if (recentOrders.length === 0) {
    console.log('  ⚠️ Nenhum pedido JotaJá encontrado!');
  }
  for (const o of recentOrders) {
    const dt = new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`  #${o.dailyOrderNumber || '?'} | ${o.customerName} | R$ ${o.totalAmount} | ${o.status} | ${dt}`);
    console.log(`     ref: ${o.openDeliveryReference || 'N/A'} | orderId: ${(o.openDeliveryOrderId || '').substring(0, 30)}...`);
  }

  // 3. Verificar pedidos #5765 e #5766
  const missing = await sql`
    SELECT id, "openDeliveryOrderId", "openDeliveryReference", "customerName", status, "createdAt"
    FROM "CustomerOrder"
    WHERE "openDeliveryReference" IN ('5765', '5766', '#5765', '#5766')
       OR "customerName" ILIKE '%FRED FERREIRA%'
       OR "customerName" ILIKE '%Loyse Lima%'
  `;

  console.log('\n=== PEDIDOS #5765 (FRED FERREIRA) e #5766 (LOYSE LIMA) ===');
  if (missing.length === 0) {
    console.log('  ❌ NÃO ENCONTRADOS no FireHub!');
  } else {
    for (const o of missing) {
      const dt = new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      console.log(`  ✅ Ref ${o.openDeliveryReference}: ${o.customerName} | ${o.status} | ${dt}`);
    }
  }

  // 4. Variáveis de ambiente
  console.log('\n=== VARIÁVEIS DE AMBIENTE ===');
  console.log(`  JOTAJA_CLIENT_ID: ${process.env.JOTAJA_CLIENT_ID ? '✅ ' + process.env.JOTAJA_CLIENT_ID.substring(0, 10) + '...' : '❌'}`);
  console.log(`  JOTAJA_CLIENT_SECRET: ${process.env.JOTAJA_CLIENT_SECRET ? '✅ configurado' : '❌'}`);
  console.log(`  JOTAJA_BASE_URL: ${process.env.JOTAJA_BASE_URL || 'https://api.jotaja.com/openDelivery (padrão)'}`);
  console.log(`  CRON_SECRET: ${process.env.CRON_SECRET ? '✅ configurado' : '❌ NÃO DEFINIDO'}`);

  // 5. Hakim
  const hakim = await sql`
    SELECT id, "storeName", "ownerId", "jotajaConnected", "jotajaMerchantId",
           CASE WHEN "jotajaClientId" IS NOT NULL THEN 'SIM' ELSE 'NAO' END as has_client_id
    FROM "User"
    WHERE email = 'contatohakim@gmail.com'
    LIMIT 1
  `;
  console.log('\n=== HAKIM ===');
  if (hakim.length > 0) {
    const h = hakim[0];
    console.log(`  id: ${h.id}, ownerId: ${h.ownerId || 'N/A'}, storeName: ${h.storeName}`);
    console.log(`  jotajaConnected: ${h.jotajaConnected}, merchantId: ${h.jotajaMerchantId || 'N/A'}, clientId: ${h.has_client_id === 'SIM' ? '✅' : '❌'}`);
  } else {
    console.log('  ❌ Não encontrado');
  }
}

main().catch(console.error);
