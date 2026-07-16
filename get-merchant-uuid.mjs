/**
 * get-merchant-uuid.mjs
 * Rode com: node get-merchant-uuid.mjs
 * Após o iFood liberar o app para produção e você solicitar acesso no Portal do Desenvolvedor.
 */

const clientId     = 'f003da60-a255-4a6f-a1fb-f94819c6f286';
const clientSecret = '107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51';

async function run() {
  console.log('🔑 Obtendo token...');
  const tokenRes = await fetch('https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grantType: 'client_credentials', clientId, clientSecret })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.accessToken) {
    console.error('❌ Erro ao obter token:', JSON.stringify(tokenData, null, 2));
    console.log('\n⚠️  O iFood ainda não liberou o app para produção. Aguarde o retorno do chamado de suporte.');
    return;
  }
  console.log('✅ Token OK!\n');

  console.log('🏪 Buscando lojas vinculadas...');
  const merchantRes = await fetch('https://merchant-api.ifood.com.br/merchant/v1.0/merchants', {
    headers: { Authorization: `Bearer ${tokenData.accessToken}`, Accept: 'application/json' }
  });

  const merchants = await merchantRes.json();
  console.log('Status:', merchantRes.status);

  if (!Array.isArray(merchants) || merchants.length === 0) {
    console.log('⚠️  Nenhuma loja vinculada ainda.');
    console.log('   → Acesse developer.ifood.com.br → FireHub → Permissões → adicione o CNPJ da loja');
    console.log('   → Depois aprove no portal.ifood.com.br da loja');
    return;
  }

  console.log(`\n✅ ${merchants.length} loja(s) encontrada(s):\n`);
  merchants.forEach((m, i) => {
    console.log(`  [${i+1}] Nome:   ${m.name || m.shortName || '(sem nome)'}`);
    console.log(`       UUID:   ${m.id}`);
    console.log(`       Status: ${m.status ?? '?'}`);
    console.log(`       CNPJ:   ${m.corporateName ?? '?'}`);
    console.log('');
  });

  console.log('📋 Cole o UUID acima em firehubfood.com.br/store/ifood → campo "Merchant UUID"');
}

run().catch(console.error);
