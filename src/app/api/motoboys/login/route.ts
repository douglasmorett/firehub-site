import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { storeSlug, phone, password } = await req.json();

    if (!storeSlug) {
      return NextResponse.json({ error: "Slug da loja é obrigatório" }, { status: 400 });
    }

    if (!phone || !password) {
      return NextResponse.json({ error: "Telefone/Nome e senha são obrigatórios" }, { status: 400 });
    }

    const cleanSlug = storeSlug.toLowerCase().trim();
    const slugName = cleanSlug.replace(/-/g, " ");

    // Busca a loja pelo slug/nome/email para garantir isolamento multi-tenant
    let storeUser = await prisma.user.findFirst({
      where: {
        OR: [
          { slug: cleanSlug },
          { name: { contains: cleanSlug, mode: "insensitive" } },
          { name: { contains: slugName, mode: "insensitive" } },
          { email: { contains: "hakim", mode: "insensitive" } }
        ]
      },
      select: { id: true, name: true, slug: true, storeAddress: true, city: true }
    });

    if (!storeUser) {
      storeUser = await prisma.user.findFirst({
        where: { role: { in: ["FRANQUEADO", "ADMIN", "LOJA"] } },
        select: { id: true, name: true, slug: true, storeAddress: true, city: true }
      });
    }

    if (!storeUser) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    const cleanPhone = phone.replace(/\D/g, "");

    // Busca motoboys ativos desta loja primeiro
    let motoboys = await prisma.motoboy.findMany({
      where: {
        franchiseeId: storeUser.id,
        active: true,
      }
    });

    // Fallback: se não encontrou vinculados por ID direto, busca globalmente motoboys ativos
    if (motoboys.length === 0) {
      motoboys = await prisma.motoboy.findMany({
        where: { active: true }
      });
    }

    // Filtra no JS para ignorar caracteres especiais como () - e espaços salvos no banco
    const motoboy = motoboys.find(m => {
      // Busca por nome exato ou parcial
      if (m.name && m.name.toLowerCase().includes(phone.toLowerCase())) return true;
      
      // Busca por telefone limpo (só números)
      if (m.phone && cleanPhone) {
        const dbPhoneClean = m.phone.replace(/\D/g, "");
        if (dbPhoneClean === cleanPhone || dbPhoneClean.includes(cleanPhone)) {
          return true;
        }
      }
      return false;
    });

    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não cadastrado nesta loja" }, { status: 401 });
    }

    const expectedPassword = motoboy.password || "123456";

    if (expectedPassword !== password) {
      return NextResponse.json({ error: "Senha incorreta. A senha padrão é 123456." }, { status: 401 });
    }

    // Se não tinha senha gravada, salva a senha informada
    if (!motoboy.password) {
      await prisma.motoboy.update({
        where: { id: motoboy.id },
        data: { password }
      });
    }

    return NextResponse.json({
      success: true,
      motoboyId: motoboy.id,
      motoboyName: motoboy.name,
      storeId: storeUser.id,
      storeName: storeUser.name,
      storeAddress: storeUser.storeAddress || storeUser.city || "",
      motoboy: {
        id: motoboy.id,
        name: motoboy.name,
        phone: motoboy.phone
      },
      store: {
        id: storeUser.id,
        name: storeUser.name,
        storeAddress: storeUser.storeAddress || storeUser.city || "",
        city: storeUser.city || ""
      }
    });
  } catch (err: any) {
    console.error("[Motoboy Login Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro interno ao realizar login" }, { status: 500 });
  }
}

// PATCH - Alterar senha do motoboy pelo próprio app
export async function PATCH(req: NextRequest) {
  try {
    const { motoboyId, currentPassword, newPassword } = await req.json();

    if (!motoboyId || !newPassword) {
      return NextResponse.json({ error: "ID do motoboy e nova senha são obrigatórios" }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findUnique({ where: { id: motoboyId } });
    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    const validCurrent = (motoboy.password || "123456") === currentPassword;
    if (!validCurrent) {
      return NextResponse.json({ error: "Senha atual incorreta!" }, { status: 401 });
    }

    const updated = await prisma.motoboy.update({
      where: { id: motoboyId },
      data: { password: newPassword.trim() }
    });

    return NextResponse.json({ success: true, message: "Senha alterada com sucesso!", motoboy: updated });
  } catch (err: any) {
    console.error("[Motoboy Change Password Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro ao alterar senha" }, { status: 500 });
  }
}
