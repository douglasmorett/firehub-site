import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const DEFAULT_STAFF_PERMISSIONS = [
  "dashboard",
  "orders",
  "kds",
  "venda_presencial",
  "cardapio",
  "estoque",
  "motoboys",
  "financeiro",
  "relatorios",
  "ifood",
  "impressoras",
  "minha_loja"
];

// GET: Lista todos os funcionários da equipe da loja do usuário logado
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const ownerId = (currentUser as any).ownerId || currentUser.id;

  // Busca apenas os funcionários cadastrados para a equipe desta loja
  const teamMembers = await prisma.user.findMany({
    where: {
      ownerId: ownerId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json(teamMembers);
}

// POST: Cadastra um novo funcionário para a equipe
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  // Apenas o dono ou admin pode criar membros de equipe
  if (currentUser.role !== "ADMIN" && currentUser.role !== "FRANCHISEE" && !currentUser.isFranqueadoHakim) {
    return NextResponse.json({ error: "Apenas o dono da loja pode cadastrar membros da equipe" }, { status: 403 });
  }

  try {
    const { name, email, password, permissions } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Nome, e-mail e senha são obrigatórios" }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Verifica se o e-mail já existe
    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    if (existing) {
      return NextResponse.json({ error: "Já existe uma conta cadastrada com este e-mail" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Por padrão, se não passarem permissões específicas, ativa TUDO (como o dono)
    const permsList = Array.isArray(permissions) && permissions.length > 0 
      ? permissions 
      : DEFAULT_STAFF_PERMISSIONS;

    const newStaff = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        password: hashedPassword,
        role: "STAFF",
        ownerId: currentUser.id,
        permissions: permsList.join(","),
        // Compartilha dados da loja do dono para o funcionário visualizar a mesma loja
        storeName: currentUser.storeName,
        ifoodMerchantId: currentUser.ifoodMerchantId,
        jotajaMerchantId: currentUser.jotajaMerchantId,
        city: currentUser.city,
        cpfCnpj: currentUser.cpfCnpj,
      } as any,
    });

    return NextResponse.json({
      success: true,
      member: {
        id: newStaff.id,
        name: newStaff.name,
        email: newStaff.email,
        role: newStaff.role,
        permissions: newStaff.permissions,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao cadastrar funcionário" }, { status: 500 });
  }
}

// PUT: Atualiza as permissões de um funcionário
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  try {
    const { id, permissions, password } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "ID do funcionário é obrigatório" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
    }

    // Garante que o dono só edite funcionários da sua própria loja
    if ((targetUser as any).ownerId !== currentUser.id && currentUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Sem permissão para alterar este funcionário" }, { status: 403 });
    }

    const updateData: any = {};
    if (Array.isArray(permissions)) {
      updateData.permissions = permissions.join(",");
    }

    if (password && password.trim().length >= 4) {
      updateData.password = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, permissions: true }
    });

    return NextResponse.json({ success: true, member: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao atualizar permissões" }, { status: 500 });
  }
}

// DELETE: Remove um funcionário da equipe
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID não fornecido" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }

  if ((targetUser as any).ownerId !== currentUser.id && currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão para remover este funcionário" }, { status: 403 });
  }

  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
