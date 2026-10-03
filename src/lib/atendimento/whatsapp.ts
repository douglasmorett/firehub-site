import { createHash } from "crypto";
import { segredoObrigatorio } from "@/lib/segredos";
import { paraEnvioWhatsApp } from "@/lib/telefone";
import { configDoAtendimento, INSTANCIA_DO_ATENDIMENTO } from "./config";

/**
 * O WHATSAPP DO NÚMERO DO FIREHUB — o mesmo gateway das lojas, instância
 * própria (`firehub_atendimento`).
 *
 * Não usa lib/whatsapp-evolution.ts de propósito: lá o nome da instância e a
 * URL do gateway são DERIVADOS de uma loja (`firehub_<id>`, chatbotConfig), e
 * este número não é loja. As chamadas são as mesmas do gateway; só a origem
 * da configuração muda (CrmConfig).
 */

async function gateway() {
  const config = await configDoAtendimento();
  const url = (config.evolutionUrl || process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  // A chave própria só vale junto com a URL própria. Sem URL a chamada vai ao
  // gateway padrão, que só aceita a chave do ambiente — uma chave avulsa ali
  // (01/10: o Chrome preencheu a senha do login no campo) derruba o número inteiro.
  const apiKey = (config.evolutionUrl && config.evolutionApiKey) || segredoObrigatorio("EVOLUTION_API_KEY");
  return {
    url,
    headers: { apikey: apiKey, "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true", "User-Agent": "FireHub" },
  };
}

const inst = () => encodeURIComponent(INSTANCIA_DO_ATENDIMENTO);

export type EstadoNoGateway = {
  conectado: boolean | null;
  telefone: string | null;
  vinculoDoente?: boolean;
  motivo?: string | null;
  erro?: string;
};

/** Está no ar? `null` = o gateway não respondeu (não se sabe). */
export async function estadoNoGateway(): Promise<EstadoNoGateway> {
  try {
    const { url, headers } = await gateway();
    const res = await fetch(`${url}/instance/connectionState/${inst()}`, { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { conectado: false, telefone: null };
    if (!res.ok) return { conectado: null, telefone: null, erro: `gateway respondeu ${res.status}` };
    const d = await res.json().catch(() => ({}));
    const estado = d?.instance?.state || d?.state;
    const bruto = String(d?.instance?.ownerJid || "").split("@")[0].split(":")[0];
    return {
      conectado: estado === "open",
      telefone: bruto || null,
      vinculoDoente: d?.instance?.vinculoDoente === true,
      motivo: typeof d?.instance?.motivo === "string" ? d.instance.motivo.slice(0, 400) : null,
    };
  } catch (err: any) {
    return { conectado: null, telefone: null, erro: err?.message || "gateway fora do ar" };
  }
}

/**
 * Pede o QR para conectar. O gateway das lojas cria a sessão no `connect`; a
 * Evolution oficial precisa do `create` antes — os dois passos são inofensivos
 * no outro.
 */
export async function pedirQrCode(): Promise<{ conectado: boolean; qr?: string; erro?: string }> {
  try {
    const { url, headers } = await gateway();
    const estado = await fetch(`${url}/instance/connectionState/${inst()}`, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (estado?.status === 404) {
      await fetch(`${url}/instance/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ instanceName: INSTANCIA_DO_ATENDIMENTO, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    }
    // Evolution oficial manda cada instância para o webhook dela; o gateway das
    // lojas usa um só (FIREHUB_WEBHOOK_URL) e responde 404 aqui — inofensivo.
    const webhook = `${(process.env.NEXTAUTH_URL || "https://firehubfood.com.br").replace(/\/$/, "")}/api/webhook/whatsapp`;
    const eventos = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];
    await fetch(`${url}/webhook/set/${inst()}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ webhook: { enabled: true, url: webhook, webhookByEvents: true, events: eventos }, enabled: true, url: webhook, webhookByEvents: true, events: eventos }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    const res = await fetch(`${url}/instance/connect/${inst()}`, { headers, signal: AbortSignal.timeout(15000) });
    const d = await res.json().catch(() => ({}));
    if (d?.connected || d?.instance?.state === "open") return { conectado: true };
    const base64 = d?.base64 || d?.code || d?.qrcode?.base64;
    if (typeof base64 === "string" && base64.length > 100) {
      return { conectado: false, qr: base64.startsWith("data:image") ? base64 : `data:image/png;base64,${base64}` };
    }
    return { conectado: false, erro: d?.error || "O gateway ainda está gerando o QR. Tente de novo em alguns segundos." };
  } catch (err: any) {
    return { conectado: false, erro: err?.message || "Gateway fora do ar." };
  }
}

/** Código de 8 letras para "Conectar com número de telefone" — sem câmera. */
export async function pedirCodigoDePareamento(numero: string): Promise<{ codigo?: string; conectado?: boolean; erro?: string }> {
  const d = String(numero || "").replace(/\D/g, "");
  const comDdi = d.startsWith("55") ? d : `55${d}`;
  if (comDdi.length < 12) return { erro: "Informe o número com DDD." };
  try {
    const { url, headers } = await gateway();
    const res = await fetch(`${url}/instance/pairing-code/${inst()}?number=${comDdi}`, { headers, signal: AbortSignal.timeout(20000) });
    const r = await res.json().catch(() => ({}));
    if (r?.jaConectada) return { conectado: true };
    if (typeof r?.pairingCode === "string" && r.pairingCode.length <= 12) return { codigo: r.pairingCode };
    return { erro: r?.error || `O gateway respondeu ${res.status}.` };
  } catch (err: any) {
    return { erro: err?.message || "Gateway fora do ar." };
  }
}

export async function desconectarNoGateway(): Promise<boolean> {
  try {
    const { url, headers } = await gateway();
    const res = await fetch(`${url}/instance/logout/${inst()}`, { method: "DELETE", headers, signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reinicia sem deslogar (o remédio do "Aguardando mensagem" — ver whatsapp-evolution.ts). */
export async function reiniciarNoGateway(): Promise<boolean> {
  const { url, headers } = await gateway();
  for (const metodo of ["PUT", "POST"] as const) {
    try {
      const res = await fetch(`${url}/instance/restart/${inst()}`, { method: metodo, headers, signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      if (res.status !== 404 && res.status !== 405) return false;
    } catch {
      /* tenta o outro verbo */
    }
  }
  return false;
}

// ── O ECO DO QUE O FIREHUB MANDOU ──────────────────────────────────────────
//
// Mensagem que SAI do número volta pelo webhook como `fromMe` — tanto a que a
// tela/robô mandou quanto a que o Douglas digitou no celular. As duas são
// muito diferentes: a do celular quer dizer "uma pessoa assumiu, robô quieto";
// a da tela já está gravada. O que distingue é o registro abaixo, feito ANTES
// de o texto sair: mesmo texto, mesma conversa, poucos minutos → é eco.
// (Mesmo raciocínio do `botSentHashes` do robô das lojas, lib/loop-guard.ts.)

type Envio = { conversa: string; em: number };
const JANELA_DO_ECO_MS = 3 * 60_000;

function envios(): Map<string, Envio[]> {
  const g = globalThis as any;
  if (!g.__ecosDoAtendimento) g.__ecosDoAtendimento = new Map<string, Envio[]>();
  return g.__ecosDoAtendimento;
}

const hashDoTexto = (t: string) => createHash("sha1").update(String(t || "").trim()).digest("hex");
const conversaDoJid = (jid: string) => String(jid || "").split("@")[0].replace(/\D/g, "").slice(-8);

function lembrarEnvio(jid: string, texto: string) {
  const mapa = envios();
  const agora = Date.now();
  const chave = hashDoTexto(texto);
  const lista = (mapa.get(chave) || []).filter((e) => agora - e.em < JANELA_DO_ECO_MS);
  lista.push({ conversa: conversaDoJid(jid), em: agora });
  mapa.set(chave, lista);
  if (mapa.size > 500) {
    for (const [k, v] of mapa) if (v.every((e) => agora - e.em >= JANELA_DO_ECO_MS)) mapa.delete(k);
  }
}

/**
 * Esta mensagem `fromMe` é o eco de algo que o FireHub mandou?
 *
 * O registro NÃO é consumido: o gateway pode entregar o mesmo eco duas vezes
 * (reconexão), e o segundo viraria "digitado no celular" — calando o robô por
 * 12 h numa conversa em que ninguém assumiu. Ele vence sozinho pela janela.
 * (Mesmo desenho do `botSentHashes` do robô das lojas, lib/loop-guard.ts.)
 */
export function ehEcoDoFireHub(jids: string[], texto: string): boolean {
  const lista = envios().get(hashDoTexto(texto));
  if (!lista?.length) return false;
  const agora = Date.now();
  const conversas = new Set(jids.map(conversaDoJid).filter(Boolean));
  return lista.some((e) => agora - e.em < JANELA_DO_ECO_MS && conversas.has(e.conversa));
}

/**
 * Tempo de "digitando…". O robô imita gente (o antispam do WhatsApp vive de
 * atraso constante — ver `tempoDeDigitacao` em whatsapp-evolution.ts); quem
 * digitou na tela já levou o tempo dele, então sai quase na hora.
 */
function atrasoDoRobo(texto: string): number {
  const leitura = 600 + Math.random() * 1200;
  const bruto = leitura + texto.length * (22 + Math.random() * 20);
  return Math.round(Math.min(Math.max(bruto, 1200), 8000 + Math.random() * 3000));
}

export type ResultadoDoEnvio = { ok: boolean; erro?: string };

/** Manda texto para a conversa (`jid` exato, ou número com DDD). */
export async function enviarTexto(destino: string, texto: string, opcoes: { comoRobo?: boolean } = {}): Promise<ResultadoDoEnvio> {
  const conteudo = String(texto || "").trim();
  if (!conteudo) return { ok: false, erro: "Mensagem vazia." };
  // Número digitado (vendedor, "me avisar neste WhatsApp") precisa do 55: "22999998888"
  // sem ele o WhatsApp lê como DDI 229 e o gateway ACEITA — o aviso some e fica
  // marcado como enviado (o mesmo defeito contado em cron/gateway-keepalive).
  const numero = destino.includes("@") ? destino : paraEnvioWhatsApp(destino);
  if (!numero) return { ok: false, erro: "Número de WhatsApp inválido (use DDD + número)." };
  lembrarEnvio(numero, conteudo);
  try {
    const { url, headers } = await gateway();
    const res = await fetch(`${url}/message/sendText/${inst()}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: numero,
        text: conteudo,
        options: { delay: opcoes.comoRobo ? atrasoDoRobo(conteudo) : 400, presence: "composing" },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return {
      ok: false,
      erro: res.status === 503 ? "O número do FireHub está desconectado do WhatsApp." : d?.error || `O gateway respondeu ${res.status}.`,
    };
  } catch (err: any) {
    return { ok: false, erro: err?.name === "TimeoutError" ? "O gateway demorou demais para responder." : err?.message || "Gateway fora do ar." };
  }
}

/** Baixa a mídia (áudio, imagem, vídeo, PDF) que não veio junto no evento (fallback do gateway). */
export async function baixarMidia(chave: any, mensagem: any): Promise<string | null> {
  try {
    const { url, headers } = await gateway();
    const res = await fetch(`${url}/chat/getBase64FromMediaMessage/${inst()}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: { key: chave, message: mensagem } }),
      // Vídeo e PDF demoram mais que o áudio para sair do gateway.
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return typeof d?.base64 === "string" && d.base64.length > 100 ? d.base64 : null;
  } catch {
    return null;
  }
}
