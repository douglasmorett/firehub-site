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
