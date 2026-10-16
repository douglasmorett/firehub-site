import { NextRequest, NextResponse } from "next/server";
import { keetaConfigurada, type EventoKeeta } from "@/lib/keeta/api";
import { webhookAssinadoPelaKeeta } from "@/lib/keeta/assinatura";
import { processarEventoKeeta } from "@/lib/keeta/eventos";
import { lojaDoMerchant } from "@/lib/keeta/lojas";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";

/**
 * POST /api/keeta/webhook — a Keeta avisa um evento de pedido.
 *
 * É a URL que o vínculo registra como `ordersWebhookURL` no onboarding de cada
 * loja. O polling (/api/cron/keeta-poll) roda junto como rede de segurança: o
 * mesmo evento pode chegar pelos dois, e a gravação é idempotente.
 *
 * ── 204 só depois de gravar ─────────────────────────────────────────────────
 * A Keeta reenvia após 1, 2 e 3 minutos se não receber 2xx. Responder 200 antes
 * de gravar e "confiar no polling" foi o furo da Brendi (o polling dela não
 * repõe o que recebeu 200). Aqui o processamento é síncrono: gravou → 204;
 * falhou → 500 e a Keeta tenta de novo (e o polling também).
 *
 * ── Assinatura ──────────────────────────────────────────────────────────────
 * HMAC-SHA256 do corpo cru com o client secret, em base64. A doc não traz
 * exemplo numérico, então nas primeiras semanas a conferência OBSERVA (grava o
 * resultado no payload cru) e só recusa com KEETA_WEBHOOK_ASSINATURA=obrigatoria.
 * Observar é seguro aqui: do corpo só se usa o `orderId`; o pedido e a loja
 * vêm da API da Keeta, com o nosso token — um corpo forjado não grava nada.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!keetaConfigurada()) return new NextResponse(null, { status: 503 });

  const cru = await req.text();
  const assinaturaOk = webhookAssinadoPelaKeeta(process.env.KEETA_CLIENT_SECRET || "", cru, req.headers.get("x-app-signature"));
  const merchant = req.headers.get("x-app-merchantid");

  let evento: EventoKeeta | null = null;
  try {
    evento = JSON.parse(cru);
  } catch {
    return NextResponse.json({ title: "corpo não é JSON", status: 400 }, { status: 400 });
  }

  await guardarPayloadCru({
    canal: "KEETA",
    tipo: "webhook",
    idNoParceiro: evento?.orderId ?? null,
    payload: { evento, merchant, appId: req.headers.get("x-app-id") },
    avisos: assinaturaOk ? [] : ["assinatura do webhook NÃO conferiu"],
  });

  if (!assinaturaOk) {
    console.warn(`[Keeta] ⚠️ webhook com assinatura que não confere (evento ${evento?.eventType} ${evento?.orderId})`);
    if (process.env.KEETA_WEBHOOK_ASSINATURA === "obrigatoria") {
      return NextResponse.json({ title: "assinatura inválida", status: 401 }, { status: 401 });
    }
  }

  // Loja bloqueada por mensalidade (lib/loja-bloqueada.ts): não processa. 204
  // para a Keeta não repetir o webhook; o pedido fica no Portal da Keeta.
  const lojaDoCabecalho = merchant ? await lojaDoMerchant(merchant).catch(() => null) : null;
  if (lojaDoCabecalho && (await lojaBloqueadaPorMensalidade(lojaDoCabecalho.franchiseeId))) {
    console.log(`[Keeta] webhook ${evento?.eventType} ${evento?.orderId}: loja bloqueada por mensalidade — ignorado`);
    return new NextResponse(null, { status: 204 });
  }

  try {
    const r = await processarEventoKeeta(evento as EventoKeeta, { merchantDoCabecalho: merchant });
    console.log(`[Keeta] webhook ${evento?.eventType} ${evento?.orderId}: ${r.acao}${r.mensagem ? ` — ${r.mensagem}` : ""}`);
    return r.confirmar ? new NextResponse(null, { status: 204 }) : NextResponse.json({ title: r.mensagem || r.acao, status: 500 }, { status: 500 });
  } catch (e: any) {
    console.error(`[Keeta] ❌ webhook ${evento?.eventType} ${evento?.orderId}:`, e?.message);
    return NextResponse.json({ title: "erro ao processar", status: 500 }, { status: 500 });
  }
}
