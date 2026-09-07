/**
 * /api/ifood/homologacao/polling
 *
 * Cenário 1 de Logistics: a tela precisa MOSTRAR o polling acontecendo — a URL
 * com `excludeHeartbeat`, o header `x-polling-merchants` e o acknowledgment 200
 * imediato de cada evento. O backend de produção (src/lib/ifood-eventos.ts) faz
 * isso o dia inteiro, mas o vídeo de homologação exige front-end funcional;
 * esta rota executa UMA rodada por tick da tela e devolve cada detalhe para
 * exibição.
 *
 * O ack é imediato e incondicional, como manda o critério. Os eventos NÃO são
 * processados como pedido aqui — quem cria pedido é o fluxo de produção
 * (webhook e cron); esta rota é a vitrine do mecanismo, amarrada à loja de
 * teste pelo app de homologação (`?distribuido=1` trava a cascata de tokens,
 * igual às outras abas).
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { chamarComContexto } from "@/lib/ifood-http";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const caminho = "/events/v1.0/events:polling?excludeHeartbeat=true";
    const headerMerchants = ctx.merchantId || "";

    const r = await chamarComContexto(ctx, caminho, {
      headers: headerMerchants ? { "x-polling-merchants": headerMerchants } : {},
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: "O polling do iFood não respondeu.", ifood: { status: r.status, origem: r.origem } },
        { status: r.status === 0 ? 502 : r.status },
      );
    }

    // 204 é rodada legítima sem eventos (heartbeats já excluídos pela query).
    const eventos: any[] = Array.isArray(r.data) ? r.data : [];

    let ack: { status: number; enviados: number } | null = null;
    if (eventos.length > 0) {
      const corpo = eventos.filter((e) => e?.id).map((e) => ({ id: e.id }));
      const ra = await chamarComContexto(ctx, "/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        idempotente: true,
      });
      ack = { status: ra.status, enviados: corpo.length };
    }

    return NextResponse.json({
      ok: true,
      polling: {
        endpoint: `GET ${caminho}`,
        headers: { "x-polling-merchants": headerMerchants },
        status: r.status,
        origem: r.origem,
        eventos: eventos.map((e) => ({
          id: e.id ?? null,
          codigo: e.fullCode || e.code || "?",
          orderId: e.orderId ?? null,
          criadoEm: e.createdAt ?? null,
        })),
      },
      ack,
    });
  });
}
