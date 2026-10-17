import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { PRECOS_DO_APP, registrarSolicitacao, solicitacaoDaLoja, type Plataformas } from "@/lib/app-da-loja/solicitacao";

/**
 * GET  — a loja (nome, logo, telefone para preencher o pedido), os preços e a
 *        solicitação em aberto.
 * POST { plataformas, nomeDoApp, contato, observacao } — pede o aplicativo (ou
 *        atualiza o pedido em aberto) e avisa o Douglas.
 *
 * Só o dono da loja (a mesma regra do Bill: lib/assessor/loja-da-sessao.ts).
 */
export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja pede o aplicativo." }, { status: 403 });
  const loja = await prisma.user.findUnique({
    where: { id: s.franchiseeId },
    select: { storeName: true, slug: true, storeLogo: true, storePhone: true, notificationPhone: true },
  });
  return NextResponse.json({
    loja: {
      nome: loja?.storeName || "Sua loja",
      slug: loja?.slug || null,
      logo: loja?.storeLogo || null,
      telefone: loja?.notificationPhone || loja?.storePhone || "",
    },
    precos: PRECOS_DO_APP,
    solicitacao: await solicitacaoDaLoja(s.franchiseeId),
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja pede o aplicativo." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const loja = await prisma.user.findUnique({ where: { id: s.franchiseeId }, select: { storeName: true, slug: true } });
  try {
    const solicitacao = await registrarSolicitacao(
      s.franchiseeId,
      { storeName: loja?.storeName ?? null, slug: loja?.slug ?? null },
      {
        plataformas: String(body.plataformas || "") as Plataformas,
        nomeDoApp: String(body.nomeDoApp || ""),
        contato: String(body.contato || ""),
        observacao: body.observacao ? String(body.observacao) : null,
      },
    );
    return NextResponse.json({ solicitacao });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu certo." }, { status: 400 });
  }
}
