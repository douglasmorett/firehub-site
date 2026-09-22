/**
 * Audita o cardápio cadastrado contra o CARDÁPIO FÍSICO — o único que o dono
 * me mandou. Diz, item a item, o que o físico confirma e o que NÃO está nele.
 */
const fs = require("fs");
const src = fs.readFileSync("C:/Users/FINANCEIRO/Documents/firehub-site/scratch/achar-pedido-197.js", "utf8");
const url = (src.match(/postgres[a-z]*:\/\/[^"']+/) || [])[0];
const { PrismaClient } = require("C:/Users/FINANCEIRO/Documents/firehub-site/node_modules/@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const FRANQUEADO = "cmucxpr8s002fqt01ouza8gml";

/** Transcrito da FOTO. Nome → descrição, exatamente como está impresso. */
const FISICO = {
  "À Moda da Casa": "Mussarela, presunto, bacon, alho, tomate e manjericão",
  "À Moda do Chefe": "5 ingredientes da sua preferência",
  "Alemã": "Mussarela, bacon, tomate e cebola",
  "Atum Sólido com Mussarela": "Atum com mussarela e cebola",
  "Bacon": "Mussarela com bacon",
  "Bauru": "Mussarela, presunto e tomate",
  "Brasileira": "Frango, milho, bacon, requeijão e cheddar",
  "Brócolis": "Mussarela, brócolis, bacon e alho frito",
  "Caipira": "Frango, mussarela, bacon e milho",
  "Calabresa": "Calabresa com cebola",
  "Calabresa com Requeijão": "Calabresa com requeijão",
  "Calzone Fechado": "Frango, mussarela, presunto, palmito e requeijão",
  "Canadense": "Lombo, requeijão e queijo",
  "Carijó": "Frango, bacon, milho e requeijão",
  "Corinthiana": "Lombo, queijo, presunto e bacon",
  "Costela Desfiada": "Mussarela, costela e requeijão",
  "Dois Queijos": "Mussarela e requeijão",
  "Frango com Requeijão": "Mussarela, frango com Catupiry original",
  "Jardineira": "Frango, mussarela, milho, ervilha e bacon",
  "Marguerita": "Mussarela, tomate e manjericão fresco",
  "Milho": "Mussarela com milho",
  "Mussarela": "Mussarela e orégano",
  "Napolitana": "Mussarela, tomate e parmesão",
  "Palmito": "Mussarela com palmito",
  "Paola": "Calabresa, mussarela, presunto e requeijão",
  "Peruana": "Mussarela, atum, champignon e requeijão",
  "Portuguesa": "Presunto, mussarela, ervilha, ovos e cebola",
  "Quatro Queijos": "Mussarela, provolone, gorgonzola e requeijão",
  "Romana": "Mussarela, calabresa e provolone",
  "Saborosa": "Mussarela, atum, palmito, ovos e requeijão",
  "Siciliana": "Mussarela, presunto, ervilha e bacon",
  "Toscana": "Calabresa, mussarela e tomate",
  "Banana com Queijo": "Banana com mussarela, leite condensado e canela",
  "Banana Nevada": "Banana, leite condensado, chocolate branco e canela",
  "Chocolate com Morango": "Morango com chocolate",
  "Nutella com Morango": "Nutella com morango",
  "Nutella com Banana": "Nutella com banana",
  "Sonho de Valsa": "Leite condensado, chocolate preto, sonho de valsa e creme de leite",
  "Pepperoni Suprema": "Pepperoni selecionado, mussarela especial, requeijão cremoso e parmesão",
  "Havaiana Premium": "Presunto, mussarela e abacaxi selecionado",
  "Costela BBQ Premium": "Costela desfiada, tomate fresco, mussarela e molho barbecue",
  "Frango BBQ Supremo": "Frango desfiado, mussarela, bacon crocante e molho barbecue",
};

/** O que o físico NÃO traz — veio da busca que eu fiz, não do dono. */
const FORA_DO_FISICO = {
  "Ouro Branco": "o físico junta com Sonho de Valsa numa linha só e não descreve separado",
  "Sem Borda": "o físico não fala de borda",
  "Borda Scala (salgada)": "o físico não fala de borda",
  "Borda Chocolate (pizza doce)": "o físico não fala de borda",
  "Borda Catupiry Original (salgada)": "o físico não fala de borda",
  "Borda Cheddar (salgada)": "o físico não fala de borda",
  "Borda Chocolate (pizza salgada)": "o físico não fala de borda",
  "Coca-Cola 1L": "o combo do físico diz Coca-Cola 1L, mas não vende a bebida avulsa",
  "Coca-Cola Zero 1L": "o combo do físico diz 'normal ou zero'",
};

const semSufixo = (n) => n.replace(/ \((Salgada|Doce|Premium)\)$/, "");
const norm = (s) => String(s || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

(async () => {
  const itens = await prisma.$queryRawUnsafe(
    `SELECT name, description FROM "MenuProduct"
     WHERE "franchiseeId"=$1 AND "apenasEmCombo"=true ORDER BY "sortOrder"`, FRANQUEADO);

  const confirmados = [], divergentes = [], foraDoFisico = [];
  for (const i of itens) {
    const chave = semSufixo(i.name);
    if (FORA_DO_FISICO[chave] || FORA_DO_FISICO[i.name]) {
      foraDoFisico.push([i.name, FORA_DO_FISICO[chave] || FORA_DO_FISICO[i.name]]);
      continue;
    }
    const esperado = FISICO[chave];
    if (esperado === undefined) { divergentes.push([i.name, "(não achei no físico)", i.description]); continue; }
    if (norm(esperado) === norm(i.description)) confirmados.push(i.name);
    else divergentes.push([i.name, esperado, i.description]);
  }

  console.log(`CONFIRMADOS PELO CARDÁPIO FÍSICO: ${confirmados.length}`);
  console.log(`\nDIVERGENTES: ${divergentes.length}`);
  for (const [n, fis, banco] of divergentes) {
    console.log(`  ${n}`);
    console.log(`     físico: ${fis}`);
    console.log(`     banco : ${banco}`);
  }
  console.log(`\nNÃO ESTÃO NO FÍSICO (vieram da busca que eu fiz): ${foraDoFisico.length}`);
  for (const [n, por] of foraDoFisico) console.log(`  ${n} — ${por}`);

  await prisma.$disconnect();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
