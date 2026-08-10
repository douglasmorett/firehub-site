/**
 * test-prod-creds.js — Testa se as credenciais em produção são as mesmas ou diferentes
 * Compara: chamada com credenciais ENV vs chamada ao endpoint de produção
 */
async function main() {
  const BASE = 'https://api.jotaja.com/openDelivery';
  
  // Credenciais do .env / .env.local (funcionam localmente)
  const LOCAL_CID = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const LOCAL_CSEC = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

  // 1. Auth com credenciais locais e verificar merchantId da resposta
  console.log('═══ CREDENCIAIS LOCAIS (.env) ═══');
  const localRes = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: LOCAL_CID, client_secret: LOCAL_CSEC }),
  });
  const localData = await localRes.json();
  const localToken = localData.access_token || localData.accessToken;
  console.log('  Token:', localToken ? localToken.slice(0, 30) + '...' : 'FALHOU');
  
  // Check events with local token
  const evRes = await fetch(`${BASE}/v1/events:polling`, {
    headers: { Authorization: `Bearer ${localToken}`, Accept: 'application/json' },
  });
  const evText = await evRes.text();
  const events = evText ? JSON.parse(evText) : [];
  console.log(`  Eventos com token local: ${events.length}`);

  // 2. Chamar o cron de produção e ver a resposta
  console.log('\n═══ ENDPOINT PRODUÇÃO (Vercel) ═══');
  const prodRes = await fetch('https://www.firehubfood.com.br/api/cron/jotaja-poll');
  const prodData = await prodRes.json();
  console.log('  Status:', prodRes.status);
  console.log('  Eventos em produção:', prodData.events);
  console.log('  Log:', JSON.stringify(prodData.log, null, 2));

  // 3. Conclusão
  console.log('\n═══ DIAGNÓSTICO ═══');
  if (events.length > 0 && prodData.events === 0) {
    console.log('🔴 CONFIRMADO: Produção usa credenciais/token DIFERENTES do local!');
    console.log('   O Vercel provavelmente NÃO tem JOTAJA_CLIENT_ID e JOTAJA_CLIENT_SECRET');
    console.log('   nas environment variables, ou tem valores DIFERENTES.');
    console.log('');
    console.log('   SOLUÇÃO: Adicionar no Vercel Dashboard (Settings > Environment Variables):');
    console.log(`     JOTAJA_BASE_URL = https://api.jotaja.com/openDelivery`);
    console.log(`     JOTAJA_CLIENT_ID = ${LOCAL_CID}`);
    console.log(`     JOTAJA_CLIENT_SECRET = ${LOCAL_CSEC}`);
    console.log(`     JOTAJA_MERCHANT_ID = 22238`);
  } else if (events.length > 0 && prodData.events > 0) {
    console.log('✅ Ambos encontram eventos — o problema é intermitente');
  } else {
    console.log('⚠️ Situação inesperada — verificar manualmente');
  }
}

main().catch(e => console.error(e));
