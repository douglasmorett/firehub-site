/**
 * O módulo Caixa de mercado (lib/caixa-mercado).
 * GET  — estado, computadores registrados, config e os números da mensalidade.
 * POST { ligar, aceite: { versao } } — ativa (com o termo) ou desativa. Só o dono.
 * PUT  { config } — etiqueta da balança, margem padrão, NFC-e por padrão. Só o dono.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { quemUsaOCaixa } from "@/lib/caixa-mercado/sessao";
import {
  DIAS_DE_TESTE_DO_CAIXA, TermoNaoAceitoError, estadoDoCaixa, ligarOuDesligarCaixa, lerConfigDoCaixa, salvarConfigDoCaixa,
} from "@/lib/caixa-mercado/assinatura";
import { terminaisDaLoja } from "@/lib/caixa-mercado/terminal";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

export const dynamic = "force-dynamic";

export async function GET() {
  const quem = await quemUsaOCaixa("/store/caixa-mercado");
  if (!quem) return NextResponse.json({ error: "Seu acesso não abre o Caixa de mercado. Peça ao dono da loja." }, { status: 403 });
  const estado = await estadoDoCaixa(quem.lojaId);
  return NextResponse.json({
    estado,
    podeContratar: quem.dono,
    diasDeTeste: DIAS_DE_TESTE_DO_CAIXA,
    terminais: await terminaisDaLoja(quem.lojaId),
    mensalidade: { percentual: FIREHUB_PLAN.PERCENT_RATE, minimo: FIREHUB_PLAN.MIN_MONTHLY, teto: FIREHUB_PLAN.MAX_MONTHLY },
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja ativa ou desativa o Caixa de mercado." }, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });
  let aceite = null;
  if (corpo.ligar && corpo?.aceite?.versao) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null };
  }
  try {
    return NextResponse.json({ ok: true, estado: await ligarOuDesligarCaixa(s.franchiseeId, corpo.ligar, aceite) });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja muda a configuração do caixa." }, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));
  try {
    const config = lerConfigDoCaixa(corpo?.config);
    await salvarConfigDoCaixa(s.franchiseeId, config);
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
