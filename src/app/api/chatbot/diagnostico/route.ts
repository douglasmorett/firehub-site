import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { lerTrace } from "@/lib/webhook-trace";
import { loopGuardBackend } from "@/lib/loop-guard";

export const dynamic = "force-dynamic";

/**
 * Onde as últimas mensagens do WhatsApp pararam.
 *
 * Serve para responder "mandei áudio e o robô não respondeu" sem precisar das
 * telas do Coolify e do Railway abertas ao mesmo tempo. Cada entrada diz o
 * estágio que a mensagem alcançou; o primeiro estágio que não for "enviado"
 * aponta o culpado:
 *
 *   loja-nao-encontrada → a instância não casa com nenhuma loja
 *   audio-sem-bytes     → o áudio chegou vazio (download falhou no gateway)
 *   robo-desativado     → chatbotConfig.active está false nessa loja
 *   guard-ignorou       → anti-loop calou (o detalhe diz por quê)
 *   ia-timeout          → o Gemini não respondeu a tempo
 *   envio-falhou        → a resposta existia mas o gateway recusou mandar
 *
 * Ausência de QUALQUER entrada para o telefone significa que a mensagem nem
 * chegou ao webhook — aí o problema está no gateway, antes daqui.
 *
 * Protegido pelo CRON_SECRET: expõe apenas telefone mascarado e estágio, mas
 * não é informação para ficar aberta.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const rastro = lerTrace();

  return NextResponse.json({
    agora: new Date().toISOString(),
    estadoDoAntiLoop: loopGuardBackend(),
    totalRegistrado: rastro.length,
    ultimas: rastro,
  });
}
