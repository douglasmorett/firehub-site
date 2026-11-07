/**
 * scripts/teste-boot-do-espelho-pglite.ts — prova, num Postgres local (PGlite),
 * o SQL que o boot roda para o espelho de integração (lib/garantir-colunas.ts):
 * cria as colunas e o índice, carimba os espelhos antigos pela regra, pausa
 * os ativos e numera os produtos da loja com Código PDV.
 *
 *   DATABASE_URL=<url do PGlite local, porta 5491, com ?pgbouncer=true> NEXTAUTH_SECRET=x npx tsx scripts/teste-boot-do-espelho-pglite.ts
 *
 * Só precisa das tabelas MenuProduct e ComboGroup, criadas aqui enxutas.
 */
export {};
import fs from "node:fs";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

function sqlDoBoot() {
  const fonte = fs.readFileSync(new URL("../src/lib/garantir-colunas.ts", import.meta.url), "utf8");
  const bloco = (nome: string) => {
    const m = fonte.match(new RegExp(`const ${nome} = \`([\\s\\S]*?)\`;`));
    if (!m) throw new Error(`não achei ${nome}`);
    return m[1];
  };
  const instrucoes = [...fonte.matchAll(/^\s+`((?:ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "(?:origemIntegracao|codigoExterno|codigoPDV|vinculadoA)"|CREATE UNIQUE INDEX IF NOT EXISTS "MenuProduct_franchiseeId_codigoPDV_key")[^`]*)`/gm)].map((m) => m[1]);
  return { instrucoes, carimbo: bloco("CARIMBO_DE_ESPELHO"), pausa: bloco("PAUSA_DO_ESPELHO"), numeracao: bloco("NUMERACAO_PDV") };
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const sql = sqlDoBoot();
  confere(sql.instrucoes.length === 5, `5 instruções de coluna/índice (achei ${sql.instrucoes.length})`);

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ComboGroup"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "MenuProduct"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "MenuProduct" (
    id TEXT PRIMARY KEY, "franchiseeId" TEXT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imageUrl" TEXT, category TEXT NOT NULL DEFAULT 'Lanches', active BOOLEAN NOT NULL DEFAULT true,
    "activePDV" BOOLEAN NOT NULL DEFAULT true, "activeDelivery" BOOLEAN NOT NULL DEFAULT true, "activeTotem" BOOLEAN NOT NULL DEFAULT true, "activeGarcom" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "ComboGroup" (id TEXT PRIMARY KEY, "menuProductId" TEXT NOT NULL)`);

  const linhas: [string, string, string, string, boolean, string | null, string][] = [
    // id, loja, nome, categoria, ativo, foto, descrição
    ["cuid-1", "L1", "X-Burger", "Lanches", true, "x.jpg", "pão, carne"],
    ["cuid-2", "L1", "Coca", "Bebidas", false, null, ""], // real pausado, sem prefixo: NUNCA espelho
    ["ifood-a", "L1", "Pastel", "Pastéis", true, "p.jpg", "importado"], // Paulista: real com id ifood- → fica
    ["ifood-b", "L1", "Combo X", "iFood", false, null, ""], // espelho clássico
    ["ifood-c", "L1", "Pizza", "Pizzas", false, null, ""], // espelho adotado pelo kds-sem-categoria (categoria real, pausado, sem nada)
    ["ifood-d", "L1", "Pizza com pergunta", "Pizzas", false, null, ""], // pausado mas com pergunta → real
    ["99food_L1_Combo Tadala", "L1", "Combo Tadala", "Burgers", true, null, ""], // 99Food ATIVO com categoria real → espelho, pausa
    ["brendi-recovered-123", "L1", "Pedido Brendi #123", "Brendi", true, null, ""],
    ["keeta-L2-it-1", "L2", "Yakisoba", "Keeta", false, null, ""],
    ["cuid-3", "L2", "Sushi", "Japonês", true, null, ""],
  ];
  for (const [id, loja, nome, cat, ativo, foto, desc] of linhas) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MenuProduct" (id, "franchiseeId", name, category, active, "imageUrl", description, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' seconds')::interval)`,
      id, loja, nome, cat, ativo, foto, desc, String(linhas.findIndex((l) => l[0] === id)),
    );
  }
  await prisma.$executeRawUnsafe(`INSERT INTO "ComboGroup" (id, "menuProductId") VALUES ('g1', 'ifood-d')`);

  for (const i of sql.instrucoes) await prisma.$executeRawUnsafe(i);
  const carimbados = await prisma.$executeRawUnsafe(sql.carimbo);
  const pausados = await prisma.$executeRawUnsafe(sql.pausa);
  const numerados = await prisma.$executeRawUnsafe(sql.numeracao);
  console.log(`carimbados=${carimbados} pausados=${pausados} numerados=${numerados}`);

  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, "origemIntegracao" o, active, "activeDelivery" d, "codigoPDV" c FROM "MenuProduct" ORDER BY "franchiseeId", "createdAt"`);
  const por = Object.fromEntries(rows.map((r) => [r.id, r]));
  confere(por["cuid-1"].o === null && por["cuid-1"].c === 1, "produto real: sem origem, Código PDV 1");
  confere(por["cuid-2"].o === null && por["cuid-2"].c === 2, "real pausado sem prefixo: não é espelho, Código 2");
  confere(por["ifood-a"].o === null && por["ifood-a"].active === true && por["ifood-a"].c === 3, "Paulista (ifood- ativo com categoria real): fica real");
  confere(por["ifood-b"].o === "IFOOD" && por["ifood-b"].c === null, "espelho clássico do iFood carimbado, sem código");
  confere(por["ifood-c"].o === "IFOOD", "espelho adotado (categoria real, pausado, sem foto/descrição/pergunta) carimbado");
  confere(por["ifood-d"].o === null && por["ifood-d"].c === 4, "pausado com pergunta: real");
  confere(por["99food_L1_Combo Tadala"].o === "99FOOD" && por["99food_L1_Combo Tadala"].active === false && por["99food_L1_Combo Tadala"].d === false, "99Food ativo: carimbado e PAUSADO em todo canal");
  confere(por["brendi-recovered-123"].o === "BRENDI" && por["brendi-recovered-123"].active === false, "Brendi recuperado: espelho pausado");
  confere(por["keeta-L2-it-1"].o === "KEETA", "Keeta carimbado");
  confere(por["cuid-3"].c === 1, "numeração é por loja (L2 começa em 1)");

  console.log("\n[2] Rodar de novo não muda nada (idempotente)");
  const c2 = await prisma.$executeRawUnsafe(sql.carimbo);
  const p2 = await prisma.$executeRawUnsafe(sql.pausa);
  const n2 = await prisma.$executeRawUnsafe(sql.numeracao);
  confere(Number(c2) === 0 && Number(p2) === 0 && Number(n2) === 0, `segunda rodada: 0/0/0 (foi ${c2}/${p2}/${n2})`);

  console.log("\n[3] Loja que já tem código não é renumerada; produto novo sem código fica para proximoCodigoPDV");
  await prisma.$executeRawUnsafe(`INSERT INTO "MenuProduct" (id, "franchiseeId", name) VALUES ('cuid-4', 'L1', 'Novo')`);
  const n3 = await prisma.$executeRawUnsafe(sql.numeracao);
  const novo = await prisma.$queryRawUnsafe<any[]>(`SELECT "codigoPDV" c FROM "MenuProduct" WHERE id = 'cuid-4'`);
  confere(Number(n3) === 0 && novo[0].c === null, "não renumera loja que já tem código");

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  await prisma.$disconnect();
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
