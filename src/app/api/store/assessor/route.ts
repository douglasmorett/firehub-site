import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { estadoDoAssessor, ligarOuDesligarAssessor, PRECO_DO_ASSESSOR, DIAS_DE_TESTE_DO_ASSESSOR } from "@/lib/assessor/assinatura";
import { garantirEstruturaDoAssessor } from "@/lib/assessor/estrutura-no-banco";
import { numerosDoDono } from "@/lib/numeros-do-dono";

/**
 * GET  — o estado do Bill, os números que falam com ele e os últimos lançamentos.
 * POST { ligar: boolean } — liga (7 dias grátis na primeira vez) ou desliga.
 */
export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja abre o Bill." }, { status: 403 });

  const estado = await estadoDoAssessor(s.franchiseeId);
  const registros = (await garantirEstruturaDoAssessor())
    ? await prisma.assessorRegistro.findMany({
        where: { franchiseeId: s.franchiseeId },
        orderBy: { criadoEm: "desc" },
        take: 40,
        select: { id: true, tipo: true, resumo: true, canal: true, desfeitoEm: true, criadoEm: true },
      })
    : [];
  const cfg = (s.loja.chatbotConfig || {}) as any;
  return NextResponse.json({
    estado,
    preco: PRECO_DO_ASSESSOR,
    diasDeTeste: DIAS_DE_TESTE_DO_ASSESSOR,
    numerosDoDono: numerosDoDono(s.loja.notificationPhone, cfg),
    numeroDoRobo: String(cfg?.phone || "").replace(/\D/g, "") || null,
    registros,
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja liga ou desliga o Bill." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });
  try {
    const estado = await ligarOuDesligarAssessor(s.franchiseeId, corpo.ligar);
    return NextResponse.json({ ok: true, estado });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
