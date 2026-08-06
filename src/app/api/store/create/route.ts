import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { storeName, storeAddress, storePhone, city, cpfCnpj } = body;

    if (!storeName) {
      return NextResponse.json({ error: "Nome da loja é obrigatório" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const franchiseeId = user.ownerId || user.id;
    const masterId = user.accountGroupId || franchiseeId;

    const masterStore = await prisma.user.findUnique({ where: { id: masterId } });
    if (!masterStore) {
      return NextResponse.json({ error: "Loja principal não encontrada" }, { status: 404 });
    }

    // Gera um slug baseado no nome e adiciona sufixo aleatório
    const baseSlug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const slug = `${baseSlug}-${randomSuffix}`;

    // Gera o e-mail virtual único
    const newEmail = `${slug}.${masterId.slice(0, 6)}@stores.firehub.app`;

    const newStore = await prisma.user.create({
      data: {
        email: newEmail,
        name: storeName,
        storeName: storeName,
        password: masterStore.password, // Reutiliza a senha da conta principal
        role: "FRANCHISEE",
        accountGroupId: masterId,
        isPrimaryStore: false,
        city: city || null,
        storePhone: storePhone || null,
        storeAddress: storeAddress || null,
        cpfCnpj: cpfCnpj || null,
        slug: slug,
      }
    });

    return NextResponse.json({
      success: true,
      store: newStore,
      billingNotice: "Uma nova cobrança mensal será gerada para esta loja baseada no faturamento dela."
    });
  } catch (error) {
    console.error("Error creating store:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
