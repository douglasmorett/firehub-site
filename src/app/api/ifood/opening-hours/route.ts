/**
 * /api/ifood/opening-hours
 * Cenário 3 — os turnos de funcionamento.
 *
 * O iFood não trabalha com "das 10 às 19": trabalha com início e DURAÇÃO em
 * minutos. Sábado das 10:00 às 19:00 é `{ start: "10:00", duration: 540 }`.
 * Turnos sobrepostos voltam como 400, e isso também é testado.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { chamarComContexto, mensagemDeErro } from "@/lib/ifood-http";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const r = await chamarComContexto(ctx, `/merchant/v1.0/merchants/${ctx.merchantId}/opening-hours`);
    return NextResponse.json({
      merchantId: ctx.merchantId,
      openingHours: r.data ?? null,
      ifood: { status: r.status, ok: r.ok, origem: r.origem },
      ...(r.ok ? {} : { error: mensagemDeErro(r) }),
    });
  });
}

export async function PUT(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    // A API aceita tanto o array de turnos quanto o objeto que os embrulha.
    const payload = Array.isArray(corpo) ? corpo : (corpo?.shifts ?? corpo);

    const r = await chamarComContexto(ctx, `/merchant/v1.0/merchants/${ctx.merchantId}/opening-hours`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      return NextResponse.json(
        {
          error: r.status === 400
            ? "O iFood recusou os horários. Confira se não há turnos sobrepostos no mesmo dia."
            : mensagemDeErro(r),
          ifood: { status: r.status, origem: r.origem },
          details: r.data ?? r.texto?.slice(0, 300),
        },
        { status: r.status === 0 ? 502 : r.status },
      );
    }

    return NextResponse.json({
      success: true,
      result: r.data,
      ifood: { status: r.status, origem: r.origem, esperado: 201 },
    });
  });
}
