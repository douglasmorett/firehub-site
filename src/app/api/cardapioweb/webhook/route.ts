import { NextRequest, NextResponse, after } from "next/server";
import { ambienteDoToken, cardapiowebConfigurada } from "@/lib/cardapioweb/api";
import { marcarEvento, processarEventoCardapioWeb, registrarEventoDoWebhook, type EventoCW } from "@/lib/cardapioweb/eventos";

/**
 * POST /api/cardapioweb/webhook — o CardápioWeb avisa: pedido novo ou status mudou.
 *
 * É a `webhook_url` cadastrada no app (a mesma para todas as lojas que
 * instalaram). O aviso traz só ids; o `X-Webhook-Token` diz que é do
 * CardápioWeb e de QUAL ambiente (cada app, sandbox e produção, tem o seu).
 *
 * ── 200 SEMPRE, e em menos de 5 s ───────────────────────────────────────────
 *
 * O CardápioWeb tenta de novo até 15 vezes (~2h30) e depois PAUSA o webhook
 * — e pausado ele só volta por e-mail ao suporte deles. Então nada aqui
 * devolve erro: token errado, loja desconhecida, loja bloqueada, banco fora,
 * exceção — tudo é 200, com log e aviso. A rede de verdade é o polling de
 * 30 s (/api/cron/cardapioweb-poll), que acha o que este aviso não trouxe.
 *
 * O trabalho (buscar o pedido, gravar, imprimir, confirmar) roda DEPOIS da
 * resposta, no `after()` do Next. Antes da resposta só o registro do aviso,
 * com teto de tempo: o `event_id` é a chave contra o reenvio, e o registro é
 * o caminho de volta para o reprocesso se o servidor cair no meio.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const responder = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra }, { status: 200 });
const texto = (v: unknown) => (v == null ? "" : String(v).trim());

/** Fora de uma requisição do Next (teste, script) o `after()` lança: aí roda solto. */
function depoisDaResposta(tarefa: () => Promise<void>) {
  try {
    after(tarefa);
  } catch {
    void tarefa().catch((e) => console.error("[CardápioWeb] ❌ aviso em segundo plano:", e?.message));
  }
}

function comTeto<T>(promessa: Promise<T>, ms: number, seEstourar: T): Promise<T> {
  return Promise.race([promessa, new Promise<T>((r) => setTimeout(() => r(seEstourar), ms))]);
}

export async function POST(req: NextRequest) {
  try {
    // Sem credencial no servidor o canal está parado: responde e não toca em nada.
    if (!cardapiowebConfigurada()) return responder({ ignorado: "desligado" });

    const ambiente = ambienteDoToken(req.headers.get("x-webhook-token"));
    if (!ambiente) {
      console.warn("[CardápioWeb] ⚠️ webhook com X-Webhook-Token que não confere — ignorado");
      import("@/lib/server-monitor")
        .then((m) =>
          m.alertarFalhaDeIntegracao(
            "CardápioWeb (token do webhook)",
            "—",
            "chegou um aviso de pedido com X-Webhook-Token que não confere com CARDAPIOWEB_WEBHOOK_TOKEN/CARDAPIOWEB_SANDBOX_WEBHOOK_TOKEN. Se for o CardápioWeb, o token mudou: confira no Coolify. O polling de 30 s segue trazendo os pedidos.",
          ),
        )
        .catch(() => {});
      return responder({ ignorado: "token" });
    }

    const cru = await req.text();
    let corpo: any = null;
    try {
      corpo = JSON.parse(cru);
    } catch {
      console.warn("[CardápioWeb] ⚠️ webhook com corpo que não é JSON — ignorado");
      return responder({ ignorado: "corpo" });
    }

    const evento: EventoCW = {
      ambiente,
      eventId: texto(corpo?.event_id) || null,
      merchantId: texto(corpo?.merchant_id),
      orderId: texto(corpo?.order_id),
      eventType: texto(corpo?.event_type) || null,
      orderStatus: texto(corpo?.order_status) || null,
    };
    if (!evento.merchantId || !evento.orderId) {
      console.warn(`[CardápioWeb] ⚠️ webhook sem merchant_id/order_id (${evento.eventType}) — ignorado`);
      return responder({ ignorado: "sem ids" });
    }

    const registro = evento.eventId
      ? await comTeto(registrarEventoDoWebhook({ ...evento, eventId: evento.eventId }), 2_500, "sem-registro" as const)
      : ("sem-registro" as const);
    if (registro === "repetido") return responder({ repetido: true });

    depoisDaResposta(async () => {
      const r = await processarEventoCardapioWeb(evento, "webhook").catch((e: any) => ({ concluido: false, acao: "erro", mensagem: String(e?.message || e) }));
      console.log(`[CardápioWeb] webhook ${evento.eventType} ${evento.merchantId}/${evento.orderId} (${evento.orderStatus}): ${r.acao}${r.mensagem ? ` — ${r.mensagem}` : ""}`);
      if (evento.eventId) await marcarEvento(evento.eventId, r.concluido, r.acao + (r.mensagem ? ` — ${r.mensagem}` : ""));
    });
    return responder();
  } catch (e: any) {
    console.error("[CardápioWeb] ❌ webhook:", e?.message);
    return responder({ ignorado: "erro" });
  }
}
