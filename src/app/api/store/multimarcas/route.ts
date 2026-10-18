import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { DIAS_DE_TESTE_DO_MULTIMARCAS, TermoNaoAceitoError, estadoDoMultimarcas, ligarOuDesligarMultimarcas } from "@/lib/multimarcas/assinatura";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

/**
 * GET  — o estado do Multimarcas e os números da mensalidade (para a tela
 *        explicar que os R$ 97 são à parte).
 * POST { ligar: true, aceite: { versao } } — ativa, com o termo aceito (lib/multimarcas/termo.ts).
 * POST { ligar: false } — desativa; o mês seguinte não é cobrado.
 * Só o dono (ou o ADMIN dentro da loja): a mesma porta do Bill.
 */
const publico = (e: Awaited<ReturnType<typeof estadoDoMultimarcas>>) => ({
  ativo: e.ativo, cobradoEsteMes: e.cobradoEsteMes, testeAte: e.testeAte, emTeste: e.emTeste, jaTestou: e.jaTestou, isento: e.isento,
});

export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja contrata o Multimarcas." }, { status: 403 });
  const estado = await estadoDoMultimarcas(s.franchiseeId);
  return NextResponse.json({
    estado: publico(estado),
    preco: estado.preco,
    diasDeTeste: DIAS_DE_TESTE_DO_MULTIMARCAS,
    mensalidade: {
      percentual: FIREHUB_PLAN.PERCENT_RATE,
      minimo: FIREHUB_PLAN.MIN_MONTHLY,
      teto: FIREHUB_PLAN.MAX_MONTHLY,
      lojaExtraMarketplace: FIREHUB_PLAN.EXTRA_STORE_FEE,
    },
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja ativa ou desativa o Multimarcas." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });

  // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
  let aceite = null;
  if (corpo.ligar) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = corpo?.aceite?.versao
      ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
      : null;
  }
  try {
    const estado = await ligarOuDesligarMultimarcas(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json({ ok: true, estado: publico(estado) });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
