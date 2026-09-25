/**
 * Põe o MEIO A MEIO dentro de cada pizza de uma loja: a pizza do card é uma
 * metade, e uma pergunta opcional escolhe a outra entre as demais pizzas.
 *
 * É o jeito do Menudino (e do Wabiz): o cliente abre "Pizza Calabresa", toca
 * em "Adicionar sabor" e escolhe qualquer outra pizza do cardápio. Entrou aqui
 * em 25/09/2026 com a Ragnar Burger, que tinha isso no Menudino e perdeu na
 * cópia — as 13 pizzas vieram avulsas, sem caminho de meio a meio no delivery
 * nem nas mesas.
 *
 * ── A CONTA ─────────────────────────────────────────────────────────────────
 *
 * O card cobra o preço cheio da pizza dele; a pergunta cobra a DIFERENÇA:
 *
 *   média (padrão, é o Menudino da Ragnar):  acréscimo = (outra − esta) / 2
 *       Calabresa 65,90 + meia Bjorn 109,90  → 65,90 + 22,00 = 87,90
 *       Bjorn 109,90 + meia Calabresa 65,90  → 109,90 − 22,00 = 87,90
 *   --regra=maior (a mais cara das duas):     acréscimo = max(0, outra − esta)
 *
 * O acréscimo NEGATIVO é o que faz a ordem não importar. Ele só é cobrado
 * certo com `pisoDoPreco` no servidor (commit "Meio a meio: a meia pizza mais
 * barata desconta..."): antes dele o delivery e a mesa usavam o "a partir de"
 * como piso e lançavam a Bjorn cheia. Não gravar com --regra=media numa
 * produção sem esse commit.
 *
 * Cada opção leva `optionNote` com o preço FINAL daquela combinação ("Meio a
 * meio sai por R$ 87,90"), que é o número que o cliente quer ver — o mesmo
 * truque que resolveu a NIK.
 *
 * A opção é um produto "1/2 <nome da pizza>" (Complementos, apenasEmCombo),
 * com a foto e a descrição da pizza: é o nome que a comanda imprime embaixo
 * do item ("Pizza Bjorn Ironside ↳ 1/2 Pizza Calabresa Gd 35cm"), igual ao
 * que o Menudino mostra no carrinho.
 *
 * Idempotente: a pergunta é achada pelo título ("Meio a meio?..."), os
 * vínculos são refeitos. Rodar de novo depois de um reajuste recalcula tudo.
 *
 *   node scripts/meio-a-meio-nas-pizzas.mjs <franchiseeId> [--gravar] [--regra=maior] [--categorias="Pizzas A,Pizzas B"]
 *
 * Sem --categorias: toda categoria que começa com "Pizza".
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");
const REGRA = (process.argv.find((a) => a.startsWith("--regra=")) || "--regra=media").split("=")[1];
const CATS = (process.argv.find((a) => a.startsWith("--categorias=")) || "").split("=")[1];
if (!franchiseeId || !["media", "maior"].includes(REGRA)) {
  console.log('uso: node scripts/meio-a-meio-nas-pizzas.mjs <franchiseeId> [--gravar] [--regra=media|maior] [--categorias="Pizzas A,Pizzas B"]');
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
const r2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => n.toFixed(2).replace(".", ",");
const TITULO = "Meio a meio? Escolha a outra metade — deixe em branco para pizza inteira";
const ehPerguntaDeMeio = (t) => /^meio a meio\?/i.test(String(t || "").trim());

const [loja] = await sql`SELECT "storeName" FROM "User" WHERE "id" = ${franchiseeId}`;
if (!loja) {
  console.log(`não existe loja com id ${franchiseeId}`);
  process.exit(1);
}
const categorias = CATS ? CATS.split(",").map((c) => c.trim()) : null;
const pizzas = (
  await sql`
    SELECT "id","name","description","price","priceSalao","priceDelivery","priceTotem","promoPrice","imageUrl","category","active"
    FROM "MenuProduct"
    WHERE "franchiseeId" = ${franchiseeId} AND NOT "apenasEmCombo" AND "active"`
).filter((p) => (categorias ? categorias.includes(p.category) : /^pizza/i.test(p.category)));

if (pizzas.length < 2) {
  console.log(`achei ${pizzas.length} pizza(s) ativa(s) — nada para combinar`);
  process.exit(1);
}
// Preço por canal ou promoção mudariam a conta por canal; esta versão não os traduz.
const comCanal = pizzas.filter((p) => p.priceSalao || p.priceDelivery || p.priceTotem || p.promoPrice);
if (comCanal.length) {
  console.log("PAREI — pizza com preço por canal ou promoção (a diferença mudaria por canal):");
  for (const p of comCanal) console.log(`  ✖ ${p.name}`);
  process.exit(1);
}

const ordenadas = [...pizzas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
const acrescimo = (esta, outra) =>
  REGRA === "maior" ? r2(Math.max(0, outra.price - esta.price)) : r2((outra.price - esta.price) / 2);

// Opções já existentes ("1/2 ..." em Complementos), pelo nome exato.
const opcoes = new Map(
  (await sql`
    SELECT "id","name" FROM "MenuProduct"
    WHERE "franchiseeId" = ${franchiseeId} AND "apenasEmCombo" AND "category" = 'Complementos' AND "name" LIKE '1/2 %'`).map((o) => [o.name, o]),
);

const conta = { perguntasNovas: 0, perguntasRefeitas: 0, opcoesNovas: 0, vinculos: 0 };
const amostra = [];

for (const p of ordenadas) {
  const grupos = await sql`SELECT "id","title","sortOrder" FROM "ComboGroup" WHERE "menuProductId" = ${p.id} ORDER BY "sortOrder", "id"`;
  const antigo = grupos.find((g) => ehPerguntaDeMeio(g.title));
  const outros = grupos.filter((g) => g !== antigo);
  const grupoId = antigo?.id || novoId("cg_");
  const comandos = [];

  // A pergunta do meio a meio vem primeiro, como no Menudino; as outras descem.
  if (antigo) {
    conta.perguntasRefeitas++;
    comandos.push(sql`UPDATE "ComboGroup" SET "title" = ${TITULO}, "minQty" = 0, "maxQty" = 1, "priceRule" = NULL, "sortOrder" = 0 WHERE "id" = ${grupoId}`);
    comandos.push(sql`DELETE FROM "ComboGroupItem" WHERE "comboGroupId" = ${grupoId}`);
  } else {
    conta.perguntasNovas++;
    comandos.push(sql`
      INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
      VALUES (${grupoId}, ${p.id}, ${TITULO}, 1, 0, NULL, 0)`);
  }
  outros.forEach((g, i) => comandos.push(sql`UPDATE "ComboGroup" SET "sortOrder" = ${i + 1} WHERE "id" = ${g.id}`));
  comandos.push(sql`UPDATE "MenuProduct" SET "isCombo" = true, "updatedAt" = NOW() WHERE "id" = ${p.id}`);

  for (const [ordem, q] of ordenadas.filter((x) => x.id !== p.id).entries()) {
    const nome = `1/2 ${q.name}`;
    let opcao = opcoes.get(nome);
    if (!opcao) {
      conta.opcoesNovas++;
      opcao = { id: novoId("prd_"), name: nome };
      opcoes.set(nome, opcao);
      if (GRAVAR)
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
          VALUES (${opcao.id}, ${franchiseeId}, ${nome}, ${q.description || ""}, 0, ${q.imageUrl}, 'Complementos', 0,
                  true, false, false, true, NOW(), NOW())`;
    } else if (GRAVAR && !opcao.atualizada) {
      opcao.atualizada = true;
      await sql`
        UPDATE "MenuProduct" SET "description" = ${q.description || ""}, "imageUrl" = ${q.imageUrl}, "active" = true, "updatedAt" = NOW()
        WHERE "id" = ${opcao.id}`;
    }
    const add = acrescimo(p, q);
    const final = r2(p.price + add);
    const nota = `Meio a meio sai por R$ ${brl(final)}${q.description ? ` · ${q.description.trim()}` : ""}`;
    conta.vinculos++;
    comandos.push(sql`
      INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice","maxPerItem","optionNote","sortOrder")
      VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${add}, NULL, ${nota}, ${ordem})`);
    if (amostra.length < 4 && (p.name.includes("Bjorn") || p.name.includes("Calabresa")) && (q.name.includes("Bjorn") || q.name.includes("Calabresa") || q.name.includes("Mussarela")))
      amostra.push(`${p.name} (${brl(p.price)}) + ${nome}: ${add >= 0 ? "+" : "−"}${brl(Math.abs(add))} = R$ ${brl(final)}`);
  }
  if (GRAVAR) await sql.transaction(comandos);
}

console.log(GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
console.log(`loja: ${loja.storeName} · regra: ${REGRA === "maior" ? "a mais cara" : "média"} · ${pizzas.length} pizzas`);
console.log(`perguntas novas ${conta.perguntasNovas} · refeitas ${conta.perguntasRefeitas} · opções novas ${conta.opcoesNovas} · vínculos ${conta.vinculos}`);
for (const a of amostra) console.log("  · " + a);
