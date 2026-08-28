import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "./segredos";

export async function getEvolutionQRCode(userId: string, storePhone?: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;

  // Buscar configurações da loja para verificar se há URL/API Key customizadas da Evolution API
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  const url = baseUrl;

  try {
    const defaultHeaders = {
      "apikey": apiKey,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Remainder": "true",
      "User-Agent": "FireHub"
    };

    // 1. Verificar estado da instância
    const stateRes = await fetch(`${url}/instance/connectionState/${instanceName}`, {
      method: "GET",
      headers: defaultHeaders,
      signal: AbortSignal.timeout(10000),
    });

    if (stateRes.ok) {
      const stateData = await stateRes.json();
      if (stateData?.instance?.state === "open" || stateData?.state === "open") {
        const phone = stateData?.instance?.ownerJid?.split("@")[0] || storePhone || "+55 21 99999-9999";
        return {
          connected: true,
          phone: phone.startsWith("+") ? phone : `+55 ${phone.replace(/^55/, "")}`,
          battery: 99,
          status: "ONLINE",
        };
      }
    }

    const webhookUrl = `${process.env.NEXTAUTH_URL || "https://firehubfood.com.br"}/api/webhook/whatsapp`;
    const webhookEvents = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

    // 2. Se não existir, tenta criar
    if (stateRes.status === 404) {
      await fetch(`${url}/instance/create`, {
        method: "POST",
        headers: defaultHeaders,
        body: JSON.stringify({
          instanceName,
          token: userId,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          webhook: webhookUrl,
          webhookByEvents: true,
          events: webhookEvents,
        }),
        signal: AbortSignal.timeout(10000),
      });
    }

    // 3. Garantir o webhook TAMBEM quando a instancia ja existia.
    //
    // Antes, o webhook so era definido no /instance/create acima. Instancia que
    // ja existisse — criada por uma versao anterior, por outro ambiente, ou
    // sobrevivente de um logout/reconexao — ficava para sempre sem destino:
    // o lojista lia o QR, o WhatsApp conectava, e nenhuma mensagem chegava ao
    // FireHub. Sem erro em lugar nenhum, so o robo mudo.
    //
    // Como e idempotente (redefinir o mesmo destino nao muda nada), roda a cada
    // pedido de QR. Falha aqui nao pode derrubar a conexao: o QR e o que o
    // lojista esta esperando, entao o erro so vai para o log.
    try {
      await fetch(`${url}/webhook/set/${instanceName}`, {
        method: "POST",
        headers: defaultHeaders,
        body: JSON.stringify({
          webhook: { enabled: true, url: webhookUrl, webhookByEvents: true, events: webhookEvents },
          // Formato antigo da Evolution, aceito em paralelo por versoes mais velhas.
          enabled: true,
          url: webhookUrl,
          webhookByEvents: true,
          events: webhookEvents,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (webhookErr) {
      console.warn(
        `[WhatsApp Evolution] Nao consegui reafirmar o webhook de ${instanceName}:`,
        (webhookErr as any)?.message
      );
    }

    // 4. Obter QR Code real
    const connectRes = await fetch(`${url}/instance/connect/${instanceName}`, {
      method: "GET",
      headers: defaultHeaders,
      signal: AbortSignal.timeout(10000),
    });

    if (connectRes.ok) {
      const connectData = await connectRes.json();

      if (connectData?.connected || connectData?.instance?.state === "open") {
        return {
          connected: true,
          phone: connectData.phone || storePhone || "+55 (21) 99999-9999",
          battery: 99,
          status: "ONLINE",
        };
      }

      const base64Qr = connectData?.code || connectData?.base64 || connectData?.qrcode?.base64;
      // Código de pareamento NUNCA pode ser inventado. Este trecho tinha dois
      // jeitos de mentir: caía em `connectData.code` (que é o base64 do QR
      // inteiro) e, na falta dele, em um número aleatório. O painel mostrava
      // isso como "conectar com número de telefone", o lojista digitava, não
      // funcionava nunca — e concluía que o FireHub estava quebrado.
      // Sem código real, campo vazio: a tela então oferece só o QR, que funciona.
      const pairingCode = typeof connectData?.pairingCode === "string" && connectData.pairingCode.length <= 12
        ? connectData.pairingCode
        : "";

      if (base64Qr) {
        const qrCodeUrl = base64Qr.startsWith("data:image") ? base64Qr : `data:image/png;base64,${base64Qr}`;
        return {
          connected: false,
          qrCodeUrl,
          pairingCode,
          expiresInSeconds: 45,
          status: "AWAITING_SCAN",
        };
      }
    }
  } catch (urlErr) {
    console.warn(`[WhatsApp Evolution] Tentativa de conexão em ${url} falhou:`, (urlErr as any).message);
  }

  // Se nenhuma instância online responder, lança erro para a interface informar o usuário
  throw new Error("Servidor de WhatsApp indisponível no momento. Certifique-se de que o Gateway está ativo.");
}

/**
 * Quanto tempo o robô fica "digitando..." antes de a mensagem sair.
 *
 * ── POR QUE NÃO É UMA CONTA FIXA ────────────────────────────────────────────
 *
 * Era `text.length * 40`, limitado entre 1,5s e 8s. Determinístico: a mesma
 * resposta saía sempre com exatamente o mesmo atraso, e duas mensagens de
 * mesmo tamanho eram idênticas no relógio. É assinatura de automação, e é
 * disso que o antispam do WhatsApp vive — o custo de ser detectado é o número
 * da loja banido, com a loja sem atendimento no meio do movimento.
 *
 * Gente de verdade não digita em velocidade constante: hesita antes de
 * começar, acelera no meio, para para pensar. O que se imita aqui:
 *
 *  - um tempinho de leitura antes de começar a digitar;
 *  - velocidade sorteada a cada mensagem, na faixa de quem digita rápido no
 *    celular (mais ou menos 22 a 45 ms por caractere);
 *  - uma variação final de ±15%, para dois envios do MESMO texto nunca
 *    levarem o mesmo tempo.
 *
 * O teto de 12s existe porque acima disso o cliente acha que ninguém viu a
 * mensagem dele e manda "oi?" de novo.
 */
function tempoDeDigitacao(texto: string): number {
  const caracteres = (texto || "").length;
  const msPorCaractere = 22 + Math.random() * 23;
  const leitura = 600 + Math.random() * 1400;
  const bruto = leitura + caracteres * msPorCaractere;
  const comVariacao = bruto * (0.85 + Math.random() * 0.3);
  // O TETO também é sorteado. Com teto fixo, toda resposta longa (listagem de
  // cardápio, resumo de pedido) saía exatamente em 12,000 ms — o mesmo valor
  // constante que estávamos tentando eliminar, só que no outro extremo.
  const teto = 9_000 + Math.random() * 4_000;
  return Math.round(Math.min(Math.max(comVariacao, 1200), teto));
}

export async function sendEvolutionMessage(userIdOrInstance: string, toPhone: string, text: string) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    const typingDelay = tempoDeDigitacao(text);

    const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        text,
        options: {
          delay: typingDelay,
          presence: "composing",
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mensagem:", err);
    return false;
  }
}

/**
 * Envia mídia por URL.
 *
 * O `tipo` existe porque o cardápio da loja pode ser PDF, e PDF enviado como
 * "image" chega quebrado no WhatsApp — o aparelho tenta desenhar o arquivo e
 * mostra um retângulo cinza. Documento precisa ir como "document", com nome de
 * arquivo, senão o cliente recebe algo sem título que ninguém abre.
 */
export async function sendEvolutionMediaUrl(
  userIdOrInstance: string,
  toPhone: string,
  mediaUrl: string,
  caption?: string,
  tipo: "image" | "document" = "image",
  nomeDoArquivo?: string,
) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    const res = await fetch(`${baseUrl}/message/sendMedia/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        mediaMessage: {
          mediatype: tipo,
          caption: caption || "",
          media: mediaUrl,
          ...(tipo === "document" ? { fileName: nomeDoArquivo || "cardapio.pdf" } : {}),
        },
        options: { delay: 1200, presence: "composing" },
      }),
      signal: AbortSignal.timeout(12000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mídia:", err);
    return false;
  }
}

export async function sendEvolutionAudioBase64(userIdOrInstance: string, toPhone: string, base64Audio: string) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  // Aprox 1MB = 1 minuto. Base64 de áudio curto. Delay mínimo 3s, máximo 15s.
  const baseDelay = Math.min(Math.max(Math.floor(base64Audio.length / 5000), 3000), 15000);

  try {
    const res = await fetch(`${baseUrl}/message/sendWhatsAppAudio/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        audio: base64Audio.startsWith("data:") ? base64Audio : `data:audio/mp3;base64,${base64Audio}`,
        delay: baseDelay,
        encoding: true,
        options: {
          presence: "recording"
        }
      }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar áudio:", err);
    return false;
  }
}

export async function disconnectEvolutionInstance(userId: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    await fetch(`${baseUrl}/instance/logout/${instanceName}`, {
      method: "DELETE",
      headers: {
        "apikey": apiKey,
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao desconectar instância:", err);
  }
}

/**
 * Reinicia a instância SEM deslogar — o remédio para o "Aguardando mensagem".
 *
 * ── O QUE É O "AGUARDANDO MENSAGEM" ─────────────────────────────────────────
 *
 * "Aguardando mensagem. Essa ação pode levar alguns instantes." no aparelho de
 * quem recebe significa que a mensagem CHEGOU, mas cifrada com uma sessão que
 * o aparelho não consegue abrir. A conversa entre o número da loja e cada
 * contato tem sua própria sessão de criptografia; quando a do lado do gateway
 * apodrece (redeploy que voltou estado antigo, prekeys esgotadas, instância
 * duplicada), TUDO que a loja envia àquele contato vira esse aviso — para
 * sempre, até a sessão ser refeita.
 *
 * Atinge principalmente dono e motoboys: são conversas onde o robô SÓ envia
 * (aviso de pedido, rota). Cliente conversa COM o robô, e cada mensagem
 * recebida renova a sessão do lado de cá — por isso cliente quase nunca vê o
 * problema.
 *
 * O restart derruba e recria a conexão da instância, forçando o Baileys a
 * renegociar sessão e repor prekeys, sem perder o pareamento (não pede QR).
 * Se depois do restart algum contato AINDA ficar preso, o desencalhe manual é
 * aquele contato mandar qualquer "oi" para o número da loja — a mensagem
 * recebida obriga a sessão nova dos dois lados.
 *
 * A Evolution mudou o verbo entre versões (v1: PUT, v2: POST); tenta os dois.
 */
export async function restartEvolutionInstance(userId: string): Promise<boolean> {
  const instanceName = `firehub_${userId.slice(-10)}`;
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  const headers = {
    "apikey": apiKey,
    "Bypass-Tunnel-Remainder": "true",
    "User-Agent": "FireHub",
  };

  for (const metodo of ["PUT", "POST"] as const) {
    try {
      const res = await fetch(`${baseUrl}/instance/restart/${instanceName}`, {
        method: metodo,
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return true;
      // 404/405 = verbo da outra versão; qualquer outro erro não melhora
      // trocando o verbo.
      if (res.status !== 404 && res.status !== 405) {
        console.error(`[Evolution API Gateway] Restart de ${instanceName} respondeu ${res.status}.`);
        return false;
      }
    } catch (err) {
      console.error(`[Evolution API Gateway] Erro no restart (${metodo}) de ${instanceName}:`, err);
    }
  }
  return false;
}

export async function getEvolutionAudioBase64(userIdOrInstance: string, messageKey: any, messageObj: any): Promise<string | null> {
  // Resolve o nome exato da instância
  let instanceName = userIdOrInstance;
  if (userIdOrInstance && userIdOrInstance.length >= 20 && !userIdOrInstance.startsWith("firehub_")) {
    instanceName = `firehub_${userIdOrInstance.slice(-10)}`;
  }

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: userIdOrInstance },
          { id: { endsWith: shortId } },
          { chatbotConfig: { path: ['instanceName'], equals: instanceName } }
        ]
      },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  const headers = {
    "apikey": apiKey,
    "Content-Type": "application/json",
    "Bypass-Tunnel-Remainder": "true",
    "User-Agent": "FireHub"
  };

  // ── Sobre o tamanho desta lista ─────────────────────────────────────────
  // Havia aqui 2 endpoints × 4 payloads = 8 tentativas de 10s, e o webhook
  // chamava esta função 3 vezes seguidas: até 4 MINUTOS antes de desistir e
  // avisar o cliente que o áudio não foi ouvido.
  //
  // E o esforço era inútil. Este fallback existe para quando o gateway não
  // conseguiu baixar o áudio inline — mas o endpoint do gateway roda o MESMO
  // `downloadMediaMessage` que acabou de falhar. Repetir 24 vezes a operação
  // que falhou não a faz funcionar; só transforma um erro rápido numa espera
  // longa, e no meio dela o cliente desiste.
  //
  // Sobrou o único endpoint que o gateway realmente implementa (o outro sempre
  // respondeu 404) e os dois formatos de payload que ele aceita. Vale a pena
  // tentar porque o download pode falhar por motivo transitório — mas em
  // segundos, não em minutos.
  const endpoints = [`${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`];

  const payloads = [
    // Formato que o gateway espera: key e message aninhados.
    {
      message: {
        key: {
          id: messageKey?.id,
          remoteJid: messageKey?.remoteJid,
          fromMe: messageKey?.fromMe || false,
        },
        message: messageObj?.message || messageObj,
      },
      convertToMp4: false,
    },
    // Mensagem crua, para o caso de o objeto já vir no formato do Baileys.
    {
      message: messageObj,
      convertToMp4: false,
    },
  ];

  for (const ep of endpoints) {
    for (const body of payloads) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          let base64Str = data.base64 || data.data || data.response?.base64 || data.media?.base64 || data.mediaBase64 || null;
          if (base64Str && typeof base64Str === "string") {
            if (base64Str.includes(";base64,")) {
              base64Str = base64Str.split(";base64,")[1];
            }
            base64Str = base64Str.trim();
            if (base64Str.length > 50) {
              return base64Str;
            }
          }
        }
      } catch (err: any) {
        // tenta o próximo endpoint/payload
      }
    }
  }

  return null;
}
