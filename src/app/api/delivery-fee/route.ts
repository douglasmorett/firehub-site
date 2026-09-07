import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { avaliarEntrega, raioMaximoKm, taxaFixaDaLoja } from "@/lib/area-de-entrega";

/**
 * GET: taxa de entrega para um endereço/bairro/GPS. A decisão vem de
 * `avaliarEntrega` (src/lib/area-de-entrega.ts) — a MESMA regra da rota de
 * pedido e do robô.
 *
 * Esta rota falhava ABERTA: endereço que o mapa não achava, mapa fora do ar ou
 * loja sem pino viravam "disponível, R$ 5,00". Agora:
 *   - ATENDE       → taxa da faixa/bairro;
 *   - FORA         → indisponível, com o motivo;
 *   - DESCONHECIDO → disponível com a taxa da faixa MAIS CARA e aviso: a venda
 *                    não se perde, a loja não paga a diferença, e o pedido chega
 *                    marcado para conferência (rota de pedido).
 */
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
    select: { deliveryZoneType: true, deliveryZones: true, deliveryConfig: true, storeLatLng: true, storeAddress: true, city: true },
  });
  if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const hasCoords = latStr && lngStr && !isNaN(parseFloat(latStr)) && !isNaN(parseFloat(lngStr));
  const coords = hasCoords ? { lat: parseFloat(latStr!), lng: parseFloat(lngStr!) } : null;
  const fullQuery = address || `${street} ${number}, ${neighborhood}`.trim().replace(/^,\s*|,\s*$/g, "") || neighborhood || "";

  const v = await avaliarEntrega(user, {
    endereco: fullQuery,
    bairro: neighborhood || null,
    coords,
    partes: { street, number, neighborhood, city: user.city || "" },
  });
  const type = v.modo === "BAIRRO" ? "neighborhood" : "radius";
  const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

  if (v.modo === "BAIRRO" && v.resultado === "DESCONHECIDO") {
    return NextResponse.json({ fee: 0, available: false, type, message: "Selecione seu bairro para calcular a entrega." });
  }
  if (v.modo === "KM" && !coords && fullQuery.trim().length < 4) {
    return NextResponse.json({ fee: 0, available: false, type, message: "Informe o endereço completo (rua, número e bairro) para calcular o frete." });
  }

  if (v.resultado === "FORA") {
    return NextResponse.json({
      fee: 0, available: false, type, distanceKm: v.distanciaKm, maxRadiusKm: v.raioMaxKm,
      message: v.modo === "BAIRRO"
        ? "Bairro não atendido pela loja. Por favor, selecione um dos bairros cadastrados."
        : `Endereço fora do raio de entrega (${v.distanciaKm} km. Raio máximo: ${v.raioMaxKm} km).`,
    });
  }

  if (v.resultado === "DESCONHECIDO") {
    // Nem "fora" nem "atende". Cobra a faixa mais cara e avisa; o pedido vai
    // marcado para a loja conferir (ver customer-order/route.ts).
    const zonas = Array.isArray(user.deliveryZones) ? (user.deliveryZones as any[]) : [];
    const maisCara = Math.max(0, ...zonas.map((z: any) => Number(z?.fee) || 0));
    const fee = maisCara || taxaFixaDaLoja(user) || 0;
    return NextResponse.json({
      fee, available: true, unknown: true, type, maxRadiusKm: v.raioMaxKm ?? raioMaximoKm(user),
      message: `Não localizamos esse endereço no mapa. Confira rua, número e bairro ou use "Minha localização". Por enquanto a taxa é ${brl(fee)}, e a loja confirma a entrega.`,
    });
  }

  // ATENDE
  // Loja sem área cadastrada segue como sempre: R$ 5,00 quando não há taxa fixa.
  const fee = v.taxa ?? taxaFixaDaLoja(user) ?? (v.modo === "SEM_AREA" ? 5 : 0);
  return NextResponse.json({
    fee, available: true, type, distanceKm: v.distanciaKm, maxRadiusKm: v.raioMaxKm, matchedAddress: v.enderecoNoMapa, neighborhood: v.bairro,
    message: v.modo === "BAIRRO" ? `Bairro atendido: ${v.bairro}`
      : v.modo === "KM" ? `Distância aproximada: ${v.distanciaKm} km`
      : "Taxa padrão da loja",
  });
}
