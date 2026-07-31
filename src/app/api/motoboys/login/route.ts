import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { storeSlug, phone, password } = await req.json();

    if (!storeSlug) {
      return NextResponse.json({ error: "Slug da loja é obrigatório" }, { status: 400 });
    }

    if (!phone || !password) {
      return NextResponse.json({ error: "Telefone e senha são obrigatórios" }, { status: 400 });
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
          { phone: { contains: cleanPhone } },
          { name: { contains: phone, mode: "insensitive" } }
        ]
      }
    });

    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não cadastrado nesta loja" }, { status: 401 });
    }

    // Se o motoboy já tiver senha cadastrada, verifica. Caso contrário, permite primeiro login e grava a senha!
    if (motoboy.password && motoboy.password !== password) {
      return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
    }

    if (!motoboy.password) {
      await prisma.motoboy.update({
        where: { id: motoboy.id },
        data: { password }
      });
    }

    const response = NextResponse.json({
      success: true,
      motoboy: {
        id: motoboy.id,
        name: motoboy.name,
        phone: motoboy.phone,
      },
      store: {
        id: storeUser.id,
        name: storeUser.name,
        slug: storeUser.slug,
        storeAddress: storeUser.storeAddress,
        city: storeUser.city
      }
    });

    // Grava cookie de sessão isolado para o motoboy nesta loja
    response.cookies.set("motoboy_session", JSON.stringify({
      motoboyId: motoboy.id,
      storeId: storeUser.id,
      storeSlug: storeUser.slug
    }), {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 // 30 dias
    });

    return response;

  } catch (err: any) {
    console.error("[Motoboy Login API Error]", err);
    return NextResponse.json({ error: "Erro interno no login" }, { status: 500 });
  }
}
