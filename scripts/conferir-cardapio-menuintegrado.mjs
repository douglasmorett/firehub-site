/**
 * Confere, item por item, se o cardápio de uma loja do FireHub ficou IDÊNTICO
 * ao do Menu Integrado de onde foi copiado.
 *
 *   node scripts/conferir-cardapio-menuintegrado.mjs <dominio> <franchiseeId>
 *
 * Existe porque "copiei o cardápio" só vale quando alguém compara os dois — a
 * primeira cópia da Brendi (Frangoso, 12/09/2026) foi dada por pronta com 90%
 * dos complementos faltando, e quem percebeu foi o lojista.
 *
 * Compara, na ordem, em cinco níveis:
 *   1. ordem e nome das CATEGORIAS
 *   2. ordem, nome, preço, descrição, foto e dias do PRODUTO
 *   3. ordem, título, mínimo e máximo de cada GRUPO
 *   4. ordem, nome e adicional de cada OPÇÃO
 *   5. o "a partir de" que cada lado mostra no card
 *
 * Grupo com `max: 0` na origem é grupo desligado (não aparece para o cliente) —
 * o conferidor ignora, igual ao importador. Diferença de horário por produto e
 * de preço "de/por" o FireHub não guarda: sai como NOTA, não como falha.
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [dominio, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dominio || !franchiseeId) {
  console.log("uso: node scripts/conferir-cardapio-menuintegrado.mjs <dominio> <franchiseeId>");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const limpo = (s) => String(s ?? "").trim();
const chave = (s) => limpo(s).toLowerCase().replace(/\s+/g, " ");
const cent = (v) => Math.round((Number(v) || 0) * 100);
const SIGLAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];
const dias = (d) => {
  if (!Array.isArray(d) || d.length < 8) return null;
  const m = SIGLAS.filter((_, i) => d[i + 1] === true);
  return m.length === 0 || m.length === 7 ? null : m;
};
const cruza = (a, b) => (!a ? b : !b ? a : (() => { const j = a.filter((x) => b.includes(x)); return j.length === 0 || j.length === 7 ? null : j; })());

const falhas = [];
const notas = [];
const erro = (onde, oQue, origem, firehub) =>
  falhas.push(`${onde}\n      ${oQue}\n      origem : ${JSON.stringify(origem)}\n      FireHub: ${JSON.stringify(firehub)}`);

/* ─── as duas fontes ─────────────────────────────────────────────────── */
const url = `https://${dominio.replace(/^https?:\/\//, "").replace(/\/$/, "")}/internal/categories?channel=platform`;
const origem = await (await fetch(url, { headers: { Accept: "application/json" } })).json();

const prods = await sql`
  SELECT "id","name","description","price","category","sortOrder","imageUrl","isCombo","active","availableDays","apenasEmCombo"
  FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId} ORDER BY "category","sortOrder","name"`;
const cats = await sql`SELECT "name","sortOrder" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId} ORDER BY "sortOrder","name"`;
const grupos = await sql`
  SELECT g."id", g."menuProductId" AS pid, g."title", g."minQty", g."maxQty", g."sortOrder"
  FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
  WHERE p."franchiseeId" = ${franchiseeId} ORDER BY g."sortOrder"`;
const itens = await sql`
  SELECT i."comboGroupId" AS gid, i."additionalPrice", o."name", o."imageUrl", o."description"
  FROM "ComboGroupItem" i
  JOIN "ComboGroup" g ON g."id" = i."comboGroupId"
  JOIN "MenuProduct" p ON p."id" = g."menuProductId"
  JOIN "MenuProduct" o ON o."id" = i."menuProductId"
  WHERE p."franchiseeId" = ${franchiseeId}`;

const gruposDoProduto = new Map();
for (const g of grupos) {
  if (!gruposDoProduto.has(g.pid)) gruposDoProduto.set(g.pid, []);
  gruposDoProduto.get(g.pid).push(g);
}
for (const l of gruposDoProduto.values()) l.sort((a, b) => a.sortOrder - b.sortOrder);
const itensDoGrupo = new Map();
for (const i of itens) {
  if (!itensDoGrupo.has(i.gid)) itensDoGrupo.set(i.gid, []);
  itensDoGrupo.get(i.gid).push(i);
}
const vendaveis = prods.filter((p) => p.apenasEmCombo !== true);
const porNomeCat = new Map(vendaveis.map((p) => [chave(p.name) + "|" + chave(p.category), p]));

/* ─── 1. categorias, na ordem ────────────────────────────────────────── */
const catsOrigem = origem.map((c) => limpo(c.name));
const catsFire = cats.map((c) => limpo(c.name));
if (JSON.stringify(catsOrigem) !== JSON.stringify(catsFire)) {
  erro("CATEGORIAS", "a ordem ou os nomes não batem", catsOrigem, catsFire);
}

/* ─── 2..5. produto a produto ────────────────────────────────────────── */
let nProd = 0, nGrupo = 0, nOpcao = 0;
for (const c of origem) {
  const diasCat = dias(c.days);
  (c.products || []).forEach((p, ordem) => {
    nProd++;
    const nome = limpo(p.name);
    const onde = `${limpo(c.name)} → ${nome}`;
    const f = porNomeCat.get(chave(nome) + "|" + chave(c.name));
    if (!f) { erro(onde, "produto NÃO EXISTE no FireHub", nome, null); return; }

    if (f.sortOrder !== ordem) erro(onde, "posição dentro da categoria", ordem, f.sortOrder);
    if (cent(f.price) !== cent(p.price)) erro(onde, "preço", p.textPrice, `R$ ${Number(f.price).toFixed(2)}`);
    if (limpo(f.description) !== limpo(p.description)) erro(onde, "descrição", limpo(p.description).slice(0, 90), limpo(f.description).slice(0, 90));
    if (!f.imageUrl) erro(onde, "produto ficou SEM FOTO", p.coverImageUrl, null);

    const diasEsperados = cruza(dias(p.days), diasCat);
    const diasGravados = f.availableDays ? JSON.parse(f.availableDays) : null;
    if (JSON.stringify(diasEsperados) !== JSON.stringify(diasGravados)) erro(onde, "dias da semana", diasEsperados, diasGravados);

    const gOrigem = (p.variations || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).filter((g) => Number(g.max) > 0);
    const gFire = gruposDoProduto.get(f.id) || [];
    if (f.isCombo !== (gOrigem.length > 0)) erro(onde, "isCombo", gOrigem.length > 0, f.isCombo);
    if (gOrigem.length !== gFire.length) {
      erro(onde, "quantidade de grupos", gOrigem.map((g) => limpo(g.name)), gFire.map((g) => limpo(g.title)));
      return;
    }

    gOrigem.forEach((g, i) => {
      nGrupo++;
      const fg = gFire[i];
      const ondeG = `${onde} → grupo ${i + 1} "${limpo(g.name)}"`;
      if (limpo(fg.title) !== limpo(g.name)) erro(ondeG, "título", limpo(g.name), limpo(fg.title));
      if (fg.minQty !== Number(g.min)) erro(ondeG, "mínimo (o 'Escolha N' da tela)", g.min, fg.minQty);
      if (fg.maxQty !== Number(g.max)) erro(ondeG, "máximo", g.max, fg.maxQty);

      const oOrigem = (g.items || []).map((o) => ({ nome: limpo(o.name), add: cent(o.price), foto: !!o.coverImageUrl }));
      const oFire = (itensDoGrupo.get(fg.id) || []).map((o) => ({ nome: limpo(o.name), add: cent(o.additionalPrice), foto: !!o.imageUrl }));
      const mapaFire = new Map(oFire.map((o) => [chave(o.nome), o]));
      if (oOrigem.length !== oFire.length) {
        erro(ondeG, "quantidade de opções", oOrigem.map((o) => o.nome), oFire.map((o) => o.nome));
        return;
      }
      for (const o of oOrigem) {
        nOpcao++;
        const fo = mapaFire.get(chave(o.nome));
        if (!fo) { erro(ondeG, "opção NÃO EXISTE", o.nome, [...mapaFire.keys()]); continue; }
        if (fo.add !== o.add) erro(`${ondeG} → ${o.nome}`, "adicional", (o.add / 100).toFixed(2), (fo.add / 100).toFixed(2));
        if (o.foto && !fo.foto) erro(`${ondeG} → ${o.nome}`, "opção ficou sem foto", "tem foto", "sem foto");
      }
    });

    /* 5. o "a partir de": base + Σ (mínimo exigido × opção mais barata).
       É a mesma regra de src/lib/preco-combo.ts. Se o número bater, o card do
       FireHub anuncia o mesmo valor que o card da origem. */
    const minimo = (grupos_, pega) =>
      Number(p.price) + grupos_.reduce((s, g) => {
        const min = pega.min(g);
        if (min <= 0) return s;
        const precos = pega.itens(g).map(pega.preco).sort((a, b) => a - b);
        return s + precos.slice(0, min).reduce((x, y) => x + y, 0);
      }, 0);
    const minOrigem = minimo(gOrigem, { min: (g) => Number(g.min), itens: (g) => g.items || [], preco: (o) => Number(o.price) || 0 });
    const minFire = Number(f.price) + gFire.reduce((s, g) => {
      const min = Number(g.minQty);
      if (!min || min <= 0) return s;
      const precos = (itensDoGrupo.get(g.id) || []).map((o) => Number(o.additionalPrice) || 0).sort((a, b) => a - b);
      return s + precos.slice(0, min).reduce((x, y) => x + y, 0);
    }, 0);
    if (cent(minOrigem) !== cent(minFire)) erro(onde, "menor preço possível (o 'a partir de' do card)", minOrigem.toFixed(2), minFire.toFixed(2));

    /* Notas: o que o FireHub não guarda. */
    if (!p.alwaysAvailable && (p.start1 !== "00:00" || p.stop1 !== "23:59")) notas.push(`${onde}: sai das ${p.start1} às ${p.stop1} na origem; no FireHub sai o dia todo`);
    if ((Number(p.originalPrice) || 0) > Number(p.price)) notas.push(`${onde}: ${p.textOriginalPrice} por ${p.textPrice} na origem; o FireHub não tem "de/por" (ficou ${p.textPrice} + tag Promoção)`);
    (p.variations || []).filter((g) => Number(g.max) === 0).forEach((g) => notas.push(`${onde}: grupo "${limpo(g.name)}" está DESLIGADO na origem (max=0, não aparece para o cliente) — não copiei`));
  });
}

/* ─── sobras: o que existe no FireHub e não na origem ────────────────── */
const nomesOrigem = new Set(origem.flatMap((c) => (c.products || []).map((p) => chave(p.name) + "|" + chave(c.name))));
for (const p of vendaveis) {
  if (!nomesOrigem.has(chave(p.name) + "|" + chave(p.category))) {
    erro(`SOBRANDO no FireHub`, `produto que não existe na origem`, null, `[${p.category}] ${p.name}`);
  }
}

console.log(`conferido: ${nProd} produtos, ${nGrupo} grupos, ${nOpcao} opções, ${catsOrigem.length} categorias`);
console.log(`           (+ ${prods.length - vendaveis.length} produtos-opção em "Complementos", que não aparecem no cardápio)`);
if (notas.length) {
  console.log(`\nNOTAS (${notas.length}) — diferenças que o FireHub não tem como guardar:`);
  for (const n of [...new Set(notas)]) console.log("  • " + n);
}
if (falhas.length) {
  console.log(`\n❌ ${falhas.length} DIFERENÇA(S):\n`);
  for (const f of falhas) console.log("  " + f + "\n");
  process.exit(1);
}
console.log("\n✅ idêntico à origem nos cinco níveis (categoria, produto, grupo, opção e 'a partir de').");
