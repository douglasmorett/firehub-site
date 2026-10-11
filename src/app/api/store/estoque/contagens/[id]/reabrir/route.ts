/**
 * POST /api/store/estoque/contagens/[id]/reabrir — volta a ÚLTIMA contagem
 * fechada para "contando", desfazendo os ajustes de saldo dela. Reabrir muda o
 * CMV daquele dia, então só quem vê dados sensíveis reabre.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { ContagemRecusadaError, reabrirContagem } from "@/lib/cmv/contagem-no-banco";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await exigirDadosSensiveis();
    if (!r.ok) return r.resposta;
    const { id } = await params;
    await reabrirContagem({ lojaId: r.acesso.lojaId, contagemId: id });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof ContagemRecusadaError || e?.name === "ContagemRecusadaError") return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[Contagem reabrir]", e);
    return NextResponse.json({ error: e?.message || "Erro interno" }, { status: 500 });
  }
}
