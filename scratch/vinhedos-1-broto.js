/**
 * Cadastra o cardápio da Pizzaria Vinhedos (Bragança Paulista) no FireHub.
 *
 *   node cadastrar-vinhedos.js            → simula, não grava
 *   node cadastrar-vinhedos.js --gravar   → grava
 *
 * ── DE ONDE VEIO O CARDÁPIO ────────────────────────────────────────────────
 *
 * Do cardápio digital que a própria loja já tem (cardapio.ai/pizzaria-vinhedos),
 * lido pelo POST <slug>/listProducts + getProductByCod — que só respondem com o
 * cookie de sessão da página. Nome, descrição e as bordas vieram de lá.
 *
 * ── A REGRA DE PREÇO, DITA PELO DONO DA LOJA ───────────────────────────────
 *
 * WhatsApp de 22/09/2026:
 *   • "Deixa as pizzas broto de 25 cm todas no valor de 40 reais" → R$ 40 fixo
 *   • "o preço da mais cara fica"  → priceRule MAIOR na pergunta de sabor
 *   • "eu faço meio a meio em todas as salgadas e todas as doces" → max 2
 *   • foto de produto: não cadastrar, o lojista põe depois
 *
 * O preço de cada sabor fica no VÍNCULO (ComboGroupItem.additionalPrice), não
 * no produto-opção: é o que permite o mesmo sabor custar R$ 40 no broto e o
 * preço cheio na 35 cm, sem virar dois produtos e sem recalcular nada à mão
 * quando a loja reajustar.
 *
 * ── O QUE ESTE SCRIPT NÃO FAZ, E POR QUÊ ───────────────────────────────────
 *
 * Não cria a pizza de 35 cm. Os preços dela só existem no cardápio FÍSICO da
 * loja, que não foi lido — e preço de pizza inventado é prejuízo em toda venda.
 * A estrutura está pronta: assim que os valores chegarem, é a mesma lista de
 * sabores com outro `additionalPrice`.
 */
const fs = require("fs");
const crypto = require("crypto");

const GRAVAR = process.argv.includes("--gravar");
const FRANQUEADO = "cmucxpr8s002fqt01ouza8gml"; // Pizzaria vinhedos
const PRECO_BROTO = 40.0;

const src = fs.readFileSync("C:/Users/FINANCEIRO/Documents/firehub-site/scratch/achar-pedido-197.js", "utf8");
const url = (src.match(/postgres[a-z]*:\/\/[^"']+/) || [])[0];
const { PrismaClient } = require("C:/Users/FINANCEIRO/Documents/firehub-site/node_modules/@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const novoId = (p) => p + crypto.randomBytes(12).toString("hex");

// ── OS SABORES ─────────────────────────────────────────────────────────────
// O "Z " que prefixa as doces é truque de ordenação do cardapio.ai (para elas
// caírem no fim da lista). Sai daqui: no FireHub quem ordena é o sortOrder.
const SABORES = [
  ["À Moda da Casa (Salgada)", "Mussarela, presunto, bacon, alho, tomate e manjericão"],
  ["À Moda do Chefe (Salgada)", "5 ingredientes da sua preferência"],
  ["Alemã (Salgada)", "Mussarela, bacon, tomate e cebola"],
  ["Atum Sólido com Mussarela (Salgada)", "Atum com mussarela e cebola"],
  ["Bacon (Salgada)", "Mussarela com bacon"],
  ["Bauru (Salgada)", "Mussarela, presunto e tomate"],
  ["Brasileira (Salgada)", "Frango, milho, bacon, requeijão e cheddar"],
  ["Brócolis (Salgada)", "Mussarela, brócolis, bacon e alho frito"],
  ["Caipira (Salgada)", "Frango, mussarela, bacon e milho"],
  ["Calabresa (Salgada)", "Calabresa com cebola"],
  ["Calabresa com Requeijão (Salgada)", "Calabresa com requeijão"],
  ["Calzone Fechado (Salgada)", "Frango, mussarela, presunto e requeijão"],
  ["Canadense (Salgada)", "Lombo, requeijão e queijo"],
  ["Carijó (Salgada)", "Frango, bacon, milho e requeijão"],
  ["Corinthiana (Salgada)", "Lombo, queijo, presunto e bacon"],
  ["Costela Desfiada (Salgada)", "Mussarela, costela e requeijão"],
  ["Dois Queijos (Salgada)", "Mussarela e requeijão"],
  ["Frango com Requeijão (Salgada)", "Mussarela, frango com catupiry original"],
  ["Jardineira (Salgada)", "Frango, mussarela, milho, ervilha e bacon"],
  ["Marguerita (Salgada)", "Mussarela, tomate e manjericão fresco"],
  ["Milho (Salgada)", "Mussarela com milho"],
  ["Mussarela (Salgada)", "Mussarela e orégano"],
  ["Napolitana (Salgada)", "Mussarela, tomate e parmesão"],
  ["Palmito (Salgada)", "Mussarela com palmito"],
  ["Paola (Salgada)", "Calabresa, mussarela, presunto e requeijão"],
  ["Peruana (Salgada)", "Mussarela, atum, champignon e requeijão"],
  ["Portuguesa (Salgada)", "Presunto, mussarela, ervilha, ovos e cebola"],
  ["Quatro Queijos (Salgada)", "Mussarela, provolone, gorgonzola e requeijão"],
  ["Romana (Salgada)", "Mussarela, calabresa e provolone"],
  ["Saborosa (Salgada)", "Mussarela, atum, palmito, ovos e requeijão"],
  ["Siciliana (Salgada)", "Mussarela, presunto, ervilha e bacon"],
  ["Toscana (Salgada)", "Calabresa, mussarela e tomate"],
  ["Banana com Queijo (Doce)", "Banana com mussarela, leite condensado e canela"],
  ["Banana Nevada (Doce)", "Banana, leite condensado, chocolate branco e canela"],
  ["Chocolate com Morango (Doce)", "Morango com chocolate"],
  ["Nutella com Banana (Doce)", "Nutella coberta com banana"],
  ["Nutella com Morango (Doce)", "Nutella com morango"],
  ["Ouro Branco (Doce)", "Base creme de leite, chocolate branco, ouro branco e leite condensado"],
  ["Sonho de Valsa (Doce)", "Leite condensado, chocolate preto, sonho de valsa e creme de leite"],
];

// ── AS BORDAS ──────────────────────────────────────────────────────────────
// A origem tem DOIS grupos (salgadas e doces) porque lá a borda de chocolate
// custa R$ 10 na salgada e é grátis na doce. Aqui é um grupo só, com o tipo no
// NOME da opção: o cliente escolhe UMA borda, e o papel precisa dizer qual. Dois
// grupos obrigariam quem pede pizza salgada a ver a pergunta das doces também.
const BORDAS = [
  ["Sem Borda", "Sem borda recheada", 0],
  ["Borda Scala (salgada)", "Borda scala — grátis nas pizzas salgadas", 0],
  ["Borda Chocolate (pizza doce)", "Borda recheada com chocolate — grátis nas pizzas doces", 0],
  ["Borda Catupiry Original (salgada)", "Borda recheada com catupiry original", 5],
  ["Borda Cheddar (salgada)", "Borda recheada com cheddar", 5],
  ["Borda Chocolate (pizza salgada)", "Borda recheada com chocolate", 10],
];

const CATEGORIA = "Pizzas";

(async () => {
  const [loja] = await prisma.$queryRawUnsafe(
    `SELECT id, "storeName", slug FROM "User" WHERE id = $1`, FRANQUEADO);
  if (!loja) throw new Error("loja não encontrada");
  console.log(`Loja: ${loja.storeName} (${loja.slug})`);

  const [antes] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*)::int FROM "MenuCategory" WHERE "franchiseeId"=$1) AS categorias,
            (SELECT COUNT(*)::int FROM "MenuProduct"  WHERE "franchiseeId"=$1) AS produtos`, FRANQUEADO);
  console.log(`Antes: ${antes.categorias} categorias, ${antes.produtos} produtos`);
  if (antes.produtos > 0) {
    console.log("⚠️  A loja JÁ tem produtos. Este script foi feito para cardápio vazio — pare e confira.");
    if (GRAVAR) process.exit(1);
  }

  const plano = {
    categorias: [CATEGORIA, "Complementos"],
    produtoVenda: `Pizza Broto 25cm (4 pedaços)`,
    sabores: SABORES.length,
    bordas: BORDAS.length,
    precoPorSabor: PRECO_BROTO,
  };
  console.log("\nVai criar:");
  console.log(`  categorias .......... ${plano.categorias.join(", ")}`);
  console.log(`  produto de venda .... ${plano.produtoVenda}  (base R$ 0,00)`);
  console.log(`    grupo 1 ........... "Escolha o sabor" — min 1, max 2, priceRule MAIOR`);
  console.log(`                        ${plano.sabores} sabores, todos a R$ ${PRECO_BROTO.toFixed(2)}`);
  console.log(`    grupo 2 ........... "Borda" — min 0, max 1, soma`);
  console.log(`                        ${plano.bordas} opções (R$ 0 a R$ 10)`);
  console.log(`  opções (sabores+bordas) criadas em "Complementos", apenasEmCombo`);
  console.log(`\n  Meio a meio: 2 sabores a R$ ${PRECO_BROTO.toFixed(2)} com MAIOR = R$ ${PRECO_BROTO.toFixed(2)} (uma pizza)`);

  if (!GRAVAR) {
    console.log("\n(simulação) rode com --gravar para valer.");
    await prisma.$disconnect();
    return;
  }

  const sql = (q, ...p) => prisma.$executeRawUnsafe(q, ...p);

  // Categorias
  for (const [i, nome] of plano.categorias.entries()) {
    await sql(
      `INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","color","sortOrder","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      novoId("cat_"), FRANQUEADO, nome, nome === CATEGORIA ? "🍕" : "🧩", "#C62828", i);
  }
  console.log("\n✓ categorias criadas");

  // O produto que o cliente compra: base zero, o preço vem do sabor escolhido.
  const produtoId = novoId("prd_");
  await sql(
    `INSERT INTO "MenuProduct"
       ("id","franchiseeId","name","description","price","category","sortOrder",
        "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
    produtoId, FRANQUEADO, plano.produtoVenda,
    "Pizza broto de 25 cm, 4 pedaços. Escolha 1 ou 2 sabores (meio a meio) entre salgadas e doces.",
    0, CATEGORIA, 0, true, true, false, false);
  console.log("✓ produto de venda criado");

  // Grupo dos sabores — MAIOR: meia calabresa + meia portuguesa é UMA pizza.
  const grupoSabor = novoId("cg_");
  await sql(
    `INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    grupoSabor, produtoId, "Escolha o sabor (até 2 — meio a meio)", 2, 1, "MAIOR", 0);

  let n = 0;
  for (const [nome, descricao] of SABORES) {
    const opId = novoId("prd_");
    await sql(
      `INSERT INTO "MenuProduct"
         ("id","franchiseeId","name","description","price","category","sortOrder",
          "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
      opId, FRANQUEADO, nome, descricao, 0, "Complementos", n, true, false, false, true);
    await sql(
      `INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
       VALUES ($1,$2,$3,$4)`,
      novoId("cgi_"), grupoSabor, opId, PRECO_BROTO);
    n++;
  }
  console.log(`✓ ${n} sabores vinculados a R$ ${PRECO_BROTO.toFixed(2)}`);

  // Grupo da borda — opcional (min 0) e soma, que é a regra de adicional.
  const grupoBorda = novoId("cg_");
  await sql(
    `INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    grupoBorda, produtoId, "Borda", 1, 0, "SOMA", 1);

  let b = 0;
  for (const [nome, descricao, preco] of BORDAS) {
    const opId = novoId("prd_");
    await sql(
      `INSERT INTO "MenuProduct"
         ("id","franchiseeId","name","description","price","category","sortOrder",
          "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
      opId, FRANQUEADO, nome, descricao, 0, "Complementos", 100 + b, true, false, false, true);
    await sql(
      `INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
       VALUES ($1,$2,$3,$4)`,
      novoId("cgi_"), grupoBorda, opId, preco);
    b++;
  }
  console.log(`✓ ${b} bordas vinculadas`);

  const [depois] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT COUNT(*)::int FROM "MenuCategory" WHERE "franchiseeId"=$1) AS categorias,
            (SELECT COUNT(*)::int FROM "MenuProduct"  WHERE "franchiseeId"=$1) AS produtos,
            (SELECT COUNT(*)::int FROM "ComboGroup" cg JOIN "MenuProduct" mp ON mp.id=cg."menuProductId"
             WHERE mp."franchiseeId"=$1) AS grupos,
            (SELECT COUNT(*)::int FROM "ComboGroupItem" cgi JOIN "ComboGroup" cg ON cg.id=cgi."comboGroupId"
             JOIN "MenuProduct" mp ON mp.id=cg."menuProductId" WHERE mp."franchiseeId"=$1) AS vinculos`,
    FRANQUEADO);
  console.log(`\nDepois: ${JSON.stringify(depois)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
