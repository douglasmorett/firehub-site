import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PUT { ambassadorId | null }: define (ou tira) o EMBAIXADOR da loja — quem
 * leva a comissão de embaixador dela (`User.ambassadorId`, o mesmo campo que o
 * link de indicação preenche no cadastro). Pedido do dono (27/09/2026): a loja
 * que chegou sem link, ou chegou pelo link errado, ganha o embaixador certo à
 * mão, ao lado do vendedor, na aba Lojistas.
 *
 * Não mexe no vendedor: são dois vínculos (lib/vendedores.ts). Se o embaixador
 * escolhido também for o vendedor da loja, ele deixa de levar os 3% nela —
 * `ganhaComoVendedor` resolve isso na hora de pagar.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ambassadorId = body.ambassadorId ? String(body.ambassadorId) : null;

  const loja = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, ambassadorId: true } });
  if (!loja || loja.role !== "FRANCHISEE") return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  if (ambassadorId) {
    const emb = await prisma.ambassador.findUnique({ where: { id: ambassadorId }, select: { active: true, linkedUserId: true } });
    if (!emb?.active) return NextResponse.json({ error: "Embaixador não encontrado ou inativo." }, { status: 400 });
    // A própria loja do embaixador não pode ser indicada por ele mesmo.
    if (emb.linkedUserId === id) return NextResponse.json({ error: "Esta é a loja do próprio embaixador." }, { status: 400 });
  }

  if (loja.ambassadorId === ambassadorId) return NextResponse.json({ ok: true, semMudanca: true });

  const atualizado = await prisma.user.update({
    where: { id },
    data: { ambassadorId },
    select: { ambassadorId: true },
  });
  return NextResponse.json({ ok: true, ...atualizado });
}
