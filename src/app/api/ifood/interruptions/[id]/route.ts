/**
 * /api/ifood/interruptions/[id]
 * Remove a pausa. O critério de aprovação é responder 204 sem conteúdo — e a
 * pausa não aparecer mais na listagem seguinte.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { mensagemDeErro } from "@/lib/ifood-http";
import { removerInterrupcao } from "@/lib/ifood-interrupcoes";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return comContextoIfood(req, async ({ ctx }) => {
    const r = await removerInterrupcao(ctx, id);

    // 204 não tem corpo, e `ok` já cobre a faixa 2xx.
    if (!r.ok) {
      return NextResponse.json(
        { error: mensagemDeErro(r), ifood: { status: r.status, origem: r.origem } },
        { status: r.status === 0 ? 502 : r.status },
      );
    }

    return NextResponse.json({
      success: true,
      removed: id,
      ifood: { status: r.status, origem: r.origem, esperado: 204 },
    });
  });
}
