import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lerPeriodoDoResumo } from "@/lib/assessor/painel";
import { resumoDoBill } from "@/lib/assessor/painel-servidor";

/**
 * GET ?periodo=hoje|7d|mes — a Visão geral da tela /store/bill: o que o Bill
 * lançou no período (dia de operação da loja, vira às 5h), o que ele pausou e
 * segue pausado e os últimos lançamentos. Só o dono (ou o ADMIN na loja ativa).
 */
export async function GET(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja abre o Bill." }, { status: 403 });
  const periodo = lerPeriodoDoResumo(new URL(req.url).searchParams.get("periodo"));
  try {
    return NextResponse.json(await resumoDoBill(s.franchiseeId, s.loja.storeTimezone, periodo));
  } catch (err: any) {
    console.error("[Bill] resumo falhou:", err?.message);
    return NextResponse.json({ error: "Não consegui montar o resumo agora." }, { status: 500 });
  }
}
