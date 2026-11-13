/**
 * /api/store/estoque/visao-geral — a primeira aba do Estoque: valor em
 * estoque, CMV real e perdas da última semana do CMV (só dados sensíveis),
 * abaixo do mínimo, lotes vencendo, as 8 semanas, onde está o dinheiro e o
 * que fazer hoje. A conta é de lib/estoque/analise-no-banco.ts.
 */
import { NextResponse } from "next/server";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { visaoGeral } from "@/lib/estoque/analise-no-banco";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, nomeDaLoja, goals, veDadosSensiveis } = r.acesso;
  try {
    return NextResponse.json(await visaoGeral({ lojaId, tz, nomeDaLoja, goals, veValor: veDadosSensiveis }));
  } catch (err: any) {
    console.error("[Estoque] visão geral falhou:", err?.message || err);
    return NextResponse.json({ error: "Não deu para montar a visão geral agora." }, { status: 500 });
  }
}
