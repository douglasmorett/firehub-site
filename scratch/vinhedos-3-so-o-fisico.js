/**
 * Deixa no cardápio da Vinhedos SÓ o que está no cardápio físico.
 *
 *   node so-o-fisico.js            → simula
 *   node so-o-fisico.js --gravar   → grava
 *
 * Ordem do dono (22/09/2026): "use só o cardápio físico deles". Sai tudo que
 * eu tinha trazido da busca que fiz por conta própria e que o papel não traz.
 *
 * SAI: os 6 itens de BORDA e a pergunta "Borda" das duas pizzas. O cardápio
 * físico não menciona borda em lugar nenhum — preço de borda que eu não vi
 * impresso é preço inventado.
 *
 * FICA: as duas opções de refrigerante do Combo Premium. Elas ESTÃO no papel —
 * "1 PIZZA PEPPERONI + COCA-COLA 1L (NORMAL OU ZERO)".
 *
 * AJUSTA: a descrição do Ouro Branco passa a ser a linha impressa. O físico
 * vende "SONHO DE VALSA OU OURO BRANCO" numa linha só, com uma descrição só —
 * a que estava lá antes veio da outra fonte.
 */
const fs = require("fs");
const GRAVAR = process.argv.includes("--gravar");
const FRANQUEADO = "cmucxpr8s002fqt01ouza8gml";

const src = fs.readFileSync("C:/Users/FINANCEIRO/Documents/firehub-site/scratch/achar-pedido-197.js", "utf8");
const url = (src.match(/postgres[a-z]*:\/\/[^"']+/) || [])[0];
const { PrismaClient } = require("C:/Users/FINANCEIRO/Documents/firehub-site/node_modules/@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const DESCRICAO_IMPRESSA_DOS_DOIS = "Leite condensado, chocolate preto, sonho de valsa e creme de leite";

(async () => {
  const q = (s, ...p) => prisma.$queryRawUnsafe(s, ...p);
  const sql = (s, ...p) => prisma.$executeRawUnsafe(s, ...p);

  const bordas = await q(
    `SELECT id, name FROM "MenuProduct"
     WHERE "franchiseeId"=$1 AND ("name" LIKE 'Borda%' OR "name" = 'Sem Borda')`, FRANQUEADO);
  const grupos = await q(
    `SELECT cg.id, cg.title, mp.name AS produto FROM "ComboGroup" cg
     JOIN "MenuProduct" mp ON mp.id = cg."menuProductId"
     WHERE mp."franchiseeId"=$1 AND cg.title = 'Borda'`, FRANQUEADO);

  console.log("VAI REMOVER:");
  console.log(`  ${grupos.length} perguntas "Borda" (em: ${grupos.map(g => g.produto).join(", ")})`);
  for (const b of bordas) console.log(`    - ${b.name}`);
  console.log(`\nVAI AJUSTAR:`);
  console.log(`  Ouro Branco (Doce) → "${DESCRICAO_IMPRESSA_DOS_DOIS}"`);
  console.log(`\nFICA (está impresso no combo): Coca-Cola 1L e Coca-Cola Zero 1L`);

  if (!GRAVAR) { console.log("\n(simulação) rode com --gravar."); await prisma.$disconnect(); return; }

  for (const g of grupos) {
    await sql(`DELETE FROM "ComboGroupItem" WHERE "comboGroupId"=$1`, g.id);
    await sql(`DELETE FROM "ComboGroup" WHERE id=$1`, g.id);
  }
  for (const b of bordas) {
    await sql(`DELETE FROM "ComboGroupItem" WHERE "menuProductId"=$1`, b.id);
    await sql(`DELETE FROM "MenuProduct" WHERE id=$1`, b.id);
  }
  await sql(
    `UPDATE "MenuProduct" SET "description"=$1, "updatedAt"=NOW()
     WHERE "franchiseeId"=$2 AND name='Ouro Branco (Doce)'`,
    DESCRICAO_IMPRESSA_DOS_DOIS, FRANQUEADO);

  console.log("\n✓ bordas removidas");
  console.log("✓ descrição do Ouro Branco alinhada ao papel");

  const [f] = await q(
    `SELECT (SELECT COUNT(*)::int FROM "MenuProduct" WHERE "franchiseeId"=$1) AS produtos,
            (SELECT COUNT(*)::int FROM "ComboGroup" cg JOIN "MenuProduct" mp ON mp.id=cg."menuProductId"
             WHERE mp."franchiseeId"=$1) AS grupos`, FRANQUEADO);
  console.log(`\nAgora: ${f.produtos} produtos, ${f.grupos} perguntas`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
