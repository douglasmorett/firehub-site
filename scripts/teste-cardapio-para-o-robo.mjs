/**
 * Prova de que o cardápio inteiro cabe no prompt do robô sem perder nada
 * (lib/cardapio-para-o-robo.ts).
 *
 *   node scripts/teste-cardapio-para-o-robo.mjs
 *
 * O defeito: o cardápio no prompt só levava as opções do produto que a
 * conversa citou em texto. Pergunta por áudio ("tem pizza de camarão?") não
 * cita nada, os sabores ficavam de fora e o robô dizia que não tem (Pizzaria
 * 17, 08/10/2026). Na Lá Casa, "pizza" citava 76 pizzas com 75 meias cada e
 * o prompt ia a 200 mil tokens.
 *
 * Quatro moldes de loja: Pizzaria 17 (5 tamanhos × os mesmos 51 sabores com
 * preços diferentes), Lá Casa/Deeds (cada sabor é um produto com Tamanho,
 * Borda e "Meio a meio" de "1/2 <outro sabor>"), hamburgueria (a mesma lista
 * de adicionais em 20 lanches) e Nugget (base R$ 0 com o preço nas opções).
 */
import { readFileSync } from "fs";
import ts from "typescript";

// A lib importa outras libs puras (preco-combo, opcao-pausada, meio-a-meio):
// cada .ts é transpilado e os imports relativos viram data: URLs, de baixo
// para cima, para o teste rodar com `node` puro.
const carregados = new Map();
async function carregar(rel) {
  const caminho = `src/lib/${rel.replace(/^\.\//, "")}.ts`;
  if (carregados.has(caminho)) return carregados.get(caminho);
  let fonte = readFileSync(caminho, "utf8");
  for (const dep of [...fonte.matchAll(/from\s+"(\.\/[^"]+)"/g)].map((m) => m[1])) {
    fonte = fonte.split(`"${dep}"`).join(`"${await carregar(dep)}"`);
  }
  const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const url = "data:text/javascript," + encodeURIComponent(js);
  carregados.set(caminho, url);
  return url;
}
const { cardapioParaORobo, brl } = await import(await carregar("./cardapio-para-o-robo"));
const { meiaNaPizza } = await import(await carregar("./meio-a-meio"));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const igual = (nome, obtido, esperado) => conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), { obtido, esperado });
const vezes = (texto, trecho) => texto.split(trecho).length - 1;
const secao = (texto, titulo) => {
  const inicio = texto.indexOf(`\n${titulo}`);
  if (inicio < 0) return "";
  const resto = texto.slice(inicio + 1);
  const fim = resto.search(/\n\n[A-ZÀ-Ú]/);
  return fim < 0 ? resto : resto.slice(0, fim);
};

const ctx = { currentDayCode: "QUI", currentDayName: "Quinta-feira", tomorrowDayCode: "SEX", tomorrowDayName: "Sexta-feira" };

// ── fábrica de fixtures (o formato que chatbot-ai.ts entrega, depois de aplicarPrecoNoCardapio) ──
let seq = 0;
const opcao = (name, additionalPrice = 0, extra = {}) => ({ additionalPrice, menuProduct: { id: `o${++seq}`, name, price: 0, active: true }, ...extra });
const pausada = (name, additionalPrice = 0) => ({ additionalPrice, menuProduct: { id: `o${++seq}`, name, price: 0, active: false } });
const grupo = (title, minQty, maxQty, items, priceRule = null) => ({ id: `g${++seq}`, title, minQty, maxQty, priceRule, items });
const produto = (name, category, price, comboGroups = [], extra = {}) => ({ id: `p${++seq}`, name, description: "", price, category, isCombo: false, availableDays: null, tags: null, comboGroups, ...extra });

// O cardápio como era antes do filtro por citação: tudo por extenso. A
// referência de tamanho — o compacto tem que ser menor que isto.
function ingenuo(produtos) {
  const linhas = [];
  for (const p of produtos) {
    linhas.push(`- PRODUTO: "${p.name}" (${p.category}) ➔ PREÇO R$ ${brl(p.price)}${p.description ? ` — ${p.description}` : ""}`);
    for (const g of p.comboGroups || []) {
      linhas.push(`    ↳ ${g.title} (escolha ${g.minQty ?? g.maxQty} a ${g.maxQty}): ${(g.items || []).map((i) => `${i.menuProduct.name}${i.additionalPrice ? ` +R$ ${brl(i.additionalPrice)}` : " (sem custo)"}`).join(" | ")}`);
    }
  }
  return linhas.join("\n");
}

// Checagens que valem para qualquer loja. `fracao`: o compacto tem que caber
// nessa fração da renderização ingênua (o cabeçalho fixo pesa em loja pequena).
function basico(nome, produtos, texto, estat, fracao, contexto = ctx) {
  const { texto: deNovo } = cardapioParaORobo(produtos, contexto);
  conferir(`${nome}: determinístico (o Gemini cacheia o prompt)`, deNovo === texto);
  conferir(`${nome}: sem undefined/NaN/null/marca interna`, !/undefined|NaN|\bnull\b|\u0000/.test(texto), texto.match(/.{0,40}(undefined|NaN|\bnull\b|\u0000).{0,40}/)?.[0]);
  conferir(`${nome}: sem hora atual nem dado de cliente`, !/agora são|cliente:|telefone|\d{2}\/\d{2}\/\d{4}/i.test(texto));
  conferir(`${nome}: cabe em ${Math.round(fracao * 100)}% da renderização ingênua`, texto.length < ingenuo(produtos).length * fracao, { compacto: texto.length, ingenuo: ingenuo(produtos).length });
  igual(`${nome}: estatísticas.chars = tamanho do texto`, estat.chars, texto.length);
  for (const t of ["CARDÁPIO (dia: Quinta-feira)", "PROMOÇÕES DE HOJE", "PROMOÇÕES DE AMANHÃ", "CRONOGRAMA DE PROMOÇÕES", "COMBOS", "PRODUTOS", "INDISPONÍVEIS HOJE"]) {
    conferir(`${nome}: seção "${t}"`, texto.includes(`\n${t}`) || texto.startsWith(t));
  }
}

// ── 1) PIZZARIA 17: 5 tamanhos × os mesmos 51 sabores, preços por tamanho ───────
console.log("\n1) Pizzaria 17 — matriz de sabores");
{
  const bases = ["Muçarela", "Calabresa", "Portuguesa", "Frango c/ Catupiry", "Marguerita", "Presunto", "Bacon c/ Ovos", "Milho com Bacon", "4 Queijos", "Atum", "Palmito", "Camarão", "Lombo Canadense", "Carne Seca", "Brigadeiro", "Banana c/ Canela", "Prestígio"];
  const sabores = bases.flatMap((b) => [b, `${b} Especial`, `${b} c/ Cheddar`]); // 51
  igual("51 sabores", sabores.length, 51);
  const tier = (s) => (/Camarão|Carne Seca|Lombo/.test(s) ? 3 : /Especial|Cheddar/.test(s) ? 2 : /Brigadeiro|Banana|Prestígio/.test(s) ? 0 : 1);
  const tabela = { P: [39, 43, 48, 59], M: [48, 55, 62, 79], G: [63, 68, 73, 99], GG: [80, 83, 90, 124], XGG: [92, 95, 99, 137] };
  const pizza = (tam, fatias, max, titulo) =>
    produto(`Pizza ${tam} (${fatias} Fatias)`, "Pizzas", 0, [grupo(titulo, 1, max, sabores.map((s) => opcao(s, tabela[tam][tier(s)])), max > 1 ? "MAIOR" : null)], { description: max > 1 ? `Até ${max} sabores. O valor da pizza é o do sabor mais caro.` : "1 sabor." });
  const dez = () => bases.slice(0, 10).map((s) => opcao(s));
  const bebida = () => grupo("Escolha a bebida", 1, 1, [opcao("Pepsi 1,5L"), opcao("Guaraná Antarctica 1,5L"), opcao("Sukita Uva 2L"), opcao("Coca-Cola 1,5L", 8)]);
  const doce = () => grupo("Pizza P doce: escolha o sabor", 1, 1, [opcao("Brigadeiro"), opcao("Banana c/ Canela"), opcao("Prestígio")]);
  const produtos = [
    produto("Coca-Cola Lata", "Bebidas", 7.9), produto("Sukita Uva 2L", "Bebidas", 14), produto("Guaraná Antarctica 1,5L", "Bebidas", 14),
    produto("COMBO 1", "Combos Pizzas", 74.99, [grupo("Pizza G: escolha 2 sabores", 2, 2, dez()), bebida()], { isCombo: true, description: "Pizza G (8 fatias) + Refrigerante" }),
    produto("COMBO 2", "Combos Pizzas", 99.99, [grupo("Pizza G: escolha 2 sabores", 2, 2, dez()), doce(), bebida()], { isCombo: true }),
    produto("COMBO 5", "Combos Pizzas", 84.99, [grupo("Pizza M: escolha 2 sabores", 2, 2, dez()), doce()], { isCombo: true }),
    produto("Batatas Recheadas", "Petiscos", 0, [grupo("Escolha o sabor", 1, 1, [opcao("Cheddar c/ Bacon (400g)", 32.99), opcao("Costela c/ Catupiry (400g)", 35.99), opcao("Carne Seca (400g)", 34.99)])]),
    pizza("XGG", "12/16", 4, "Escolha até 4 sabores (cobra o sabor mais caro)"),
    pizza("P", "4", 1, "Escolha o sabor"),
    pizza("G", "8", 2, "Escolha até 2 sabores (cobra o sabor mais caro)"),
    pizza("GG", "10", 2, "Escolha até 2 sabores (cobra o sabor mais caro)"),
    pizza("M", "6", 2, "Escolha até 2 sabores (cobra o sabor mais caro)"),
  ];
  const { texto, estatisticas } = cardapioParaORobo(produtos, ctx);
  basico("P17", produtos, texto, estatisticas, 0.6);
  igual("uma matriz, 0 meio a meio", [estatisticas.matrizes, estatisticas.meiosAMeio], [1, 0]);
  conferir("colunas em ordem de preço: P, M, G, GG, XGG", texto.includes("colunas: P = Pizza P (4 Fatias) | M = Pizza M (6 Fatias) | G = Pizza G (8 Fatias) | GG = Pizza GG (10 Fatias) | XGG = Pizza XGG (12/16 Fatias)"));
  conferir("a linha do Camarão com os 5 preços (o caso do áudio de 08/10/2026)", texto.includes("\n  Camarão: 59 | 79 | 99 | 124 | 137\n"));
  conferir("Muçarela a 43/55/68/83/95 e Brigadeiro a 39/48/63/80/92", texto.includes("\n  Muçarela: 43 | 55 | 68 | 83 | 95\n") && texto.includes("\n  Brigadeiro: 39 | 48 | 63 | 80 | 92\n"));
  const tabelaT1 = secao(texto, "TABELAS DE SABORES");
  conferir("cada um dos 51 sabores é UMA linha da tabela", sabores.every((s) => vezes(tabelaT1, `\n  ${s}: `) === 1), sabores.filter((s) => vezes(tabelaT1, `\n  ${s}: `) !== 1));
  conferir("a lista de sabores não se repete nos 5 produtos", vezes(texto, "Camarão c/ Cheddar") === 1);
  for (const [tam, col] of [["P (4 Fatias)", "P"], ["M (6 Fatias)", "M"], ["G (8 Fatias)", "G"], ["GG (10 Fatias)", "GG"], ["XGG (12/16 Fatias)", "XGG"]]) {
    const linha = texto.slice(texto.indexOf(`- Pizza ${tam} ·`)).split("\n").slice(0, 2).join("\n");
    conferir(`Pizza ${tam} aponta a coluna ${col}`, linha.includes(`tabela T1, coluna ${col}`), linha);
  }
  conferir("a regra do sabor mais caro está na pergunta", texto.includes("? Escolha até 2 sabores (cobra o sabor mais caro) (1 a 2; é 1 pizza: vale o sabor mais caro): sabores e preços na tabela T1, coluna G"));
  conferir("Pizza P: a partir de R$ 39 (o mais barato)", texto.includes("- Pizza P (4 Fatias) · a partir de R$ 39 — 1 sabor."));
  conferir("os 10 sabores dos combos vão UMA vez (lista compartilhada sob títulos diferentes)", vezes(texto, bases.slice(0, 10).join(" | ")) === 1);
  conferir("o produto cita a lista pelo título dele", texto.includes("? Pizza M: escolha 2 sabores (2 obrig.): opções da L") && texto.includes("? Pizza G: escolha 2 sabores (2 obrig.): opções da L"));
  conferir("bebida do combo: só a Coca acresce, escrita como +R$", vezes(texto, "Pepsi 1,5L | Guaraná Antarctica 1,5L | Sukita Uva 2L | Coca-Cola 1,5L +R$ 8") === 1 && !texto.includes("Pepsi 1,5L = R$"));
  conferir("'Sukita' não é combo (o /kit/ antigo)", secao(texto, "PRODUTOS").includes("- Sukita Uva 2L · R$ 14") && !secao(texto, "COMBOS").includes("Sukita Uva 2L · R$"));
  conferir("Batatas: base 0 com preço absoluto nas opções", texto.includes("- Batatas Recheadas · a partir de R$ 32,99") && texto.includes("Cheddar c/ Bacon (400g) = R$ 32,99 | Costela c/ Catupiry (400g) = R$ 35,99 | Carne Seca (400g) = R$ 34,99"));
  conferir("combo com preço fechado sem 'a partir de'", texto.includes("- COMBO 5 · R$ 84,99"));
  conferir("combo cuja bebida acresce é 'a partir de'", texto.includes("- COMBO 1 · a partir de R$ 74,99"));
}

// ── 2) LÁ CASA / DEEDS: cada sabor é um produto, com Tamanho, Borda e Meio a meio ──
console.log("\n2) Lá Casa — meio a meio vira uma regra");
{
  const TITULO = "Meio a meio? Escolha a outra metade (vale o preço da mais cara)";
  const borda = () => grupo("Borda recheada?", 0, 1, [opcao("Borda de Catupiry", 18), opcao("Borda de Cheddar", 18), opcao("Borda Mista", 19), pausada("Borda de Chocolate", 19)]);
  const base = [
    ["Calabresa", "Pizzas Salgadas", 70, 9, "Mussarela, calabresa e cebola."], ["Mussarela", "Pizzas Salgadas", 70, 9, "Mussarela e tomate."], ["Portuguesa", "Pizzas Salgadas", 77, 12, "Presunto, ovo, cebola e azeitona."],
    ["Atum", "Pizzas Salgadas", 70, 9, "Atum, cebola e mussarela."], ["Frango c/ Catupiry", "Pizzas Salgadas", 70, 9, "Frango desfiado e catupiry."], ["Costela", "Pizzas Salgadas", 77, 12, "Costela, catupiry e cebola."],
    ["Brigadeiro", "Pizzas Doces", 70, 9, "Chocolate e granulado."], ["Prestígio", "Pizzas Doces", 72, 14, "Chocolate e coco."], ["Romeu e Julieta", "Pizzas Doces", 70, 9, "Goiabada e mussarela."],
    ["Banana Nevada", "Pizzas Doces", 72, 14, "Banana, canela e chocolate branco."], ["Oreo", "Pizzas Doces", 72, 14, "Chocolate branco e Oreo."], ["Confete", "Pizzas Doces", 70, 9, "Chocolate e confete."],
  ];
  const pizzas = base.map(([name, category, price, grande, description]) =>
    produto(name, category, price, [grupo("Tamanho", 1, 1, [opcao("Broto", 0), opcao("Grande", grande)]), borda()], { description, isCombo: true }));
  // As meias como o script de lib/meio-a-meio.ts as grava: "1/2 <outra>", com a tabela por tamanho.
  for (const esta of pizzas) {
    const meias = pizzas.filter((o) => o !== esta).map((outra) => {
      const m = meiaNaPizza(esta, outra, "maior");
      return opcao(m.nome, m.additionalPrice, { precoPorEscolha: m.precoPorEscolha });
    });
    esta.comboGroups.push(grupo(TITULO, 0, 1, meias));
  }
  const produtos = [
    produto("Pizza 3 Sabores (9 fatias)", "3 Sabores", 89, [grupo("Escolha até 3 sabores", 1, 3, pizzas.map((p) => opcao(p.name))), borda()], { isCombo: true }),
    produto("Coca-Cola 2L", "Refrigerantes", 15), ...pizzas,
  ];
  const { texto, estatisticas } = cardapioParaORobo(produtos, ctx);
  basico("Lá Casa", produtos, texto, estatisticas, 0.35);
  igual("12 regras de meio a meio, 0 matriz", [estatisticas.meiosAMeio, estatisticas.matrizes], [12, 0]);
  const REGRA = `${TITULO} (opcional): a outra metade é qualquer outra pizza de Pizzas Salgadas, Pizzas Doces, escrita exatamente "1/2 <nome da pizza>"; vale o preço da metade mais cara; o sistema calcula o valor exato`;
  conferir("a regra: qualquer outra pizza das duas categorias, grafia '1/2 <nome>', mais cara, sistema calcula — UMA vez", vezes(texto, REGRA) === 1);
  conferir("a pizza mais cara (toda meia a zero) segue a MESMA regra do título, não 'sem custo extra'", !texto.includes("sem custo extra"));
  conferir("nenhuma das 132 meias é listada", vezes(texto, "1/2 ") === 1);
  const rotuloDaRegra = texto.match(/^(L\d+) = Meio a meio\?/m)?.[1];
  conferir("cada pizza cita a regra pelo rótulo", !!rotuloDaRegra && pizzas.every((p) => {
    const bloco = texto.slice(texto.indexOf(`- ${p.name} ·`)).split("\n").slice(1, 4).join("\n");
    return new RegExp(`^  perguntas: .*\\b${rotuloDaRegra}\\b`, "m").test(bloco);
  }));
  conferir("Tamanho com preço absoluto, compartilhado", vezes(texto, "Tamanho (1 obrig.): Broto = R$ 70 | Grande = R$ 79") === 1 && vezes(texto, "Broto = R$ 77 | Grande = R$ 89") === 1 && vezes(texto, "Broto = R$ 72 | Grande = R$ 86") === 1);
  conferir("Borda com +R$, uma vez, e a pausada como indisponível", vezes(texto, "Borda de Catupiry +R$ 18 | Borda de Cheddar +R$ 18 | Borda Mista +R$ 19 · indisponíveis agora, não anotar: Borda de Chocolate") === 1 && vezes(texto, "Borda de Chocolate") === 1);
  conferir("cada pizza é um produto, uma vez, com 'a partir de' e descrição", base.every(([n, , preco, , d]) => vezes(texto, `\n- ${n} · a partir de R$ ${preco} — ${d}`) === 1));
  conferir("a Pizza 3 Sabores lista os sabores pelo nome (sem custo)", texto.includes("? Escolha até 3 sabores (1 a 3): Calabresa | Mussarela | Portuguesa | Atum | Frango c/ Catupiry | Costela | Brigadeiro | Prestígio | Romeu e Julieta | Banana Nevada | Oreo | Confete"));
}

// ── 2b) Serpa: meio a meio pela média, sem meio a meio na Pequena ────────────────
console.log("\n2b) Serpa — média e tamanho bloqueado");
{
  // Quatro pizzas: a regra só substitui a lista a partir de 3 meias (com 2, a lista é menor que a frase).
  const pizzas = [["Calabresa", 40, 20], ["Camarão", 50, 40], ["Marguerita", 38, 10], ["Portuguesa", 45, 25]].map(([n, p, g]) =>
    produto(n, "Pizzas", p, [grupo("Tamanho", 1, 1, [opcao("Pequena", 0), opcao("Grande", g)])]));
  for (const esta of pizzas) {
    esta.comboGroups.push(grupo("Meio a meio? Escolha a outra metade (cobra metade do preço de cada)", 0, 1, pizzas.filter((o) => o !== esta).map((outra) => {
      const m = meiaNaPizza(esta, outra, "media", ["Pequena"]);
      return opcao(m.nome, m.additionalPrice, { precoPorEscolha: m.precoPorEscolha });
    })));
  }
  const { texto, estatisticas } = cardapioParaORobo(pizzas, ctx);
  igual("4 regras", estatisticas.meiosAMeio, 4);
  conferir("média + tamanho sem meio a meio", texto.includes('escrita exatamente "1/2 <nome da pizza>"; vale a média do preço das duas metades; não tem meio a meio no tamanho Pequena; o sistema calcula o valor exato'));
  conferir("'1/2 ' só na regra", vezes(texto, "1/2 ") === 1);
}

// ── 2c) NIK: a outra metade com o nome exato da pizza, preço = metade da diferença ──
console.log("\n2c) NIK — sem o prefixo '1/2 ', e o preço que não bate vai por extenso");
{
  const montar = (errar) => {
    const pizzas = [["Pizza Toscana", 65.9], ["Pizza Frango Catupiry", 68.9], ["Pizza Provolombo", 83.9], ["Pizza Chocolate", 53.9]].map(([n, p]) => produto(n, "Pizzas", p, []));
    for (const esta of pizzas) {
      esta.comboGroups.push(grupo("Meio a meio? Escolha a outra metade — deixe em branco para pizza inteira", 0, 1,
        pizzas.filter((o) => o !== esta).map((outra, k) => opcao(outra.name, Math.round(((outra.price - esta.price) / 2 + (errar && k === 0 ? 3 : 0)) * 100) / 100))));
    }
    return pizzas;
  };
  const certo = cardapioParaORobo(montar(false), ctx);
  igual("4 regras quando o preço bate com a média", certo.estatisticas.meiosAMeio, 4);
  conferir("a frase diz 'nome exato' e 'média'", certo.texto.includes("a outra metade é qualquer outra pizza de Pizzas, escrita com o nome exato da pizza; vale a média do preço das duas metades; o sistema calcula o valor exato"));
  const errado = cardapioParaORobo(montar(true), ctx);
  igual("preço gravado que não bate: nenhuma regra", errado.estatisticas.meiosAMeio, 0);
  conferir("…e a meia vai por extenso, com o desconto", errado.texto.includes("Pizza Toscana −R$ ") && errado.texto.includes("(desconta)"));
}

// ── 3) HAMBURGUERIA: a mesma lista de adicionais em 20 lanches ───────────────────
console.log("\n3) Hamburgueria — lista compartilhada, promoção, dia da semana, pausada, desconto");
{
  const turbine = () => grupo("Turbine seu Burger", 0, 5, [opcao("Ovo", 3), opcao("Bacon", 4), opcao("Presunto", 3), opcao("Queijo prato", 4), opcao("Creme de cheddar", 5), opcao("Catupiry", 5), opcao("Cebola caramelizada", 6), opcao("Filé de frango empanado", 7)]);
  const ponto = () => grupo("Ponto da carne", 1, 1, [opcao("Mal passada"), opcao("Ao ponto"), opcao("Bem passada")]);
  const nomes = ["X-Burger", "X-Salada", "X-Bacon", "X-Egg", "X-Frango", "X-Calabresa", "X-Picanha", "X-Costela", "X-Duplo", "X-Triplo", "X-Cheddar", "X-Catupiry", "X-Vegetariano", "X-Smash", "X-Bife", "X-Lombo", "X-Pernil", "X-Filé", "X-Mignon"];
  const produtos = [
    ...nomes.map((n, i) => produto(n, "Lanches", 25 + i, [turbine(), ponto()], { description: `Pão, carne 120g e ${n.slice(2).toLowerCase()}.` })),
    produto("X-Tudo", "Lanches", 42, [turbine(), ponto()], { availableDays: '["SEG","TER"]' }),
    produto("X-Promo", "Lanches", 25, [turbine()], { precoDe: 30, tags: '["PROMO"]' }),
    produto("Combo Casal", "Combos", 59.9, [grupo("Bebida", 1, 1, [opcao("Coca 2L"), opcao("Guaraná 2L")])], { isCombo: true, availableDays: '["SEX","SAB"]', tags: '["Oferta"]' }),
    produto("Refrigerante", "Bebidas", 0, [grupo("Sabores", 1, 10, [opcao("Coca Lata", 5.99), opcao("Guaraná Lata", 4.99), pausada("Coca 600ml", 7.5)])]),
    produto("Água", "Bebidas", 3),
    produto("Bjorn Ironside", "Pizzas", 109.9, [grupo("Meio a meio?", 0, 1, [opcao("1/2 Calabresa", -22), opcao("1/2 Ragnar", -10)])], { description: "A pizza mais cara da casa, com direito a metade mais barata." }),
  ];
  const { texto, estatisticas } = cardapioParaORobo(produtos, ctx);
  basico("Hamburgueria", produtos, texto, estatisticas, 0.4);
  conferir("'Turbine seu Burger' vai UMA vez, com os preços", vezes(texto, "Turbine seu Burger (até 5, opcional): Ovo +R$ 3 | Bacon +R$ 4 | Presunto +R$ 3 | Queijo prato +R$ 4 | Creme de cheddar +R$ 5 | Catupiry +R$ 5 | Cebola caramelizada +R$ 6 | Filé de frango empanado +R$ 7") === 1 && vezes(texto, "Bacon +R$ 4") === 1);
  conferir("'Ponto da carne' sem custo: só os nomes", vezes(texto, "Ponto da carne (1 obrig.): Mal passada | Ao ponto | Bem passada") === 1);
  conferir("os 19 lanches de hoje citam as duas listas", nomes.every((n) => /^  perguntas: L\d+, L\d+$/m.test(texto.slice(texto.indexOf(`- ${n} ·`)).split("\n")[1])));
  conferir("X-Tudo só segunda e terça: fora de PRODUTOS, em INDISPONÍVEIS", !secao(texto, "PRODUTOS").includes("X-Tudo") && secao(texto, "INDISPONÍVEIS HOJE").includes("- X-Tudo (Lanches): só Segunda-feira, Terça-feira"));
  // "a partir de" porque o adicional opcional tem preço — é a regra de sempre (precoVariaPorEscolha).
  conferir("promoção de hoje com o preço de tabela", secao(texto, "PROMOÇÕES DE HOJE").includes("- X-Promo · a partir de R$ 25 (de R$ 30)") && !secao(texto, "PROMOÇÕES DE HOJE").includes("Combo Casal"));
  conferir("promoção de amanhã (sexta): as duas", secao(texto, "PROMOÇÕES DE AMANHÃ").includes("- X-Promo (Lanches) · R$ 25") && secao(texto, "PROMOÇÕES DE AMANHÃ").includes("- Combo Casal (Combos) · R$ 59,90"));
  conferir("cronograma: uma linha por promoção com os dias", secao(texto, "CRONOGRAMA").includes("- X-Promo (R$ 25): todos os dias") && secao(texto, "CRONOGRAMA").includes("- Combo Casal (R$ 59,90): Sexta-feira, Sábado"));
  conferir("Combo Casal de sexta não está em COMBOS hoje", !secao(texto, "COMBOS").includes("Combo Casal") && secao(texto, "INDISPONÍVEIS HOJE").includes("- Combo Casal (Combos): só Sexta-feira, Sábado"));
  conferir("a opção pausada aparece só como indisponível", vezes(texto, "Coca 600ml") === 1 && texto.includes("Sabores (1 a 10): Coca Lata +R$ 5,99 | Guaraná Lata +R$ 4,99 · indisponíveis agora, não anotar: Coca 600ml"));
  conferir("Refrigerante: a partir do sabor mais barato", texto.includes("- Refrigerante · a partir de R$ 4,99"));
  conferir("meia que desconta, sem produto por trás: por extenso", texto.includes("? Meio a meio? (opcional): 1/2 Calabresa −R$ 22 (desconta) | 1/2 Ragnar −R$ 10 (desconta)"));
  conferir("a tag do produto vai curta", texto.includes("- X-Promo · a partir de R$ 25 (de R$ 30) [PROMO]"));
}

// ── 4) NUGGET: base R$ 0 com o preço nas opções; horário, estoque, opção de combo ──
console.log("\n4) Nugget — base zero, horário do produto, estoque, só-opção-de-combo");
{
  const nugget = produto("Nugget", "Petiscos", 0, [grupo("Tamanho", 1, 1, [opcao("6 unidades", 9.9), opcao("15 unidades", 19.9), opcao("40 unidades", 39.9)])]);
  const marmita = produto("Marmita do dia", "Almoço", 22, [], { availableHours: { de: "09:00", ate: "14:00" } });
  const caldo = produto("Caldo de feijão", "Jantar", 18, [], { availableHours: { de: "18:00", ate: "23:00" } });
  const esgotado = produto("Esfiha de carne", "Esfihas", 3.5);
  const ultimas = produto("Esfiha de queijo", "Esfihas", 3.5);
  const soOpcao = produto("Molho BBQ", "Complementos", 4);
  const travado = produto("Combo Lata", "Combos", 30, [grupo("Refrigerante", 1, 1, [pausada("Coca Lata")])], { perguntaTravadaPelaPausa: "Refrigerante", isCombo: true });
  const comPipe = produto("Pastel de Carne | antigo", "Pastéis", 12, [], { description: "x".repeat(200) });
  const produtos = [nugget, marmita, caldo, esgotado, ultimas, soOpcao, travado, comPipe];
  const contexto = {
    ...ctx,
    idsSoDeOpcaoDeCombo: new Set([soOpcao.id]),
    estoque: new Map([[esgotado.id, { restam: 0, pausaAoZerar: true }], [ultimas.id, { restam: 2, pausaAoZerar: true }]]),
    idsForaDoHorarioAgora: new Set([caldo.id]),
    horarioPorId: new Map([[marmita.id, "das 09:00 às 14:00"], [caldo.id, "das 18:00 às 23:00"]]),
  };
  const { texto, estatisticas } = cardapioParaORobo(produtos, contexto);
  // Loja de 8 itens: o cabeçalho fixo pesa mais que o cardápio — o ingênuo
  // ganha, e tudo bem; o que se prova aqui é o conteúdo.
  basico("Nugget", produtos, texto, estatisticas, 2, contexto);
  conferir("Nugget: a partir de R$ 9,90 e cada tamanho com preço absoluto", texto.includes("- Nugget · a partir de R$ 9,90\n  ? Tamanho (1 obrig.): 6 unidades = R$ 9,90 | 15 unidades = R$ 19,90 | 40 unidades = R$ 39,90"));
  conferir("marmita no horário: a linha diz o horário", texto.includes("- Marmita do dia · R$ 22 [só das 09:00 às 14:00]"));
  conferir("caldo fora do horário: indisponível, com o horário", secao(texto, "INDISPONÍVEIS HOJE").includes("- Caldo de feijão (Jantar): fora do horário agora (só das 18:00 às 23:00; se perguntarem, diga o horário)") && !secao(texto, "PRODUTOS").includes("Caldo"));
  conferir("esgotado sai; últimas 2 avisam", secao(texto, "INDISPONÍVEIS HOJE").includes("- Esfiha de carne (Esfihas): esgotado hoje") && texto.includes("- Esfiha de queijo · R$ 3,50 [últimas 2 unid., não anotar mais que isso]"));
  conferir("só-opção-de-combo fica de fora", !texto.includes("Molho BBQ"));
  conferir("combo travado pela pausa", secao(texto, "INDISPONÍVEIS HOJE").includes('- Combo Lata (Combos): sem as opções de "Refrigerante" (pausadas)') && !secao(texto, "COMBOS").includes("Combo Lata"));
  conferir("nome antes do '|' e descrição cortada em ~120", texto.includes("- Pastel de Carne · R$ 12 — " + "x".repeat(119) + "…") && !texto.includes("antigo"));
  igual("estatísticas", [estatisticas.produtos, estatisticas.grupos, estatisticas.opcoes], [4, 1, 3]);
}

// ── 5) INDISPONÍVEIS agrupados por motivo (a NIK tem 27 pizzas "só quarta") ──────
console.log("\n5) Indisponíveis agrupados");
{
  const produtos = ["Pizza A", "Pizza B", "Pizza C"].map((n) => produto(n, "QUARTA COM BORDA GRÁTIS", 50, [], { availableDays: ["QUA"] }));
  const { texto } = cardapioParaORobo(produtos, ctx);
  conferir("uma linha para as três", texto.includes("- (QUARTA COM BORDA GRÁTIS) só Quarta-feira: Pizza A, Pizza B, Pizza C"));
  conferir("sem combo nem produto", texto.includes("COMBOS\n- nenhum combo cadastrado") && texto.includes("PRODUTOS\n- nenhum item avulso cadastrado"));
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
