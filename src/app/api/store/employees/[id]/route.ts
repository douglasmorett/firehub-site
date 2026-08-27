import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const { name, role, phone, cpf, creditLimit, active } = await req.json();

  // ── O FUNCIONÁRIO PRECISA SER DESTA LOJA ────────────────────────────────
  //
  // Só se conferia "existe sessão": qualquer lojista logado mandava o id de um
  // funcionário de OUTRA loja e editava/desativava o cadastro dele — ou, no
  // caso do fiado, lançava dívida e baixa em nome da loja alheia (dinheiro).
  const _usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!_usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const _lojaDaSessao = _usuario.ownerId || _usuario.id;

  const _funcionario = await prisma.storeEmployee.findUnique({
    where: { id: id },
    select: { franchiseeId: true },
  });
  if (!_funcionario) return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  if (_usuario.role !== "ADMIN" && _funcionario.franchiseeId !== _lojaDaSessao) {
    console.warn(`[employees] 🚫 ${_usuario.id} tentou acessar funcionário de outra loja (${_funcionario.franchiseeId}).`);
    return NextResponse.json({ error: "Este cadastro não é desta loja" }, { status: 403 });
  }

  const employee = await prisma.storeEmployee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }

  const updated = await prisma.storeEmployee.update({
    where: { id },
    data: {
      ...(name && { name: name.trim() }),
      ...(role !== undefined && { role: role?.trim() || null }),
      ...(phone !== undefined && { phone: phone?.trim() || null }),
      ...(cpf !== undefined && { cpf: cpf?.trim() || null }),
      ...(creditLimit !== undefined && {
        creditLimit: creditLimit ? parseFloat(String(creditLimit)) : null,
      }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  });

  return NextResponse.json({ success: true, employee: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  // ── O FUNCIONÁRIO PRECISA SER DESTA LOJA ────────────────────────────────
  //
  // Só se conferia "existe sessão": qualquer lojista logado mandava o id de um
  // funcionário de OUTRA loja e editava/desativava o cadastro dele — ou, no
  // caso do fiado, lançava dívida e baixa em nome da loja alheia (dinheiro).
  const _usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!_usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const _lojaDaSessao = _usuario.ownerId || _usuario.id;

  const _funcionario = await prisma.storeEmployee.findUnique({
    where: { id: id },
    select: { franchiseeId: true },
  });
  if (!_funcionario) return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  if (_usuario.role !== "ADMIN" && _funcionario.franchiseeId !== _lojaDaSessao) {
    console.warn(`[employees] 🚫 ${_usuario.id} tentou acessar funcionário de outra loja (${_funcionario.franchiseeId}).`);
    return NextResponse.json({ error: "Este cadastro não é desta loja" }, { status: 403 });
  }

  // Desativa o funcionário (soft delete para preservar histórico financeiro)
  const updated = await prisma.storeEmployee.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ success: true, employee: updated });
}
