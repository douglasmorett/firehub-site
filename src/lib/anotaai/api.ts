/**
 * lib/anotaai/api.ts — o cliente da API de parceiros do Anota AI (v2).
 *
 * Doc oficial: https://integ-public-platform-docs.anota.ai (a do Stoplight foi
 * descontinuada). Levantada em 23/10/2026.
 *
 * ── Como a v2 autentica ─────────────────────────────────────────────────────
 *
 * Uma credencial só, do PARCEIRO (o FireHub), tirada do perfil no Portal de
 * Integração (integracao.anota.ai):
 *
 *   ANOTAAI_CLIENT_ID + ANOTAAI_CLIENT_SECRET   → OAuth client_credentials, token de 1 h
 *
 * A LOJA não tem token próprio: cada chamada leva `x-page-id` = o `idpage` da
 * página (loja) vinculada ao FireHub (lib/anotaai/lojas.ts). Sem as duas
 * variáveis, nada aqui chama a rede — o interruptor de `anotaAiConfigurado`.
 *
 * ── Regras ──────────────────────────────────────────────────────────────────
 *
 *   - Token reaproveitado até 1 min antes de vencer, com UMA renovação por vez
 *     (a rota de token aceita só 15 chamadas por minuto e bloqueia o abuso).
 *   - 401: renova e repete UMA vez.
 *   - 429 (500 chamadas a cada 10 s), 5xx e rede = `repetir`: quem chamou
 *     manda para a fila de ações pendentes.
 *   - Erro de negócio volta 200 com `success:false` — lido como recusa.
 *   - User-Agent identificado é obrigatório (sem ele o WAF deles pode barrar),
 *     e todo POST leva corpo (vazio = Content-Length 0), como a doc exige.
 *   - Nenhum token vai para o log.
 */

const TEMPO_MS = 10_000;
const BASE_PADRAO = "https://gateway-partners.anota.ai";

/**
 * Para onde vai a chamada.
 *
 * ── O Cloudflare deles barra o nosso servidor ──────────────────────────────
 *
 * 28/10/2026, primeira loja a conectar (Dellatorre): "O Anota AI não aceitou
 * esta chave (sem token do parceiro)". As credenciais estavam certas — o
 * gateway-partners.anota.ai devolve 403 em HTML para o IP do servidor do
 * FireHub (DigitalOcean), qualquer que seja o User-Agent, e 401/200 normais
 * para o PC e para a Railway. Por isso a chamada vai pelo gateway do WhatsApp
 * (Railway, `/proxy/anotaai`), com a `apikey` de sempre (EVOLUTION_API_KEY).
 *
 * `ANOTAAI_BASE_URL` continua mandando quando existe (o teste aponta para um
 * Anota AI falso).
 */
const GATEWAY_DO_ANOTAAI = "https://whatsapp-gateway-teste-production.up.railway.app";

function destino(caminho: string): { url: string; extras: Record<string, string> } {
  const direto = String(process.env.ANOTAAI_BASE_URL || "").trim();
  // O gateway das lojas (o mesmo de chatbotConfig.evolutionUrl), não o
  // EVOLUTION_API_URL antigo: só este tem a passagem /proxy/anotaai.
  const gateway = String(process.env.ANOTAAI_GATEWAY_URL || GATEWAY_DO_ANOTAAI).trim().replace(/\/+$/, "");
  const chave = String(process.env.EVOLUTION_API_KEY || "").trim();
  if (!direto && gateway && chave) return { url: `${gateway}/proxy/anotaai${caminho}`, extras: { apikey: chave } };
  return { url: `${(direto || BASE_PADRAO).replace(/\/+$/, "")}${caminho}`, extras: {} };
}

const ROTA_DO_TOKEN = "/integ/integ-oauth-api/oauth-client/token";
const ROTA_DOS_PEDIDOS = "/api-old/partnerauth/v2";
const ROTA_DO_VINCULO = "/integ/integ-public-core/v2/integration-partner/linkpage-by-token";

const USER_AGENT = `firehub-anotaai/1.0 (production; Node.js/${String(process.version || "").replace(/^v/, "")})`;

export function anotaAiConfigurado(): boolean {
  return Boolean(String(process.env.ANOTAAI_CLIENT_ID || "").trim() && String(process.env.ANOTAAI_CLIENT_SECRET || "").trim());
}

export type RespostaAnotaAi<T = any> = { ok: boolean; status: number; dados?: T; erro?: string; repetir?: boolean };

// ── Token do parceiro ────────────────────────────────────────────────────────

let tokenAtual: { valor: string; venceEm: number } | null = null;
let renovando: Promise<string | null> | null = null;

/** Para o teste: esquece o token guardado. */
export function esquecerTokenAnotaAi() {
  tokenAtual = null;
  renovando = null;
}

async function pedirToken(): Promise<string | null> {
  const corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: String(process.env.ANOTAAI_CLIENT_ID || "").trim(),
    client_secret: String(process.env.ANOTAAI_CLIENT_SECRET || "").trim(),
  }).toString();
  const { url, extras } = destino(ROTA_DO_TOKEN);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, ...extras },
    body: corpo,
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.accessToken) {
    console.error(`[Anota AI] ❌ token do parceiro recusado (HTTP ${res.status}): ${String(json?.message || "").slice(0, 200)}`);
    return null;
  }
  const segundos = Number(json.expiresIn) > 0 ? Number(json.expiresIn) : 3600;
  tokenAtual = { valor: String(json.accessToken), venceEm: Date.now() + (segundos - 60) * 1000 };
  return tokenAtual.valor;
}

async function token(forcar = false): Promise<string | null> {
  if (!forcar && tokenAtual && tokenAtual.venceEm > Date.now()) return tokenAtual.valor;
  if (!renovando) {
    renovando = pedirToken()
      .catch((e) => {
        console.error("[Anota AI] ❌ não consegui pedir o token:", e?.message);
        return null;
      })
      .finally(() => {
        renovando = null;
      });
  }
  return renovando;
}

// ── Chamada genérica ─────────────────────────────────────────────────────────

async function chamar<T = any>(
  metodo: "GET" | "POST",
  caminho: string,
  opts: { pageId?: string; corpo?: unknown } = {},
): Promise<RespostaAnotaAi<T>> {
  if (!anotaAiConfigurado()) return { ok: false, status: 0, erro: "Anota AI não configurado no servidor" };
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const t = await token(tentativa === 2);
    if (!t) return { ok: false, status: 0, erro: "sem token do parceiro no Anota AI", repetir: true };
    const corpo = opts.corpo === undefined ? "" : JSON.stringify(opts.corpo);
    const headers: Record<string, string> = { Authorization: `Bearer ${t}`, "User-Agent": USER_AGENT, Accept: "application/json" };
    if (opts.pageId) headers["x-page-id"] = opts.pageId;
    // Content-Length: o fetch do Node põe sozinho quando o corpo é texto —
    // inclusive "Content-Length: 0" no POST sem corpo, que é o que a doc pede.
    if (metodo === "POST") headers["Content-Type"] = "application/json";
    let res: Response;
    const { url, extras } = destino(caminho);
    try {
      res = await fetch(url, {
        method: metodo,
        headers: { ...headers, ...extras },
        body: metodo === "POST" ? corpo : undefined,
        signal: AbortSignal.timeout(TEMPO_MS),
      });
    } catch (e: any) {
      return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
    }
    if (res.status === 401 && tentativa === 1) continue;
    const json: any = await res.json().catch(() => null);
    const mensagem = String(json?.message || json?.err || "").slice(0, 200);
    if (res.status === 429 || res.status >= 500) {
      // O 500 do Anota AI também é a resposta de "ID do pedido não enviado" e
      // de token inválido; mesmo assim repetir é o lado seguro — a fila tem prazo.
      return { ok: false, status: res.status, erro: `HTTP ${res.status}${mensagem ? `: ${mensagem}` : ""}`, repetir: true };
    }
    if (!res.ok) return { ok: false, status: res.status, erro: `HTTP ${res.status}${mensagem ? `: ${mensagem}` : ""}` };
    if (json && json.success === false) return { ok: false, status: res.status, erro: mensagem || "o Anota AI recusou", dados: json };
    return { ok: true, status: res.status, dados: json as T };
  }
  return { ok: false, status: 401, erro: "token do parceiro recusado pelo Anota AI" };
}

// ── Vínculo da loja ──────────────────────────────────────────────────────────

/** Lê o payload de um JWT sem validar (só para achar o `idpage`; quem valida é o Anota AI). */
export function payloadDoJwt(jwt: unknown): Record<string, any> | null {
  const partes = String(jwt ?? "").trim().split(".");
  if (partes.length !== 3) return null;
  try {
    const json = Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const p = JSON.parse(json);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

/** O `idpage` dentro de um token do Anota AI, se houver. */
export function idPageDoToken(jwt: unknown): string | null {
  const p = payloadDoJwt(jwt);
  const id = String(p?.idpage ?? p?.idPage ?? p?.pageId ?? "").trim();
  return /^[0-9A-Za-z-]{1,40}$/.test(id) ? id : null;
}

/**
 * Vincula a página ao FireHub pela "Chave de integração" que o lojista copia
 * do admin dele. Webhooks não são registrados: o formato do aviso não está
 * documentado e o polling de 30 s é o que a própria doc recomenda.
 */
export async function vincularPaginaAnotaAi(pageToken: string, externalId: string): Promise<RespostaAnotaAi<{ info?: { token?: string } }>> {
  return chamar("POST", ROTA_DO_VINCULO, { corpo: { pageToken, externalId, active: true } });
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

export type ResumoAnotaAi = { _id?: string; check?: number | string; from?: string; salesChannel?: string; updatedAt?: string; schedule_order?: unknown };

/** Pedidos do dia (check 0–3; `cancelados` lista os 4). Lê até 5 páginas de 100. */
export async function listarPedidosAnotaAi(pageId: string, opts: { cancelados?: boolean } = {}): Promise<RespostaAnotaAi<ResumoAnotaAi[]>> {
  const todos: ResumoAnotaAi[] = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const q = new URLSearchParams({ excludeIfood: "1", currentpage: String(pagina) });
    if (opts.cancelados) q.set("cancelled", "1");
    const r = await chamar<any>("GET", `${ROTA_DOS_PEDIDOS}/ping/list?${q}`, { pageId });
    if (!r.ok) return { ...r, dados: undefined };
    const docs = Array.isArray(r.dados?.info?.docs) ? r.dados.info.docs : [];
    todos.push(...docs);
    const limite = Number(r.dados?.info?.limit) || 100;
    if (docs.length < limite) break;
  }
  return { ok: true, status: 200, dados: todos };
}

export async function buscarPedidoAnotaAi(pageId: string, orderId: string): Promise<RespostaAnotaAi<any>> {
  const r = await chamar<any>("GET", `${ROTA_DOS_PEDIDOS}/ping/get/${encodeURIComponent(orderId)}`, { pageId });
  return r.ok ? { ...r, dados: r.dados?.info ?? null } : r;
}

export type AcaoAnotaAi = "accept" | "ready" | "finalize" | "cancel";

/**
 * Uma ação no pedido. O status lá só avança; ação que não cabe mais (o pedido
 * já passou dali) volta como recusa — quem chama decide se era "já estava".
 */
export async function acaoNoPedidoAnotaAi(pageId: string, acao: AcaoAnotaAi, orderId: string, corpo?: unknown): Promise<RespostaAnotaAi<any>> {
  const body = acao === "cancel" ? { justification: String((corpo as any)?.justification || "Cancelado pela loja").slice(0, 250) } : undefined;
  return chamar("POST", `${ROTA_DOS_PEDIDOS}/order/${acao}/${encodeURIComponent(orderId)}`, { pageId, corpo: body });
}
