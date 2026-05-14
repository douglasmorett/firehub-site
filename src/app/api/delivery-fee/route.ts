import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET: Calculate delivery fee for a given address/neighborhood
export async function GET(req: NextRequest) {
  const franchiseeId = req.nextUrl.searchParams.get("franchiseeId");
  const neighborhood = req.nextUrl.searchParams.get("neighborhood");

  if (!franchiseeId) return NextResponse.json({ error: "Falta franchiseeId" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { deliveryZoneType: true, deliveryZones: true, storeLatLng: true }
  });

  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const zones = user.deliveryZones as any;
  const zoneType = user.deliveryZoneType;

  if (!zones || !zoneType) {
    return NextResponse.json({ fee: 0, available: true, type: "none" });
  }

  if (zoneType === "NEIGHBORHOOD" && neighborhood) {
    const zone = zones.find((z: any) => z.name.toLowerCase() === neighborhood.toLowerCase());
    if (zone) {
      return NextResponse.json({ fee: zone.fee, available: true, type: "neighborhood", neighborhood: zone.name });
    }
    return NextResponse.json({ fee: 0, available: false, type: "neighborhood", message: "Bairro fora da área de entrega." });
  }

  if (zoneType === "RADIUS") {
    // Return all radius zones for the client to calculate
    return NextResponse.json({ type: "radius", zones, center: user.storeLatLng });
  }

  return NextResponse.json({ fee: 0, available: true, type: "none" });
}
