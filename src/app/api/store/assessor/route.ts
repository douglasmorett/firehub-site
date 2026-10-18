import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { estadoDoAssessor, ligarOuDesligarAssessor, DIAS_DE_TESTE_DO_ASSESSOR, TermoNaoAceitoError } from "@/lib/assessor/assinatura";
import { garantirEstruturaDoAssessor } from "@/lib/assessor/estrutura-no-banco";
import { numerosDoDono } from "@/lib/numeros-do-dono";

/**
 * GET  — o estado do Bill, os números que falam com ele e os últimos lançamentos.
 * POST { ligar: true, aceite: { versao } } — liga, com o termo aceito (lib/assessor/termo.ts).
 * POST { ligar: false } — desliga; o mês seguinte não é cobrado.
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
    estado: { ativo: estado.ativo, cobradoEsteMes: estado.cobradoEsteMes, testeAte: estado.testeAte, emTeste: estado.emTeste, jaTestou: estado.jaTestou, isento: estado.isento },
    preco: estado.preco,
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

  // O aceite fica gravado com quem estava logado (o ADMIN que entrou na loja
  // aparece com o e-mail dele), o IP e o navegador — a prova do "concordo".
  let aceite = null;
  if (corpo.ligar) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = corpo?.aceite?.versao
      ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
      : null;
  }
  try {
    const estado = await ligarOuDesligarAssessor(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json({ ok: true, estado: { ativo: estado.ativo, cobradoEsteMes: estado.cobradoEsteMes, testeAte: estado.testeAte, emTeste: estado.emTeste, jaTestou: estado.jaTestou, isento: estado.isento } });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
