/**
 * lib/saipos/cliente.ts — a conversa com a API de Pedidos do Saipos (https://order-api.saipos.com).
 *
 * `fetch` e relógio entram por parâmetro: o teste usa um servidor falso.
 *
 *   POST /auth {idPartner, secret}  → token (vale 2 dias)
 *   POST /order                     → cria o pedido no PDV
 *   POST /cancel-order              → cancela um pedido já enviado
 *   POST /update-order-status       → só entrega do PARCEIRO (DISPATCHED/CONCLUDED/CANCELLED)
 *   GET  /v2/catalog                → {url}: o JSON do cardápio da loja (30 min)
 *
 * O `secret` é UM para todas as lojas (do cadastro do FireHub em
 * developer.saipos.com); cada loja tem o `idPartner` dela (gerado em Conta
 * Saipos › Canais de Vendas e Integrações). O token é por idPartner.
 */
import type { LinhaDoCatalogo } from "./codigos";

export const URL_DA_API_SAIPOS = (process.env.SAIPOS_URL_BASE || "https://order-api.saipos.com").replace(/\/+$/, "");

type Fetch = typeof fetch;
type Opcoes = { fetchImpl?: Fetch; agora?: () => number; base?: string };

/** O token vale 2 dias; renova com folga. */
const VALIDADE_DO_TOKEN_MS = 40 * 3_600_000;
const tokens = new Map<string, { token: string; ate: number }>();
export function esquecerTokens() { tokens.clear(); }

export type Resposta = {
  ok: boolean;
  status: number;
  /** Código de erro do Saipos (900, 904, 920...) quando vier no corpo. */
  codigo?: number;
  mensagem?: string;
  corpo?: any;
  /** Vale tentar de novo? (rede, 5xx, token vencido). */
  repetir?: boolean;
};

/** Códigos que contam como "o pedido está lá" — reenviar não adianta nem deve. */
export const CODIGOS_DE_SUCESSO = new Set([904, 920, 921]);

async function chamar(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Resposta> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctl.signal });
    const texto = await r.text().catch(() => "");
    let corpo: any = texto;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { /* corpo em texto */ }
    const codigo = Number(corpo?.code ?? corpo?.codigo ?? corpo?.errorCode);
    const mensagem = typeof corpo === "string" ? corpo.slice(0, 300) : String(corpo?.errorMessage || corpo?.message || corpo?.error || "").slice(0, 300);
    return {
      ok: r.ok,
      status: r.status,
      ...(Number.isFinite(codigo) ? { codigo } : {}),
      ...(mensagem ? { mensagem } : {}),
      corpo,
      repetir: !r.ok && (r.status >= 500 || r.status === 429 || r.status === 408 || Number(corpo?.code) === 901),
    };
  } catch (e: any) {
    return { ok: false, status: 0, mensagem: e?.name === "AbortError" ? "demorou demais" : String(e?.message || e).slice(0, 200), repetir: true };
  } finally {
    clearTimeout(t);
  }
}

/** O token do idPartner: o guardado se ainda vale, senão pede um novo. */
export async function tokenDoParceiro(idPartner: string, secret: string, o: Opcoes = {}): Promise<{ token: string } | { erro: Resposta }> {
  const agora = (o.agora || Date.now)();
  const guardado = tokens.get(idPartner);
  if (guardado && guardado.ate > agora) return { token: guardado.token };
  const r = await chamar(o.fetchImpl || fetch, `${o.base || URL_DA_API_SAIPOS}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idPartner, secret }),
  });
  const bruto = r.corpo;
  const token = typeof bruto === "string" ? bruto.replace(/^"|"$/g, "") : String(bruto?.token || bruto?.access_token || bruto?.Authorization || "");
  if (!r.ok || !token) return { erro: { ...r, ok: false, mensagem: r.mensagem || "o Saipos não devolveu token" } };
  tokens.set(idPartner, { token, ate: agora + VALIDADE_DO_TOKEN_MS });
  return { token };
}

async function comToken(idPartner: string, secret: string, o: Opcoes, fazer: (token: string) => Promise<Resposta>): Promise<Resposta> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const t = await tokenDoParceiro(idPartner, secret, o);
    if ("erro" in t) return t.erro;
    const r = await fazer(t.token);
    // Token recusado (vencido antes da hora): esquece e pede outro uma vez.
    if (!r.ok && (r.status === 401 || r.codigo === 901) && tentativa === 0) { tokens.delete(idPartner); continue; }
    return r;
  }
  return { ok: false, status: 0, mensagem: "token recusado", repetir: true };
}

const json = (token: string) => ({ "Content-Type": "application/json", Authorization: token });

export function enviarPedido(idPartner: string, secret: string, payload: unknown, o: Opcoes = {}): Promise<Resposta> {
  return comToken(idPartner, secret, o, (token) =>
    chamar(o.fetchImpl || fetch, `${o.base || URL_DA_API_SAIPOS}/order`, { method: "POST", headers: json(token), body: JSON.stringify(payload) }));
}

export function cancelarPedido(idPartner: string, secret: string, orderId: string, codStore: string, o: Opcoes = {}): Promise<Resposta> {
  return comToken(idPartner, secret, o, (token) =>
    chamar(o.fetchImpl || fetch, `${o.base || URL_DA_API_SAIPOS}/cancel-order`, {
      method: "POST", headers: json(token), body: JSON.stringify({ order_id: orderId, cod_store: codStore }),
    }));
}

export function atualizarStatus(idPartner: string, secret: string, orderId: string, status: "DISPATCHED" | "CONCLUDED" | "CANCELLED", o: Opcoes = {}): Promise<Resposta> {
  return comToken(idPartner, secret, o, (token) =>
    chamar(o.fetchImpl || fetch, `${o.base || URL_DA_API_SAIPOS}/update-order-status`, {
      method: "POST", headers: json(token), body: JSON.stringify({ order_id: orderId, status }),
    }));
}

/** O cardápio da loja no Saipos: pede o link e baixa o JSON. */
export async function baixarCatalogo(idPartner: string, secret: string, o: Opcoes = {}): Promise<{ ok: true; linhas: LinhaDoCatalogo[] } | { ok: false; erro: Resposta }> {
  const f = o.fetchImpl || fetch;
  const pedido = await comToken(idPartner, secret, o, (token) =>
    chamar(f, `${o.base || URL_DA_API_SAIPOS}/v2/catalog`, { method: "GET", headers: json(token) }));
  const url = pedido.corpo?.url;
  if (!pedido.ok || typeof url !== "string") return { ok: false, erro: pedido };
  // O link é do S3 (assinado): sem o header de Authorization.
  const arquivo = await chamar(f, url, { method: "GET" }, 30_000);
  if (!arquivo.ok || !Array.isArray(arquivo.corpo)) return { ok: false, erro: { ...arquivo, ok: false, mensagem: arquivo.mensagem || "o arquivo do cardápio não veio como lista" } };
  return { ok: true, linhas: arquivo.corpo as LinhaDoCatalogo[] };
}

/** Resultado do envio traduzido para a fila: enviado (ou já lá), tentar de novo, ou erro de dado. */
export function destinoDaResposta(r: Resposta): "ENVIADO" | "REPETIR" | "ERRO" {
  if (r.ok) return "ENVIADO";
  if (r.codigo != null && CODIGOS_DE_SUCESSO.has(r.codigo)) return "ENVIADO";
  return r.repetir ? "REPETIR" : "ERRO";
}
