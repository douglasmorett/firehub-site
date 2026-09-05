/**
 * scripts/brendi-sandbox.mjs — sonda de SANDBOX da Brendi (Open Delivery).
 *
 * SÓ LEITURA. Nunca dá acknowledgment, nunca confirma, nunca cancela: o
 * `events:polling` sem ack não consome a fila (mesma regra do iFood), então
 * rodar isto quantas vezes quiser não perde evento nenhum.
 *
 * Uso:
 *   BRENDI_CLIENT_ID=... BRENDI_CLIENT_SECRET=... node scripts/brendi-sandbox.mjs
 *
 * O que responde, na ordem em que a integração precisa saber:
 *   1. A credencial autentica? (POST /oauth/token)
 *   2. Qual o merchantId da loja sandbox? (endpoints de merchant, um a um)
 *   3. Chega evento na fila? (GET /v1/events:polling, sem ack)
 *   4. O pedido baixa inteiro? (GET /v1/orders/{id}) — e o JSON cru é gravado
 *      em scratch/, que é o insumo para conferir o tradutor de
 *      src/lib/processBrendiEvent.ts contra um pedido REAL.
 */
const BASE = process.env.BRENDI_BASE_URL || "https://api.brendi.com.br";
const ID = process.env.BRENDI_CLIENT_ID;
const SECRET = process.env.BRENDI_CLIENT_SECRET;
const TIMEOUT = 15_000;

if (!ID || !SECRET) {
  console.error("Faltam BRENDI_CLIENT_ID e BRENDI_CLIENT_SECRET no ambiente.");
  process.exit(1);
}

const linha = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);
const corta = (s, n = 900) => (s.length > n ? s.slice(0, n) + `… (+${s.length - n} chars)` : s);

async function token() {
  linha("1. POST /oauth/token");
  // Os dois formatos que implementações Open Delivery aceitam. O form-urlencoded
  // é o do padrão OAuth2 e o que lib/brendi-api.ts usa; o JSON entra só se o
  // primeiro for recusado, para o diagnóstico não parar num detalhe de formato.
  const tentativas = [
    ["form", { "Content-Type": "application/x-www-form-urlencoded" },
      new URLSearchParams({ grant_type: "client_credentials", client_id: ID, client_secret: SECRET })],
    ["json", { "Content-Type": "application/json" },
      JSON.stringify({ grantType: "client_credentials", clientId: ID, clientSecret: SECRET })],
  ];
  for (const [nome, headers, body] of tentativas) {
    try {
      const r = await fetch(`${BASE}/oauth/token`, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT) });
      const txt = await r.text();
      console.log(`   ${nome}: HTTP ${r.status}`);
      if (!r.ok) { console.log(`   corpo: ${corta(txt, 300)}`); continue; }
      const d = JSON.parse(txt);
      const t = d.access_token ?? d.accessToken;
      if (!t) { console.log(`   200 sem access_token: ${corta(txt, 300)}`); continue; }
      console.log(`   ✅ autenticou (${nome}); expira em ${d.expires_in ?? d.expiresIn ?? "?"}s`);
      return t;
    } catch (e) {
      console.log(`   ${nome}: falhou — ${e.message}`);
    }
  }
  return null;
}

async function get(t, path) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { status: r.status, texto: await r.text() };
  } catch (e) {
    return { status: 0, texto: e.message };
  }
}

async function main() {
  console.log(`Brendi sandbox — base ${BASE}, clientId ${ID.slice(0, 8)}…`);
  const t = await token();
  if (!t) { console.error("\n❌ Sem token: nada mais a testar. Confira Client ID/Secret."); process.exit(1); }

  linha("2. Descoberta do merchantId");
  // O merchantId é a chave que amarra pedido → loja no FireHub. O padrão Open
  // Delivery não define UM endpoint de merchant, e cada originador expõe o seu
  // (ou nenhum, e aí o id só aparece dentro do pedido).
  for (const p of ["/v1/merchants", "/v1/merchant", "/v1/merchants/me", "/merchants", "/v1/me"]) {
    const r = await get(t, p);
    console.log(`   GET ${p} → ${r.status}${r.status === 200 ? ` ${corta(r.texto, 400)}` : ""}`);
  }

  linha("3. GET /v1/events:polling (sem acknowledgment — não consome)");
  const ev = await get(t, "/v1/events:polling?excludeHeartbeat=true");
  console.log(`   HTTP ${ev.status}`);
  console.log(`   ${corta(ev.texto, 1200)}`);

  let eventos = [];
  try { const j = JSON.parse(ev.texto); eventos = Array.isArray(j) ? j : (j?.events ?? j?.data ?? []); } catch {}
  console.log(`   eventos na fila: ${eventos.length}`);

  linha("4. GET /v1/orders/{id} do primeiro evento");
  const primeiro = eventos.find((e) => e?.orderId || e?.orderID || e?.order_id || e?.order?.id);
  if (!primeiro) {
    console.log("   Nenhum evento na fila. Crie um pedido de teste na loja sandbox e rode de novo.");
    return;
  }
  const orderId = String(primeiro.orderId ?? primeiro.orderID ?? primeiro.order_id ?? primeiro.order?.id);
  console.log(`   evento: ${JSON.stringify(primeiro)}`);
  const ped = await get(t, `/v1/orders/${orderId}`);
  console.log(`   GET /v1/orders/${orderId} → ${ped.status}`);
  console.log(`   ${corta(ped.texto, 2500)}`);

  if (ped.status === 200) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("scratch", { recursive: true });
    const arq = `scratch/brendi-pedido-${orderId}.json`;
    writeFileSync(arq, ped.texto);
    console.log(`\n   JSON cru gravado em ${arq} — é o insumo para conferir o tradutor.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
