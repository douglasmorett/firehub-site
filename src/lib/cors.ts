// Producao roda no Coolify (firehubfood.com.br). Os dominios *.vercel.app foram
// removidos junto com a saida da Vercel — mante-los na allowlist deixaria o
// deploy zumbi conversando com esta API.
const ALLOWED_ORIGINS = [
  'https://firehubfood.com.br',
  'https://www.firehubfood.com.br',
  'http://localhost:3000',
  'http://localhost:3001',
];

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCorsPreFlight(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }
  return null;
}
