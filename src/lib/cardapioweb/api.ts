/**
 * lib/cardapioweb/api.ts — o cliente da API aberta do CardápioWeb (app privado na CW App Store).
 *
 * Credencial por INSTALAÇÃO: cada loja do CardápioWeb que autoriza o FireHub
 * vira uma linha em lib/cardapioweb/instalacoes.ts, com access_token (2 h) e
 * refresh_token cifrados. O `client_id` e o token do webhook são do APP, no
 * ambiente do servidor:
 *
 *   CARDAPIOWEB_CLIENT_ID          + CARDAPIOWEB_WEBHOOK_TOKEN           produção
 *   CARDAPIOWEB_SANDBOX_CLIENT_ID  + CARDAPIOWEB_SANDBOX_WEBHOOK_TOKEN   sandbox
 *
 * Sem o par de um ambiente, aquele ambiente está parado e NADA aqui chama a
 * rede (o interruptor de `keetaConfigurada`). Não existe client_secret: app de
 * integradora é cliente público e a segurança vem do PKCE (lib/cardapioweb/oauth.ts).
 *
 * Regras que vieram caras dos outros canais:
 *   - Renovação ANTES de vencer (5 min) e com trava por instalação: dez pedidos
 *     chegando juntos com o token vencido pedem UMA renovação, não dez — e,
 *     se o CardápioWeb girar o refresh_token, a segunda renovação com o token
 *     velho derrubaria a loja (o iFood ficou semanas com token morto calado).
 *   - 401 numa chamada: renova uma vez e repete UMA vez. Se continuar 401, a
 *     instalação caiu (desinstalada, revogada) e vira "reconectar" na tela.
 *   - 429 (300 chamadas a cada 3 min por loja), 5xx e rede são `repetir`: quem
 *     chamou manda para a fila de ações pendentes, nunca para o log calado.
 *   - Nenhum token, `code` ou `code_verifier` vai para o log (a doc pede, e o
 *     log do Coolify é lido por mais gente que o banco).
 */
import { mesmoSegredo } from "@/lib/cofre";
import type { AmbienteCW } from "./id-do-pedido";
import { lerTokens, gravarTokens, marcarReconectar, type InstalacaoCW } from "./instalacoes";

export type { AmbienteCW };

const TEMPO_MS = 10_000;
/** Renova quando faltar isto para vencer — o token dura 2 h. */
export const RENOVAR_ANTES_MS = 5 * 60_000;

export const AMBIENTES: AmbienteCW[] = ["producao", "sandbox"];

const VARIAVEIS: Record<AmbienteCW, { clientId: string; webhookToken: string }> = {
  producao: { clientId: "CARDAPIOWEB_CLIENT_ID", webhookToken: "CARDAPIOWEB_WEBHOOK_TOKEN" },
  sandbox: { clientId: "CARDAPIOWEB_SANDBOX_CLIENT_ID", webhookToken: "CARDAPIOWEB_SANDBOX_WEBHOOK_TOKEN" },
};

/** O portal (onde o Proprietário autoriza) e a API são hosts diferentes — sempre o par do MESMO ambiente. */
const HOSTS: Record<AmbienteCW, { api: string; portal: string }> = {
  producao: { api: "https://integracao.cardapioweb.com", portal: "https://portal.cardapioweb.com/cw-apps" },
  sandbox: { api: "https://integracao.sandbox.cardapioweb.com", portal: "https://portal.sandbox.cardapioweb.com/cw-apps" },
};

export const urlDaApi = (ambiente: AmbienteCW) => HOSTS[ambiente].api;
export const urlDoPortal = (ambiente: AmbienteCW) => HOSTS[ambiente].portal;

export function clientIdDo(ambiente: AmbienteCW): string {
  return String(process.env[VARIAVEIS[ambiente].clientId] || "").trim();
}

export function webhookTokenDo(ambiente: AmbienteCW): string {
  return String(process.env[VARIAVEIS[ambiente].webhookToken] || "").trim();
}

/** O ambiente só anda com as duas: sem o token do webhook não há como saber se o aviso é do CardápioWeb. */
export function ambienteConfigurado(ambiente: AmbienteCW): boolean {
  return Boolean(clientIdDo(ambiente) && webhookTokenDo(ambiente));
}

export function ambientesConfigurados(): AmbienteCW[] {
  return AMBIENTES.filter(ambienteConfigurado);
}

export function cardapiowebConfigurada(): boolean {
  return ambientesConfigurados().length > 0;
}

/** Onde o "Conectar" leva quando a tela não diz: produção, se existir. */
export function ambientePadrao(): AmbienteCW | null {
  return ambientesConfigurados()[0] ?? null;
}

export function ehAmbiente(v: unknown): v is AmbienteCW {
  return v === "producao" || v === "sandbox";
}

/**
 * De qual ambiente é este `X-Webhook-Token` (comparação em tempo constante).
 * Cada app (sandbox e produção) tem o seu token: é ele que diz de qual banco
 * do CardápioWeb o `merchant_id` do aviso é.
 */
export function ambienteDoToken(token: string | null | undefined): AmbienteCW | null {
  if (!token) return null;
  for (const ambiente of ambientesConfigurados()) {
    if (mesmoSegredo(token, webhookTokenDo(ambiente))) return ambiente;
  }
  return null;
}

// ── Resultado ────────────────────────────────────────────────────────────────

export type ResultadoCW<T = any> = {
  ok: boolean;
  status: number;
  dados?: T;
  erro?: string;
  /** Vale repetir mais tarde (rede, 5xx, 429, token). Regra de negócio (4xx) não. */
  repetir?: boolean;
  /** O `code` do corpo de erro do CardápioWeb (4002, 4003, 4010…). */
  codigo?: number;
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
    const partes = [dados.error, dados.error_description, dados.message, dados.details].filter((p) => typeof p === "string" && p.trim());
    if (partes.length > 0) return `${status} ${partes.join(" — ")}`.slice(0, 300);
    return `${status} ${JSON.stringify(dados).slice(0, 280)}`;
  }
  return `${status} ${String(dados ?? "").slice(0, 280)}`.trim();
}

// ── OAuth (troca, renovação, revogação, contexto) ───────────────────────────

export type TokensCW = { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos: string | null };

async function postarToken(ambiente: AmbienteCW, campos: Record<string, string>): Promise<ResultadoCW<TokensCW>> {
  try {
    const r = await fetch(`${urlDaApi(ambiente)}/api/partner/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(campos).toString(),
      signal: AbortSignal.timeout(TEMPO_MS),
    });
    const dados = await ler(r);
    if (!r.ok) return { ok: false, status: r.status, erro: mensagemDe(dados, r.status), repetir: r.status === 429 || r.status >= 500 };
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

/** A troca do `code` do callback. `redirectUri` tem de ser IDÊNTICA à do redirect para o portal. */
export function trocarCodigoPorTokens(ambiente: AmbienteCW, p: { code: string; redirectUri: string; codeVerifier: string }) {
  return postarToken(ambiente, {
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: clientIdDo(ambiente),
    code_verifier: p.codeVerifier,
  });
}

export function renovarTokens(ambiente: AmbienteCW, refreshToken: string) {
  return postarToken(ambiente, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientIdDo(ambiente) });
}

/** Desligar no FireHub revoga o token lá: o lojista que desconecta não deixa uma credencial viva para trás. */
export async function revogarToken(ambiente: AmbienteCW, token: string | null | undefined): Promise<boolean> {
  if (!token || !clientIdDo(ambiente)) return false;
  try {
    const r = await fetch(`${urlDaApi(ambiente)}/api/partner/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ token, client_id: clientIdDo(ambiente) }).toString(),
      signal: AbortSignal.timeout(TEMPO_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type ContextoCW = {
  companyId: string;
  companyNome: string;
  userId: string | null;
  userNome: string | null;
  userEmail: string | null;
  escopos: string[];
};

/**
 * Quem autorizou e QUAL loja (escopo `auth`). É daqui — e só daqui — que sai o
 * `company.id` do vínculo: a URL de retorno não traz loja nenhuma, e o
 * `state` é opaco de propósito. Ids comparados como texto (a doc avisa que
 * vêm ora número, ora string).
 */
export async function contextoDaInstalacao(ambiente: AmbienteCW, accessToken: string): Promise<ResultadoCW<ContextoCW>> {
  try {
    const r = await fetch(`${urlDaApi(ambiente)}/api/partner/v1/identity/context`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TEMPO_MS),
    });
    const dados = await ler(r);
    if (!r.ok) return { ok: false, status: r.status, erro: mensagemDe(dados, r.status), codigo: Number(dados?.code) || undefined, repetir: r.status === 429 || r.status >= 500 };
    const companyId = dados?.company?.id;
    if (companyId === undefined || companyId === null || String(companyId).trim() === "") {
      return { ok: false, status: r.status, erro: "o CardápioWeb não disse qual loja foi autorizada (company.id vazio)" };
    }
    return {
      ok: true,
      status: r.status,
      dados: {
        companyId: String(companyId).trim(),
        companyNome: String(dados?.company?.name || "").trim(),
        userId: dados?.user?.id != null ? String(dados.user.id) : null,
        userNome: dados?.user?.name ? String(dados.user.name) : null,
        userEmail: dados?.user?.email ? String(dados.user.email) : null,
        escopos: Array.isArray(dados?.scopes) ? dados.scopes.map((s: unknown) => String(s)) : [],
      },
    };
  } catch (e: any) {
    return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
  }
}

// ── Token da instalação ─────────────────────────────────────────────────────

type TokenOuErro = { ok: true; token: string } | { ok: false; erro: string; status: number; repetir: boolean };

/** Uma renovação por instalação de cada vez (a trava). */
const renovacoesEmVoo = new Map<string, Promise<TokenOuErro>>();

async function renovar(inst: InstalacaoCW, refreshToken: string): Promise<TokenOuErro> {
  const r = await renovarTokens(inst.ambiente, refreshToken);
  if (r.ok && r.dados) {
    await gravarTokens(inst.id, {
      accessToken: r.dados.accessToken,
      // Sem refresh_token novo na resposta, o antigo continua valendo.
      refreshToken: r.dados.refreshToken ?? refreshToken,
      expiraEm: r.dados.expiraEm,
      escopos: r.dados.escopos,
    });
    return { ok: true, token: r.dados.accessToken };
  }
  if (!r.repetir) {
    // 400/401 do endpoint de token: refresh_token recusado (revogado,
    // desinstalado, vencido). Não adianta tentar de novo — só o lojista
    // reconectando. A tela mostra "reconectar"; o Douglas recebe o aviso.
    await marcarReconectar(inst.id, `renovação do token recusada: ${r.erro}`);
    avisar(inst, `o CardápioWeb recusou a renovação do token (${r.erro}). A loja precisa reconectar em Integrações → CardápioWeb.`);
  }
  return { ok: false, erro: `renovação do token: ${r.erro}`, status: r.status, repetir: Boolean(r.repetir) };
}

/**
 * O access_token desta instalação, renovado se faltar menos de 5 min (ou se
 * `forcar`, depois de um 401). Com a rede fora na hora de renovar e o token
 * ainda dentro da validade, usa o que tem: renovar cedo é prudência, não
 * condição.
 */
export async function tokenDaInstalacao(inst: InstalacaoCW, forcar = false): Promise<TokenOuErro> {
  const tokens = await lerTokens(inst.id);
  if (!tokens) return { ok: false, erro: "instalação sem token (desligada?)", status: 401, repetir: false };
  const agora = Date.now();
  const venceEm = tokens.expiraEm ? tokens.expiraEm.getTime() : 0;
  if (!forcar && tokens.accessToken && venceEm - agora > RENOVAR_ANTES_MS) return { ok: true, token: tokens.accessToken };
  if (!tokens.refreshToken) {
    if (!forcar && tokens.accessToken && venceEm > agora) return { ok: true, token: tokens.accessToken };
    await marcarReconectar(inst.id, "sem refresh_token para renovar");
    return { ok: false, erro: "sem refresh_token — a loja precisa reconectar", status: 401, repetir: false };
  }

  let emVoo = renovacoesEmVoo.get(inst.id);
  if (!emVoo) {
    emVoo = renovar(inst, tokens.refreshToken).finally(() => renovacoesEmVoo.delete(inst.id));
    renovacoesEmVoo.set(inst.id, emVoo);
  }
  const r = await emVoo;
  if (!r.ok && r.repetir && !forcar && tokens.accessToken && venceEm > agora) return { ok: true, token: tokens.accessToken };
  return r;
}

// ── Chamada com Bearer ───────────────────────────────────────────────────────

export async function chamarCardapioWeb<T = any>(
  inst: InstalacaoCW,
  metodo: "GET" | "POST",
  caminho: string,
  opts: { query?: Record<string, string>; corpo?: unknown } = {},
): Promise<ResultadoCW<T>> {
  if (!ambienteConfigurado(inst.ambiente)) return { ok: false, status: 0, erro: `CardápioWeb (${inst.ambiente}) não configurado no servidor`, repetir: false };
  const qs = opts.query && Object.keys(opts.query).length > 0 ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const url = `${urlDaApi(inst.ambiente)}${caminho}${qs}`;
  const corpo = opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo);

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const t = await tokenDaInstalacao(inst, tentativa > 1);
    if (!t.ok) return { ok: false, status: t.status, erro: t.erro, repetir: t.repetir };
    let r: Response;
    try {
      r = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${t.token}`,
          Accept: "application/json",
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: corpo,
        signal: AbortSignal.timeout(TEMPO_MS),
      });
    } catch (e: any) {
      return { ok: false, status: 0, erro: `rede: ${e?.message || e}`, repetir: true };
    }
    const dados = await ler(r);
    if (r.ok) return { ok: true, status: r.status, dados };
    if (r.status === 401 && tentativa === 1) continue;
    if (r.status === 401) {
      // Token recém-renovado e ainda 401: a instalação não está mais ativa lá.
      await marcarReconectar(inst.id, `401 com token novo em ${metodo} ${caminho.replace(/\/\d+/g, "/:id")}`);
      avisar(inst, `o CardápioWeb respondeu 401 mesmo com o token renovado — o app pode ter sido desinstalado. A loja precisa reconectar.`);
    }
    return {
      ok: false,
      status: r.status,
      dados,
      codigo: Number(dados?.code) || undefined,
      erro: mensagemDe(dados, r.status),
      // 401 entra como "repetir": se o lojista reconectar em até 3 h, a fila
      // de pendentes entrega o que ficou para trás.
      repetir: r.status === 429 || r.status >= 500 || r.status === 401,
    };
  }
  return { ok: false, status: 401, erro: "token recusado duas vezes", repetir: true };
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

export function buscarPedidoCW(inst: InstalacaoCW, orderId: string) {
  return chamarCardapioWeb(inst, "GET", `/api/partner/v1/orders/${encodeURIComponent(orderId)}`);
}

/**
 * Pedidos alterados desde `desde`. O CardápioWeb recusa `updated_since` de
 * mais de 24 h atrás — quem chama já manda dentro da janela.
 */
export async function pedidosAlteradosCW(inst: InstalacaoCW, desde: Date): Promise<ResultadoCW<any[]>> {
  const r = await chamarCardapioWeb<any[]>(inst, "GET", "/api/partner/v1/orders", { query: { updated_since: desde.toISOString() } });
  if (r.ok) return { ...r, dados: Array.isArray(r.dados) ? r.dados : [] };
  return r;
}

export type AcaoCW = "confirm" | "start_preparation" | "prepared" | "dispatch" | "delivered" | "finalize" | "cancel";

/**
 * Uma ação de status. 4002 ("pedido finalizado, não muda") e 4003 ("transição
 * não permitida") contam como ok-já-estava: o pedido já passou desse ponto lá
 * (alguém mudou no portal, ou é a segunda vez que avisamos). Repetir isso pela
 * fila de pendentes seria bater três horas na mesma recusa. As transições
 * exatas só existem numa imagem da doc — por isso a tolerância, e a escada de
 * lib/cardapioweb/status.ts lê o status real antes de subir.
 */
export async function acaoNoPedidoCW(inst: InstalacaoCW, acao: AcaoCW, orderId: string, corpo?: unknown): Promise<ResultadoCW & { jaEstava?: boolean }> {
  const r = await chamarCardapioWeb(inst, "POST", `/api/partner/v1/orders/${encodeURIComponent(orderId)}/${acao}`, corpo === undefined ? {} : { corpo });
  if (!r.ok && (r.codigo === 4002 || r.codigo === 4003)) {
    console.log(`[CardápioWeb] ℹ️ ${acao} em ${orderId}: ${r.codigo} (já estava assim lá) — ${r.erro}`);
    return { ...r, ok: true, jaEstava: true };
  }
  return r;
}

// ── Aviso ────────────────────────────────────────────────────────────────────

function avisar(inst: InstalacaoCW, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("CardápioWeb", `${inst.nome || inst.companyId} (${inst.ambiente}, loja ${inst.franchiseeId})`, detalhe))
    .catch(() => {});
}
