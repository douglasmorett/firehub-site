import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { DIAS_DE_TESTE_DO_TABLET, TermoNaoAceitoError, estadoDoTablet, ligarOuDesligarTablet } from "@/lib/tablet-da-mesa/assinatura";
import { apagarTablet, novoCodigoDePareamento, tabletsDaLoja, trocarMesaDoTablet } from "@/lib/tablet-da-mesa/tablets";

/**
 * O módulo Tablet na mesa no painel (lib/tablet-da-mesa).
 *
 * GET    — estado do módulo, os tablets e as mesas.
 * POST   { ligar: boolean, aceite?: { versao } }  — liga (com o termo) ou desliga.
 * POST   { acao: "parear", tableId }              — número de 6 dígitos para um tablet novo.
 * PATCH  { tabletId, tableId }                    — muda o tablet de mesa.
 * DELETE { tabletId }                             — tira o tablet (o cookie dele para de valer).
 *
 * Só o dono (ou o ADMIN dentro da loja): ligar cobra no boleto — a mesma porta do Bill.
 */
export const dynamic = "force-dynamic";

const SO_O_DONO = { error: "Só o dono da loja mexe no Tablet na mesa." };

async function tudo(lojaId: string) {
  const [estado, tablets, mesas] = await Promise.all([
    estadoDoTablet(lojaId),
    tabletsDaLoja(lojaId),
    prisma.table.findMany({
      where: { franchiseeId: lojaId },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      select: { id: true, number: true, label: true, isActive: true },
    }),
  ]);
  return { estado, tablets, mesas, diasDeTeste: DIAS_DE_TESTE_DO_TABLET };
}

export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  return NextResponse.json(await tudo(s.franchiseeId));
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));

  if (corpo?.acao === "parear") {
    const estado = await estadoDoTablet(s.franchiseeId);
    if (!estado.ativo) return NextResponse.json({ error: "Ligue o Tablet na mesa antes de parear um tablet." }, { status: 409 });
    const r = await novoCodigoDePareamento(s.franchiseeId, String(corpo.tableId || ""));
    if (!r) return NextResponse.json({ error: "Escolha uma mesa da loja." }, { status: 400 });
    return NextResponse.json({ codigo: r.codigo, ate: r.ate.toISOString() });
  }

  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });
  let aceite = null;
  if (corpo.ligar && corpo?.aceite?.versao) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null };
  }
  try {
    await ligarOuDesligarTablet(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json(await tudo(s.franchiseeId));
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));
  const ok = await trocarMesaDoTablet(s.franchiseeId, String(corpo.tabletId || ""), String(corpo.tableId || ""));
  if (!ok) return NextResponse.json({ error: "Não achei esse tablet ou essa mesa." }, { status: 404 });
  return NextResponse.json(await tudo(s.franchiseeId));
}

export async function DELETE(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));
  await apagarTablet(s.franchiseeId, String(corpo.tabletId || ""));
  return NextResponse.json(await tudo(s.franchiseeId));
}
