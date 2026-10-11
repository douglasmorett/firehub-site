/**
 * GET /api/store/dados-sensiveis?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *
 * O painel de CMV real, CMO e custo primário (lib/cmv/painel.ts). Sem período,
 * a semana de hoje — a semana do CMV da loja, que segue o dia da contagem
 * completa (lib/cmv/semana-do-cmv.ts). Só para quem vê dados sensíveis
 * (lib/cmv/acesso.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { montarPainel } from "@/lib/cmv/painel";
import { inicioDaSemanaDoCmv, lerSemanaDoCmv } from "@/lib/cmv/semana-do-cmv";
import { diasNoPeriodo, hojeNaLoja, somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const r = await exigirDadosSensiveis();
    if (!r.ok) return r.resposta;
    const { lojaId, tz, nomeDaLoja, goals } = r.acesso;

    const hoje = hojeNaLoja(tz);
    const sp = req.nextUrl.searchParams;
    let de = sp.get("de") || "";
    let ate = sp.get("ate") || "";
    if (!DIA_RE.test(de) || !DIA_RE.test(ate) || de > ate) {
      de = inicioDaSemanaDoCmv(hoje, lerSemanaDoCmv(goals).comecaEm);
      ate = somarDias(de, 6);
    }
    if (diasNoPeriodo(de, ate) > 400) return NextResponse.json({ error: "Período maior que 400 dias." }, { status: 400 });

    const painel = await montarPainel({ lojaId, nomeDaLoja, tz, goals, hoje, de, ate });
    return NextResponse.json(painel);
  } catch (e: any) {
    console.error("[Dados sensíveis]", e);
    return NextResponse.json({ error: e?.message || "Erro interno" }, { status: 500 });
  }
}
