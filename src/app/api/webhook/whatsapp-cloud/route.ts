import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { segredoObrigatorio } from "@/lib/segredos";
import {
  parseCloudApiWebhook,
  sendCloudApiMessage, 
  downloadCloudApiMedia, 
  markAsRead, 
  verifyCloudApiWebhook 
} from '@/lib/whatsapp-cloud';
import { processChatbotAI } from '@/lib/chatbot-ai';
import { trackWhatsAppMessage } from '@/lib/usage-tracker';

export const dynamic = 'force-dynamic';

// Função pelo mesmo motivo dos arquivos do totem: avaliar no topo do módulo
// quebraria o build quando a variável não está presente no ambiente de build.
const obterVerifyToken = () => segredoObrigatorio("WHATSAPP_CLOUD_VERIFY_TOKEN");

// Caches
const messageCooldowns = new Map<string, number>();
const humanPaused = new Map<string, number>();
const historyCache = new Map<string, { role: string, content: string, ts: number }[]>();

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of messageCooldowns.entries()) {
    if (now - ts > 3000) messageCooldowns.delete(key);
  }
  for (const [key, ts] of humanPaused.entries()) {
    if (now - ts > 12 * 60 * 60 * 1000) humanPaused.delete(key);
  }
  for (const [key, history] of historyCache.entries()) {
    if (history.length > 0 && now - history[history.length - 1].ts > 30 * 60 * 1000) {
      historyCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === obterVerifyToken()) {
      return new NextResponse(challenge, { status: 200 });
    }

    return new NextResponse('Forbidden', { status: 403 });
  } catch (error) {
    console.error('Error verifying Cloud API Webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Always return 200 immediately for Meta.
    // We process the webhook asynchronously.
    await processPayload(body).catch((err) => {
      console.error('Error processing WhatsApp Cloud payload:', err);
    });

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    // Never return error status codes to avoid Meta disabling the webhook
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}

async function processPayload(body: any) {
  const parsed = parseCloudApiWebhook(body);
  if (!parsed || parsed.messages.length === 0) return;

  const { phoneNumberId } = parsed;

  for (const message of parsed.messages) {
    if (!message) continue;

    const { from, pushName, text, mediaId, type } = message;
    if (!from) continue;

    const now = Date.now();

    // 1. Cooldown Check (3 seconds per phone number)
    const lastMsgTime = messageCooldowns.get(from) || 0;
    if (now - lastMsgTime < 3000) {
      console.log(`Skipping message from ${from} due to 3s cooldown`);
      continue;
    }
    messageCooldowns.set(from, now);

    // 2. Human Intervention Check (12 hours)
    const humanPauseTime = humanPaused.get(from) || 0;
    if (now - humanPauseTime < 12 * 60 * 60 * 1000) {
      continue;
    }

    // 3. Find User/Store by phone number ID
    const user = await prisma.user.findFirst({
      where: {
        role: "FRANCHISEE",
        chatbotConfig: { path: ['cloudApiPhoneNumberId'], equals: phoneNumberId }
      },
      select: {
        id: true, 
        storeName: true, 
        chatbotConfig: true,
        slug: true, 
        storePhone: true,
      },
    });

    if (!user || !user.chatbotConfig) continue;
    
    const config = user.chatbotConfig as Record<string, any>;
    if (config.active !== true) continue;

    const accessToken = config.cloudApiAccessToken;
    if (!accessToken) continue;

    // 4. Human Support Detection
    const lowerText = (text || '').toLowerCase();
    if (lowerText.includes('atendente') || lowerText.includes('suporte') || lowerText.includes('humano')) {
      humanPaused.set(from, now);
      await sendCloudApiMessage(
        phoneNumberId, 
        accessToken, 
        from, 
        "Entendido. Pausei o atendimento automático por 12 horas. Em breve um atendente humano irá falar com você."
      ).catch(console.error);
      continue;
    }

    // 5. Mark as read
    if (message.messageId) {
      await markAsRead(phoneNumberId, accessToken, message.messageId).catch(console.error);
    }

    // 6. Track Inbound Message
    trackWhatsAppMessage(user.id, 'INBOUND', 'SERVICE');

    // 7. Prepare History
    // ISOLAMENTO ENTRE LOJAS: chave inclui a loja (mesmo motivo do webhook da
    // Evolution). O user ja esta resolvido na linha ~103, entao da para usar.
    const convKey = user.id + "_" + from;
    let history = historyCache.get(convKey) || [];
    history = history.filter(h => now - h.ts < 30 * 60 * 1000); // Only last 30 minutes
    const chatbotHistory = history.map(h => ({ role: h.role, content: h.content }));

    // 8. Prepare Media
    let audioData: { base64: string, mimeType: string } | null = null;
    if (type === 'audio' && mediaId) {
      try {
        const downloaded = await downloadCloudApiMedia(mediaId, accessToken);
        if (downloaded) {
          audioData = downloaded;
        }
      } catch (error) {
        console.error('Error downloading Cloud API audio:', error);
      }
    }

    // 9. Process with AI (25s timeout)
    const timeoutPromise = new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error('AI_TIMEOUT')), 25000)
    );
    const aiPromise = processChatbotAI(user.id, text || '', chatbotHistory, from, audioData || undefined, pushName);

    try {
      const result = await Promise.race([aiPromise, timeoutPromise]) as { reply: string };

      if (result && result.reply) {
        // Send reply
        await sendCloudApiMessage(phoneNumberId, accessToken, from, result.reply);
        
        // Track Outbound Message
        trackWhatsAppMessage(user.id, 'OUTBOUND', 'SERVICE');

        // Update history
        history.push({ role: 'user', content: text || '[Audio]', ts: now });
        history.push({ role: 'assistant', content: result.reply, ts: Date.now() });
        
        if (history.length > 15) {
          history = history.slice(history.length - 15);
        }
        historyCache.set(convKey, history);
      }
    } catch (error: any) {
      console.error('AI Processing Error:', error);
      if (error.message === 'AI_TIMEOUT') {
        const fallbackMessage = "Desculpe, estou demorando mais do que o normal para responder. Por favor, aguarde um momento ou envie sua mensagem novamente.";
        await sendCloudApiMessage(phoneNumberId, accessToken, from, fallbackMessage).catch(console.error);
      }
    }
  }
}
