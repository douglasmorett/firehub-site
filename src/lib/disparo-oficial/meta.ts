/**
 * lib/disparo-oficial/meta.ts — as chamadas à Graph API do WhatsApp (Cloud API)
 * que o Disparo oficial faz. Uma função por chamada, sem estado.
 *
 * O app é o MESMO app da Meta do FireHub (META_APP_ID / META_APP_SECRET, já
 * usado pelo Tráfego pago), com o produto WhatsApp e o cadastro incorporado
 * (Embedded Signup) na configuração WHATSAPP_ES_CONFIG_ID.
 *
 * Versão da Graph: a mesma do resto do que fala com a Meta (lib/meta-capi.ts).
 */
import { segredoObrigatorio, segredoOpcional } from "@/lib/segredos";
import { VERSAO_DA_GRAPH_API } from "@/lib/meta-capi";

const GRAPH = `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}`;

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
  const appId = segredoOpcional("META_APP_ID");
  const configId = segredoOpcional("WHATSAPP_ES_CONFIG_ID");
  if (!appId || !configId) return null;
  return { appId, configId, versao: VERSAO_DA_GRAPH_API };
}

/**
 * O código do cadastro incorporado vira o token da loja (token de usuário do
 * sistema da empresa dela, sem prazo). O código vive 30 segundos: a tela
 * manda assim que o Facebook devolve.
 */
export async function trocarCodigoPorToken(codigo: string): Promise<string> {
  const appId = segredoObrigatorio("META_APP_ID");
  const segredo = segredoObrigatorio("META_APP_SECRET");
  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(segredo)}&code=${encodeURIComponent(codigo)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const dados: any = await res.json().catch(() => ({}));
  if (!res.ok || !dados?.access_token) {
    const e = dados?.error || {};
    throw new ErroDaMeta(Number(e?.code) || null, String(e?.message || "A Meta não devolveu o token"), res.status);
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
