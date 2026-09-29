/**
 * Põe o MEIO A MEIO dentro de cada pizza de uma loja: a pizza do card é uma
 * metade, e uma pergunta opcional escolhe a outra entre as demais pizzas.
 *
 * É o jeito do Menudino (e do Wabiz): o cliente abre "Pizza Calabresa", escolhe
 * o tamanho e, se quiser, a outra metade entre as demais pizzas. Entrou aqui
 * em 25/09/2026 com a Ragnar Burger, que tinha isso no Menudino e perdeu na
 * cópia. Em 27/09/2026 ganhou o TAMANHO na conta, para a Serpa Pizzaria, onde
 * o Grande custa diferente em cada sabor (Margueritha +10, Camarão +40).
 *
 * ── A CONTA ─────────────────────────────────────────────────────────────────
 *
 * Mora em src/lib/meio-a-meio.ts (a mesma que o painel usa para refazer as
 * meias quando o preço de uma pizza muda). Em resumo, no tamanho escolhido:
 *
 *   média (padrão, "metade de cada"):  final = (esta + outra) / 2
 *   --regra=maior ("a mais cara"):      final = max(esta, outra)
 *
 * A meia cobra final − esta, por tamanho, em `precoPorEscolha`. O acréscimo
 * NEGATIVO (outra mais barata) é o que faz a ordem não importar, e só é cobrado
 * certo com `pisoDoPreco` no servidor.
 *
 * A opção é um produto "1/2 <nome da pizza>" (Complementos, apenasEmCombo),
 * com a foto e a descrição da pizza: é o nome que a comanda imprime embaixo
 * do item. A nota da opção mostra o preço FINAL em cada tamanho.
 *
 * A pergunta entra logo depois da de tamanho (ou primeiro, sem tamanho), e o
 * título diz a regra ao cliente. Idempotente: a pergunta é achada pelo título
 * ("Meio a meio?..."), os vínculos são refeitos.
 *
 * A simulação confere TODA combinação (sabor × sabor × tamanho) pelo motor de
 * preço do FireHub (lib/preco-combo.ts); com divergência, nada é gravado.
 *
 *   node --experimental-strip-types scripts/meio-a-meio-nas-pizzas.mjs <franchiseeId> [--gravar] [--regra=maior] [--categorias="Pizzas A,Pizzas B"]
 *
 * Sem --categorias: toda categoria que começa com "Pizza".
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { TITULO_DO_MEIO, ehPerguntaDeMeio, ehPerguntaDeTamanho, meiaNaPizza, precosPorTamanho } from "../src/lib/meio-a-meio.ts";
import { precoUnitarioDoItem } from "../src/lib/preco-combo.ts";

const [franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");
const REGRA = (process.argv.find((a) => a.startsWith("--regra=")) || "--regra=media").split("=")[1];
const CATS = (process.argv.find((a) => a.startsWith("--categorias=")) || "").split("=")[1];
// Tamanhos em que a casa NÃO faz meio a meio (--sem-meio=Pequena): a meia fica
// bloqueada neles (null na tabela). A Serpa, desde 29/09/2026.
const SEM_MEIO = ((process.argv.find((a) => a.startsWith("--sem-meio=")) || "").split("=")[1] || "")
  .split(",").map((x) => x.trim()).filter(Boolean);
if (!franchiseeId || !["media", "maior"].includes(REGRA)) {
  console.log('uso: node --experimental-strip-types scripts/meio-a-meio-nas-pizzas.mjs <franchiseeId> [--gravar] [--regra=media|maior] [--categorias="Pizzas A,Pizzas B"] [--sem-meio=Pequena]');
  process.exit(1);
}

function urlDoBanco() {
  if (existsSync("scratch/check-firehub-db-clean.js")) {
    const m = readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/);
    if (m) return m[0];
  }
  return readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)[1];
}
const sql = neon(urlDoBanco());
const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const brl = (n) => n.toFixed(2).replace(".", ",");
const TITULO = TITULO_DO_MEIO[REGRA];

const [loja] = await sql`SELECT "storeName" FROM "User" WHERE "id" = ${franchiseeId}`;
if (!loja) {
  console.log(`não existe loja com id ${franchiseeId}`);
  process.exit(1);
}
const categorias = CATS ? CATS.split(",").map((c) => c.trim()) : null;
const pizzas = (
  await sql`
    SELECT "id","name","description","price","priceSalao","priceDelivery","priceTotem","promoPrice","imageUrl","category"
    FROM "MenuProduct"
    WHERE "franchiseeId" = ${franchiseeId} AND NOT "apenasEmCombo" AND "active"`
).filter((p) => (categorias ? categorias.includes(p.category) : /^pizza/i.test(p.category)));

if (pizzas.length < 2) {
  console.log(`achei ${pizzas.length} pizza(s) ativa(s) — nada para combinar`);
  process.exit(1);
}

// As perguntas de cada pizza, com as opções — é delas que sai o preço por tamanho.
const grupos = await sql`
  SELECT "id", "menuProductId", "title", "sortOrder"
  FROM "ComboGroup" WHERE "menuProductId" = ANY(${pizzas.map((p) => p.id)}) ORDER BY "sortOrder", "id"`;
const opcoesDosGrupos = await sql`
  SELECT gi."comboGroupId", gi."additionalPrice", gi."additionalPriceSalao", gi."additionalPriceDelivery", gi."additionalPriceTotem", o."name"
  FROM "ComboGroupItem" gi JOIN "MenuProduct" o ON o."id" = gi."menuProductId"
  WHERE gi."comboGroupId" = ANY(${grupos.map((g) => g.id)}) ORDER BY gi."sortOrder", gi."id"`;
for (const p of pizzas) {
  p.grupos = grupos.filter((g) => g.menuProductId === p.id);
  p.comboGroups = p.grupos.map((g) => ({
    id: g.id,
    title: g.title,
    items: opcoesDosGrupos.filter((i) => i.comboGroupId === g.id).map((i) => ({ ...i, menuProduct: { name: i.name } })),
  }));
}

// Preço por canal ou promoção mudariam a conta por canal; esta versão não os traduz.
const comCanal = pizzas.filter(
  (p) =>
    p.priceSalao || p.priceDelivery || p.priceTotem || p.promoPrice ||
    p.comboGroups.some((g) => ehPerguntaDeTamanho(g.title) && g.items.some((i) => i.additionalPriceSalao || i.additionalPriceDelivery || i.additionalPriceTotem))
);
if (comCanal.length) {
  console.log("PAREI — pizza com preço por canal ou promoção (a diferença mudaria por canal):");
  for (const p of comCanal) console.log(`  ✖ ${p.name}`);
  process.exit(1);
}

const ordenadas = [...pizzas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

// Opções já existentes ("1/2 ..." em Complementos), pelo nome exato.
const opcoes = new Map(
  (await sql`
    SELECT "id","name" FROM "MenuProduct"
    WHERE "franchiseeId" = ${franchiseeId} AND "apenasEmCombo" AND "category" = 'Complementos' AND "name" LIKE '1/2 %'`).map((o) => [o.name, o]),
);

// ── PLANO + CONFERÊNCIA ─────────────────────────────────────────────────────
// Primeiro monta tudo e confere cada combinação pelo motor; só grava depois.
const conta = { perguntasNovas: 0, perguntasRefeitas: 0, opcoesNovas: 0, vinculos: 0, conferidas: 0 };
const erros = [];
const amostra = [];
const planos = [];

for (const p of ordenadas) {
  const antigo = p.grupos.find((g) => ehPerguntaDeMeio(g.title));
  const outros = p.grupos.filter((g) => g !== antigo);
  const grupoId = antigo?.id || novoId("cg_");
  if (antigo) conta.perguntasRefeitas++;
  else conta.perguntasNovas++;

  // Ordem: tamanho, meio a meio, o resto (borda...). Sem tamanho, meio a meio primeiro.
  const ordem = [...outros];
  ordem.splice(outros.findIndex((g) => ehPerguntaDeTamanho(g.title)) + 1, 0, { id: grupoId });

  const meias = ordenadas.filter((x) => x.id !== p.id).map((q) => ({ q, meia: meiaNaPizza(p, q, REGRA, SEM_MEIO) }));
  conta.vinculos += meias.length;

  // A pizza como ficará no banco, cobrada por precoUnitarioDoItem (o que o
  // servidor usa), contra a conta feita à mão, em cada tamanho.
  const comboGroups = [
    ...outros.map((g) => p.comboGroups.find((c) => c.id === g.id)),
    { id: grupoId, title: TITULO, items: meias.map(({ meia }) => ({ ...meia, menuProduct: { name: meia.nome } })) },
  ];
  const tamanho = p.comboGroups.find((g) => ehPerguntaDeTamanho(g.title));
  for (const { q, meia } of meias) {
    const daOutra = precosPorTamanho(q);
    for (const [t, precoEsta] of precosPorTamanho(p)) {
      const precoOutra = daOutra.get(t) ?? (daOutra.size === 1 ? [...daOutra.values()][0] : undefined);
      if (precoOutra === undefined) continue;
      const esperado = REGRA === "maior" ? Math.max(precoEsta, precoOutra) : Math.round(((precoEsta + precoOutra) / 2) * 100) / 100;
      const escolhas = { [grupoId]: { [meia.nome]: 1 } };
      if (tamanho && t) escolhas[tamanho.id] = { [t]: 1 };
      const cobrado = precoUnitarioDoItem({ price: p.price, comboGroups }, escolhas);
      conta.conferidas++;
      if (Math.abs(cobrado - esperado) > 0.001) erros.push(`${p.name} ${t} + ${meia.nome}: motor ${brl(cobrado)} × esperado ${brl(esperado)}`);
      if (amostra.length < 6 && /^calabresa$/i.test(p.name) && /(camar|margu)/i.test(q.name))
        amostra.push(`${p.name} ${t} + ${meia.nome}: R$ ${brl(cobrado)}  (nota: ${meia.optionNote})`);
    }
  }
  planos.push({ p, antigo, grupoId, ordem, meias });
}

if (GRAVAR && erros.length === 0) {
  for (const { p, antigo, grupoId, ordem, meias } of planos) {
    const comandos = [];
    if (antigo) {
      comandos.push(sql`UPDATE "ComboGroup" SET "title" = ${TITULO}, "minQty" = 0, "maxQty" = 1, "priceRule" = NULL WHERE "id" = ${grupoId}`);
      comandos.push(sql`DELETE FROM "ComboGroupItem" WHERE "comboGroupId" = ${grupoId}`);
    } else {
      comandos.push(sql`
        INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
        VALUES (${grupoId}, ${p.id}, ${TITULO}, 1, 0, NULL, 0)`);
    }
    ordem.forEach((g, i) => comandos.push(sql`UPDATE "ComboGroup" SET "sortOrder" = ${i} WHERE "id" = ${g.id}`));
    comandos.push(sql`UPDATE "MenuProduct" SET "isCombo" = true, "updatedAt" = NOW() WHERE "id" = ${p.id}`);

    for (const [ordemDaOpcao, { q, meia }] of meias.entries()) {
      let opcao = opcoes.get(meia.nome);
      if (!opcao) {
        conta.opcoesNovas++;
        opcao = { id: novoId("prd_"), name: meia.nome, atualizada: true };
        opcoes.set(meia.nome, opcao);
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
          VALUES (${opcao.id}, ${franchiseeId}, ${meia.nome}, ${q.description || ""}, 0, ${q.imageUrl}, 'Complementos', 0,
                  true, false, false, true, NOW(), NOW())`;
      } else if (!opcao.atualizada) {
        opcao.atualizada = true;
        await sql`
          UPDATE "MenuProduct" SET "description" = ${q.description || ""}, "imageUrl" = ${q.imageUrl}, "active" = true, "updatedAt" = NOW()
          WHERE "id" = ${opcao.id}`;
      }
      comandos.push(sql`
        INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice","precoPorEscolha","maxPerItem","optionNote","sortOrder")
        VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${meia.additionalPrice},
                ${meia.precoPorEscolha ? JSON.stringify(meia.precoPorEscolha) : null}::jsonb, NULL, ${meia.optionNote}, ${ordemDaOpcao})`);
    }
    await sql.transaction(comandos);
  }
} else {
  conta.opcoesNovas = new Set(planos.flatMap((pl) => pl.meias.map((m) => m.meia.nome)).filter((n) => !opcoes.has(n))).size;
}

console.log(GRAVAR && erros.length === 0 ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
console.log(`loja: ${loja.storeName} · regra: ${REGRA === "maior" ? "a mais cara" : "metade de cada"} · ${pizzas.length} pizzas`);
console.log(`perguntas novas ${conta.perguntasNovas} · refeitas ${conta.perguntasRefeitas} · opções novas ${conta.opcoesNovas} · vínculos ${conta.vinculos}`);
console.log(`conferidas pelo motor: ${conta.conferidas} combinações · divergentes: ${erros.length}`);
for (const a of amostra) console.log("  · " + a);
for (const e of erros.slice(0, 20)) console.log("  ✖ " + e);
if (erros.length) {
  if (GRAVAR) console.log("NADA GRAVADO por causa das divergências.");
  process.exit(1);
}
