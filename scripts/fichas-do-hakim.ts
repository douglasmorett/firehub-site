/**
 * Fichas técnicas dos produtos do cardápio do Hakim, pelas respostas do Douglas
 * na revisão de 11/10/2026 (https://claude.ai/artifact/T718JGT5o8hWr2etqGVQkP).
 * Os insumos e preparos vêm de scripts/cadastrar-estoque-do-hakim.ts — rode
 * aquele antes.
 *
 *   npx tsx scripts/fichas-do-hakim.ts --loja <email>            (só o plano)
 *   npx tsx scripts/fichas-do-hakim.ts --loja <email> --gravar   (troca a ficha dos produtos listados)
 *
 * A ficha vai no PRODUTO de cada sabor. Os combos ("Monte seu Combo", "10
 * Esfirras Premium"...) usam esses produtos como opções, e a baixa soma a
 * ficha de cada opção escolhida (lib/stock.ts) — então ficha no sabor cobre
 * todos os combos. Embalagem por combo fica para quando o Douglas disser
 * quanto cada um usa.
 *
 * A ficha só serve para a baixa automática e para comparar com a contagem.
 * O CMV real vem da contagem e das compras (lib/cmv), com ou sem ficha.
 */
import { prisma } from "@/lib/prisma";

type Linha = [insumo: string, quantidade: number];

const MASSA: Linha = ["Massa de esfirra (bolinha)", 1];
const G = "Embalagem G personalizada";
const P = "Embalagem P personalizada";
const KRAFT = "Saco kraft";

/** Nome do produto (sem diferenciar caixa) → ficha, na unidade do insumo. */
const FICHAS: Record<string, Linha[]> = {
  // ── Salgadas: carne e calabresa 25 g; queijo e queijo temperado 20 g ──
  "Esfirra de Carne": [MASSA, ["Recheio de carne", 25]],
  "Esfirra de Carne (Promo)": [MASSA, ["Recheio de carne", 25]],
  "Esfirra de Calabresa": [MASSA, ["Recheio de calabresa", 25]],
  "Esfirra de Calabresa (Promo)": [MASSA, ["Recheio de calabresa", 25]],
  "Esfirra de Queijo": [MASSA, ["Queijo temperado", 20]],
  "Esfirra de Queijo (Promo)": [MASSA, ["Queijo temperado", 20]],
  "Esfirra de Queijo Temperado": [MASSA, ["Queijo temperado", 20]],
  "Esfirra de Carne c/ Mussarela": [MASSA, ["Recheio de carne", 25], ["Mussarela", 10]],
  "Esfirra de Carne c/ Catupiry": [MASSA, ["Recheio de carne", 25], ["Catupiry", 15]],
  "Esfirra de Frango": [MASSA, ["Mussarela", 20], ["Recheio de frango", 10]],
  "Esfirra de Frango c/ Catupiry": [MASSA, ["Mussarela", 20], ["Recheio de frango", 10], ["Catupiry", 15]],
  "Esfirra de Frango c/ Cheddar": [MASSA, ["Mussarela", 20], ["Recheio de frango", 10], ["Cheddar", 15]],
  "Esfirra de Bacon": [MASSA, ["Mussarela", 20], ["Bacon limpo", 8]],
  "Esfirra de Bacon c/ Catupiry": [MASSA, ["Mussarela", 20], ["Bacon limpo", 8], ["Catupiry", 15]],
  "Esfirra de Bacon c/ Cheddar": [MASSA, ["Mussarela", 20], ["Bacon limpo", 8], ["Cheddar", 15]],
  "Esfirra de 4 queijos": [MASSA, ["Mistura de 3 queijos", 20], ["Catupiry", 15]],
  // Duas listras de catupiry (10 g) e uma de cheddar (5 g).
  "Esfirra 5 Queijos": [MASSA, ["Mistura de 3 queijos", 20], ["Catupiry", 10], ["Cheddar", 5]],
  // 3 rodelas de peperoni Seara: 9 fatias = 40 g na embalagem → ~4,4 g a rodela → 13 g.
  "Esfirra de Peperoni": [MASSA, ["Mussarela", 20], ["Peperoni", 13]],
  "Esfirra Peperoni c/ Catupiry": [MASSA, ["Mussarela", 20], ["Peperoni", 13], ["Catupiry", 15]],
  // ── Doces ──
  "Esfirra de Chocolate ao Leite": [MASSA, ["Chocolate ao leite", 25]],
  "Esfirra de Chocolate Branco": [MASSA, ["Chocolate branco", 25]],
  "Esfirra Duo": [MASSA, ["Chocolate branco", 13], ["Chocolate ao leite", 13]],
  "Esfirra de Nutella": [MASSA, ["Nutella", 25]],
  "Esfirra de Romeu e Julieta": [MASSA, ["Mussarela", 20], ["Goiabada", 10]],
  "Esfirra de Banana Nevada": [MASSA, ["Banana", 0.5], ["Chocolate branco", 20]],
  // EM ABERTO: 20 g ou 25 g de chocolate? 8 M&M's ≈ 7 g.
  "Esfirra de M&M": [MASSA, ["Chocolate ao leite", 20], ["M&M's", 7]],
  "Esfirra de Kitkat": [MASSA, ["Chocolate ao leite", 20], ["Kit Kat (barra de 4 palitos)", 0.25]],
  // ── Revenda ──
  "Coca-Cola lata": [["Coca-Cola lata", 1]],
  "Coca-Cola Zero": [["Coca-Cola Zero lata", 1]],
  "Coca-Cola 2L": [["Coca-Cola 2L", 1]],
  "Fanta Laranja lata": [["Fanta Laranja lata", 1]],
  "Fanta Uva lata": [["Fanta Uva lata", 1]],
  "Guaravita 280ml": [["Guaravita 280ml", 1]],
  "Água c/ Gás": [["Água com gás", 1]],
  "Água sem gás": [["Água sem gás", 1]],
  "Batata Frita": [["Batata frita congelada", 150], ["Caixinha de batata", 1]],
  "Doguinho": [MASSA, ["Salsicha", 1], ["Mussarela", 10]],
  "Maionese Da casa Ervas Finas": [["Maionese da casa (porção)", 1]],
  "Pastel de Nata": [["Pastel de nata (pronto)", 1]],
  // Um limão em quatro: ~25 g a porção (limão de ~100 g).
  "limão": [["Limão", 25]],
  // ── Embalagem dos combos (Douglas, 11/10). A esfirra escolhida dentro do
  // combo baixa a ficha dela; aqui entra só o que o COMBO gasta de caixa e
  // saco. A esfirra avulsa vai na caixa G (4 a 6 por pedido), mas a caixa não
  // pode ir na ficha do sabor: o sabor também é opção dos combos e a caixa
  // sairia duas vezes. A da avulsa aparece pela contagem diária da caixa G.
  "10 Esfirras Premium": [[G, 2], [KRAFT, 1]],
  "20 Esfihas do Sábio": [[G, 4], [KRAFT, 2]],
  // Quase nunca sai sozinha (fica abaixo do pedido mínimo): meio kraft.
  "3 Esfirras Doces": [[G, 1], [KRAFT, 0.5]],
  "4 Esfirras de Calabresa": [[G, 1], [KRAFT, 1]],
  "4 Esfirras de Carne": [[G, 1], [KRAFT, 1]],
  "4 Esfirras de Queijo Temperado": [[G, 1], [KRAFT, 1]],
  "4 Pasteis de Nata": [[G, 1], [KRAFT, 1]],
  "Combo 10 Esfirras Simples": [[G, 2], [KRAFT, 1]],
  "Combo 6 Esfirras Premium": [[G, 1], [KRAFT, 1]],
  "Combo Imperial": [[G, 1], [KRAFT, 1]],
  "Combo do Solteiro": [[G, 1], [P, 1], [KRAFT, 1]],
  "Monte seu Combo (8 itens Variados)": [[G, 1], [KRAFT, 1]],
  // EM ABERTO: o Douglas não citou; igual aos de 4 esfirras.
  "Pedido do Rei": [[G, 1], [KRAFT, 1]],
  "Rodizio do Sábio": [[G, 2], [KRAFT, 1]],
  // A caixinha da batata está na ficha da batata (o acompanhamento escolhido).
  "Trio Hk": [[G, 1], [KRAFT, 1]],
  // O brinde (R$ 8) e a bebida entram pelas opções escolhidas.
  "Hakim Kids": [[G, 1], [P, 1], [KRAFT, 1]],
  "Oferta Hk - 5 Itens a partir de 29,90": [[G, 1], [P, 1], [KRAFT, 1]],
  "6 Nuggets": [["Nugget", 6]],
  "15 Nuggets": [["Nugget", 15]],
  "40 Nuggets": [["Nugget", 40]],
  "Panda Atrapalhado": [["Brinde Panda", 1]],
  "Panda Fitness": [["Brinde Panda", 1]],
  "Panda Fominha": [["Brinde Panda", 1]],
  "Panda Gamer": [["Brinde Panda", 1]],
  "Panda Soninho": [["Brinde Panda", 1]],
  "Panda Zen": [["Brinde Panda", 1]],
};

/** Produtos que ficam sem ficha de propósito, com o motivo. */
const SEM_FICHA_PORQUE: Record<string, string> = {
  "Nugget": "é a pergunta de quantidade; a ficha está nas opções (6, 15, 40)",
};

async function main() {
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--loja") + 1];
  const gravar = args.includes("--gravar");
  if (args.indexOf("--loja") < 0 || !email) { console.error("Use --loja <email da loja>."); process.exit(2); }

  const loja = await prisma.user.findUnique({ where: { email }, select: { id: true, storeName: true } });
  if (!loja) { console.error(`Loja ${email} não encontrada.`); process.exit(2); }

  const insumos = await prisma.stockItem.findMany({ where: { franchiseeId: loja.id, NOT: { active: false } }, select: { id: true, name: true, unit: true } });
  const insumo = new Map(insumos.map((i) => [i.name.toLowerCase(), i]));
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: loja.id, active: true },
    select: { id: true, name: true, category: true, isCombo: true, recipeItems: { select: { id: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  console.log(`Loja: ${loja.storeName} — ${gravar ? "GRAVANDO" : "só o plano"}\n`);
  const faltaInsumo = new Set<string>();
  let comFicha = 0;
  const semFicha: string[] = [];
  const usados = new Set<string>();

  for (const p of produtos) {
    const ficha = FICHAS[Object.keys(FICHAS).find((k) => k.toLowerCase() === p.name.toLowerCase()) || ""];
    if (!ficha) {
      if (!p.isCombo) semFicha.push(`${p.name} (${p.category})${SEM_FICHA_PORQUE[p.name] ? ` — ${SEM_FICHA_PORQUE[p.name]}` : ""}`);
      continue;
    }
    usados.add(p.name.toLowerCase());
    const linhas = ficha.map(([n, q]) => ({ n, q, i: insumo.get(n.toLowerCase()) }));
    const faltando = linhas.filter((l) => !l.i);
    for (const f of faltando) faltaInsumo.add(f.n);
    console.log(`${faltando.length ? "⚠️ " : "✓ "} ${p.name}: ${linhas.map((l) => `${l.q} ${l.i?.unit || "?"} ${l.n}`).join(" + ")}${p.recipeItems.length ? ` (substitui ficha de ${p.recipeItems.length} linha(s))` : ""}`);
    if (faltando.length) continue;
    comFicha++;
    if (gravar) {
      await prisma.$transaction(async (tx) => {
        await tx.productRecipe.deleteMany({ where: { menuProductId: p.id } });
        await tx.productRecipe.createMany({ data: linhas.map((l) => ({ menuProductId: p.id, stockItemId: l.i!.id, quantityConsumed: l.q })) });
      });
    }
  }

  const combos = produtos.filter((p) => p.isCombo).length;
  console.log(`\n${comFicha} produtos com ficha · ${combos} combos (baixam pela ficha das opções) · ${semFicha.length} sem ficha:`);
  for (const s of semFicha) console.log(`   - ${s}`);
  const naoAchados = Object.keys(FICHAS).filter((k) => !usados.has(k.toLowerCase()));
  if (naoAchados.length) console.log(`\nFicha pronta, produto não está ativo no cardápio: ${naoAchados.join(", ")}`);
  if (faltaInsumo.size) console.log(`\n⚠️  Insumos que faltam no estoque (rode cadastrar-estoque-do-hakim antes): ${[...faltaInsumo].join(", ")}`);
  console.log(gravar ? "\nGravado." : "\nNada foi gravado: rode com --gravar.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
