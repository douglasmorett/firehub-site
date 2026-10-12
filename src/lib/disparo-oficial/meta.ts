/**
 * lib/disparo-oficial/meta.ts — as chamadas à Graph API do WhatsApp (Cloud API)
 * que o Disparo oficial faz. Uma função por chamada, sem estado.
 *
 * O app é o "FireHub Cloud API" (1926992894663462, portfólio Fire Delivery),
 * separado do app de anúncios: WHATSAPP_APP_ID / WHATSAPP_APP_SECRET, e o
 * cadastro incorporado (Embedded Signup) na configuração WHATSAPP_ES_CONFIG_ID.
 *
 * Versão da Graph: a mesma do resto do que fala com a Meta (lib/meta-capi.ts).
 */
import { createHmac } from "crypto";
import { segredoObrigatorio, segredoOpcional } from "@/lib/segredos";
import { VERSAO_DA_GRAPH_API } from "@/lib/meta-capi";

const GRAPH = `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}`;

/** Id do app do WhatsApp (o público vai para a tela). */
export function appIdDoWhatsapp(): string | null {
  return segredoOpcional("WHATSAPP_APP_ID");
}

/** Chave secreta do app do WhatsApp: troca do código e assinatura do webhook. */
export function segredoDoAppDoWhatsapp(): string | null {
  return segredoOpcional("WHATSAPP_APP_SECRET");
}

/**
 * O token que a Meta manda no GET de verificação do webhook. Sem
 * WHATSAPP_OFICIAL_VERIFY_TOKEN, sai da chave secreta do app — fica só no
 * servidor, e quem cadastra o webhook é o próprio servidor
 * (assinarWebhookDoApp), então ninguém precisa digitá-lo.
 */
export function tokenDeVerificacao(): string | null {
  const definido = segredoOpcional("WHATSAPP_OFICIAL_VERIFY_TOKEN");
  if (definido) return definido;
  const segredo = segredoDoAppDoWhatsapp();
  return segredo ? createHmac("sha256", segredo).update("firehub-disparo-oficial-webhook").digest("hex").slice(0, 32) : null;
}

export const CAMPOS_DO_WEBHOOK = ["messages", "message_template_status_update", "phone_number_quality_update", "account_update"];

/**
 * Cadastra (ou atualiza) o webhook do app na Meta: URL, token e campos. Usa o
 * token do APP (id|chave), que só o servidor tem. A Meta chama o GET de
 * verificação na hora — o site tem de estar no ar com as variáveis.
 */
export async function assinarWebhookDoApp(callbackUrl: string): Promise<{ success?: boolean }> {
  const appId = segredoObrigatorio("WHATSAPP_APP_ID");
  const segredo = segredoObrigatorio("WHATSAPP_APP_SECRET");
  const verify = tokenDeVerificacao();
  if (!verify) throw new Error("Sem token de verificação.");
  const corpo = new URLSearchParams({
    object: "whatsapp_business_account",
    callback_url: callbackUrl,
    verify_token: verify,
    fields: CAMPOS_DO_WEBHOOK.join(","),
    include_values: "true",
    access_token: `${appId}|${segredo}`,
  });
  const res = await fetch(`${GRAPH}/${appId}/subscriptions`, { method: "POST", body: corpo, signal: AbortSignal.timeout(30000) });
  const dados: any = await res.json().catch(() => ({}));
  if (!res.ok || dados?.error) {
    const e = dados?.error || {};
    throw new ErroDaMeta(Number(e?.code) || null, String(e?.error_user_msg || e?.message || `HTTP ${res.status}`), res.status);
  }
  return dados;
}

/** O que a Meta tem cadastrado de webhook para o app (sem segredos). */
export async function webhookDoApp(): Promise<unknown> {
  const appId = segredoObrigatorio("WHATSAPP_APP_ID");
  const segredo = segredoObrigatorio("WHATSAPP_APP_SECRET");
  const res = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${segredo}`)}`, { signal: AbortSignal.timeout(20000) });
  const dados: any = await res.json().catch(() => ({}));
  return (dados?.data || []).map((s: any) => ({ object: s.object, callback_url: s.callback_url, active: s.active, fields: (s.fields || []).map((f: any) => f.name) }));
}

export class ErroDaMeta extends Error {
  constructor(public codigo: number | null, public titulo: string, public status: number) {
    super(titulo);
  }
}

async function graph<T = any>(caminho: string, opcoes: { token: string; metodo?: string; corpo?: unknown; timeoutMs?: number }): Promise<T> {
  const res = await fetch(`${GRAPH}/${caminho.replace(/^\/+/, "")}`, {
    method: opcoes.metodo || "GET",
    headers: {
      Authorization: `Bearer ${opcoes.token}`,
      ...(opcoes.corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    signal: AbortSignal.timeout(opcoes.timeoutMs ?? 20000),
  });
  const dados: any = await res.json().catch(() => ({}));
  if (!res.ok || dados?.error) {
    const e = dados?.error || {};
    const detalhe = e?.error_data?.details || e?.error_user_msg || e?.message || `HTTP ${res.status}`;
    throw new ErroDaMeta(Number.isFinite(Number(e?.code)) ? Number(e.code) : null, String(detalhe), res.status);
  }
  return dados as T;
}

/** O que a tela precisa para abrir o cadastro incorporado. Null = falta configurar no servidor. */
export function configDoCadastro(): { appId: string; configId: string; versao: string } | null {
  const appId = appIdDoWhatsapp();
  const configId = segredoOpcional("WHATSAPP_ES_CONFIG_ID");
  if (!appId || !configId || !segredoDoAppDoWhatsapp()) return null;
  return { appId, configId, versao: VERSAO_DA_GRAPH_API };
}

/**
 * O código do cadastro incorporado vira o token da loja (token de usuário do
 * sistema da empresa dela, sem prazo). O código vive 30 segundos: a tela
 * manda assim que o Facebook devolve.
 */
export async function trocarCodigoPorToken(codigo: string): Promise<string> {
  const appId = segredoObrigatorio("WHATSAPP_APP_ID");
  const segredo = segredoObrigatorio("WHATSAPP_APP_SECRET");
  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(segredo)}&code=${encodeURIComponent(codigo)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const dados: any = await res.json().catch(() => ({}));
  if (!res.ok || !dados?.access_token) {
    const e = dados?.error || {};
    throw new ErroDaMeta(Number(e?.code) || null, String(e?.message || "A Meta não devolveu o token"), res.status);
  }
  return String(dados.access_token);
}

/**
 * Renova o token da loja por mais 60 dias. O token do cadastro incorporado
 * vence em 60 dias (a configuração da Meta não deixa escolher "nunca"); o
 * antigo continua valendo até a data dele.
 */
export async function renovarToken(token: string): Promise<string> {
  const appId = segredoObrigatorio("WHATSAPP_APP_ID");
  const segredo = segredoObrigatorio("WHATSAPP_APP_SECRET");
  const url =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&set_token_expires_in_60_days=true` +
    `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(segredo)}&fb_exchange_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const dados: any = await res.json().catch(() => ({}));
  if (!res.ok || !dados?.access_token) {
    const e = dados?.error || {};
    throw new ErroDaMeta(Number(e?.code) || null, String(e?.message || "A Meta não renovou o token"), res.status);
  }
  return String(dados.access_token);
}

/** Inscreve o app do FireHub na WABA da loja: sem isto, nenhum webhook chega. */
export async function inscreverAppNaWaba(wabaId: string, token: string): Promise<void> {
  await graph(`${wabaId}/subscribed_apps`, { token, metodo: "POST", corpo: {} });
}

export type NumeroDaWaba = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
  is_on_biz_app?: boolean;
};

export async function numerosDaWaba(wabaId: string, token: string): Promise<NumeroDaWaba[]> {
  const d = await graph<{ data?: NumeroDaWaba[] }>(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app`,
    { token }
  );
  return Array.isArray(d?.data) ? d.data : [];
}

export async function infoDoNumero(phoneNumberId: string, token: string): Promise<NumeroDaWaba & { messaging_limit_tier?: string; throughput?: { level?: string } }> {
  return graph(`${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app,messaging_limit_tier,throughput`, { token });
}

/**
 * Coexistência: os contatos do WhatsApp Business vão para a API. A Meta só
 * aceita UMA vez e dentro de 24 h do cadastro. O histórico de conversas NÃO é
 * pedido: quem conversa é o robô no gateway, a API não precisa dele.
 */
export async function sincronizarContatos(phoneNumberId: string, token: string): Promise<void> {
  await graph(`${phoneNumberId}/smb_app_data`, { token, metodo: "POST", corpo: { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" } });
}

export async function criarModelo(wabaId: string, token: string, modelo: unknown): Promise<{ id: string; status?: string }> {
  return graph(`${wabaId}/message_templates`, { token, metodo: "POST", corpo: modelo });
}

export async function lerModelo(metaTemplateId: string, token: string): Promise<{ id: string; name?: string; status?: string; rejected_reason?: string }> {
  return graph(`${metaTemplateId}?fields=id,name,status,rejected_reason`, { token });
}

export async function apagarModelo(wabaId: string, token: string, nome: string, metaTemplateId?: string | null): Promise<void> {
  const q = `name=${encodeURIComponent(nome)}${metaTemplateId ? `&hsm_id=${encodeURIComponent(metaTemplateId)}` : ""}`;
  await graph(`${wabaId}/message_templates?${q}`, { token, metodo: "DELETE" });
}

/** Manda o modelo aprovado para um telefone; devolve o wamid. */
export async function enviarModelo(args: {
  phoneNumberId: string;
  token: string;
  telefone: string;
  nomeDoModelo: string;
  idioma: string;
  /** O primeiro nome do cliente, quando o modelo usa {nome}. */
  nome?: string | null;
}): Promise<string> {
  const componentes = args.nome != null ? [{ type: "body", parameters: [{ type: "text", text: args.nome }] }] : [];
  const d = await graph<{ messages?: { id: string }[] }>(`${args.phoneNumberId}/messages`, {
    token: args.token,
    metodo: "POST",
    corpo: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.telefone,
      type: "template",
      template: { name: args.nomeDoModelo, language: { code: args.idioma }, ...(componentes.length ? { components: componentes } : {}) },
    },
    timeoutMs: 15000,
  });
  const wamid = d?.messages?.[0]?.id;
  if (!wamid) throw new ErroDaMeta(null, "A Meta aceitou mas não devolveu o id da mensagem", 200);
  return wamid;
}

/** Texto livre — só dentro da janela de 24 h que o cliente abriu (grátis). */
export async function enviarTexto(phoneNumberId: string, token: string, telefone: string, texto: string): Promise<void> {
  await graph(`${phoneNumberId}/messages`, {
    token,
    metodo: "POST",
    corpo: { messaging_product: "whatsapp", recipient_type: "individual", to: telefone, type: "text", text: { body: texto } },
  });
}
