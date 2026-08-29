import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";

/**
 * "O WhatsApp desta loja está de pé AGORA?" — perguntado ao gateway.
 *
 * Peça única, usada pela tela do Chatbot e pela faixa do painel, para as duas
 * não divergirem: era exatamente isso que produzia o defeito que ela conserta —
 * a tela afirmando "Vinculado com Sucesso!" a partir de uma bandeira gravada no
 * banco no dia da leitura do QR, enquanto a sessão estava morta havia dias.
 *
 * `null` quer dizer NÃO SEI (gateway mudo, timeout, chave ausente). Quem chama
 * é obrigado a tratar esse caso: transformar "não sei" em "desconectado" apenas
 * trocaria o falso positivo antigo por um falso alarme novo, mandando o lojista
 * ler QR à toa toda vez que a rede piscasse.
 */
export type EstadoDoRobo = {
  /** true = no ar, false = fora, null = não deu para saber. */
  conectada: boolean | null;
  telefone: string | null;
};

export async function estadoAoVivoDoRobo(
  lojaId: string,
  config: any,
): Promise<EstadoDoRobo> {
  const instanceName = `firehub_${lojaId.slice(-10)}`;
  const baseUrl = (
    config?.evolutionUrl ||
    process.env.EVOLUTION_API_URL ||
    "https://firehub-whatsapp-gateway-production.up.railway.app"
  ).replace(/\/$/, "");

  let apiKey: string;
  try {
    apiKey = config?.evolutionApiKey || segredoObrigatorio("EVOLUTION_API_KEY");
  } catch {
    return { conectada: null, telefone: null };
  }

  try {
    const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      method: "GET",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const d = await res.json();
      const estado = d?.instance?.state || d?.state;
      const bruto = d?.instance?.ownerJid?.split("@")[0];
      return {
        conectada: estado === "open",
        telefone: bruto ? (String(bruto).startsWith("+") ? bruto : `+55 ${String(bruto).replace(/^55/, "")}`) : null,
      };
    }
    // Instância sumiu do gateway: é desconexão de verdade, não incerteza. É o
    // caso da sessão que morreu e foi limpa do outro lado.
    if (res.status === 404) return { conectada: false, telefone: null };
  } catch {
    // rede/timeout
  }
  return { conectada: null, telefone: null };
}

/**
 * Grava a mudança de estado no `chatbotConfig` — e SÓ quando ela mudou mesmo.
 *
 * `jaConectouAlgumaVez` é histórico, não estado: é ele que mantém a loja sob
 * vigilância e autoriza o aviso de queda. Uma versão anterior do keep-alive
 * filtrava por `connected !== true` e, quando a loja caía, deixava de vigiar
 * justamente quem precisava de socorro. O histórico nunca volta para false.
 */
export async function registrarEstadoDoRobo(
  lojaId: string,
  config: any,
  conectada: boolean,
  telefone: string | null,
  storePhone?: string | null,
): Promise<void> {
  if (Boolean(config?.connected) === conectada && config?.verificadoEm) {
    // Estado igual: só carimba a hora da conferência, sem mexer no resto.
    await prisma.user.update({
      where: { id: lojaId },
      data: { chatbotConfig: { ...(config || {}), verificadoEm: new Date().toISOString() } },
    });
    return;
  }

  const novo = conectada
    ? {
        ...(config || {}),
        connected: true,
        phone: telefone || config?.phone || storePhone || null,
        connectedAt: new Date().toISOString(),
        jaConectouAlgumaVez: true,
        desconectadoDesde: null,
        avisoDesconexaoEm: null,
        instanceName: `firehub_${lojaId.slice(-10)}`,
        verificadoEm: new Date().toISOString(),
      }
    : {
        ...(config || {}),
        connected: false,
        connectedAt: null,
        jaConectouAlgumaVez:
          config?.jaConectouAlgumaVez === true || Boolean(config?.connectedAt) || config?.connected === true,
        desconectadoDesde: config?.desconectadoDesde || new Date().toISOString(),
        verificadoEm: new Date().toISOString(),
      };

  await prisma.user.update({ where: { id: lojaId }, data: { chatbotConfig: novo } });
}
