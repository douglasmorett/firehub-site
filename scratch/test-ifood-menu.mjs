/**
 * test-ifood-menu.mjs
 * Diagnóstico: testa vários endpoints públicos do iFood para descobrir qual funciona
 * Uso: node scratch/test-ifood-menu.mjs <URL_DO_RESTAURANTE_NO_IFOOD>
 * Ex:  node scratch/test-ifood-menu.mjs "https://www.ifood.com.br/delivery/sao-paulo-sp/restaurante_abc/f2170891-3073-47ea-9e32-947a2336bc8c"
 */

const url = process.argv[2] || "https://www.ifood.com.br/delivery/sao-paulo-sp/restaurante/f2170891-3073-47ea-9e32-947a2336bc8c";

// Extrai UUID da URL
const uuidMatch = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
const merchantId = uuidMatch?.[1];

const HEADERS_DESKTOP = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9",
  "Origin": "https://www.ifood.com.br",
  "Referer": "https://www.ifood.com.br/",
  "platform": "Desktop",
  "app_version": "9.0.0",
  "browser_version": "125",
};

const HEADERS_MOBILE = {
  "User-Agent": "okhttp/4.9.2",
  "Accept": "application/json",
  "platform": "Android",
  "app_version": "23.5.0",
};

async function test(label, fn) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    const result = await fn();
    const summary = JSON.stringify(result)?.slice(0, 300);
    console.log("✅ OK:", summary);
    return result;
  } catch (e) {
    console.log("❌ FALHOU:", e.message);
    return null;
  }
}

async function run() {
  console.log("=== iFood Menu Endpoint Diagnostics ===");
  console.log("URL:", url);
  console.log("Merchant ID:", merchantId || "(não encontrado na URL)");

  // 1. Scraping da página HTML (busca __NEXT_DATA__)
  await test("Scraping HTML __NEXT_DATA__", async () => {
    const res = await fetch(url, { headers: HEADERS_DESKTOP, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const match = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) throw new Error("__NEXT_DATA__ não encontrado no HTML");
    const data = JSON.parse(match[1]);
    // Tenta encontrar categorias
    const keys = JSON.stringify(data).match(/"categories":\[/g);
    return { found: true, keysCount: keys?.length || 0, topKeys: Object.keys(data?.props || {}) };
  });

  if (!merchantId) {
    console.log("\nSem merchantId, pulando testes de API.");
    return;
  }

  // 2. Endpoint novo v2 catalog
  await test("GET marketplace.ifood.com.br/v2/merchants/{id}/catalog", async () => {
    const res = await fetch(`https://marketplace.ifood.com.br/v2/merchants/${merchantId}/catalog`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cats = data?.catalog?.categories || data?.categories || [];
    if (!cats.length) throw new Error("Sem categorias na resposta");
    return { categories: cats.length, firstCat: cats[0]?.name };
  });

  // 3. Endpoint v1
  await test("GET marketplace.ifood.com.br/v1/merchants/{id}/catalog", async () => {
    const res = await fetch(`https://marketplace.ifood.com.br/v1/merchants/${merchantId}/catalog`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cats = data?.catalog?.categories || data?.categories || [];
    if (!cats.length) throw new Error("Sem categorias");
    return { categories: cats.length, firstCat: cats[0]?.name };
  });

  // 4. Menu endpoint v1
  await test("GET marketplace.ifood.com.br/v1/merchants/{id}/menu", async () => {
    const res = await fetch(`https://marketplace.ifood.com.br/v1/merchants/${merchantId}/menu`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cats = data?.categories || data?.menu?.categories || (Array.isArray(data) ? data : []);
    if (!cats.length) throw new Error("Sem categorias");
    return { categories: cats.length, firstCat: cats[0]?.name };
  });

  // 5. Endpoint wsloja (legado)
  await test("GET wsloja.ifood.com.br/v3/merchants/{id}/menu", async () => {
    const res = await fetch(`https://wsloja.ifood.com.br/ifood-ws/v3/merchants/${merchantId}/menu`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { keys: Object.keys(data).slice(0, 5) };
  });

  // 6. GraphQL marketplace
  await test("POST marketplace.ifood.com.br/v1/merchant-info/graphql", async () => {
    const res = await fetch("https://marketplace.ifood.com.br/v1/merchant-info/graphql", {
      method: "POST",
      headers: { ...HEADERS_DESKTOP, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($merchantId:String!){merchantExtra(merchantId:$merchantId){menu{categories{code name itens{code description unitPrice logoUrl}}}}}`,
        variables: { merchantId },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cats = data?.data?.merchantExtra?.menu?.categories || [];
    if (!cats.length) throw new Error("Sem categorias no GraphQL");
    return { categories: cats.length, firstCat: cats[0]?.name };
  });

  // 7. Discovery API
  await test("GET marketplace.ifood.com.br/discovery/v1/merchants/{id}/menu", async () => {
    const res = await fetch(`https://marketplace.ifood.com.br/discovery/v1/merchants/${merchantId}/menu`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { keys: Object.keys(data).slice(0, 5) };
  });

  // 8. Novo endpoint catálogo com channel
  await test("GET marketplace.ifood.com.br/v1/merchants/{id}/catalog?channel=DELIVERY", async () => {
    const res = await fetch(`https://marketplace.ifood.com.br/v1/merchants/${merchantId}/catalog?channel=DELIVERY&context=catalog`, { headers: HEADERS_DESKTOP });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cats = data?.catalog?.categories || data?.categories || [];
    return { categories: cats.length, topKeys: Object.keys(data).slice(0, 6) };
  });

  console.log("\n=== Fim dos testes ===");
}

run().catch(console.error);
