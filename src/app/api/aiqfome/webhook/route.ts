import { NextRequest, NextResponse, after } from "next/server";
import { aiqfomeConfigurada, webhookAutentico } from "@/lib/aiqfome/api";
import { idDoEvento, marcarEvento, processarEventoAiqfome, registrarEventoDoWebhook, type EventoAQ } from "@/lib/aiqfome/eventos";

/**
 * POST /api/aiqfome/webhook — o aiqfome avisa: pedido novo, lido, pronto ou cancelado.
 *
 * É a url que o FireHub cadastra em cada loja ao conectar (POST
 * /store/{store_id}/webhooks), com o `secret_key` = AIQFOME_WEBHOOK_SECRET,
 * que volta no header `Authorization`. O corpo é
 * `{ event, store_id, data: { order_id, ... } }` — só ids.
 *
 * ── 200 SEMPRE, e rápido ────────────────────────────────────────────────────
 *
 * A doc não diz como o aiqfome trata falha nem se tenta de novo. Então nada
 * aqui devolve erro: segredo errado, loja desconhecida, banco fora — tudo é
 * 200, com log e aviso. A rede de verdade é o polling de 30 s
 * (/api/cron/aiqfome-poll), que acha o que este aviso não trouxe.
 *
 * O trabalho (buscar o pedido, gravar, imprimir, aceitar) roda DEPOIS da
 * resposta, no `after()` do Next. Antes só o registro do aviso, com teto de
 * tempo: é o caminho de volta para o reprocesso se o servidor cair no meio.
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
    void tarefa().catch((e) => console.error("[aiqfome] ❌ aviso em segundo plano:", e?.message));
  }
}

function comTeto<T>(promessa: Promise<T>, ms: number, seEstourar: T): Promise<T> {
  return Promise.race([promessa, new Promise<T>((r) => setTimeout(() => r(seEstourar), ms))]);
}

let ultimoAlertaDeSegredo = 0;

export async function POST(req: NextRequest) {
  try {
    if (!aiqfomeConfigurada()) return responder({ ignorado: "desligado" });

    if (!webhookAutentico(req.headers.get("authorization"))) {
      console.warn("[aiqfome] ⚠️ webhook sem o secret_key certo no Authorization — ignorado");
      if (Date.now() - ultimoAlertaDeSegredo > 60 * 60_000) {
        ultimoAlertaDeSegredo = Date.now();
        import("@/lib/server-monitor")
          .then((m) =>
            m.alertarFalhaDeIntegracao(
              "aiqfome (segredo do webhook)",
              "—",
              "chegou um aviso de pedido sem o secret_key de AIQFOME_WEBHOOK_SECRET no header Authorization. Se for o aiqfome, o segredo mudou ou vem em outro header: confira no Coolify e no payload cru. O polling de 30 s segue trazendo os pedidos.",
            ),
          )
          .catch(() => {});
      }
      return responder({ ignorado: "segredo" });
    }

    let corpo: any = null;
    try {
      corpo = JSON.parse(await req.text());
    } catch {
      console.warn("[aiqfome] ⚠️ webhook com corpo que não é JSON — ignorado");
      return responder({ ignorado: "corpo" });
    }

    const dados = corpo?.data && typeof corpo.data === "object" ? corpo.data : {};
    const evento: EventoAQ = {
      storeId: texto(corpo?.store_id ?? dados.store_id),
      orderId: texto(dados.order_id),
      evento: texto(corpo?.event),
      motivo: texto(dados.reason) || null,
    };
    if (!evento.storeId || !evento.orderId) {
      console.warn(`[aiqfome] ⚠️ webhook sem store_id/order_id (${evento.evento}) — ignorado`);
      return responder({ ignorado: "sem ids" });
    }

    const eventId = idDoEvento(corpo);
    const registro = await comTeto(registrarEventoDoWebhook({ ...evento, eventId }), 2_500, "sem-registro" as const);
    if (registro === "repetido") return responder({ repetido: true });

    depoisDaResposta(async () => {
      const r = await processarEventoAiqfome(evento, "webhook").catch((e: any) => ({ concluido: false, acao: "erro", mensagem: String(e?.message || e) }));
      console.log(`[aiqfome] webhook ${evento.evento} ${evento.storeId}/${evento.orderId}: ${r.acao}${r.mensagem ? ` — ${r.mensagem}` : ""}`);
      await marcarEvento(eventId, r.concluido, r.acao + (r.mensagem ? ` — ${r.mensagem}` : ""));
    });
    return responder();
  } catch (e: any) {
    console.error("[aiqfome] ❌ webhook:", e?.message);
    return responder({ ignorado: "erro" });
  }
}
