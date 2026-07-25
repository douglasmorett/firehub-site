import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await prisma.user.findFirst({
      where: { email: { contains: "contatohakim" } },
      select: { id: true, ownerId: true }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário Hakim não encontrado" }, { status: 404 });
    }

    const franchiseeId = user.ownerId || user.id;

    const destDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const imageUrl = "/uploads/batata_frita.png";

    const existing = await prisma.menuProduct.findFirst({
      where: { franchiseeId, name: { equals: "Batata Frita", mode: "insensitive" } }
    });

    let product;
    if (existing) {
      product = await prisma.menuProduct.update({
        where: { id: existing.id },
        data: {
          name: "Batata Frita",
          category: "Acompanhamentos",
          description: "Huum.. Uma batatinha.. Deu água na boca só de pensar",
          price: 9.90,
          imageUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: false,
          isBeverage: false
        }
      });
    } else {
      product = await prisma.menuProduct.create({
        data: {
          franchiseeId,
          name: "Batata Frita",
          category: "Acompanhamentos",
          description: "Huum.. Uma batatinha.. Deu água na boca só de pensar",
          price: 9.90,
          imageUrl,
          active: true,
          activePDV: true,
          activeDelivery: true,
          isCombo: false,
          isBeverage: false
        }
      });
    }

    return NextResponse.json({ ok: true, message: "Batata Frita cadastrada com sucesso!", product });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
