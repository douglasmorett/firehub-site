import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: {
        id: true,
        storeName: true,
        cpfCnpj: true,
        fiscalConfig: true,
        ownerId: true,
      },
    });

    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const targetId = user.ownerId || user.id;
    const store = user.ownerId
      ? await prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, storeName: true, cpfCnpj: true, fiscalConfig: true },
        })
      : user;

    const defaultConfig = {
      enabled: false,
      ambiente: "homologacao", // "homologacao" | "producao"
      cnpj: store?.cpfCnpj || "",
      ie: "",
      cstDefault: "102",
      ncmDefault: "2106.90.90",
      autoEmitPaymentMethods: ["PIX", "CREDITO_ONLINE", "CREDIT_CARD", "DEBIT_CARD"],
    };

    const fiscalConfig = {
      ...defaultConfig,
      ...((store?.fiscalConfig as any) || {}),
    };

    return NextResponse.json({
      success: true,
      storeName: store?.storeName || "",
      cpfCnpj: store?.cpfCnpj || "",
      fiscalConfig,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const targetId = user.ownerId || user.id;
    const body = await req.json();

    const current = await prisma.user.findUnique({
      where: { id: targetId },
      select: { fiscalConfig: true },
    });

    const updatedConfig = {
      ...((current?.fiscalConfig as any) || {}),
      ...body,
    };

    await prisma.user.update({
      where: { id: targetId },
      data: { fiscalConfig: updatedConfig },
    });

    return NextResponse.json({ success: true, fiscalConfig: updatedConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
