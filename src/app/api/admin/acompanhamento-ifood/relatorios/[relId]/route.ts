import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDaSessao, estruturaPronta, SELECT_DO_RELATORIO } from "@/lib/acompanhamento-ifood/servidor";

type Ctx = { params: Promise<{ relId: string }> };

/** PATCH: marca como enviado ao cliente (ou volta a rascunho). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { relId } = await params;
  const b = await req.json().catch(() => ({}));
  if (b.status !== "ENVIADO" && b.status !== "RASCUNHO") return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
  try {
    const relatorio = await prisma.acompanhamentoRelatorio.update({
      where: { id: relId },
      data: { status: b.status, enviadoEm: b.status === "ENVIADO" ? new Date() : null },
      select: SELECT_DO_RELATORIO,
    });
    return NextResponse.json({ relatorio });
  } catch {
    return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { relId } = await params;
  try {
    await prisma.acompanhamentoRelatorio.delete({ where: { id: relId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  }
}
