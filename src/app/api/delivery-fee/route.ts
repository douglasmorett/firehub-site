import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStoreDeliveryAddress } from "@/lib/geocoding";

// GET: Calculate delivery fee for a given address/neighborhood
export async function GET(req: NextRequest) {
  const franchiseeId = req.nextUrl.searchParams.get("franchiseeId");
  const neighborhood = req.nextUrl.searchParams.get("neighborhood");
  const address = req.nextUrl.searchParams.get("address");

  if (!franchiseeId) return NextResponse.json({ error: "Falta franchiseeId" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: {
      deliveryZoneType: true,
      deliveryZones: true,
      storeLatLng: true,
      storeAddress: true,
      city: true
    }
  });

  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const zones = (user.deliveryZones as any) || [];
  const zoneType = user.deliveryZoneType || "NEIGHBORHOOD";

  if (zoneType === "NEIGHBORHOOD") {
    if (!neighborhood) {
      return NextResponse.json({ fee: 0, available: false, type: "neighborhood", message: "Bairro não informado." });
    }
    const zone = Array.isArray(zones)
      ? zones.find((z: any) => z.name && z.name.trim().toLowerCase() === neighborhood.trim().toLowerCase())
      : null;
    if (zone) {
      return NextResponse.json({ fee: Number(zone.fee) || 0, available: true, type: "neighborhood", neighborhood: zone.name });
    }
    return NextResponse.json({ fee: 0, available: false, type: "neighborhood", message: "Não atendemos neste bairro no momento." });
  }

  if (zoneType === "RADIUS" || zoneType === "DISTANCE") {
    if (!address) {
      return NextResponse.json({ type: "radius", zones, center: user.storeLatLng, available: true, fee: 0 });
    }
    const check = await verifyStoreDeliveryAddress(
      user.storeAddress,
      user.storeLatLng as any,
      user.city,
      zones,
      zoneType,
      address
    );

    if (!check) {
      return NextResponse.json({ fee: 0, available: true, type: "radius", message: "Calculado com base no endereço." });
    }

    if (!check.isWithinRadius && check.distanceKm && check.maxRadiusKm) {
      return NextResponse.json({
        fee: 0,
        available: false,
        type: "radius",
        distanceKm: check.distanceKm,
        maxRadiusKm: check.maxRadiusKm,
        message: `Endereço fora do raio de entrega da loja (${check.distanceKm} km. Raio máximo: ${check.maxRadiusKm} km).`
      });
    }

    return NextResponse.json({
      fee: check.deliveryFee || 0,
      available: true,
      type: "radius",
      distanceKm: check.distanceKm,
      maxRadiusKm: check.maxRadiusKm,
      matchedAddress: check.matchedAddress,
      message: `Distância aproximada: ${check.distanceKm} km.`
    });
  }

  return NextResponse.json({ fee: 0, available: true, type: "none" });
}
