import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// POST /api/admin/migrate-neighborhoods
// Rota temporária para migrar entrega de "Por Raio" para "Por Bairro"
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const neighborhoods = [
    // Faixa 1 — Até 1.5km (R$ 4,99 / 48 min)
    { name: "Parque Zabulão", time: 48, fee: 4.99 },
    { name: "Bosque Beira Rio", time: 48, fee: 4.99 },
    { name: "Colinas", time: 48, fee: 4.99 },
    { name: "Costazul", time: 48, fee: 4.99 },
    { name: "Liberdade", time: 48, fee: 4.99 },
    { name: "Nova Cidade", time: 48, fee: 4.99 },
    { name: "Gelson Apicelo", time: 48, fee: 4.99 },
    // Faixa 2 — Até 3.5km (R$ 4,99 / 48 min)
    { name: "Centro", time: 48, fee: 4.99 },
    { name: "Novo Rio das Ostras", time: 48, fee: 4.99 },
    { name: "Boca da Barra", time: 48, fee: 4.99 },
    { name: "Village Sol e Mar", time: 48, fee: 4.99 },
    { name: "Parque São Jorge", time: 48, fee: 4.99 },
    { name: "Jardim Mariléa", time: 48, fee: 4.99 },
    { name: "Chácara Mariléa", time: 48, fee: 4.99 },
    { name: "Porto Seguro", time: 48, fee: 4.99 },
    { name: "Loteamento Atlântica", time: 48, fee: 4.99 },
    { name: "Village Rio das Ostras", time: 48, fee: 4.99 },
    { name: "Residencial Praia Âncora", time: 48, fee: 4.99 },
    { name: "Nova Esperança", time: 48, fee: 4.99 },
    // Faixa 3 — Até 4km (R$ 5,99 / 58 min)
    { name: "Operário", time: 58, fee: 5.99 },
    { name: "Peroba", time: 58, fee: 5.99 },
    { name: "Casa Grande", time: 58, fee: 5.99 },
    { name: "São Cristóvão", time: 58, fee: 5.99 },
    { name: "Balneário Remanso", time: 58, fee: 5.99 },
    { name: "Extensão Novo Rio das Ostras", time: 58, fee: 5.99 },
    { name: "Residencial Camping do Bosque", time: 58, fee: 5.99 },
    { name: "Mar do Norte", time: 58, fee: 5.99 },
    { name: "Balneário das Garças", time: 58, fee: 5.99 },
    { name: "Enseada das Gaivotas", time: 58, fee: 5.99 },
    // Faixa 4 — Até 5km (R$ 7,99 / 58 min)
    { name: "Bosque da Praia", time: 58, fee: 7.99 },
    { name: "Extensão do Bosque", time: 58, fee: 7.99 },
    { name: "Sobradinho", time: 58, fee: 7.99 },
    { name: "Nova Aliança", time: 58, fee: 7.99 },
    { name: "Recanto", time: 58, fee: 7.99 },
    { name: "Cantinho do Mar", time: 58, fee: 7.99 },
    { name: "Residencial Rio das Ostras", time: 58, fee: 7.99 },
    { name: "Vila Real", time: 58, fee: 7.99 },
    { name: "Jardim Miramar", time: 58, fee: 7.99 },
    { name: "Cidade Praiana", time: 58, fee: 7.99 },
    { name: "Cidade Beira Mar", time: 58, fee: 7.99 },
    { name: "Serramar", time: 58, fee: 7.99 },
    { name: "Extensão Serramar", time: 58, fee: 7.99 },
    { name: "Jardim Campomar", time: 58, fee: 7.99 },
    { name: "Jardim Patrícia", time: 58, fee: 7.99 },
    { name: "Residencial Maria Turri", time: 58, fee: 7.99 },
    { name: "Terra Firme", time: 58, fee: 7.99 },
    { name: "Residencial Verdes Mares", time: 58, fee: 7.99 },
    { name: "Reduto da Paz", time: 58, fee: 7.99 },
    { name: "Floresta das Gaivotas", time: 58, fee: 7.99 },
    { name: "Praiamar", time: 58, fee: 7.99 },
    { name: "Bosque da Areia", time: 58, fee: 7.99 },
  ];

  const users = await prisma.user.findMany({
    where: { role: "FRANCHISEE" },
    select: { id: true, name: true, storeName: true },
  });

  const results: string[] = [];
  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        deliveryZoneType: "NEIGHBORHOOD",
        deliveryZones: neighborhoods,
      },
    });
    results.push(`✅ ${user.storeName || user.name}: ${neighborhoods.length} bairros`);
  }

  return NextResponse.json({
    success: true,
    message: `Migração concluída! ${neighborhoods.length} bairros cadastrados para ${users.length} lojista(s).`,
    details: results,
  });
}
