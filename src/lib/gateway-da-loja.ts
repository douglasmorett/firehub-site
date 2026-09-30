import { segredoObrigatorio } from "./segredos";

const GATEWAY_PADRAO = "https://firehub-whatsapp-gateway-production.up.railway.app";

/**
 * Para qual gateway de WhatsApp vão as chamadas desta loja.
 *
 * `chatbotConfig.evolutionUrl` (e `evolutionApiKey`, opcional) põem UMA loja
 * num gateway à parte — o de teste com Baileys 7, só para a Divinos (25/09/2026).
 * Só o banco grava esses campos: a tela do robô os recusa (api/chatbot/config).
 *
 * `lib/whatsapp-evolution.ts` e `lib/whatsapp-estado.ts` já liam o campo; o
 * código de pareamento e o cron de contatos não, e mandariam a loja para o
 * gateway onde a instância dela não existe.
 */
export function gatewayDaLoja(chatbotConfig: unknown): { baseUrl: string; apiKey: string } {
  const c = (chatbotConfig && typeof chatbotConfig === "object" ? chatbotConfig : {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const baseUrl = (texto(c.evolutionUrl) || process.env.EVOLUTION_API_URL || GATEWAY_PADRAO).trim().replace(/\/+$/, "");
  const apiKey = texto(c.evolutionApiKey) || segredoObrigatorio("EVOLUTION_API_KEY");
  return { baseUrl, apiKey };
}

/**
 * O gateway das CONEXÕES NOVAS: o de Baileys 7, que entende conta com aparelho
 * hospedado (API oficial da Meta em coexistência). Divinos, Map Grill e China
 * pow só voltaram a receber mensagem depois de irem para ele (25–30/09/2026).
 * `GATEWAY_NOVAS_CONEXOES=""` desliga a regra.
 */
export const GATEWAY_DAS_NOVAS_CONEXOES = (process.env.GATEWAY_NOVAS_CONEXOES ?? "https://whatsapp-gateway-teste-production.up.railway.app")
  .trim()
  .replace(/\/+$/, "");

/** Fora há pelo menos isto: queda de gateway que volta sozinha não troca ninguém de lugar. */
export const FORA_HA_PELO_MENOS_MS = 10 * 60 * 1000;

/**
 * A loja vai ler um QR (ou código) AGORA: ela vai para o gateway novo?
 *
 * Nunca tira do lugar quem está funcionando (trocar de gateway obriga a ler o
 * QR de novo). Vai só quem já teria de ler o QR de qualquer jeito: loja que
 * nunca conectou, ou que está fora há 10 min ou mais. Quem chama tem de ter
 * conferido no gateway atual que a instância NÃO está aberta.
 */
export function vaiParaOGatewayNovo(chatbotConfig: unknown, agora = Date.now()): boolean {
  const c = (chatbotConfig && typeof chatbotConfig === "object" ? chatbotConfig : {}) as Record<string, unknown>;
  if (!GATEWAY_DAS_NOVAS_CONEXOES) return false;
  if (typeof c.evolutionUrl === "string" && c.evolutionUrl.trim()) return false;
  if (c.connected === true) return false;
  if (!c.jaConectouAlgumaVez) return true;
  const desde = Date.parse(String(c.desconectadoDesde || ""));
  return Number.isFinite(desde) && agora - desde >= FORA_HA_PELO_MENOS_MS;
}

/** A instância está aberta (conectada) neste gateway? Na dúvida, diz que sim: melhor não trocar. */
export async function abertaNoGateway(baseUrl: string, apiKey: string, instanceName: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return false;
    if (!res.ok) return true;
    const d = await res.json().catch(() => ({}));
    const estado = d?.instance?.state ?? d?.state;
    return estado === "open" || estado === "connecting";
  } catch {
    return true;
  }
}

/**
 * Se a loja deve ir para o gateway novo, grava e devolve a config nova; senão
 * devolve a mesma. Lê a config FRESCA do banco para não apagar nada escrito
 * no meio do caminho.
 */
export async function levarAoGatewayNovoSeFor(userId: string): Promise<Record<string, unknown> | null> {
  const { prisma } = await import("@/lib/prisma");
  const loja = await prisma.user.findUnique({ where: { id: userId }, select: { chatbotConfig: true } });
  const config = ((loja?.chatbotConfig as Record<string, unknown>) || {}) as Record<string, unknown>;
  if (!vaiParaOGatewayNovo(config)) return config;
  const { baseUrl, apiKey } = gatewayDaLoja(config);
  if (await abertaNoGateway(baseUrl, apiKey, `firehub_${userId.slice(-10)}`)) return config;
  const nova = { ...config, evolutionUrl: GATEWAY_DAS_NOVAS_CONEXOES };
  await prisma.user.update({ where: { id: userId }, data: { chatbotConfig: nova as any } });
  console.log(`[Gateway] ${userId} vai ler o QR no gateway novo (${GATEWAY_DAS_NOVAS_CONEXOES}).`);
  return nova;
}
