import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espelharVendedorDaLoja } from "@/lib/crm/contatos";

/**
 * PUT { vendedorId | null }: põe a loja na carteira de um vendedor (ou tira).
 *
 * Toda atribuição NOVA nasce "AGUARDANDO": é o que faz a loja aparecer no
 * topo da carteira do vendedor como cliente para contatar. Reenviar o mesmo
 * vendedor não zera o atendimento que ele já marcou.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const vendedorId = body.vendedorId ? String(body.vendedorId) : null;

  const loja = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, vendedorId: true } });
  if (!loja || loja.role !== "FRANCHISEE") return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  if (vendedorId) {
    const vendedor = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { isVendedor: true, active: true } });
    if (!vendedor?.isVendedor || !vendedor.active) {
      return NextResponse.json({ error: "Vendedor não encontrado ou inativo." }, { status: 400 });
    }
  }

  if (loja.vendedorId === vendedorId) return NextResponse.json({ ok: true, semMudanca: true });

  const agora = new Date();
  const atualizado = await prisma.user.update({
    where: { id },
    data: vendedorId
      ? { vendedorId, vendedorStatus: "AGUARDANDO", vendedorAtribuidoEm: agora, vendedorAtendidoEm: null }
      : { vendedorId: null, vendedorStatus: null, vendedorAtribuidoEm: null, vendedorAtendidoEm: null },
    select: { vendedorId: true, vendedorStatus: true, vendedorAtribuidoEm: true },
  });
  // O contato desta loja no CRM acompanha a carteira (lib/crm/contatos.ts).
  await espelharVendedorDaLoja(id, vendedorId);
  return NextResponse.json({ ok: true, ...atualizado });
}
