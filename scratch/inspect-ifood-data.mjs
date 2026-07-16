// Testa a API consumer do iFood marketplace (sem auth)
const merchantId = 'f2170891-3073-47ea-9e32-947a2336bc8c';
const slug = 'hakim-esfihas-marilia';

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Origin': 'https://www.ifood.com.br',
  'Referer': 'https://www.ifood.com.br/',
};

async function tryEndpoint(label, url, options = {}) {
  process.stdout.write(`\n[${label}]\n`);
  try {
    const res = await fetch(url, { headers: H, ...options });
    console.log('Status:', res.status);
    if (!res.ok) { console.log('FALHOU'); return null; }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) { console.log('Not JSON, content-type:', ct); return null; }
    const data = await res.json();
    const str = JSON.stringify(data);
    // Check for categories/items
    const hasCats = str.includes('"categories"') || str.includes('"itens"') || str.includes('"items"');
    console.log('Has categories/items:', hasCats, '| size:', str.length, 'chars');
    // Show top keys
    console.log('Top keys:', Object.keys(data).slice(0, 10));
    if (hasCats) {
      const catIdx = str.indexOf('"categories"');
      console.log('Categories sample:', str.slice(catIdx, catIdx + 300));
    }
    return data;
  } catch(e) { console.log('ERROR:', e.message); return null; }
}

// Try marketplace home API
await tryEndpoint(
  'v2/home with alias',
  `https://marketplace.ifood.com.br/v2/home?alias=${slug}&channel=IFOOD&size=500&latitude=-22.2198&longitude=-49.9461&channel=IFOOD`
);

await tryEndpoint(
  'v2/home with merchantId',
  `https://marketplace.ifood.com.br/v2/home?merchantId=${merchantId}&channel=IFOOD`
);

await tryEndpoint(
  'marketplace v1 merchant info',
  `https://marketplace.ifood.com.br/v1/merchants/${merchantId}`
);

await tryEndpoint(
  'marketplace v2 merchant',
  `https://marketplace.ifood.com.br/v2/merchant?alias=${slug}`
);

// Try the restaurant page API
await tryEndpoint(
  'restaurant api',
  `https://marketplace.ifood.com.br/v1/restaurants/${merchantId}`
);

// Try with channel param
await tryEndpoint(
  'catalog v2 with channel=IFOOD',
  `https://marketplace.ifood.com.br/v2/merchants/${merchantId}/catalog?channel=IFOOD`
);

// Try the widget-based API (mobile)
await tryEndpoint(
  'widget catalog',
  `https://marketplace.ifood.com.br/v1/widgets?alias=${slug}&channel=IFOOD`,
);

// new catalog endpoint
await tryEndpoint(
  'new catalog/v3',
  `https://marketplace.ifood.com.br/v3/merchants/${merchantId}/catalog`
);

console.log('\nDone.');
