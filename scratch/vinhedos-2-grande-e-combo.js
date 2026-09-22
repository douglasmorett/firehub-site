/**
 * Cadastra a PIZZA GRANDE (35 cm) da Pizzaria Vinhedos e o Combo Premium.
 *
 *   node grande-vinhedos.js            → simula
 *   node grande-vinhedos.js --gravar   → grava
 *
 * ── A FONTE ────────────────────────────────────────────────────────────────
 *
 * O cardápio FÍSICO da loja (foto de 22/09/2026). É ele que manda: o cardápio
 * digital deles (cardapio.ai) tem só o broto e está desatualizado — não tem
 * nenhum dos quatro sabores Premium nem o combo, e descreve o Calzone sem o
 * palmito que o físico lista.
 *
 * ── AS DUAS DECISÕES DE PREÇO, DITAS PELO DONO ─────────────────────────────
 *
 *   • grande 35 cm / 8 pedaços = os preços do cardápio físico
 *   • meio a meio = "o preço da mais cara fica" → priceRule MAIOR
 *
 * ── PREMIUM SÓ NA GRANDE, E ISSO NÃO É CHUTE ───────────────────────────────
 *
 * Os quatro Premium não entram no broto porque a lista de sabores do PRÓPRIO
 * broto deles (grupo "Pizzas Broto" no cardapio.ai) não os traz — são 39
 * sabores, e nenhum Premium. O físico também os apresenta como lançamento com
 * preço próprio, fora das colunas normais.
 *
 * ── "OU" VIRA DUAS OPÇÕES ──────────────────────────────────────────────────
 *
 * O físico vende "NUTELLA COM MORANGO OU BANANA" numa linha só, por R$ 54, e
 * "SONHO DE VALSA OU OURO BRANCO" por R$ 52. Aqui viram duas opções cada, pelo
 * MESMO preço: o cliente escolhe qual quer em vez de escrever na observação, e
 * a cozinha recebe o sabor certo na comanda. Preço não muda.
 */
const fs = require("fs");
const crypto = require("crypto");

const GRAVAR = process.argv.includes("--gravar");
const FRANQUEADO = "cmucxpr8s002fqt01ouza8gml";

const src = fs.readFileSync("C:/Users/FINANCEIRO/Documents/firehub-site/scratch/achar-pedido-197.js", "utf8");
const url = (src.match(/postgres[a-z]*:\/\/[^"']+/) || [])[0];
const { PrismaClient } = require("C:/Users/FINANCEIRO/Documents/firehub-site/node_modules/@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const novoId = (p) => p + crypto.randomBytes(12).toString("hex");

/** nome no FireHub → preço da GRANDE no cardápio físico */
const PRECO_GRANDE = {
  "À Moda da Casa (Salgada)": 47,
  "À Moda do Chefe (Salgada)": 52,
  "Alemã (Salgada)": 47,
  "Atum Sólido com Mussarela (Salgada)": 55,
  "Bacon (Salgada)": 43,
  "Bauru (Salgada)": 46,
  "Brasileira (Salgada)": 48,
  "Brócolis (Salgada)": 48,
  "Caipira (Salgada)": 50,
  "Calabresa (Salgada)": 44,
  "Calabresa com Requeijão (Salgada)": 46,
  "Calzone Fechado (Salgada)": 50,
  "Canadense (Salgada)": 50,
  "Carijó (Salgada)": 50,
  "Corinthiana (Salgada)": 50,
  "Costela Desfiada (Salgada)": 62,
  "Dois Queijos (Salgada)": 46,
  "Frango com Requeijão (Salgada)": 50,
  "Jardineira (Salgada)": 50,
  "Marguerita (Salgada)": 46,
  "Milho (Salgada)": 45,
  "Mussarela (Salgada)": 44,
  "Napolitana (Salgada)": 46,
  "Palmito (Salgada)": 44,
  "Paola (Salgada)": 50,
  "Peruana (Salgada)": 50,
  "Portuguesa (Salgada)": 50,
  "Quatro Queijos (Salgada)": 50,
  "Romana (Salgada)": 47,
  "Saborosa (Salgada)": 50,
  "Siciliana (Salgada)": 47,
  "Toscana (Salgada)": 50,
  "Banana com Queijo (Doce)": 48,
  "Banana Nevada (Doce)": 50,
  "Chocolate com Morango (Doce)": 50,
  "Nutella com Banana (Doce)": 54,
  "Nutella com Morango (Doce)": 54,
  "Ouro Branco (Doce)": 52,
  "Sonho de Valsa (Doce)": 52,
};

/** Os quatro Premium: preço PROMOCIONAL, que é o que o cartaz anuncia. */
const PREMIUM = [
  ["Pepperoni Suprema (Premium)", "Pepperoni selecionado, mussarela especial, requeijão cremoso e parmesão", 59.9],
  ["Havaiana Premium", "Presunto, mussarela e abacaxi selecionado", 54.9],
  ["Costela BBQ Premium", "Costela desfiada, tomate fresco, mussarela e molho barbecue", 64.9],
  ["Frango BBQ Supremo (Premium)", "Frango desfiado, mussarela, bacon crocante e molho barbecue", 59.9],
];

/** O físico lista o Calzone COM palmito; o cardapio.ai, sem. Manda o físico. */
const CORRIGIR_DESCRICAO = {
  "Calzone Fechado (Salgada)": "Frango, mussarela, presunto, palmito e requeijão",
};

const CATEGORIA = "Pizzas";

(async () => {
  const sql = (q, ...p) => prisma.$executeRawUnsafe(q, ...p);
  const q = (s, ...p) => prisma.$queryRawUnsafe(s, ...p);

  const opcoes = await q(
    `SELECT id, name, description FROM "MenuProduct"
     WHERE "franchiseeId"=$1 AND "apenasEmCombo"=true`, FRANQUEADO);
  const porNome = new Map(opcoes.map((o) => [o.name, o]));
  console.log(`Opções já cadastradas: ${opcoes.length}`);

  // Confere que todo sabor da tabela de preços existe — nome errado aqui viraria
  // pizza sem preço lá.
  const faltando = Object.keys(PRECO_GRANDE).filter((n) => !porNome.has(n));
  if (faltando.length) {
    console.log("❌ Sabores da tabela que NÃO existem no cadastro:", faltando);
    process.exit(1);
  }
  const semPreco = opcoes
    .filter((o) => !o.name.startsWith("Borda") && o.name !== "Sem Borda")
    .filter((o) => PRECO_GRANDE[o.name] === undefined)
    .map((o) => o.name);
  if (semPreco.length) {
    console.log("❌ Sabores cadastrados que ficaram SEM preço na grande:", semPreco);
    process.exit(1);
  }
  console.log(`✓ os ${Object.keys(PRECO_GRANDE).length} sabores batem com o cadastro`);

  const bordas = opcoes.filter((o) => o.name.startsWith("Borda") || o.name === "Sem Borda");
  console.log(`✓ ${bordas.length} bordas para reaproveitar`);

  console.log("\nVai criar:");
  console.log(`  Pizza Grande 35cm (8 pedaços) — base R$ 0,00`);
  console.log(`    sabores: ${Object.keys(PRECO_GRANDE).length} do cardápio + ${PREMIUM.length} Premium = ${Object.keys(PRECO_GRANDE).length + PREMIUM.length}`);
  console.log(`    faixa de preço: R$ ${Math.min(...Object.values(PRECO_GRANDE)).toFixed(2)} a R$ ${Math.max(...PREMIUM.map(p=>p[2])).toFixed(2)}`);
  console.log(`  Combo Premium — Pizza Pepperoni + Coca-Cola 1L — R$ 70,00`);
  console.log(`  Correção de descrição: ${Object.keys(CORRIGIR_DESCRICAO).join(", ")}`);

  if (!GRAVAR) { console.log("\n(simulação) rode com --gravar."); await prisma.$disconnect(); return; }

  for (const [nome, desc] of Object.entries(CORRIGIR_DESCRICAO)) {
    await sql(`UPDATE "MenuProduct" SET "description"=$1, "updatedAt"=NOW() WHERE id=$2`, desc, porNome.get(nome).id);
  }
  console.log("\n✓ descrição corrigida");

  // O broto nasceu com "25cm" no nome; sai, pelo mesmo motivo da grande.
  await sql(
    `UPDATE "MenuProduct" SET "name"=$1, "description"=$2, "updatedAt"=NOW()
     WHERE "franchiseeId"=$3 AND "name"=$4`,
    "Pizza Broto 4 pedaços",
    "Pizza broto. Escolha 1 ou 2 sabores (meio a meio) entre salgadas e doces.",
    FRANQUEADO, "Pizza Broto 25cm (4 pedaços)");
  console.log("✓ broto renomeado para o padrão da loja");

  // Os Premium são opções novas, só da grande.
  let ordem = 200;
  for (const [nome, desc] of PREMIUM) {
    if (porNome.has(nome)) continue;
    const id = novoId("prd_");
    await sql(
      `INSERT INTO "MenuProduct"
         ("id","franchiseeId","name","description","price","category","sortOrder",
          "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,0,$5,$6,true,false,false,true,NOW(),NOW())`,
      id, FRANQUEADO, nome, desc, "Complementos", ordem++);
    porNome.set(nome, { id, name: nome });
  }
  console.log(`✓ ${PREMIUM.length} sabores Premium criados`);

  // A pizza grande.
  const grandeId = novoId("prd_");
  await sql(
    `INSERT INTO "MenuProduct"
       ("id","franchiseeId","name","description","price","category","sortOrder",
        "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,0,$5,$6,true,true,false,false,NOW(),NOW())`,
    // O NOME SEGUE O PADRÃO DA PRÓPRIA LOJA.
    //
    // No cardápio digital deles a pizza se chama "Pizza Broto 4 pedaços" — o
    // tamanho é contado em PEDAÇOS, não em centímetros, e o cardápio físico
    // não escreve medida nenhuma. Decisão do dono em 22/09/2026: sem cm no
    // nome. Quem já conhece a casa reconhece a pizza pelo que ela é lá.
    grandeId, FRANQUEADO, "Pizza Grande 8 pedaços",
    "Pizza artesanal. Escolha 1 ou 2 sabores (meio a meio) entre salgadas e doces.",
    CATEGORIA, 0);

  const gSabor = novoId("cg_");
  await sql(
    `INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
     VALUES ($1,$2,$3,2,1,'MAIOR',0)`,
    gSabor, grandeId, "Escolha o sabor (até 2 — meio a meio)");

  const todos = { ...PRECO_GRANDE };
  for (const [nome, , preco] of PREMIUM) todos[nome] = preco;
  for (const [nome, preco] of Object.entries(todos)) {
    await sql(
      `INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
       VALUES ($1,$2,$3,$4)`,
      novoId("cgi_"), gSabor, porNome.get(nome).id, preco);
  }
  console.log(`✓ ${Object.keys(todos).length} sabores vinculados à grande`);

  const gBorda = novoId("cg_");
  await sql(
    `INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
     VALUES ($1,$2,'Borda',1,0,'SOMA',1)`, gBorda, grandeId);
  // O preço da borda é o mesmo do broto: vem do vínculo do outro grupo.
  const precoDaBorda = await q(
    `SELECT mp.name, cgi."additionalPrice" AS preco FROM "ComboGroupItem" cgi
     JOIN "MenuProduct" mp ON mp.id=cgi."menuProductId"
     JOIN "ComboGroup" cg ON cg.id=cgi."comboGroupId"
     WHERE cg.title='Borda'`);
  const mapaBorda = new Map(precoDaBorda.map((b) => [b.name, Number(b.preco)]));
  for (const b of bordas) {
    await sql(
      `INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
       VALUES ($1,$2,$3,$4)`,
      novoId("cgi_"), gBorda, b.id, mapaBorda.get(b.name) ?? 0);
  }
  console.log(`✓ ${bordas.length} bordas vinculadas à grande`);

  // Combo Premium: pizza pepperoni + refrigerante, preço fechado.
  const comboId = novoId("prd_");
  await sql(
    `INSERT INTO "MenuProduct"
       ("id","franchiseeId","name","description","price","category","sortOrder",
        "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,70,$5,1,true,true,false,false,NOW(),NOW())`,
    comboId, FRANQUEADO, "Combo Premium",
    "1 Pizza Pepperoni Suprema + Coca-Cola 1L (normal ou zero).", CATEGORIA);

  const gRefri = novoId("cg_");
  await sql(
    `INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
     VALUES ($1,$2,'Escolha o refrigerante',1,1,'SOMA',0)`, gRefri, comboId);
  for (const [i, nome] of ["Coca-Cola 1L", "Coca-Cola Zero 1L"].entries()) {
    let op = porNome.get(nome);
    if (!op) {
      const id = novoId("prd_");
      await sql(
        `INSERT INTO "MenuProduct"
           ("id","franchiseeId","name","description","price","category","sortOrder",
            "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
         VALUES ($1,$2,$3,'',0,$4,$5,true,false,true,true,NOW(),NOW())`,
        id, FRANQUEADO, nome, "Complementos", 300 + i);
      op = { id, name: nome };
      porNome.set(nome, op);
    }
    await sql(
      `INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
       VALUES ($1,$2,$3,0)`, novoId("cgi_"), gRefri, op.id);
  }
  console.log("✓ Combo Premium criado (R$ 70,00)");

  await prisma.$disconnect();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
