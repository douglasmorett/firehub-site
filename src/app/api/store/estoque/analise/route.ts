/**
 * /api/store/estoque/analise — a análise da tabela de Insumos e o detalhe.
 *
 *   GET              cada insumo: consumo médio por dia (14 dias de saídas
 *                    reais), cobertura, última contagem, classe e curva ABC.
 *   GET ?insumo=id   o detalhe da gaveta: preço por compra (com a variação),
 *                    movimentações recentes, fichas e perdas de 30 dias.
 *
 * Quem tem "Estoque" vê; R$ (custo, preço) só quem vê dados sensíveis.
 * As contas são de lib/estoque/analise.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { analisarInsumos, detalharInsumo } from "@/lib/estoque/analise-no-banco";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, veDadosSensiveis } = r.acesso;
  try {
    const insumo = req.nextUrl.searchParams.get("insumo");
    if (insumo) {
      const detalhe = await detalharInsumo(lojaId, tz, insumo, veDadosSensiveis);
      if (!detalhe) return NextResponse.json({ error: "Insumo não encontrado." }, { status: 404 });
      return NextResponse.json({ veValor: veDadosSensiveis, detalhe });
    }
    return NextResponse.json({ veValor: veDadosSensiveis, ...(await analisarInsumos(lojaId, tz, veDadosSensiveis)) });
  } catch (err: any) {
    console.error("[Estoque] análise falhou:", err?.message || err);
    return NextResponse.json({ error: "Não deu para calcular agora." }, { status: 500 });
  }
}
