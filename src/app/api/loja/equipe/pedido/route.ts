/**
 * POST /api/loja/equipe/pedido — o lanche do motoboy pela tela do QR da parede
 * (app/loja/[slug]/equipe). Sessão assinada do motoboy (lib/motoboy-sessao.ts).
 *
 * Corpo: { itens: [{ menuProductId, quantity, comboSelections, notes }], levar, observacao }
 * → { ok, numero, valor, coberto, excedente, restante }
 *
 * A conta (limite do dia, Promoção do Dia fora) é de
 * lib/lanche-da-equipe.ts; nada de preço vem do corpo.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirMotoboy } from "@/lib/motoboy-sessao";
import { pedirLanche } from "@/lib/lanche-da-equipe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const motoboy = await exigirMotoboy(req);
  if (!motoboy) return NextResponse.json({ error: "Sua sessão acabou. Entre de novo." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const r = await pedirLanche({
      lojaId: motoboy.franchiseeId,
      motoboy: { id: motoboy.id, name: motoboy.name },
      itens: Array.isArray(body?.itens) ? body.itens : [],
      levar: body?.levar === true,
      observacao: body?.observacao,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (err: any) {
    console.error("[Lanche] pedido falhou:", err?.message || err);
    return NextResponse.json({ error: "Não deu para enviar o lanche agora. Tente de novo." }, { status: 500 });
  }
}
