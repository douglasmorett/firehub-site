import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.franchiseeId },
    select: {
      id: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      storeLogo: true,
      storeHours: true,
      storeOpen: true,
      cashOpen: true,
      deliveryZoneType: true,
      deliveryZones: true,
      slug: true,
      city: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    storeName: user.storeName,
    slug: user.slug,
    phone: user.storePhone,
    address: user.storeAddress,
    city: user.city,
    logo: user.storeLogo,
    isOpen: user.storeOpen,
    isCashOpen: user.cashOpen,
    hours: user.storeHours,
    deliveryZones: user.deliveryZones,
  });
}
