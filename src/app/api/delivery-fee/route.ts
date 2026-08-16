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
      deliveryConfig: true,
      storeLatLng: true,
      storeAddress: true,
      city: true
    }
  });

  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const zones = (user.deliveryZones as any) || [];
  const zoneType = user.deliveryZoneType || "RADIUS";
  const delivConfig = (user.deliveryConfig as any) || {};
  const defaultStoreFee = Number(delivConfig.deliveryFee || delivConfig.defaultFee || (Array.isArray(zones) && zones[0]?.fee) || 5);

  if (zoneType === "NEIGHBORHOOD") {
    if (!neighborhood && !address) {
      return NextResponse.json({ fee: defaultStoreFee, available: true, type: "neighborhood", message: "Informe seu bairro." });
    }
    const searchTarget = (neighborhood || address || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const zone = Array.isArray(zones)
      ? zones.find((z: any) => {
          if (!z.name) return false;
          const zClean = String(z.name).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return zClean === searchTarget || searchTarget.includes(zClean) || zClean.includes(searchTarget);
        })
      : null;

    if (zone) {
      return NextResponse.json({ fee: Number(zone.fee) || 0, available: true, type: "neighborhood", neighborhood: zone.name, message: `Bairro ${zone.name}` });
    }

    if (Array.isArray(zones) && zones.length > 0) {
      // Se a loja cadastrou bairros específicos e este não bateu
      return NextResponse.json({
        fee: defaultStoreFee,
        available: true,
        type: "neighborhood",
        message: `Bairro atendido com taxa padrão (R$ ${defaultStoreFee.toFixed(2).replace('.', ',')})`
      });
    }

    return NextResponse.json({ fee: defaultStoreFee, available: true, type: "neighborhood", message: "Taxa padrão da loja" });
  }

  // Raio / Distância ou Padrão
  if (zoneType === "RADIUS" || zoneType === "DISTANCE" || !zoneType) {
    const fullQuery = address || neighborhood || "";
    if (!fullQuery || fullQuery.trim().length < 3) {
      return NextResponse.json({ fee: defaultStoreFee, available: true, type: "radius", message: "Informe o endereço completo." });
    }

    try {
      const check = await verifyStoreDeliveryAddress(
        user.storeAddress,
        user.storeLatLng as any,
        user.city,
        zones,
        zoneType,
        fullQuery
      );

      if (!check || !check.addressFound) {
        // Fallback suave com taxa base da loja
        return NextResponse.json({
          fee: defaultStoreFee,
          available: true,
          type: "radius",
          message: `Taxa calculada: R$ ${defaultStoreFee.toFixed(2).replace('.', ',')}`
        });
      }

      if (!check.isWithinRadius && check.distanceKm && check.maxRadiusKm) {
        return NextResponse.json({
          fee: 0,
          available: false,
          type: "radius",
          distanceKm: check.distanceKm,
          maxRadiusKm: check.maxRadiusKm,
          message: `Endereço fora do raio de entrega (${check.distanceKm} km. Máx: ${check.maxRadiusKm} km).`
        });
      }

      const finalFee = check.deliveryFee !== undefined ? Number(check.deliveryFee) : defaultStoreFee;

      return NextResponse.json({
        fee: finalFee,
        available: true,
        type: "radius",
        distanceKm: check.distanceKm,
        maxRadiusKm: check.maxRadiusKm,
        matchedAddress: check.matchedAddress,
        message: check.distanceKm ? `Distância aproximada: ${check.distanceKm} km` : `Taxa de entrega calculada`
      });
    } catch {
      return NextResponse.json({ fee: defaultStoreFee, available: true, type: "radius", message: "Taxa padrão da loja" });
    }
  }

  return NextResponse.json({ fee: defaultStoreFee, available: true, type: "none" });
}

