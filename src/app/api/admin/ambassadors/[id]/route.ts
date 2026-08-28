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

    // Os dois percentuais somados saem da mensalidade da loja. O painel é o
    // único lugar onde eles mudam, então a validação mora aqui.
    for (const campo of ["commissionPercent", "level2Percent"] as const) {
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

    if (body.parentAmbassadorId !== undefined) {
      const paiId = body.parentAmbassadorId || null;

      // Sem laço. Um embaixador apontando para si mesmo (ou A→B→A) faria o
      // billing pagar duas vezes para a mesma carteira no mesmo boleto.
      if (paiId === id) {
        return NextResponse.json(
          { error: "Um embaixador não pode ser indicado por ele mesmo." },
          { status: 400 }
        );
      }
      if (paiId) {
        const pai = await prisma.ambassador.findUnique({
          where: { id: paiId },
          select: { id: true, parentAmbassadorId: true },
        });
        if (!pai) {
          return NextResponse.json({ error: "Embaixador indicador não encontrado." }, { status: 400 });
        }
        if (pai.parentAmbassadorId === id) {
          return NextResponse.json(
            { error: "Esses dois já estão ligados na outra direção — isso criaria um ciclo." },
            { status: 400 }
          );
        }
      }
      data.parentAmbassadorId = paiId;
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
