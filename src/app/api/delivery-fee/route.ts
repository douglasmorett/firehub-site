import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStoreDeliveryAddress } from "@/lib/geocoding";

// GET: Calculate delivery fee for a given address/neighborhood/coords
export async function GET(req: NextRequest) {
  const franchiseeId = req.nextUrl.searchParams.get("franchiseeId");
  const street = req.nextUrl.searchParams.get("street") || "";
  const number = req.nextUrl.searchParams.get("number") || "";
  const neighborhood = req.nextUrl.searchParams.get("neighborhood") || "";
  const address = req.nextUrl.searchParams.get("address") || "";
  const latStr = req.nextUrl.searchParams.get("lat");
  const lngStr = req.nextUrl.searchParams.get("lng");

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

  const isNeighborhoodMode = zoneType === "NEIGHBORHOOD" || (
    zoneType !== "RADIUS" && zoneType !== "DISTANCE" && zoneType !== "KM" && Array.isArray(zones) && zones.some((z: any) => z && z.name && !z.km && !z.radius)
  );

  // 1. MODO BAIRROS
  if (isNeighborhoodMode) {
    if (!neighborhood && !address) {
      return NextResponse.json({ fee: 0, available: false, type: "neighborhood", message: "Selecione seu bairro para calcular a entrega." });
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
      return NextResponse.json({ fee: Number(zone.fee) || 0, available: true, type: "neighborhood", neighborhood: zone.name, message: `Bairro atendido: ${zone.name}` });
    }

    if (Array.isArray(zones) && zones.length > 0) {
      // Se a loja cadastrou bairros específicos e este não bateu -> Fora da área de entrega
      return NextResponse.json({
        fee: 0,
        available: false,
        type: "neighborhood",
        message: "Bairro não atendido pela loja. Por favor, selecione um dos bairros cadastrados."
      });
    }

    return NextResponse.json({ fee: defaultStoreFee, available: true, type: "neighborhood", message: "Taxa padrão da loja" });
  }

  // 2. MODO RAIO / DISTÂNCIA EM KM
  const hasCoords = latStr && lngStr && !isNaN(parseFloat(latStr)) && !isNaN(parseFloat(lngStr));
  const customerCoords = hasCoords ? { lat: parseFloat(latStr!), lng: parseFloat(lngStr!) } : null;
  const fullQuery = address || `${street} ${number}, ${neighborhood}`.trim() || neighborhood || "";

  if (!customerCoords && (!fullQuery || fullQuery.trim().length < 3)) {
    return NextResponse.json({ fee: 0, available: false, type: "radius", message: "Informe o endereço completo (rua, número e bairro) para calcular o frete." });
  }

  try {
    const check = await verifyStoreDeliveryAddress(
      user.storeAddress,
      user.storeLatLng as any,
      user.city,
      zones,
      zoneType,
      fullQuery,
      customerCoords,
      delivConfig,
      { street, number, neighborhood, city: user.city || "" }
    );

    if (!check || !check.addressFound) {
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
        message: `Endereço fora do raio de entrega (${check.distanceKm} km. Raio máximo: ${check.maxRadiusKm} km).`
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

