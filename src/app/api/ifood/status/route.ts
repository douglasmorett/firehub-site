/**
 * /api/ifood/status
 * O retrato da loja no iFood num pedido só: disponibilidade, horários e pausas.
 * Alimenta o indicador de aberto/fechado do topo da tela.
 *
 * `Promise.all` aqui é seguro porque `chamarComContexto` nunca lança — devolve
 * a falha dentro do objeto. Cada bloco é opcional: se a disponibilidade vier e
 * os horários não, ainda dá para mostrar o que veio.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { chamarComContexto } from "@/lib/ifood-http";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const m = ctx.merchantId;

    const [disponibilidade, horarios, pausas] = await Promise.all([
      chamarComContexto(ctx, `/merchant/v1.0/merchants/${m}/status`),
      chamarComContexto(ctx, `/merchant/v1.0/merchants/${m}/opening-hours`),
      chamarComContexto(ctx, `/merchant/v1.0/merchants/${m}/interruptions`),
    ]);

    return NextResponse.json({
      merchantId: m,
      loja: ctx.label ?? null,
      fetchedAt: new Date().toISOString(),
      status: disponibilidade.ok ? disponibilidade.data : null,
      openingHours: horarios.ok ? horarios.data : null,
      interruptions: pausas.ok ? pausas.data : null,
      ifood: {
        origem: disponibilidade.origem,
        status: disponibilidade.status,
        openingHours: horarios.status,
        interruptions: pausas.status,
      },
    });
  });
}
