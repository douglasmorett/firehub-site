require('dotenv').config({ path: '.env.local' });

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

async function getAccessToken() {
  let clientId = process.env.IFOOD_CLIENT_ID;
  let clientSecret = process.env.IFOOD_CLIENT_SECRET;
  
  if (!clientId || clientId.includes("SENSITIVE")) {
    clientId = "f003da60-a255-4a6f-a1fb-f94819c6f286";
  }
  if (!clientSecret || clientSecret.includes("SENSITIVE")) {
    clientSecret = "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";
  }
  
  console.log("🔑 Obtendo Token OAuth com Client ID:", clientId?.slice(0, 8) + "...");
  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "client_credentials",
      clientId,
      clientSecret
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Falha na autenticação iFood: ${res.status} - ${err}`);
  }
  const data = await res.json();
  return data.accessToken;
}

async function runHomologationScenarios() {
  const token = await getAccessToken();
  let merchantId = process.env.IFOOD_MERCHANT_UUID;
  if (!merchantId || merchantId.includes("SENSITIVE")) {
    merchantId = "6a5fb96d-68bd-46af-ada4-456a9a160787";
  }
  
  console.log("\n=======================================================");
  console.log("🚀 EXECUTANDO CENÁRIOS DE HOMOLOGAÇÃO IFOOD (FIREHUB DISTRIBUÍDO)");
  console.log("=======================================================\n");
  console.log(`📌 Merchant UUID de Teste: ${merchantId}\n`);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  // -------------------------------------------------------------
  // 1. MÓDULO MERCHANT (LOJA)
  // -------------------------------------------------------------
  console.log("--- 1. MÓDULO MERCHANT (LOJA) ---");
  
  // 1.1 Listar Lojas
  try {
    const res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants`, { headers });
    console.log(`[MERCHANT] GET /merchants: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Lojas encontradas: ${Array.isArray(data) ? data.length : JSON.stringify(data)}`);
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }

  // 1.2 Detalhes da Loja
  try {
    const res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}`, { headers });
    console.log(`[MERCHANT] GET /merchants/${merchantId}: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Nome: ${data.name} | Status: ${data.status} | Corporate: ${data.corporateName || data.name}`);
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }

  // 1.3 Status da Loja
  try {
    const res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/status`, { headers });
    console.log(`[MERCHANT] GET /merchants/${merchantId}/status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Status atual:`, JSON.stringify(data).slice(0, 150));
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }

  // 1.4 Listar Interrupções
  try {
    const res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/interruptions`, { headers });
    console.log(`[MERCHANT] GET /merchants/${merchantId}/interruptions: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Interrupções ativas: ${Array.isArray(data) ? data.length : 0}`);
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }


  // -------------------------------------------------------------
  // 2. MÓDULO ORDER (PEDIDOS)
  // -------------------------------------------------------------
  console.log("\n--- 2. MÓDULO ORDER (PEDIDOS) ---");
  
  // 2.1 Polling de Eventos
  try {
    const res = await fetch(`${IFOOD_BASE}/order/v1.0/events:polling`, { headers });
    console.log(`[ORDER] GET /events:polling: ${res.status} ${res.statusText}`);
    if (res.status === 200) {
      const data = await res.json();
      console.log(`   Eventos pendentes: ${data.length}`);
    } else if (res.status === 204) {
      console.log(`   Polling OK (204 No Content - Nenhum evento novo no momento)`);
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }


  // -------------------------------------------------------------
  // 3. MÓDULO CATALOG (CARDÁPIO / CATÁLOGO)
  // -------------------------------------------------------------
  console.log("\n--- 3. MÓDULO CATALOG (CARDÁPIO / CATÁLOGO) ---");
  
  // 3.1 Listar Catálogos da Loja
  try {
    const res = await fetch(`${IFOOD_BASE}/catalog/v1.0/merchants/${merchantId}/catalogs`, { headers });
    console.log(`[CATALOG] GET /merchants/${merchantId}/catalogs: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Catálogos encontrados: ${Array.isArray(data) ? data.length : 0}`);
      if (Array.isArray(data) && data.length > 0) {
        const catalogId = data[0].catalogId || data[0].id;
        console.log(`   Catalog ID: ${catalogId}`);

        // 3.2 Listar Categorias do Catálogo
        const catRes = await fetch(`${IFOOD_BASE}/catalog/v1.0/merchants/${merchantId}/catalogs/${catalogId}/categories`, { headers });
        console.log(`[CATALOG] GET /catalogs/${catalogId}/categories: ${catRes.status} ${catRes.statusText}`);
        if (catRes.ok) {
          const catData = await catRes.json();
          console.log(`   Categorias encontradas: ${Array.isArray(catData) ? catData.length : 0}`);
        }
      }
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }


  // -------------------------------------------------------------
  // 4. MÓDULO SHIPPING (LOGÍSTICA / ENTREGA FÁCIL)
  // -------------------------------------------------------------
  console.log("\n--- 4. MÓDULO SHIPPING (LOGÍSTICA / ENTREGA) ---");
  
  // 4.1 Cotação / Simulação de Entrega
  try {
    const deliveryPayload = {
      orderId: "TEST-HOMOLOG-" + Date.now(),
      deliveryAddress: {
        formattedAddress: "Av. Paulista, 1000",
        streetName: "Av. Paulista",
        streetNumber: "1000",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        postalCode: "01310-100",
        country: "BR",
        coordinates: {
          latitude: -23.5615,
          longitude: -46.6559
        }
      }
    };
    
    // Test endpoint de cotação
    const res = await fetch(`${IFOOD_BASE}/shipping/v1.0/merchants/${merchantId}/deliveries/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify(deliveryPayload)
    });
    console.log(`[SHIPPING] POST /deliveries/calculate: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Cotação realizada com sucesso:`, JSON.stringify(data).slice(0, 150));
    } else {
      console.log(`   Resposta: ${await res.text().then(t => t.slice(0, 200))}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }


  // -------------------------------------------------------------
  // 5. MÓDULO REVIEW (AVALIAÇÕES)
  // -------------------------------------------------------------
  console.log("\n--- 5. MÓDULO REVIEW (AVALIAÇÕES) ---");
  
  // 5.1 Listar Avaliações
  try {
    const res = await fetch(`${IFOOD_BASE}/review/v1.0/merchants/${merchantId}/reviews?page=1&pageSize=10`, { headers });
    console.log(`[REVIEW] GET /merchants/${merchantId}/reviews: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`   Avaliações encontradas:`, JSON.stringify(data).slice(0, 150));
    } else {
      console.log(`   Resposta: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`   Erro: ${e.message}`);
  }

  console.log("\n=======================================================");
  console.log("🏁 TESTES DOS MÓDULOS DE HOMOLOGAÇÃO CONCLUÍDOS!");
  console.log("=======================================================\n");
}

runHomologationScenarios().catch(console.error);
