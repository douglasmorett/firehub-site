/**
 * lib/keeta/api.ts — o cliente da Keeta Open Delivery API.
 *
 * Credencial é do SOFTWARE (do FireHub), não da loja: `KEETA_CLIENT_ID` e
 * `KEETA_CLIENT_SECRET` no ambiente do servidor. Um token só (app_level_token)
 * enxerga todas as lojas que autorizaram o FireHub. Sem as duas variáveis,
 * `keetaConfigurada()` é falso e NADA aqui chama a rede — é o interruptor que
 * mantém o canal desligado até a Keeta liberar o app.
 *
 * Regras herdadas:
 *   - Nada de credencial de reserva no .env por loja (o JotaJá caía num
 *     JOTAJA_CLIENT_ID vazio e falhava calado — 14/08/2026).
 *   - Token em cache com promessa compartilhada (sem corrida de N pedidos
 *     pedindo token ao mesmo tempo) e renovado quando a Keeta diz que venceu
 *     (o iFood ficou semanas com token vencido em silêncio).
 *   - Toda resposta vira { ok, status, dados, erro, repetir }: quem chama
 *     decide; ninguém engole erro em console.log.
 */
import { assinarChamada } from "./assinatura";

const BASE_PADRAO = "https://open.mykeeta.com/api/open/opendelivery";
const TEMPO_MS = 15_000;

export function keetaConfigurada(): boolean {
  return Boolean(process.env.KEETA_CLIENT_ID && process.env.KEETA_CLIENT_SECRET);
}

function base(): string {
  return (process.env.KEETA_BASE_URL || BASE_PADRAO).replace(/\/+$/, "");
}

function segredo(): string {
  return process.env.KEETA_CLIENT_SECRET || "";
}

// ── Token ────────────────────────────────────────────────────────────────────

let tokenEmCache: { valor: string; venceEm: number } | null = null;
let tokenEmVoo: Promise<string> | null = null;

async function pedirToken(): Promise<string> {
  const campos = {
    client_id: process.env.KEETA_CLIENT_ID || "",
    client_secret: segredo(),
    grant_type: process.env.KEETA_GRANT_TYPE || "app_level_token",
  };
  // A doc se contradiz (OpenAPI diz JSON; a coleção Postman oficial manda
  // form-urlencoded). Vai o que a Keeta testa; se recusar, tenta o outro.
  const tentativas: Array<{ tipo: string; corpo: string }> = [
    { tipo: "application/x-www-form-urlencoded", corpo: new URLSearchParams(campos).toString() },
    { tipo: "application/json", corpo: JSON.stringify(campos) },
  ];
  let ultimo = "";
  for (const t of tentativas) {
    const r = await fetch(`${base()}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": t.tipo, Accept: "application/json" },
      body: t.corpo,
      signal: AbortSignal.timeout(TEMPO_MS),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.message || e) }) as any);
    const texto = await r.text();
    if (r.ok) {
      const j = JSON.parse(texto || "{}");
      if (!j.access_token) throw new Error(`Keeta: /oauth/token sem access_token (${texto.slice(0, 200)})`);
      const segundos = Number(j.expires_in) || 3600;
      // Renova 5 min antes de vencer.
      tokenEmCache = { valor: String(j.access_token), venceEm: Date.now() + Math.max(60, segundos - 300) * 1000 };
      return tokenEmCache.valor;
    }
    ultimo = `${r.status} ${texto.slice(0, 300)}`;
    // 401 com "no authorized Merchant" não muda trocando o formato.
    if (/no authorized Merchant/i.test(texto)) break;
  }
  throw new Error(`Keeta: token recusado — ${ultimo}`);
}

export async function tokenDaKeeta(forcar = false): Promise<string> {
  if (!forcar && tokenEmCache && tokenEmCache.venceEm > Date.now()) return tokenEmCache.valor;
  if (!tokenEmVoo) {
    tokenEmVoo = pedirToken().finally(() => {
      tokenEmVoo = null;
    });
  }
  return tokenEmVoo;
}

// ── Chamada assinada ─────────────────────────────────────────────────────────

export type ResultadoKeeta<T = any> = {
  ok: boolean;
  status: number;
  dados?: T;
  erro?: string;
  /** Vale a pena repetir mais tarde (rede, 5xx, limite, token). 4xx de regra não. */
  repetir?: boolean;
};

export async function chamarKeeta<T = any>(
  metodo: "GET" | "POST" | "PUT",
  caminho: string,
  opts: { query?: Record<string, string>; corpo?: unknown; cabecalhos?: Record<string, string> } = {},
): Promise<ResultadoKeeta<T>> {
  if (!keetaConfigurada()) return { ok: false, status: 0, erro: "Keeta não configurada no servidor", repetir: false };

  const url = `${base()}${caminho}`;
  const qs = opts.query && Object.keys(opts.query).length > 0 ? `?${new URLSearchParams(opts.query).toString()}` : "";
  // Serializa UMA vez: assina e envia exatamente a mesma string.
  const corpo = opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo);

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let token: string;
    try {
      token = await tokenDaKeeta(tentativa > 1);
    } catch (e: any) {
      return { ok: false, status: 0, erro: e?.message || "token", repetir: true };
    }
    const cabecalhos: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-App-Signature": assinarChamada(segredo(), url, opts.query, corpo),
      Accept: "application/json",
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cabecalhos || {}),
    };
    let r: Response;
    try {
      r = await fetch(url + qs, { method: metodo, headers: cabecalhos, body: corpo, signal: AbortSignal.timeout(TEMPO_MS) });
    } catch (e: any) {
      return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
    }
    const texto = await r.text().catch(() => "");
    let dados: any = undefined;
    try {
      dados = texto ? JSON.parse(texto) : undefined;
    } catch {
      dados = texto;
    }
    if (r.ok) return { ok: true, status: r.status, dados };

    const msg = typeof dados === "object" && dados ? dados.title || dados.message || JSON.stringify(dados) : texto;
    // Token vencido/inválido: pede outro e tenta de novo uma vez.
    if (r.status === 401 && tentativa === 1 && /expired|invalid|token/i.test(String(msg))) continue;
    if (/Invalid signature/i.test(String(msg))) {
      console.error(`[Keeta] ❌ assinatura recusada em ${metodo} ${caminho}: ${String(msg).slice(0, 300)}`);
    }
    return {
      ok: false,
      status: r.status,
      dados,
      erro: `${r.status} ${String(msg).slice(0, 300)}`,
      repetir: r.status === 429 || r.status >= 500 || r.status === 401,
    };
  }
  return { ok: false, status: 401, erro: "token recusado duas vezes", repetir: true };
}

// ── Eventos ──────────────────────────────────────────────────────────────────

export type EventoKeeta = {
  eventId: string;
  eventType: string;
  orderId: string;
  orderURL?: string;
  createdAt?: string;
  sourceAppId?: string;
  virtualBrand?: string;
  /** A Keeta manda como STRING com JSON dentro. */
  metadata?: string | Record<string, unknown> | null;
};

/**
 * Eventos pendentes. SEM filtro de `eventType` de propósito: a Keeta dá ack
 * automático no que não foi pedido, e filtrar só CREATED faria o CANCELLED
 * sumir sem nunca chegar aqui.
 */
export async function eventosDaKeeta(merchants: string[]): Promise<ResultadoKeeta<EventoKeeta[]>> {
  if (merchants.length === 0) return { ok: true, status: 204, dados: [] };
  const r = await chamarKeeta<EventoKeeta[]>("GET", "/v1/events:polling", {
    cabecalhos: { "x-polling-merchants": merchants.slice(0, 100).join(",") },
  });
  if (r.ok) return { ...r, dados: Array.isArray(r.dados) ? r.dados : [] };
  return r;
}

export async function confirmarLeitura(eventos: EventoKeeta[]): Promise<ResultadoKeeta> {
  if (eventos.length === 0) return { ok: true, status: 202 };
  const corpo = eventos.slice(0, 100).map((e) => ({ id: e.eventId, orderId: e.orderId, eventType: e.eventType }));
  return chamarKeeta("POST", "/v1/events/acknowledgment", { corpo });
}

export function metadataDoEvento(e: EventoKeeta): Record<string, any> {
  if (!e?.metadata) return {};
  if (typeof e.metadata === "object") return e.metadata as Record<string, any>;
  try {
    return JSON.parse(e.metadata);
  } catch {
    return {};
  }
}

// ── Pedido ───────────────────────────────────────────────────────────────────

export function buscarPedidoKeeta(orderId: string) {
  return chamarKeeta("GET", `/v1/orders/${encodeURIComponent(orderId)}`);
}

export type AcaoKeeta = "confirm" | "readyForPickup" | "dispatch" | "delivered" | "requestCancellation" | "acceptRefund" | "rejectRefund";

/**
 * Ação no pedido. 422 é "já feito" (a Keeta diz: confira se a instrução não
 * foi enviada antes) — conta como ok, senão a fila de pendentes repetiria para
 * sempre algo que a Keeta já registrou.
 */
export async function acaoNoPedidoKeeta(_lojaId: string, acao: AcaoKeeta, orderId: string, corpo?: unknown): Promise<ResultadoKeeta> {
  const r = await chamarKeeta("POST", `/v1/orders/${encodeURIComponent(orderId)}/${acao}`, corpo === undefined ? {} : { corpo });
  if (!r.ok && r.status === 422) {
    console.log(`[Keeta] ℹ️ ${acao} em ${orderId}: 422 (já registrado lá) — ${r.erro}`);
    return { ok: true, status: 422, dados: r.dados };
  }
  return r;
}

/**
 * Decifra os campos `ENC_` (telefone, bairro, número, complemento, endereço
 * formatado). Só funciona na entrega da LOJA; na entrega da Keeta volta erro
 * por item e o texto fica de fora (lib/open-delivery/traducao.ts → `claro`).
 */
export async function decifrar(cifrados: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = Array.from(new Set(cifrados.filter((c) => typeof c === "string" && c.startsWith("ENC_"))));
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    const r = await chamarKeeta<{ plainInfos?: Array<{ cipherText: string; plainText: string; errorCode: number }> }>("POST", "/v1/batchDecrypt", {
      corpo: { cipherInfos: lote.map((cipherText) => ({ cipherText })) },
    });
    if (!r.ok) {
      console.warn(`[Keeta] batchDecrypt falhou: ${r.erro}`);
      continue;
    }
    for (const p of r.dados?.plainInfos || []) {
      if (p && Number(p.errorCode) === 0 && typeof p.plainText === "string") mapa.set(p.cipherText, p.plainText);
    }
  }
  return mapa;
}

// ── Loja ─────────────────────────────────────────────────────────────────────

/**
 * Registra a loja na Keeta. ⚠️ Refazer o onboarding de um merchant já
 * registrado APAGA o histórico do mapeamento lá — por isso só a rota de vínculo
 * chama isto, e só quando o par (nosso id, id da Keeta) é novo.
 */
export function onboardingDaLoja(merchantId: string, keetaMerchantId: number, ordersWebhookURL: string) {
  return chamarKeeta("PUT", "/v1/merchantOnboarding", {
    query: { merchantId },
    corpo: { ordersWebhookURL, keetaMerchantId },
  });
}

/**
 * O link oficial para o lojista autorizar o FireHub (fluxo "self-serve com
 * redirect" da Keeta): ele entra na Keeta, escolhe a(s) loja(s), confirma, e a
 * Keeta o devolve para `redirectUri?authId=…`. A rota não exige token nem
 * assinatura.
 */
export async function linkDeAutorizacao(redirectUri: string): Promise<ResultadoKeeta<string>> {
  if (!keetaConfigurada()) return { ok: false, status: 0, erro: "Keeta não configurada no servidor" };
  const qs = new URLSearchParams({ clientId: process.env.KEETA_CLIENT_ID || "", redirectUri }).toString();
  try {
    const r = await fetch(`${base()}/oauth/authorization/url?${qs}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TEMPO_MS) });
    const texto = await r.text();
    const j = (() => {
      try {
        return JSON.parse(texto);
      } catch {
        return null;
      }
    })();
    const url = j?.merchantAuthorizationUrl;
    if (!r.ok || typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, status: r.status, erro: `${r.status} ${texto.slice(0, 200)}` };
    return { ok: true, status: r.status, dados: url };
  } catch (e: any) {
    return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
  }
}

export function lojasAutorizadas(authId: string, pagina = 1) {
  return chamarKeeta("GET", `/oauth/authorized/${encodeURIComponent(authId)}/merchantInfo`, {
    query: { pageNum: String(pagina), pageSize: "100" },
  });
}
