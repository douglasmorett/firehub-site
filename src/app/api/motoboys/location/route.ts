import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST: Motoboy envia sua localização em tempo real
export async function POST(req: NextRequest) {
  try {
    const { motoboyId, lat, lng } = await req.json();

    if (!motoboyId || lat === undefined || lng === undefined) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    const updated = await prisma.motoboy.update({
      where: { id: motoboyId },
      data: {
        lastLat: parseFloat(lat),
        lastLng: parseFloat(lng),
        lastLocationUpdate: new Date()
      },
      select: { id: true, name: true, lastLat: true, lastLng: true }
    });

    return NextResponse.json({ success: true, motoboy: updated });
  } catch (err) {
    console.error("[Motoboy Location POST Error]", err);
    return NextResponse.json({ error: "Erro ao atualizar localização" }, { status: 500 });
  }
}

// GET: Painel de Roteirização consulta motoboys ativos da loja
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");

    if (!storeId) {
      return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 });
    }

    const motoboys = await prisma.motoboy.findMany({
      where: {
        franchiseeId: storeId,
        active: true
      },
      select: {
        id: true,
        name: true,
        phone: true,
        lastLat: true,
        lastLng: true,
        lastLocationUpdate: true
      }
    });

    return NextResponse.json({ success: true, motoboys });
  } catch (err) {
    console.error("[Motoboy Location GET Error]", err);
    return NextResponse.json({ error: "Erro ao buscar motoboys" }, { status: 500 });
  }
}
