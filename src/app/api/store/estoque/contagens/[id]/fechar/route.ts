/**
 * POST /api/store/estoque/contagens/[id]/fechar — fecha a contagem: congela
 * quantidade e custo de cada insumo e ajusta o saldo do que foi contado
 * (lib/cmv/contagem-no-banco.ts). A partir daqui ela entra no CMV real.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { ContagemRecusadaError, fecharContagemNoBanco } from "@/lib/cmv/contagem-no-banco";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await exigirEstoque();
    if (!r.ok) return r.resposta;
    const { id } = await params;
    const { fechamento, dia } = await fecharContagemNoBanco({ lojaId: r.acesso.lojaId, usuarioId: r.acesso.usuarioId, contagemId: id, tz: r.acesso.tz });
    const sensivel = r.acesso.veDadosSensiveis;
    return NextResponse.json({
      success: true,
      dia,
      contados: fechamento.contados,
      carregados: fechamento.carregados,
      peloSistema: fechamento.peloSistema,
      valorTotal: sensivel ? fechamento.valorTotal : null,
      semCusto: fechamento.semCusto,
    });
  } catch (e: any) {
    if (e instanceof ContagemRecusadaError || e?.name === "ContagemRecusadaError") return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[Contagem fechar]", e);
    return NextResponse.json({ error: e?.message || "Erro interno" }, { status: 500 });
  }
}
