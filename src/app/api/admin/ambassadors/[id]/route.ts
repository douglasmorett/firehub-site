import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH: Atualiza um embaixador
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Lista fechada do que o painel pode alterar. Antes o `data` do corpo ia
    // cru para o `update`: um POST à mão trocaria `password` (que é hash) ou
    // `linkedUserId` por qualquer coisa.
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = String(body.email).toLowerCase().trim();
    if (body.phone !== undefined) data.phone = body.phone || null;
    if (body.pixKey !== undefined) data.pixKey = body.pixKey || null;
    if (body.asaasWalletId !== undefined) data.asaasWalletId = body.asaasWalletId || null;
    if (body.active !== undefined) data.active = !!body.active;
    if (body.code) data.code = String(body.code).toLowerCase().trim();

    // O percentual sai da mensalidade da loja. O painel é o único lugar onde
    // ele muda, então a validação mora aqui. (O nível 2 — `level2Percent` e
    // `parentAmbassadorId` — acabou em 15/10/2026 e não se edita mais.)
    for (const campo of ["commissionPercent"] as const) {
      if (body[campo] === undefined || body[campo] === null || body[campo] === "") continue;
      const valor = parseFloat(String(body[campo]));
      if (!Number.isFinite(valor) || valor < 0 || valor > 40) {
        return NextResponse.json(
          { error: `Percentual inválido em ${campo}: use um número entre 0 e 40.` },
          { status: 400 }
        );
      }
      data[campo] = valor;
    }

    const ambassador = await prisma.ambassador.update({
      where: { id },
      data,
    });

    return NextResponse.json(ambassador);
  } catch (error: any) {
    console.error("[Ambassadors API] PATCH error:", error);
    return NextResponse.json({ error: "Erro ao atualizar embaixador" }, { status: 500 });
  }
}

// DELETE: Remove um embaixador
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const resolvedParams = await params;
    await prisma.ambassador.delete({
      where: { id: resolvedParams.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Ambassadors API] DELETE error:", error);
    return NextResponse.json({ error: "Erro ao excluir embaixador" }, { status: 500 });
  }
}
