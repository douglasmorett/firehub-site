/**
 * lib/open-delivery-saida/credenciais.ts — quem é a logística que está chamando.
 *
 * O FireHub, aqui, é a "Ordering Application" do Open Delivery (Abrasel, V1,
 * módulo Orders): a logística (Bem Dito) é o "Software Service" que troca
 * client_id + client_secret por um token (OAuth2 client_credentials) e lê os
 * pedidos de ENTREGA de uma loja.
 *
 * ── Uma credencial por loja ─────────────────────────────────────────────────
 *
 * O token é da loja: tudo o que ele abre (polling, pedido, status) fica preso
 * a ela. É o que a Bem Dito pediu — "client_secret DA LOJA" — e é o que faz o
 * HMAC do webhook ser por loja.
 *
 * ── O segredo é CIFRADO, não hasheado ───────────────────────────────────────
 *
 * Diferente da chave da API Aberta (lib/api-key.ts, hash SHA-256), este segredo
 * precisa ser LIDO de volta: é a chave do HMAC do webhook (X-App-Signature).
 * Fica no cofre (lib/cofre.ts, AES-256-GCM), como a chave do Asaas.
 *
 * ── O token ─────────────────────────────────────────────────────────────────
 *
 * `od1.<integracaoId>.<expira>.<assinatura>`, assinado com o NEXTAUTH_SECRET
 * (o mesmo molde de lib/motoboy-sessao.ts). Uma marca do segredo cifrado entra
 * na assinatura: gerar um segredo novo derruba todo token emitido com o velho,
 * sem lista de revogação.
 */
import crypto from "crypto";

export const VALIDADE_DO_TOKEN_S = 60 * 60; // 1 hora

// ── Geração ───────────────────────────────────────────────────────────────────

export function gerarClientId(): string {
  return `fhod_${crypto.randomBytes(10).toString("hex")}`;
}

export function gerarClientSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** O id da loja que vai no X-App-MerchantId e em `merchant.id` (36 caracteres, como a spec pede). */
export function gerarMerchantId(): string {
  return crypto.randomUUID();
}

// ── Token ─────────────────────────────────────────────────────────────────────

function marcaDoSegredo(segredoCifrado: string): string {
  return crypto.createHash("sha256").update(segredoCifrado).digest("hex").slice(0, 12);
}

function assinarToken(chave: string, integracaoId: string, exp: number, segredoCifrado: string): string {
  return crypto
    .createHmac("sha256", chave)
    .update(`od-saida:${integracaoId}:${exp}:${marcaDoSegredo(segredoCifrado)}`)
    .digest("base64url");
}

/** Token de acesso. `chave` = NEXTAUTH_SECRET (parâmetro para o teste). */
export function emitirToken(
  chave: string,
  integracaoId: string,
  segredoCifrado: string,
  agoraMs = Date.now(),
  validadeS = VALIDADE_DO_TOKEN_S,
): { token: string; expiraEmS: number } {
  const exp = Math.floor(agoraMs / 1000) + validadeS;
  return { token: `od1.${integracaoId}.${exp}.${assinarToken(chave, integracaoId, exp, segredoCifrado)}`, expiraEmS: validadeS };
}

/** Só lê o formato (sem banco): de qual integração o token diz ser. */
export function lerToken(token: string): { integracaoId: string; exp: number; assinatura: string } | null {
  const partes = String(token || "").trim().split(".");
  if (partes.length !== 4 || partes[0] !== "od1") return null;
  const [, integracaoId, expTexto, assinatura] = partes;
  const exp = Number(expTexto);
  if (!integracaoId || !Number.isInteger(exp) || !assinatura) return null;
  return { integracaoId, exp, assinatura };
}

/** O token confere com a integração (assinatura + validade)? */
export function tokenConfere(chave: string, token: string, segredoCifrado: string, agoraMs = Date.now()): boolean {
  const lido = lerToken(token);
  if (!lido) return false;
  if (lido.exp * 1000 <= agoraMs) return false;
  const esperado = assinarToken(chave, lido.integracaoId, lido.exp, segredoCifrado);
  const a = Buffer.from(esperado);
  const b = Buffer.from(lido.assinatura);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Webhook ───────────────────────────────────────────────────────────────────

/**
 * X-App-Signature do webhook que o FireHub manda: HMAC-SHA256 do CORPO EXATO
 * (os bytes que vão no POST), com o client_secret da loja, em hex minúsculo —
 * o formato que a Bem Dito descreveu (14/10/2026).
 */
export function assinaturaDoWebhook(corpo: string, clientSecret: string): string {
  return crypto.createHmac("sha256", clientSecret).update(corpo, "utf8").digest("hex");
}

// ── Pedido de token ───────────────────────────────────────────────────────────

export type PedidoDeToken = { grantType: string; clientId: string; clientSecret: string };

/**
 * Lê o POST do /oauth/token. A spec manda form-urlencoded; aceita JSON também
 * (a Keeta declara JSON no OpenAPI e form no Postman — doc de parceiro é
 * promessa) e o client_id/secret no Basic (client_secret_basic do OAuth2).
 */
export function lerPedidoDeToken(tipo: string, corpo: string, authorization: string | null): PedidoDeToken {
  let campos: Record<string, string> = {};
  const t = String(tipo || "").toLowerCase();
  const texto = String(corpo || "");
  if (t.includes("json") || /^\s*\{/.test(texto)) {
    try {
      const j = JSON.parse(texto);
      if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) campos[k] = v == null ? "" : String(v);
    } catch {
      campos = {};
    }
  } else {
    for (const [k, v] of new URLSearchParams(texto)) campos[k] = v;
  }
  let clientId = (campos.client_id || "").trim();
  let clientSecret = (campos.client_secret || "").trim();
  const basic = /^Basic\s+(.+)$/i.exec(authorization || "");
  if (basic && (!clientId || !clientSecret)) {
    try {
      const [u, ...resto] = Buffer.from(basic[1].trim(), "base64").toString("utf8").split(":");
      clientId = clientId || decodeURIComponent(u || "");
      clientSecret = clientSecret || decodeURIComponent(resto.join(":") || "");
    } catch {}
  }
  return { grantType: (campos.grant_type || "").trim(), clientId, clientSecret };
}

/** Comparação sem vazar tempo. */
export function mesmoTexto(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ── URL do webhook ────────────────────────────────────────────────────────────

/**
 * A URL que o lojista cadastra para o FireHub fazer POST. Só HTTPS e nunca um
 * endereço interno: o servidor é quem chama, e um "http://127.0.0.1:3000/..."
 * aqui faria o FireHub bater nele mesmo.
 */
export function urlDeWebhookValida(bruta: string): { ok: true; url: string } | { ok: false; erro: string } {
  const texto = String(bruta || "").trim();
  if (!texto) return { ok: false, erro: "Informe a URL." };
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return { ok: false, erro: "URL inválida." };
  }
  if (u.protocol !== "https:") return { ok: false, erro: "A URL precisa começar com https://" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const interno =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host);
  if (interno) return { ok: false, erro: "Endereço interno não é aceito." };
  return { ok: true, url: u.toString() };
}
