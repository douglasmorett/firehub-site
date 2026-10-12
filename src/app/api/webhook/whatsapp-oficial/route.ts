import { NextRequest, NextResponse } from "next/server";
import { processarWebhook, webhookAutentico } from "@/lib/disparo-oficial/servidor";
import { tokenDeVerificacao } from "@/lib/disparo-oficial/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook do app da Meta para o Disparo oficial (lib/disparo-oficial/).
 *
 * Só LÊ: status de entrega (é o que gasta ou devolve o crédito), aprovação dos
 * modelos, qualidade do número e o "Parar promoções". NUNCA responde conversa —
 * em coexistência a mensagem do cliente chega também ao robô no gateway, e é
 * ele quem responde. Responder aqui seria a resposta em dobro. (O webhook
 * antigo /api/webhook/whatsapp-cloud responde com o robô; não é o deste app.)
 *
 * Configurar no app da Meta: URL de callback = .../api/webhook/whatsapp-oficial,
 * token = tokenDeVerificacao() (lib/disparo-oficial/meta.ts), campos messages,
 * message_template_status_update, phone_number_quality_update e account_update.
 * Quem cadastra é o servidor: POST /api/admin/disparo-oficial {acao:"webhook"}.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const esperado = tokenDeVerificacao() || "";
  if (esperado && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === esperado) {
    return new NextResponse(sp.get("hub.challenge") || "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const cru = await req.text();
  if (!webhookAutentico(cru, req.headers.get("x-hub-signature-256"))) {
    console.warn("[Disparo oficial] Webhook com assinatura inválida — ignorado.");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(cru);
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await processarWebhook(body);
  } catch (e: any) {
    // 200 mesmo assim: erro nosso não pode fazer a Meta desligar o webhook.
    console.error(`[Disparo oficial] Webhook: ${e?.message}`);
  }
  return NextResponse.json({ ok: true });
}
