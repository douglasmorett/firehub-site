/**
 * GET /api/billing/cycle
 * O ciclo de faturamento atual da LOJA (não de quem está logado), as faturas
 * fechadas que ainda estão em aberto e — com `?pedidos=1` — os pedidos que
 * formam a base da mensalidade do mês (a janela "Detalhes da Cobrança").
 *
 * Usava o id da SESSÃO: o funcionário com acesso ao Financeiro via a
 * mensalidade calculada sobre a conta dele, que não vende nada (auditoria de
 * 11/10/2026). A loja sai de lib/financeiro/contexto.ts, a mesma da página.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentCycleView, pedidosDoCicloAtual } from "@/lib/billing";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  const lojaId = r.valor.donoId;

  if (req.nextUrl.searchParams.get("pedidos") === "1") {
    return NextResponse.json(await pedidosDoCicloAtual(lojaId));
  }
  return NextResponse.json(await getCurrentCycleView(lojaId));
}
