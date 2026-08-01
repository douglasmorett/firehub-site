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

    // Busca a loja pelo slug para garantir isolamento multi-tenant
    const storeUser = await prisma.user.findFirst({
      where: {
        OR: [
          { slug: storeSlug.toLowerCase() },
          { name: { contains: storeSlug, mode: "insensitive" } }
        ]
      },
      select: { id: true, name: true, slug: true, storeAddress: true, city: true }
    });

    if (!storeUser) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    const cleanPhone = phone.replace(/\D/g, "");

    // Busca motoboy estritamente vinculado a esta loja
    const motoboy = await prisma.motoboy.findFirst({
      where: {
        franchiseeId: storeUser.id,
        active: true,
        OR: [
          ...(cleanPhone ? [{ phone: { contains: cleanPhone } }] : []),
          { name: { contains: phone, mode: "insensitive" } }
        ]
      }
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
      storeAddress: storeUser.storeAddress
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
