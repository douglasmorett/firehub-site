/**
 * GET /api/store/financeiro/periodo?de=AAAA-MM-DD&ate=AAAA-MM-DD
 *
 * Os dados do DRE para outro período (o botão de período da tela do
 * Financeiro). A primeira carga vem pronta da página; esta rota atende as
 * trocas. Mesma loja, mesma janela e mesma conta da página
 * (lib/financeiro/contexto.ts e lib/financeiro/periodo-do-financeiro.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import { dadosDoPeriodoDoFinanceiro } from "@/lib/financeiro/periodo-do-financeiro";
import { lerPeriodo } from "@/lib/financeiro/dre";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const { de, ate } = lerPeriodo(sp.get("de"), sp.get("ate"), ctx.hoje);
  try {
    const dados = await dadosDoPeriodoDoFinanceiro({ lojaId: ctx.donoId, tz: ctx.tz, hoje: ctx.hoje, de, ate, isenta: ctx.isenta });
    return NextResponse.json(dados);
  } catch (err: any) {
    console.error("[Financeiro] Erro ao montar o período:", err);
    return NextResponse.json({ error: "Não foi possível carregar o período. Tente de novo." }, { status: 500 });
  }
}
