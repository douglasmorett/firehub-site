/**
 * Confere o cardápio da Vinhedos contra o cardápio FÍSICO, preço a preço,
 * usando a regra de preço do próprio FireHub (lib/preco-combo.ts).
 */
const fs = require("fs");
const src = fs.readFileSync("C:/Users/FINANCEIRO/Documents/firehub-site/scratch/achar-pedido-197.js", "utf8");
const url = (src.match(/postgres[a-z]*:\/\/[^"']+/) || [])[0];
const { PrismaClient } = require("C:/Users/FINANCEIRO/Documents/firehub-site/node_modules/@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const FRANQUEADO = "cmucxpr8s002fqt01ouza8gml";

/** Transcrito da FOTO do cardápio físico, coluna por coluna. */
const FISICO = {
  "À Moda da Casa": 47, "À Moda do Chefe": 52, "Alemã": 47, "Atum Sólido com Mussarela": 55,
  "Bacon": 43, "Bauru": 46, "Brasileira": 48, "Brócolis": 48, "Caipira": 50, "Calabresa": 44,
  "Calabresa com Requeijão": 46, "Calzone Fechado": 50, "Canadense": 50,
  "Carijó": 50, "Corinthiana": 50, "Costela Desfiada": 62, "Dois Queijos": 46,
  "Frango com Requeijão": 50, "Jardineira": 50, "Marguerita": 46, "Milho": 45, "Mussarela": 44,
  "Napolitana": 46, "Palmito": 44, "Paola": 50, "Peruana": 50,
  "Portuguesa": 50, "Quatro Queijos": 50, "Romana": 47, "Saborosa": 50, "Siciliana": 47, "Toscana": 50,
  "Banana com Queijo": 48, "Banana Nevada": 50, "Chocolate com Morango": 50,
  "Nutella com Banana": 54, "Nutella com Morango": 54, "Ouro Branco": 52, "Sonho de Valsa": 52,
  "Pepperoni Suprema": 59.9, "Havaiana Premium": 54.9, "Costela BBQ Premium": 64.9, "Frango BBQ Supremo": 59.9,
};

const semSufixo = (n) => n.replace(/ \((Salgada|Doce|Premium)\)$/, "").replace(/ Premium$/, " Premium");

(async () => {
  const q = (s, ...p) => prisma.$queryRawUnsafe(s, ...p);
  let erros = 0;

  const produtos = await q(
    `SELECT id, name, price, active FROM "MenuProduct"
     WHERE "franchiseeId"=$1 AND "apenasEmCombo"=false ORDER BY "sortOrder"`, FRANQUEADO);
  console.log("PRODUTOS À VENDA:");
  for (const p of produtos) console.log(`  ${p.name}  —  R$ ${Number(p.price).toFixed(2)}  ${p.active ? "" : "(INATIVO)"}`);

  const grande = produtos.find((p) => p.name.includes("Grande"));
  const broto = produtos.find((p) => p.name.includes("Broto"));

  for (const [rotulo, prod, esperado] of [["BROTO", broto, 40], ["GRANDE", grande, null]]) {
    const [g] = await q(
      `SELECT id, "priceRule", "minQty", "maxQty" FROM "ComboGroup"
       WHERE "menuProductId"=$1 AND title LIKE 'Escolha o sabor%'`, prod.id);
    const itens = await q(
      `SELECT mp.name, cgi."additionalPrice" AS preco FROM "ComboGroupItem" cgi
       JOIN "MenuProduct" mp ON mp.id=cgi."menuProductId" WHERE cgi."comboGroupId"=$1`, g.id);
    console.log(`\n── ${rotulo}: ${itens.length} sabores, regra ${g.priceRule}, escolhe ${g.minQty} a ${g.maxQty} ──`);

    for (const i of itens) {
      const preco = Number(i.preco);
      const alvo = esperado !== null ? esperado : FISICO[semSufixo(i.name)];
      if (alvo === undefined) { console.log(`  FALHA ${i.name}: sem referência no físico`); erros++; continue; }
      if (Math.abs(preco - alvo) > 0.005) {
        console.log(`  FALHA ${i.name}: cadastrado R$ ${preco.toFixed(2)}, físico R$ ${alvo.toFixed(2)}`);
        erros++;
      }
    }
    console.log(`  ${erros === 0 ? "todos batem com o cardápio" : "ver falhas acima"}`);
  }

  // Meio a meio na grande, pela regra MAIOR.
  const [gg] = await q(
    `SELECT id, "priceRule" FROM "ComboGroup" WHERE "menuProductId"=$1 AND title LIKE 'Escolha o sabor%'`, grande.id);
  const itensG = await q(
    `SELECT mp.name, cgi."additionalPrice" AS preco FROM "ComboGroupItem" cgi
     JOIN "MenuProduct" mp ON mp.id=cgi."menuProductId" WHERE cgi."comboGroupId"=$1`, gg.id);
  const pg = (n) => Number(itensG.find((i) => i.name === n).preco);
  const maior = (a, b) => Math.max(a, b);

  console.log("\n── MEIO A MEIO NA GRANDE (o mais caro manda) ──");
  const casos = [
    ["Costela Desfiada (62) + Mussarela (44)", maior(pg("Costela Desfiada (Salgada)"), pg("Mussarela (Salgada)")), 62],
    ["Calabresa (44) + Portuguesa (50)", maior(pg("Calabresa (Salgada)"), pg("Portuguesa (Salgada)")), 50],
    ["Bacon (43) + Bacon (43) — inteira", maior(pg("Bacon (Salgada)"), pg("Bacon (Salgada)")), 43],
    ["Calabresa (44) + Nutella c/ Morango (54)", maior(pg("Calabresa (Salgada)"), pg("Nutella com Morango (Doce)")), 54],
    ["Costela BBQ Premium (64,90) + Mussarela (44)", maior(pg("Costela BBQ Premium"), pg("Mussarela (Salgada)")), 64.9],
  ];
  for (const [nome, obtido, esperado] of casos) {
    const ok = Math.abs(obtido - esperado) < 0.005;
    if (!ok) erros++;
    console.log(`  ${ok ? "ok   " : "FALHA"} ${nome.padEnd(46)} R$ ${obtido.toFixed(2)}`);
  }

  const [solto] = await q(
    `SELECT COUNT(*)::int AS n FROM "MenuProduct"
     WHERE "franchiseeId"=$1 AND "apenasEmCombo"=false AND "isCombo"=false`, FRANQUEADO);
  console.log(`\n  ${solto.n === 0 ? "ok   " : "FALHA"} nenhum sabor solto no cardápio (${solto.n})`);
  if (solto.n !== 0) erros++;

  console.log(erros === 0 ? "\n✅ Bate com o cardápio físico.\n" : `\n❌ ${erros} divergência(s).\n`);
  await prisma.$disconnect();
  process.exit(erros === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
