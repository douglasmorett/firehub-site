/**
 * scripts/teste-vinculo-do-espelho-pglite.ts — o vínculo item→produto real
 * (lib/espelho-de-integracao.ts) contra um Postgres local (PGlite) com o
 * schema da branch (`prisma db push` antes):
 *
 *   DATABASE_URL=<url do PGlite local com ?pgbouncer=true> NEXTAUTH_SECRET=x npx prisma db push --skip-generate
 *   DATABASE_URL=<a mesma> NEXTAUTH_SECRET=x npx tsx scripts/teste-vinculo-do-espelho-pglite.ts
 */
export {};

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { produtoRealDoItem, proximoCodigoPDV, camposDoEspelho, ORIGENS } = await import("../src/lib/espelho-de-integracao");
  const { montarItensDoPedidoIfood } = await import("../src/lib/ifood-itens");

  const loja = await prisma.user.upsert({
    where: { email: "loja-vinculo@teste.local" },
    update: {},
    create: { email: "loja-vinculo@teste.local", name: "Loja Vínculo", password: "x", role: "FRANCHISEE" } as any,
  });
  const outra = await prisma.user.upsert({
    where: { email: "outra-vinculo@teste.local" },
    update: {},
    create: { email: "outra-vinculo@teste.local", name: "Outra", password: "x", role: "FRANCHISEE" } as any,
  });
  await prisma.menuProduct.deleteMany({ where: { franchiseeId: { in: [loja.id, outra.id] } } });

  const real = await (prisma.menuProduct as any).create({
    data: { franchiseeId: loja.id, name: "Esfirra de M&M", description: "", price: 9.98, category: "Esfirras Doces", codigoPDV: 758 },
  });
  await (prisma.menuProduct as any).create({
    data: { franchiseeId: outra.id, name: "Outro 758", description: "", price: 1, category: "X", codigoPDV: 758 },
  });
  const espelho = await (prisma.menuProduct as any).create({
    data: { id: `ifood-item-abc-${loja.id}`, franchiseeId: loja.id, name: "ESFIRRA MM", description: "", price: 9.98, category: "iFood", ...camposDoEspelho(ORIGENS.IFOOD, "item-abc") },
  });

  console.log("\n[1] Código PDV casa só dentro da loja");
  confere((await produtoRealDoItem({ franchiseeId: loja.id, codigoExterno: "758" })) === real.id, "externalCode 758 → produto real da loja");
  confere((await produtoRealDoItem({ franchiseeId: loja.id, codigoExterno: "999" })) === null, "código que não existe → null");
  confere((await produtoRealDoItem({ franchiseeId: loja.id, codigoExterno: real.id })) === real.id, "externalCode = id do produto (Keeta) → produto real");
  confere((await produtoRealDoItem({ franchiseeId: loja.id, codigoExterno: "XGAHTQ" })) === null, "código de letras desconhecido → null, sem erro");

  console.log("\n[2] Vínculo manual do espelho");
  confere((await produtoRealDoItem({ franchiseeId: loja.id, idDoEspelho: espelho.id })) === null, "espelho sem vínculo → null");
  await (prisma.menuProduct as any).update({ where: { id: espelho.id }, data: { vinculadoA: real.id } });
  confere((await produtoRealDoItem({ franchiseeId: loja.id, idDoEspelho: espelho.id })) === real.id, "espelho vinculado → produto real");
  confere((await produtoRealDoItem({ franchiseeId: outra.id, idDoEspelho: espelho.id })) === null, "outra loja não enxerga o vínculo");

  console.log("\n[3] Itens do iFood: com código, conecta; sem código, espelho pausado com campo");
  const itens = await montarItensDoPedidoIfood(
    [
      { id: "item-abc", name: "ESFIRRA MM", quantity: 1, unitPrice: 9.98, totalPrice: 9.98, externalCode: "758" },
      { id: "item-novo", name: "Item Novo", quantity: 1, unitPrice: 5, totalPrice: 5 },
    ],
    { franchiseeId: loja.id },
  );
  confere(itens[0].menuProduct?.connect?.id === real.id, "item com externalCode 758 conecta no produto real");
  const create = itens[1].menuProduct?.connectOrCreate?.create;
  confere(create?.origemIntegracao === "IFOOD" && create?.codigoExterno === "item-novo" && create?.active === false && create?.activeDelivery === false, "item sem código vira espelho pausado, com origem e código externo");

  console.log("\n[4] proximoCodigoPDV");
  confere((await proximoCodigoPDV(loja.id)) === 759, "próximo da loja = 759");
  confere((await proximoCodigoPDV(null)) === null, "sem loja → null");

  // O unique (franchiseeId, codigoPDV) é provado no teste do boot (CREATE UNIQUE
  // INDEX); aqui o PGlite derruba a conexão na violação e não dá para ver o P2002.

  await prisma.menuProduct.deleteMany({ where: { franchiseeId: { in: [loja.id, outra.id] } } });
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  await prisma.$disconnect();
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
