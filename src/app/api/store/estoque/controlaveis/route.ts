/**
 * /api/store/estoque/controlaveis — o Relatório dos controláveis (Estoque).
 *
 *   GET ?de=AAAA-MM-DD&ate=AAAA-MM-DD  as oito seções (desperdício completo e
 *       incompleto, segurança alimentar, condimentos, refeição da equipe,
 *       diferença de inventário, rendimento, indiretos), o resumo em R$ e % da
 *       venda, a comparação com o período anterior e os avisos.
 *
 * Só quem vê dados sensíveis (lib/cmv/acesso.ts): é custo em R$. A conta é de
 * lib/cmv/controlaveis.ts; a busca, de lib/cmv/controlaveis-no-banco.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { montarControlaveis } from "@/lib/cmv/controlaveis-no-banco";
import { inicioDaSemanaDoCmv, lerSemanaDoCmv } from "@/lib/cmv/semana-do-cmv";
import { hojeNaLoja, somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, nomeDaLoja, goals } = r.acesso;

  const hoje = hojeNaLoja(tz);
  const semana = lerSemanaDoCmv(goals);
  // Sem período: a última semana do CMV inteira (a que já fechou).
  const estaSemana = inicioDaSemanaDoCmv(hoje, semana.comecaEm);
  const sp = req.nextUrl.searchParams;
  let de = DIA_RE.test(sp.get("de") || "") ? sp.get("de")! : somarDias(estaSemana, -7);
  let ate = DIA_RE.test(sp.get("ate") || "") ? sp.get("ate")! : somarDias(estaSemana, -1);
  if (de > ate) [de, ate] = [ate, de];
  if (somarDias(de, 370) < ate) de = somarDias(ate, -370);

  try {
    const relatorio = await montarControlaveis({ lojaId, nomeDaLoja, tz, de, ate });
    return NextResponse.json({ hoje, semana, relatorio });
  } catch (err: any) {
    console.error("[Controláveis] Falha ao montar:", err?.message || err);
    return NextResponse.json({ error: "Não deu para montar o relatório agora. Tente de novo." }, { status: 500 });
  }
}
