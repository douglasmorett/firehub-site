// Script para migrar entrega de "Por Raio" para "Por Bairro"
// Executa via: npx tsx scripts/migrate-delivery-neighborhoods.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const neighborhoods = [
  // Faixa 1 — Até 1.5km (R$ 4,99 / 48 min) — Vizinhos à loja
  { name: "Parque Zabulão", time: 48, fee: 4.99 },
  { name: "Bosque Beira Rio", time: 48, fee: 4.99 },
  { name: "Colinas", time: 48, fee: 4.99 },
  { name: "Costazul", time: 48, fee: 4.99 },
  { name: "Liberdade", time: 48, fee: 4.99 },
  { name: "Nova Cidade", time: 48, fee: 4.99 },
  { name: "Gelson Apicelo", time: 48, fee: 4.99 },

  // Faixa 2 — Até 3.5km (R$ 4,99 / 48 min) — Entorno
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

async function main() {
  const users = await prisma.user.findMany({
    where: { role: "FRANCHISEE" },
    select: { id: true, name: true, city: true, storeName: true },
  });

  console.log(`Encontrados ${users.length} lojistas:`);
  users.forEach(u => console.log(`  - ${u.name} (${u.storeName}) [${u.city}]`));

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        deliveryZoneType: "NEIGHBORHOOD",
        deliveryZones: neighborhoods,
      },
    });
    console.log(`✅ ${user.storeName || user.name}: ${neighborhoods.length} bairros cadastrados!`);
  }

  console.log(`\n🎉 Migração concluída! ${neighborhoods.length} bairros cadastrados para ${users.length} lojista(s).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
