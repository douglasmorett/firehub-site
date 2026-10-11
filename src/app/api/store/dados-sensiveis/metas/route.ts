/**
 * PUT /api/store/dados-sensiveis/metas  { cmvPct?, cmoPct?, semanaDoCmv?: { diaDaContagem: 0-6, momento } }
 *
 * As metas que pintam o ponteiro (verde até a meta, amarelo até +3 pontos,
 * vermelho acima). Gravadas em `User.financialGoals`, MESCLANDO com o que já
 * existe lá (faturamento, comissão dos apps): substituir o JSON inteiro
 * apagaria as metas das outras telas.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const body = await req.json().catch(() => ({}));

  const novo: Record<string, number> = {};
  for (const chave of ["cmvPct", "cmoPct"] as const) {
    if (body?.[chave] === undefined) continue;
    const n = Number(String(body[chave]).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n >= 100) return NextResponse.json({ error: "A meta deve ficar entre 1% e 99%." }, { status: 400 });
    novo[chave] = Math.round(n * 10) / 10;
  }
  // Dia da contagem completa: a semana do CMV segue ele (lib/cmv/semana-do-cmv.ts).
  let semana: { diaDaContagem: number; momento: string } | null = null;
  if (body?.semanaDoCmv !== undefined) {
    const dia = Number(body.semanaDoCmv?.diaDaContagem);
    const momento = body.semanaDoCmv?.momento === "ANTES_DE_ABRIR" ? "ANTES_DE_ABRIR" : "DEPOIS_DE_FECHAR";
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) return NextResponse.json({ error: "Escolha o dia da contagem completa." }, { status: 400 });
    semana = { diaDaContagem: dia, momento };
  }
  if (!Object.keys(novo).length && !semana) return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });

  const loja = await prisma.user.findUnique({ where: { id: r.acesso.lojaId }, select: { financialGoals: true } });
  const atual = loja?.financialGoals && typeof loja.financialGoals === "object" && !Array.isArray(loja.financialGoals) ? (loja.financialGoals as Record<string, unknown>) : {};
  const gravado = { ...atual, ...novo, ...(semana ? { semanaDoCmv: semana } : {}) };
  await prisma.user.update({ where: { id: r.acesso.lojaId }, data: { financialGoals: gravado } });
  return NextResponse.json({ success: true, metas: gravado });
}
