import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

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

    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { franchiseeId: targetFranchiseeId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ subscriptions });
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
    const { url, events } = body;

    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      return NextResponse.json({ error: "URL do webhook inválida. Deve começar com http:// ou https://" }, { status: 400 });
    }

    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const selectedEvents = Array.isArray(events) && events.length > 0 ? events : ["*"];

    const subscription = await prisma.webhookSubscription.create({
      data: {
        franchiseeId: targetFranchiseeId,
        url: url.trim(),
        secret,
        events: selectedEvents,
      },
    });

    return NextResponse.json({
      success: true,
      subscription,
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
    const subId = searchParams.get("id");

    if (!subId) {
      return NextResponse.json({ error: "ID da assinatura de webhook é obrigatório." }, { status: 400 });
    }

    await prisma.webhookSubscription.deleteMany({
      where: {
        id: subId,
        franchiseeId: targetFranchiseeId,
      },
    });

    return NextResponse.json({ success: true, message: "Assinatura de webhook excluída com sucesso." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
