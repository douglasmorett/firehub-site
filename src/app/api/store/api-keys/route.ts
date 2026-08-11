import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKeyPair } from "@/lib/api-key";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;

    const apiKeys = await prisma.apiKey.findMany({
      where: { franchiseeId: targetFranchiseeId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ apiKeys });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();
    const { name, permissions } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "O nome da chave de API é obrigatório." }, { status: 400 });
    }

    const { rawKey, keyPrefix, keyHash } = generateApiKeyPair("fh_live_");

    const newKey = await prisma.apiKey.create({
      data: {
        franchiseeId: targetFranchiseeId,
        name: name.trim(),
        keyPrefix,
        keyHash,
        permissions: Array.isArray(permissions) ? permissions : ["orders:read", "orders:write", "menu:read", "menu:write"],
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      apiKey: newKey,
      rawSecretKey: rawKey, // Exibido apenas uma vez para o lojista copiar!
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const { searchParams } = new URL(req.url);
    const keyId = searchParams.get("id");

    if (!keyId) {
      return NextResponse.json({ error: "ID da chave é obrigatório." }, { status: 400 });
    }

    await prisma.apiKey.deleteMany({
      where: {
        id: keyId,
        franchiseeId: targetFranchiseeId,
      },
    });

    return NextResponse.json({ success: true, message: "Chave de API revogada com sucesso." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
