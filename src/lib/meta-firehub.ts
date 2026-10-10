/**
 * /src/lib/meta-firehub.ts
 *
 * O "Iniciar período de teste" (StartTrial) do PRÓPRIO FireHub, mandado pelo
 * servidor à API de Conversões da Meta — o pixel do site (1508278337585097,
 * o do layout raiz).
 *
 * Por que existe (09–10/10/2026): a campanha de vendas do FireHub otimiza para
 * "Avaliação iniciada no site", o site dispara `fbq('track','StartTrial')` no
 * fim do cadastro, o Gerenciador de Eventos recebe o evento (237 no total, o
 * último há 1 hora) — e o Gerenciador de Anúncios mostrava ZERO resultados em
 * 30 dias (R$ 1.083 gastos, 116 mil de alcance). A Meta só atribui o evento ao
 * anúncio quando consegue casar quem converteu com quem clicou: pelo cookie
 * (_fbc/_fbp, que some de um aparelho para o outro) ou pelos dados da pessoa
 * (telefone, e-mail, nome, cidade — em hash). O evento do navegador vai sem
 * nada disso; a qualidade da correspondência estava em 6,1/10. Pelo servidor
 * vão todos, com `event_id` igual ao do navegador para a Meta não contar duas
 * vezes (deduplicação).
 *
 * Também cobre a loja que o FireHub cadastra à mão depois da conversa no
 * WhatsApp (action_source "chat"): quem clicou no anúncio e fechou pelo
 * WhatsApp é cliente do anúncio do mesmo jeito.
 *
 * Variáveis: META_FIREHUB_PIXEL_ID (padrão: o pixel do layout) e
 * META_FIREHUB_CAPI_TOKEN (token da API de Conversões gerado no Gerenciador de
 * Eventos). Sem o token, nada é enviado e o log avisa uma vez.
 */
import { hashParaMeta, telefoneParaHashMeta, VERSAO_DA_GRAPH_API } from "./meta-capi";

export const PIXEL_DO_FIREHUB = "1508278337585097";

export type OrigemDoTrial = "website" | "chat";

export type TrialIniciado = {
  /** Id da loja criada: vira o event_id (o navegador usa o mesmo). */
  userId: string;
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  /** website = cadastro feito pela pessoa no site; chat = o FireHub cadastrou depois da conversa. */
  origem: OrigemDoTrial;
  /** Cookies do navegador (_fbp/_fbc), IP e user-agent — só no cadastro pelo site. */
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Para o "Testar eventos" do Gerenciador de Eventos. */
  testEventCode?: string | null;
  agora?: Date;
};

/** Os ids que o navegador precisa repetir em `fbq('track', …, { eventID })`. */
export function idsDosEventosDoTrial(userId: string): { startTrial: string; completeRegistration: string } {
  return { startTrial: `starttrial:${userId}`, completeRegistration: `completeregistration:${userId}` };
}

/** Lê `_fbp` e `_fbc` do cabeçalho Cookie (o fetch do cadastro é do mesmo domínio). */
export function cookiesDoMeta(cookie: string | null | undefined): { fbp: string | null; fbc: string | null } {
  const pares = String(cookie ?? "").split(";").map((p) => p.trim());
  const ler = (nome: string) => {
    const par = pares.find((p) => p.startsWith(nome + "="));
    const v = par ? par.slice(nome.length + 1).trim() : "";
    return /^fb\.\d\.\d+\.[A-Za-z0-9_-]+$/.test(v) ? v : null;
  };
  return { fbp: ler("_fbp"), fbc: ler("_fbc") };
}

/**
 * O corpo que vai para `/{pixel}/events`: StartTrial sempre; CompleteRegistration
 * junto quando foi a pessoa que se cadastrou no site (é o que o site já
 * dispara). Puro — o teste confere o hash, o action_source e os ids.
 */
export function corpoDosEventosDoTrial(t: TrialIniciado): Record<string, unknown> {
  const ids = idsDosEventosDoTrial(t.userId);
  const userData: Record<string, unknown> = {};
  const ph = telefoneParaHashMeta(t.telefone);
  if (ph) userData.ph = [ph];
  const em = hashParaMeta(t.email);
  if (em) userData.em = [em];
  if (t.nome) {
    const partes = String(t.nome).trim().split(/\s+/);
    const fn = hashParaMeta(partes[0]);
    const ln = hashParaMeta(partes.length > 1 ? partes[partes.length - 1] : "");
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
  }
  const ct = hashParaMeta(t.cidade);
  if (ct) userData.ct = [ct];
  // Brasil: a Meta casa melhor com o país junto do telefone.
  userData.country = [hashParaMeta("br")];
  if (t.fbp) userData.fbp = t.fbp;
  if (t.fbc) userData.fbc = t.fbc;
  if (t.ip) userData.client_ip_address = t.ip;
  if (t.userAgent) userData.client_user_agent = t.userAgent;

  const eventTime = Math.floor((t.agora ?? new Date()).getTime() / 1000);
  const comum = {
    event_time: eventTime,
    action_source: t.origem === "website" ? "website" : "chat",
    ...(t.origem === "website" ? { event_source_url: "https://firehubfood.com.br/cadastro" } : {}),
    user_data: userData,
  };
  const data: Record<string, unknown>[] = [
    { ...comum, event_name: "StartTrial", event_id: ids.startTrial, custom_data: { currency: "BRL", value: 0, predicted_ltv: 0 } },
  ];
  if (t.origem === "website") data.push({ ...comum, event_name: "CompleteRegistration", event_id: ids.completeRegistration });
  const corpo: Record<string, unknown> = { data };
  if (t.testEventCode) corpo.test_event_code = t.testEventCode;
  return corpo;
}

let avisouSemToken = false;

/**
 * Manda o StartTrial da loja nova à Meta. Nunca lança: o cadastro não pode
 * falhar por causa de rastreio. Devolve o que aconteceu, para o log.
 */
export async function avisarMetaTrialIniciado(
  t: TrialIniciado,
  env: Record<string, string | undefined> = process.env
): Promise<{ ok: boolean; motivo?: string; recebidos?: number }> {
  const pixelId = String(env.META_FIREHUB_PIXEL_ID ?? "").trim() || PIXEL_DO_FIREHUB;
  const token = String(env.META_FIREHUB_CAPI_TOKEN ?? "").trim();
  if (!token) {
    if (!avisouSemToken) {
      avisouSemToken = true;
      console.warn("[Meta FireHub] META_FIREHUB_CAPI_TOKEN não configurado: o StartTrial não vai pelo servidor (só pelo navegador).");
    }
    return { ok: false, motivo: "sem token" };
  }
  const corpo = corpoDosEventosDoTrial(t);
  const url = `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(d?.error?.message || `HTTP ${res.status}`).slice(0, 300);
      console.error("[Meta FireHub] StartTrial recusado:", msg);
      return { ok: false, motivo: msg };
    }
    console.log(`[Meta FireHub] StartTrial enviado (${t.origem}) — loja ${t.userId}, eventos recebidos: ${Number(d?.events_received) || 0}`);
    return { ok: true, recebidos: Number(d?.events_received) || 0 };
  } catch (err: any) {
    const msg = String(err?.message || err).slice(0, 300);
    console.error("[Meta FireHub] StartTrial não enviado:", msg);
    return { ok: false, motivo: msg };
  }
}
