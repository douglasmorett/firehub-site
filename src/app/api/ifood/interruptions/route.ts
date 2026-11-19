/**
 * /api/ifood/interruptions
 * Cenário 2 — as pausas da loja.
 *
 * O status HTTP volta junto porque a homologação é avaliada por ele: criar uma
 * pausa tem que responder 201, e o analista precisa ver isso durante o vídeo.
 * Criar uma pausa em cima de outra tem que responder 409 InterruptionOverlap —
 * caso que eles testam de propósito.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { mensagemDeErro } from "@/lib/ifood-http";
import { criarInterrupcao, interrupcoesDaResposta, listarInterrupcoes } from "@/lib/ifood-interrupcoes";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const r = await listarInterrupcoes(ctx);

    if (!r.ok) {
      return NextResponse.json(
        { error: mensagemDeErro(r), ifood: { status: r.status, origem: r.origem } },
        { status: r.status === 0 ? 502 : r.status },
      );
    }

    const lista = interrupcoesDaResposta(r.data);
    // A tela antiga espera o array puro; o resto vem em campos extras que ela ignora.
    return NextResponse.json(lista);
  });
}

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const { description, start, end } = corpo ?? {};
    if (!start || !end) {
      return NextResponse.json({ error: "Informe o início e o fim da pausa." }, { status: 400 });
    }

    const r = await criarInterrupcao(ctx, { description, start, end });

    if (!r.ok) {
      return NextResponse.json(
        {
          error: r.status === 409
            ? "Já existe uma pausa nesse intervalo (InterruptionOverlap)."
            : mensagemDeErro(r),
          ifood: { status: r.status, origem: r.origem },
          details: r.data ?? r.texto?.slice(0, 300),
        },
        { status: r.status === 0 ? 502 : r.status },
      );
    }

    return NextResponse.json({
      success: true,
      interruption: r.data,
      ifood: { status: r.status, origem: r.origem, esperado: 201 },
    });
  });
}
