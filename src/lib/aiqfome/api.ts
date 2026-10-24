/**
 * lib/aiqfome/api.ts — o cliente da API V2 do aiqfome (app "Aplicativo de Integração").
 *
 * Credencial do APP no ambiente do servidor (developer.aiqfome.com → Meus aplicativos):
 *
 *   AIQFOME_CLIENT_ID + AIQFOME_CLIENT_SECRET   o app (OAuth do ID Magalu)
 *   AIQFOME_WEBHOOK_SECRET                      o `secret_key` que o FireHub cadastra
 *                                               nos webhooks de cada loja
 *
 * Sem as três, o canal está parado e NADA aqui chama a rede (o interruptor de
 * `keetaConfigurada`/`cardapiowebConfigurada`). A credencial de cada LOJA
 * (access_token de 2 h + refresh_token) mora em lib/aiqfome/instalacoes.ts.
 *
 * Regras que vieram caras dos outros canais:
 *   - Renovação ANTES de vencer (5 min) e com trava por CREDENCIAL: dez
 *     pedidos chegando juntos com o token vencido pedem UMA renovação — e o
 *     refresh do ID Magalu gira, então a segunda com o token velho mataria a loja.
 *   - 401 numa chamada: renova uma vez e repete UMA vez. Se continuar 401, a
 *     loja vira "reconectar" na tela e o Douglas é avisado.
 *   - 429, 5xx e rede são `repetir`: quem chamou manda para a fila de ações
 *     pendentes, nunca para o log calado.
 *   - Nenhum token nem `code` vai para o log.
 *
 * `AIQFOME_BASE_URL` e `AIQFOME_ID_URL` existem só para o teste apontar para
 * um aiqfome falso; em produção valem os endereços oficiais.
 */
import { mesmoSegredo } from "@/lib/cofre";
import { gravarTokens, lerTokens, marcarReconectar, type InstalacaoAQ } from "./instalacoes";

const TEMPO_MS = 10_000;
export const RENOVAR_ANTES_MS = 5 * 60_000;

/** Os escopos que o FireHub pede (pedidos e loja; cardápio fica de fora). */
export const ESCOPOS = ["aqf:order:read", "aqf:order:create", "aqf:store:read", "aqf:store:create"];

/** Quem somos, no User-Agent que a doc pede em toda chamada. */
export const USER_AGENT = "FireHub (contato@firehubfood.com.br)";

const env = (k: string) => String(process.env[k] || "").trim();

export const clientId = () => env("AIQFOME_CLIENT_ID");
const clientSecret = () => env("AIQFOME_CLIENT_SECRET");
export const segredoDoWebhook = () => env("AIQFOME_WEBHOOK_SECRET");

export function aiqfomeConfigurada(): boolean {
  return Boolean(clientId() && clientSecret() && segredoDoWebhook());
}

export const urlDaApi = () => (env("AIQFOME_BASE_URL") || "https://plataforma.aiqfome.com/api/v2").replace(/\/+$/, "");
export const urlDoIdMagalu = () => (env("AIQFOME_ID_URL") || "https://id.magalu.com").replace(/\/+$/, "");

/** O endereço público do FireHub (o mesmo critério de lib/cardapioweb/oauth.ts). */
export function urlDoFireHub(host?: string | null): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || (host ? `https://${host}` : "https://firehubfood.com.br")).replace(/\/+$/, "");
}

/** A redirect_uri cadastrada no app — IDÊNTICA na autorização, na troca e na renovação. */
export function redirectUriDoAiqfome(host?: string | null): string {
  return env("AIQFOME_REDIRECT_URI") || `${urlDoFireHub(host)}/api/store/integracoes/aiqfome/retorno`;
}

/** A url dos webhooks (o aiqfome aceita até 128 caracteres). */
export function urlDoWebhook(host?: string | null): string {
  return `${urlDoFireHub(host)}/api/aiqfome/webhook`;
}

/**
 * O webhook é nosso? O aiqfome manda o `secret_key` cadastrado no header
 * `Authorization` (aceitamos com ou sem "Bearer "). Tempo constante.
 */
export function webhookAutentico(authorization: string | null | undefined): boolean {
  const segredo = segredoDoWebhook();
  if (!segredo || !authorization) return false;
  const bruto = String(authorization).trim();
  const semBearer = bruto.replace(/^Bearer\s+/i, "");
  return mesmoSegredo(bruto, segredo) || mesmoSegredo(semBearer, segredo);
}

// ── Resultado ────────────────────────────────────────────────────────────────

export type ResultadoAQ<T = any> = {
  ok: boolean;
  status: number;
  dados?: T;
  erro?: string;
  /** Vale repetir mais tarde (rede, 5xx, 429, token). Regra de negócio (4xx) não. */
  repetir?: boolean;
};

async function ler(r: Response): Promise<any> {
  const texto = await r.text().catch(() => "");
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

function mensagemDe(dados: any, status: number): string {
  if (dados && typeof dados === "object") {
    const partes = [dados.error, dados.error_description, dados.message].filter((p) => typeof p === "string" && p.trim());
    if (partes.length > 0) return `${status} ${partes.join(" — ")}`.slice(0, 300);
    return `${status} ${JSON.stringify(dados).slice(0, 280)}`;
  }
  return `${status} ${String(dados ?? "").slice(0, 280)}`.trim();
}

const repetivel = (status: number) => status === 0 || status === 429 || status >= 500;

// ── OAuth do ID Magalu ───────────────────────────────────────────────────────

export type TokensAQ = { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos: string | null };

async function postarToken(campos: Record<string, string>): Promise<ResultadoAQ<TokensAQ>> {
  try {
    const r = await fetch(`${urlDoIdMagalu()}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...campos }).toString(),
      signal: AbortSignal.timeout(TEMPO_MS),
    });
    const dados = await ler(r);
    if (!r.ok) return { ok: false, status: r.status, erro: mensagemDe(dados, r.status), repetir: repetivel(r.status) };
    if (!dados?.access_token) return { ok: false, status: r.status, erro: "resposta do token sem access_token", repetir: true };
    const segundos = Number(dados.expires_in) > 0 ? Number(dados.expires_in) : 7200;
    return {
      ok: true,
      status: r.status,
      dados: {
        accessToken: String(dados.access_token),
        refreshToken: dados.refresh_token ? String(dados.refresh_token) : null,
        expiraEm: new Date(Date.now() + segundos * 1000),
        escopos: dados.scope ? String(dados.scope) : null,
      },
    };
  } catch (e: any) {
    return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
  }
}

export function trocarCodigoPorTokens(p: { code: string; redirectUri: string }) {
  return postarToken({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri });
}

export function renovarTokens(refreshToken: string) {
  return postarToken({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: redirectUriDoAiqfome() });
}

// ── Token da instalação ─────────────────────────────────────────────────────

type TokenOuErro = { ok: true; token: string } | { ok: false; erro: string; status: number; repetir: boolean };

/** Uma renovação por CREDENCIAL de cada vez (a trava). */
const renovacoesEmVoo = new Map<string, Promise<TokenOuErro>>();

async function renovar(inst: InstalacaoAQ, refreshToken: string): Promise<TokenOuErro> {
  const r = await renovarTokens(refreshToken);
  if (r.ok && r.dados) {
    await gravarTokens(inst.credencial, {
      accessToken: r.dados.accessToken,
      refreshToken: r.dados.refreshToken ?? refreshToken,
      expiraEm: r.dados.expiraEm,
      escopos: r.dados.escopos,
    });
    return { ok: true, token: r.dados.accessToken };
  }
  if (!r.repetir) {
    // 400/401 do ID Magalu: refresh recusado (vencido, revogado). Só o
    // lojista reconectando resolve.
    await marcarReconectar(inst.credencial, `renovação do token recusada: ${r.erro}`);
    avisar(inst, `o ID Magalu recusou a renovação do token (${r.erro}). A loja precisa reconectar em Integrações → aiqfome.`);
  }
  return { ok: false, erro: `renovação do token: ${r.erro}`, status: r.status, repetir: Boolean(r.repetir) };
}

export async function tokenDaInstalacao(inst: InstalacaoAQ, forcar = false): Promise<TokenOuErro> {
  const tokens = await lerTokens(inst.id);
  if (!tokens) return { ok: false, erro: "instalação sem token (desligada?)", status: 401, repetir: false };
  const agora = Date.now();
  const venceEm = tokens.expiraEm ? tokens.expiraEm.getTime() : 0;
  if (!forcar && tokens.accessToken && venceEm - agora > RENOVAR_ANTES_MS) return { ok: true, token: tokens.accessToken };
  if (!tokens.refreshToken) {
    if (!forcar && tokens.accessToken && venceEm > agora) return { ok: true, token: tokens.accessToken };
    await marcarReconectar(inst.credencial, "sem refresh_token para renovar");
    return { ok: false, erro: "sem refresh_token — a loja precisa reconectar", status: 401, repetir: false };
  }
  let emVoo = renovacoesEmVoo.get(inst.credencial);
  if (!emVoo) {
    emVoo = renovar(inst, tokens.refreshToken).finally(() => renovacoesEmVoo.delete(inst.credencial));
    renovacoesEmVoo.set(inst.credencial, emVoo);
  }
  const r = await emVoo;
  if (!r.ok && r.repetir && !forcar && tokens.accessToken && venceEm > agora) return { ok: true, token: tokens.accessToken };
  return r;
}

// ── Chamadas ─────────────────────────────────────────────────────────────────

async function requisitar(token: string, metodo: "GET" | "POST", caminho: string, opts: { query?: Record<string, string>; corpo?: unknown }) {
  const qs = opts.query && Object.keys(opts.query).length > 0 ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const corpo = opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo);
  return fetch(`${urlDaApi()}${caminho}${qs}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo,
    signal: AbortSignal.timeout(TEMPO_MS),
  });
}

/** Com um token avulso (o recém-trocado, antes de existir instalação). */
export async function chamarComToken<T = any>(token: string, metodo: "GET" | "POST", caminho: string, opts: { query?: Record<string, string>; corpo?: unknown } = {}): Promise<ResultadoAQ<T>> {
  try {
    const r = await requisitar(token, metodo, caminho, opts);
    const dados = await ler(r);
    if (r.ok) return { ok: true, status: r.status, dados };
    return { ok: false, status: r.status, dados, erro: mensagemDe(dados, r.status), repetir: repetivel(r.status) };
  } catch (e: any) {
    return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
  }
}

export async function chamarAiqfome<T = any>(inst: InstalacaoAQ, metodo: "GET" | "POST", caminho: string, opts: { query?: Record<string, string>; corpo?: unknown } = {}): Promise<ResultadoAQ<T>> {
  if (!aiqfomeConfigurada()) return { ok: false, status: 0, erro: "aiqfome não configurado no servidor", repetir: false };
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const t = await tokenDaInstalacao(inst, tentativa > 1);
    if (!t.ok) return { ok: false, status: t.status, erro: t.erro, repetir: t.repetir };
    let r: Response;
    try {
      r = await requisitar(t.token, metodo, caminho, opts);
    } catch (e: any) {
      return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
    }
    const dados = await ler(r);
    if (r.ok) return { ok: true, status: r.status, dados };
    if (r.status === 401 && tentativa === 1) continue;
    if (r.status === 401) {
      await marcarReconectar(inst.credencial, `401 com token novo em ${metodo} ${caminho.replace(/\/\d+/g, "/:id")}`);
      avisar(inst, "o aiqfome respondeu 401 mesmo com o token renovado — a autorização pode ter sido revogada. A loja precisa reconectar.");
    }
    return {
      ok: false,
      status: r.status,
      dados,
      erro: mensagemDe(dados, r.status),
      // 401 entra como "repetir": se a loja reconectar em até 3 h, a fila
      // de pendentes entrega o que ficou para trás.
      repetir: repetivel(r.status) || r.status === 401,
    };
  }
  return { ok: false, status: 401, erro: "token recusado duas vezes", repetir: true };
}

/** As listas da V2 vêm em `{ data: [...] }`; uma (a de cancelados) às vezes em `{ data: {...} }`. */
export function lista(dados: any): any[] {
  const d = dados && typeof dados === "object" && "data" in dados ? dados.data : dados;
  if (Array.isArray(d)) return d.filter((x) => x && typeof x === "object");
  if (d && typeof d === "object") return [d];
  return [];
}

// ── Lojas ────────────────────────────────────────────────────────────────────

/** As lojas que este token libera (`GET /store`). É daqui — e só daqui — que nasce o vínculo. */
export async function lojasDoToken(token: string): Promise<ResultadoAQ<Array<{ storeId: string; nome: string | null }>>> {
  const r = await chamarComToken(token, "GET", "/store", { query: { per_page: "50" } });
  if (!r.ok) return r as ResultadoAQ<any>;
  const lojas = lista(r.dados)
    .map((l) => ({ storeId: String(l.id ?? "").trim(), nome: String(l.name ?? l.nome ?? "").trim() || null }))
    .filter((l) => /^[0-9A-Za-z-]{1,40}$/.test(l.storeId));
  return { ok: true, status: r.status, dados: lojas };
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

/** O pedido completo (`GET /orders/{id}` → `data`). */
export async function buscarPedidoAQ(inst: InstalacaoAQ, orderId: string): Promise<ResultadoAQ<any>> {
  const r = await chamarAiqfome(inst, "GET", `/orders/${encodeURIComponent(orderId)}`);
  if (r.ok) return { ...r, dados: r.dados && typeof r.dados === "object" && r.dados.data ? r.dados.data : r.dados };
  return r;
}

/** Os pedidos em aberto da loja (lidos e não lidos), versão resumida. */
export async function pedidosAbertosAQ(inst: InstalacaoAQ): Promise<ResultadoAQ<any[]>> {
  const r = await chamarAiqfome(inst, "GET", "/orders/open", { query: { "filter[store_ids]": inst.storeId, per_page: "50" } });
  return r.ok ? { ...r, dados: lista(r.dados) } : (r as ResultadoAQ<any[]>);
}

/** Os cancelados da loja (motivo e quem cancelou). */
export async function pedidosCanceladosAQ(inst: InstalacaoAQ): Promise<ResultadoAQ<any[]>> {
  const r = await chamarAiqfome(inst, "GET", "/orders/cancelled", { query: { "filter[store_ids]": inst.storeId, per_page: "50" } });
  return r.ok ? { ...r, dados: lista(r.dados).filter((c) => c.order_id != null) } : (r as ResultadoAQ<any[]>);
}

export type AcaoAQ = "mark-as-read" | "mark-as-ready" | "mark-as-delivered";

/** O sinal que diz que a ação já foi feita lá, no pedido completo. */
const SINAL_DA_ACAO: Record<AcaoAQ, string> = { "mark-as-read": "is_read", "mark-as-ready": "is_ready", "mark-as-delivered": "is_delivered" };

/**
 * Uma ação de status. A doc não diz o que volta quando o pedido já passou
 * daquele ponto (alguém marcou no Geraldo). Então, numa recusa 4xx, o pedido
 * é lido de novo: se o sinal da ação já está lá, conta como "já estava" — e
 * não vai para a fila repetir três horas a mesma recusa.
 */
export async function acaoNoPedidoAQ(inst: InstalacaoAQ, acao: AcaoAQ, orderId: string): Promise<ResultadoAQ & { jaEstava?: boolean }> {
  const n = Number(orderId);
  const r = await chamarAiqfome(inst, "POST", `/orders/${acao}`, { corpo: { order_id: Number.isFinite(n) ? n : orderId } });
  if (r.ok || r.repetir || r.status < 400 || r.status >= 500) return r;
  const lido = await buscarPedidoAQ(inst, orderId).catch(() => null);
  if (lido?.ok && lido.dados && lido.dados[SINAL_DA_ACAO[acao]] === true) {
    console.log(`[aiqfome] ℹ️ ${acao} em ${orderId}: ${r.status} (já estava assim lá)`);
    return { ...r, ok: true, jaEstava: true };
  }
  return r;
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

/** Os eventos que o FireHub quer, pelo NOME (a doc não publica os ids). */
export const EVENTOS_DO_WEBHOOK = ["new-order", "read-order", "ready-order", "cancel-order"];

/**
 * Cadastra os webhooks da loja: lê os eventos (`/auxiliary/webhook-events`),
 * casa pelo nome, pula o que já está cadastrado com a nossa url e cadastra o
 * resto. Devolve o erro em texto (para a tela) ou null. Nunca lança: falha
 * aqui não impede a conexão — o polling de 30 s segura os pedidos.
 */
export async function cadastrarWebhooks(inst: InstalacaoAQ, url: string): Promise<string | null> {
  try {
    const ev = await chamarAiqfome(inst, "GET", "/auxiliary/webhook-events", { query: { per_page: "100" } });
    if (!ev.ok) return `não consegui ler os eventos de webhook: ${ev.erro}`;
    const porNome = new Map<string, number>();
    for (const e of lista(ev.dados)) {
      const nome = String(e.name ?? "").trim().toLowerCase();
      const id = Number(e.id);
      if (nome && Number.isFinite(id)) porNome.set(nome, id);
    }
    const faltam = EVENTOS_DO_WEBHOOK.filter((n) => !porNome.has(n));
    if (faltam.length === EVENTOS_DO_WEBHOOK.length) return `o aiqfome não listou os eventos ${EVENTOS_DO_WEBHOOK.join(", ")}`;

    const ja = await chamarAiqfome(inst, "GET", `/store/${encodeURIComponent(inst.storeId)}/webhooks`);
    const cadastrados = new Set(
      (ja.ok ? lista(ja.dados) : []).filter((w) => String(w.url ?? "") === url).map((w) => Number(w.event_id ?? w.webhook_event_id)),
    );
    const novos = EVENTOS_DO_WEBHOOK.filter((n) => porNome.has(n) && !cadastrados.has(porNome.get(n)!)).map((n) => ({
      url,
      secret_key: segredoDoWebhook(),
      webhook_event_id: porNome.get(n)!,
    }));
    if (novos.length > 0) {
      const r = await chamarAiqfome(inst, "POST", `/store/${encodeURIComponent(inst.storeId)}/webhooks`, { corpo: { webhooks: novos } });
      if (!r.ok) return `o aiqfome recusou o cadastro dos webhooks: ${r.erro}`;
    }
    return faltam.length > 0 ? `eventos que o aiqfome não listou: ${faltam.join(", ")}` : null;
  } catch (e: any) {
    return `erro ao cadastrar os webhooks: ${e?.message || e}`;
  }
}

// ── Aviso ────────────────────────────────────────────────────────────────────

function avisar(inst: InstalacaoAQ, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("aiqfome", `${inst.nome || inst.storeId} (loja ${inst.franchiseeId})`, detalhe))
    .catch(() => {});
}
