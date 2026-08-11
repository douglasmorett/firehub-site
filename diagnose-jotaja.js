/**
 * diagnose-jotaja.js — Diagnóstico completo de por que pedidos Jajá não entram
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 DIAGNÓSTICO COMPLETO — Jajá → FireHub\n');

  // 1. Verificar credenciais Jajá no banco
  console.log('═══ 1. CREDENCIAIS JOTAJÁ NO BANCO ═══');
  const usersWithJotaja = await prisma.user.findMany({
    where: {
      OR: [
        { jotajaConnected: true },
        { NOT: { jotajaClientId: null } },
        { jotajaMerchantId: { not: null } },
        { email: 'contatohakim@gmail.com' },
      ]
    },
    select: {
      id: true, email: true, name: true, storeName: true,
      jotajaConnected: true, jotajaClientId: true, jotajaClientSecret: true, jotajaMerchantId: true,
      ownerId: true,
    },
  });

  if (usersWithJotaja.length === 0) {
    console.log('   ❌ NENHUM USUÁRIO tem credenciais Jotajá no banco!');
    console.log('   Isso significa que o sistema usa APENAS as env vars padrão.');
  } else {
    for (const u of usersWithJotaja) {
      console.log(`   👤 ${u.email} (${u.storeName || u.name})`);
      console.log(`      jotajaConnected: ${u.jotajaConnected ?? 'null/undefined'}`);
      console.log(`      jotajaClientId: ${u.jotajaClientId ? u.jotajaClientId.slice(0, 8) + '...' : 'NULL'}`);
      console.log(`      jotajaClientSecret: ${u.jotajaClientSecret ? '***definido***' : 'NULL'}`);
      console.log(`      jotajaMerchantId: ${u.jotajaMerchantId || 'NULL'}`);
      console.log(`      ownerId: ${u.ownerId || 'NULL (é owner)'}`);
    }
  }

  // 2. Verificar contatohakim@gmail.com especificamente
  console.log('\n═══ 2. CONTA PRINCIPAL (contatohakim@gmail.com) ═══');
  const hakim = await prisma.user.findFirst({ where: { email: 'contatohakim@gmail.com' } });
  if (hakim) {
    console.log(`   id: ${hakim.id}`);
    console.log(`   ownerId: ${hakim.ownerId || 'NULL (é owner)'}`);
    console.log(`   storeName: ${hakim.storeName}`);
    console.log(`   role: ${hakim.role}`);
  } else {
    console.log('   ❌ contatohakim@gmail.com NÃO EXISTE no banco!');
  }

  // 3. Testar autenticação Jotajá
  console.log('\n═══ 3. TESTE DE AUTENTICAÇÃO JOTAJÁ ═══');
  const BASE = 'https://api.jotaja.com/openDelivery';
  const CID = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const CSEC = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

  try {
    const tokenRes = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC }),
    });
    if (tokenRes.ok) {
      const data = await tokenRes.json();
      const token = data.access_token || data.accessToken;
      console.log(`   ✅ Token obtido com credenciais ENV`);
      console.log(`   Expira em: ${data.expires_in || data.expiresIn}s`);

      // Test polling
      const pollRes = await fetch(`${BASE}/v1/events:polling`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (pollRes.ok) {
        const evText = await pollRes.text();
        const events = evText ? JSON.parse(evText) : [];
        console.log(`   ✅ Polling funciona: ${events.length} evento(s) pendente(s)`);
      } else {
        console.log(`   ❌ Polling falhou: ${pollRes.status} ${await pollRes.text().catch(() => '')}`);
      }
    } else {
      console.log(`   ❌ Auth falhou: ${tokenRes.status}`);
    }
  } catch (e) {
    console.log(`   ❌ Auth erro: ${e.message}`);
  }

  // 4. Verificar se as credenciais do banco são diferentes das ENV
  if (usersWithJotaja.length > 0) {
    console.log('\n═══ 4. CONFLITO DE CREDENCIAIS? ═══');
    for (const u of usersWithJotaja) {
      if (u.jotajaClientId && u.jotajaClientId !== CID) {
        console.log(`   ⚠️ ${u.email} tem clientId DIFERENTE do ENV!`);
        console.log(`      DB: ${u.jotajaClientId}`);
        console.log(`      ENV: ${CID}`);

        // Testar auth com as credenciais do banco
        try {
          const testRes = await fetch(`${BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'client_credentials', client_id: u.jotajaClientId, client_secret: u.jotajaClientSecret || '' }),
          });
          if (testRes.ok) {
            console.log(`      ✅ Credenciais do banco FUNCIONAM`);
          } else {
            console.log(`      ❌ Credenciais do banco FALHAM: ${testRes.status}`);
            console.log(`      🔴 ESTA É A CAUSA! O sistema usa credenciais do banco que são INVÁLIDAS!`);
          }
        } catch (e) {
          console.log(`      ❌ Teste falhou: ${e.message}`);
        }
      } else if (u.jotajaClientId === CID) {
        console.log(`   ✅ ${u.email} tem mesmo clientId do ENV (OK)`);
      }
    }
  }

  // 5. Testar chamada ao endpoint de produção
  console.log('\n═══ 5. TESTE DO ENDPOINT CRON EM PRODUÇÃO ═══');
  try {
    const cronRes = await fetch('https://www.firehubfood.com.br/api/cron/jotaja-poll', {
      headers: { 'Accept': 'application/json' },
    });
    const cronData = await cronRes.json().catch(() => null);
    console.log(`   Status: ${cronRes.status}`);
    if (cronData) {
      console.log(`   Response: ${JSON.stringify(cronData, null, 2).slice(0, 500)}`);
    }
  } catch (e) {
    console.log(`   ❌ Falha ao chamar endpoint: ${e.message}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
