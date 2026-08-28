import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";
import { verifyCronAuth } from "@/lib/cron-auth";
import { avisarNumeroPeloFireHub } from "@/lib/server-monitor";

export const dynamic = "force-dynamic";

/** Dois ciclos do cron. Queda curta volta sozinha e não merece alarme. */
const AVISAR_APOS_MS = 10 * 60_000;
/** Enquanto não religar, um lembrete por dia — nem mudo, nem insistente. */
const REPETIR_AVISO_MS = 24 * 60 * 60_000;

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

  const results: { gateway: string; reconnected: string[]; avisados: string[] } = {
    gateway: "unknown",
    reconnected: [],
    avisados: [],
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
  const agora = Date.now();
  try {
    const usersWithChatbot = await prisma.user.findMany({
      where: {
        chatbotConfig: { not: undefined },
      },
      select: { id: true, chatbotConfig: true, storePhone: true, storeName: true, name: true },
    });

    const defaultHeaders = {
      "apikey": apiKey,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Remainder": "true",
      "User-Agent": "FireHub",
    };

    for (const user of usersWithChatbot) {
      const config = (user.chatbotConfig as any) || {};

      // ── QUEM ENTRA NA VIGILÂNCIA ────────────────────────────────────────
      //
      // A regra é "já conectou alguma vez": quem nunca leu um QR não tem robô
      // para cair, e avisá-lo seria propaganda, não alerta.
      //
      // O filtro anterior era `config.connected !== true` e tinha um buraco
      // grave: quando a loja caía e o lojista abria a tela de QR, a própria
      // rota do QR gravava `connected: false` — e a partir dali este cron
      // pulava a loja PARA SEMPRE. A que mais precisava de socorro era
      // exatamente a que deixava de ser vigiada. Por isso agora o critério é
      // o histórico (`jaConectouAlgumaVez`/`connectedAt`), não o estado atual.
      const jaConectou =
        config.connected === true ||
        config.jaConectouAlgumaVez === true ||
        Boolean(config.connectedAt);
      if (config.active === false || !jaConectou) continue;

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

        let conectada = false;
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          const state = stateData?.instance?.state || stateData?.state;
          conectada = state === "open";
        }

        // ── VOLTOU (ou nunca caiu) ─────────────────────────────────────────
        if (conectada) {
          // Só escreve se havia queda registrada: gravação à toa em toda loja
          // a cada 5 minutos é escrita de banco por nada.
          if (config.desconectadoDesde || config.connected !== true) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                chatbotConfig: {
                  ...config,
                  connected: true,
                  jaConectouAlgumaVez: true,
                  desconectadoDesde: null,
                  avisoDesconexaoEm: null,
                },
              },
            });
            console.log(`[Keep-Alive] 💚 ${instanceName} voltou ao ar.`);
          }
          continue;
        }

        // ── CAIU ───────────────────────────────────────────────────────────
        console.log(`[Keep-Alive] 🔄 Instância ${instanceName} não está online. Forçando reconexão...`);

        await fetch(`${instanceGatewayUrl}/instance/connect/${instanceName}`, {
          method: "GET",
          headers: { ...defaultHeaders, apikey: instanceApiKey },
          signal: AbortSignal.timeout(10000),
        });

        results.reconnected.push(instanceName);
        console.log(`[Keep-Alive] ✅ Reconexão disparada para ${instanceName}`);

        // Marca o começo da queda no primeiro ciclo em que ela aparece.
        const caiuEm = config.desconectadoDesde ? new Date(config.desconectadoDesde).getTime() : agora;
        const avisadoEm = config.avisoDesconexaoEm ? new Date(config.avisoDesconexaoEm).getTime() : 0;

        // O aviso espera DOIS ciclos. Queda de 5 minutos é reinício de gateway
        // e volta sozinha — avisar nela treinaria o lojista a ignorar o aviso,
        // que é a pior coisa que pode acontecer com um alerta.
        const caiuFazTempo = agora - caiuEm >= AVISAR_APOS_MS;
        const podeReavisar = agora - avisadoEm >= REPETIR_AVISO_MS;
        const deveAvisar = caiuFazTempo && podeReavisar;

        let avisoSaiu = false;
        if (deveAvisar) {
          const nomeDaLoja = user.storeName || user.name || "sua loja";
          avisoSaiu = await avisarNumeroPeloFireHub(
            user.storePhone || "",
            [
              `⚠️ *O robô de WhatsApp de ${nomeDaLoja} desconectou.*`,
              ``,
              `Enquanto ele estiver fora, as mensagens dos seus clientes não são respondidas.`,
              ``,
              `Para religar, entre no FireHub e leia o QR Code de novo:`,
              `https://firehubfood.com.br/store/chatbot`,
              ``,
              `Leva menos de um minuto: WhatsApp do celular da loja → Aparelhos conectados → Conectar aparelho.`,
            ].join("\n"),
          );
          if (avisoSaiu) {
            results.avisados.push(instanceName);
            console.log(`[Keep-Alive] 📨 Lojista de ${instanceName} avisado da desconexão.`);
          } else {
            console.warn(`[Keep-Alive] ⚠️ Não consegui avisar o lojista de ${instanceName} (telefone: ${user.storePhone || "não cadastrado"}).`);
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            chatbotConfig: {
              ...config,
              connected: false,
              jaConectouAlgumaVez: true,
              desconectadoDesde: new Date(caiuEm).toISOString(),
              // Só marca como avisado se o aviso REALMENTE saiu; senão a
              // próxima rodada tentaria de novo achando que já avisou.
              avisoDesconexaoEm: avisoSaiu
                ? new Date(agora).toISOString()
                : (config.avisoDesconexaoEm ?? null),
            },
          },
        });
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
