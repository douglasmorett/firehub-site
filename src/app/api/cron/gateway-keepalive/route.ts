import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";
import { verifyCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Cron job que pinga o WhatsApp Gateway a cada 5 minutos
 * e verifica/reconecta sessões que estejam desconectadas.
 * 
 * Fix 5: Agora além de pingar, verifica cada instância ativa
 * e força reconexão se estiver offline — crítico para madrugada.
 */
export async function GET(req: NextRequest) {
  // Este cron era o único sem autenticação: qualquer anônimo o disparava e,
  // com ele, varria as instâncias de WhatsApp de todas as lojas e forçava
  // reconexões — abuso de recurso e mapa da operação de graça.
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gatewayUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  const apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  const results: { gateway: string; reconnected: string[] } = {
    gateway: "unknown",
    reconnected: [],
  };

  // 1. Ping básico no gateway
  try {
    const res = await fetch(`${gatewayUrl}/`, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
    });

    results.gateway = res.ok ? "online" : `status_${res.status}`;
    console.log(`[Keep-Alive] Gateway ping: ${res.status} (${new Date().toISOString()})`);
  } catch (err: any) {
    results.gateway = "offline";
    console.warn(`[Keep-Alive] Gateway indisponível: ${err.message}`);
    // Se o gateway está offline, não adianta tentar reconectar sessões
    return NextResponse.json({
      status: "gateway_offline",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Buscar todos os usuários que têm chatbot conectado e verificar suas instâncias
  try {
    const usersWithChatbot = await prisma.user.findMany({
      where: {
        chatbotConfig: { not: undefined },
      },
      select: { id: true, chatbotConfig: true },
    });

    const defaultHeaders = {
      "apikey": apiKey,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Remainder": "true",
      "User-Agent": "FireHub",
    };

    for (const user of usersWithChatbot) {
      const config = (user.chatbotConfig as any) || {};
      // Só verificar usuários que tinham chatbot ativo e conectado
      if (config.active === false || config.connected !== true) continue;

      const instanceName = `firehub_${user.id.slice(-10)}`;
      const instanceGatewayUrl = (config.evolutionUrl || gatewayUrl).replace(/\/$/, "");
      const instanceApiKey = config.evolutionApiKey || apiKey;

      try {
        // Verificar estado da instância
        const stateRes = await fetch(`${instanceGatewayUrl}/instance/connectionState/${instanceName}`, {
          method: "GET",
          headers: { ...defaultHeaders, apikey: instanceApiKey },
          signal: AbortSignal.timeout(8000),
        });

        if (stateRes.ok) {
          const stateData = await stateRes.json();
          const state = stateData?.instance?.state || stateData?.state;

          if (state === "open") {
            // Sessão OK, nada a fazer
            continue;
          }
        }

        // Sessão não está "open" — forçar reconexão
        console.log(`[Keep-Alive] 🔄 Instância ${instanceName} não está online. Forçando reconexão...`);

        await fetch(`${instanceGatewayUrl}/instance/connect/${instanceName}`, {
          method: "GET",
          headers: { ...defaultHeaders, apikey: instanceApiKey },
          signal: AbortSignal.timeout(10000),
        });

        results.reconnected.push(instanceName);
        console.log(`[Keep-Alive] ✅ Reconexão disparada para ${instanceName}`);
      } catch (instanceErr: any) {
        console.warn(`[Keep-Alive] ⚠️ Erro ao verificar/reconectar ${instanceName}:`, instanceErr.message);
      }
    }
  } catch (dbErr: any) {
    console.warn(`[Keep-Alive] Erro ao buscar usuários no banco:`, dbErr.message);
  }

  return NextResponse.json({
    status: "ok",
    gateway: results.gateway,
    reconnected: results.reconnected,
    reconnectedCount: results.reconnected.length,
    timestamp: new Date().toISOString(),
  });
}
