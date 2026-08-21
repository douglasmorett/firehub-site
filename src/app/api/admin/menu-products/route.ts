import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  const where = user.role === "ADMIN"
    ? {
        NOT: {
          category: { in: ["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE"] }
        }
      }
    : {
        franchiseeId: targetFranchiseeId,
        NOT: {
          category: { in: ["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE"] }
        }
      };

  const products = await prisma.menuProduct.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, price: true, category: true,
      imageUrl: true, active: true, isCombo: true, isBeverage: true,
      activePDV: true, activeDelivery: true, activeTotem: true, activeGarcom: true,
      cost: true, tags: true, availableDays: true, description: true,
      comboConfig: true,
      comboGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            include: {
              menuProduct: { select: { id: true, name: true, active: true, imageUrl: true } }
            }
          }
        }
      }
    },
  });

  return NextResponse.json(products);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const data = await req.json();
  const targetFranchiseeId = user.ownerId || user.id;
  const franchiseeId = user.role === "ADMIN" && data.franchiseeId ? data.franchiseeId : targetFranchiseeId;

  const { id, comboGroups, ...rest } = data;

  const product = await prisma.menuProduct.create({
    data: {
      ...rest,
      tags: rest.tags ? JSON.stringify(rest.tags) : null,
      availableDays: rest.availableDays ? JSON.stringify(rest.availableDays) : null,
      franchiseeId,
      comboGroups: comboGroups && Array.isArray(comboGroups) && comboGroups.length > 0 ? {
        create: comboGroups.map((g: any, gIdx: number) => ({
          title: g.title,
          maxQty: g.maxQty || 1,
          sortOrder: gIdx,
          items: {
            create: (g.items || []).map((it: any) => ({
              menuProductId: typeof it === "string" ? it : (it.id || it.menuProductId),
              additionalPrice: typeof it === "object" ? (Number(it.additionalPrice) || 0) : 0,
            }))
          }
        }))
      } : undefined
    }
  });

  return NextResponse.json(product);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const data = await req.json();
  const { id, comboGroups, ...updateData } = data;

  if (updateData.tags) {
    updateData.tags = JSON.stringify(updateData.tags);
  }
  if (updateData.availableDays !== undefined) {
    updateData.availableDays = updateData.availableDays ? JSON.stringify(updateData.availableDays) : null;
  }

  const product = await prisma.menuProduct.update({
    where: { id },
    data: updateData
  });

  if (comboGroups !== undefined) {
    await prisma.comboGroup.deleteMany({ where: { menuProductId: id } });
    if (Array.isArray(comboGroups) && comboGroups.length > 0) {
      for (let gIdx = 0; gIdx < comboGroups.length; gIdx++) {
        const g = comboGroups[gIdx];
        await prisma.comboGroup.create({
          data: {
            menuProductId: id,
            title: g.title,
            maxQty: g.maxQty || 1,
            sortOrder: gIdx,
            items: {
              create: (g.items || []).map((it: any) => ({
                menuProductId: typeof it === "string" ? it : (it.id || it.menuProductId),
                additionalPrice: typeof it === "object" ? (Number(it.additionalPrice) || 0) : 0,
              }))
            }
          }
        });
      }
    }
  }

  return NextResponse.json(product);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const data = await req.json();
  const productId = data.id;
  
  try {
    // 1. Remover o item de todos os combos em que ele estiver vinculado
    await prisma.comboGroupItem.deleteMany({
      where: { menuProductId: productId }
    });

    // 2. Excluir o produto do cardápio
    await prisma.menuProduct.delete({ where: { id: productId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    // Soft delete se falhar por restrição em histórico de pedidos anteriores
    await prisma.menuProduct.update({ where: { id: productId }, data: { active: false } });
    return NextResponse.json({ success: true, softDeleted: true });
  }
}
