/**
 * Confere, campo a campo, se o cardápio copiado do InstaDelivery ficou
 * IDÊNTICO ao da origem — e denuncia cada diferença.
 *
 * Existe porque "copiou 20 produtos" não é prova de nada: a cópia do Menudino
 * gravou os 100% dos itens do Ragnar e ainda assim inflou os combos em
 * R$ 18,80, porque o que estava errado era o PREÇO DENTRO da pergunta. Contar
 * linhas não pega isso; comparar valor a valor pega.
 *
 * O que ele compara:
 *
 *   • categorias  — nome, ordem e foto
 *   • produtos    — nome, descrição, preço, foto, ordem, categoria e tags
 *   • grupos      — título, mínimo, máximo e posição dentro do produto
 *   • opções      — nome, preço DENTRO do grupo, foto e ordem
 *   • o "a partir de" — `precoMinimoDoProduto` do FireHub contra o
 *     `from_price` que o site da origem mostra. É o número que o cliente lê
 *     antes de abrir o produto, e o único que prova que a regra de preço
 *     somado foi copiada certa.
 *   • as fotos    — se já são nossas ou ainda apontam para o CDN da origem.
 *
 *   node scripts/conferir-cardapio-instadelivery.mjs <slug> <franchiseeId>
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { createHash } from "crypto";

const [slug, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slug || !franchiseeId) {
  console.log("uso: node scripts/conferir-cardapio-instadelivery.mjs <slug> <franchiseeId>");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;
const mesmoDinheiro = (a, b) => Math.abs(reais(a) - reais(b)) < 0.005;
/** Só o nome do arquivo: a URL muda quando a foto vira nossa, a imagem não. */
const arquivo = (u) => String(u || "").split("/").pop().split("?")[0] || "";

/**
 * As duas URLs apontam para a MESMA imagem? Compara o sha256 do conteúdo.
 *
 * Nome de arquivo diferente não prova imagem diferente: a loja reenviou o
 * mesmo JPEG uma vez por produto, então "Borda de Cheddar" tem três URLs e um
 * só arquivo. Sem esta conferência o relatório acusaria 9 diferenças que não
 * existem — e relatório que mente vira relatório que ninguém lê.
 *
 * Devolve true/false, ou null quando não deu para baixar alguma das duas.
 */
const cacheDeHash = new Map();
async function hashDaImagem(u) {
  if (!u) return null;
  if (cacheDeHash.has(u)) return cacheDeHash.get(u);
  let h = null;
  try {
    const r = await fetch(u);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      h = createHash("sha256").update(buf).digest("hex");
    }
  } catch {}
  cacheDeHash.set(u, h);
  return h;
}
async function mesmaImagem(a, b) {
  const [ha, hb] = await Promise.all([hashDaImagem(a), hashDaImagem(b)]);
  if (!ha || !hb) return null;
  return ha === hb;
}

const problemas = [];
const ok = { cats: 0, prods: 0, grupos: 0, opcoes: 0, precos: 0, fotosIguaisPorConteudo: 0 };
const reclamar = (m) => problemas.push(m);

/* ─── origem ─────────────────────────────────────────────────────────── */
const resp = await fetch(`https://app.instadelivery.com.br/api/stores/by-slug/${encodeURIComponent(slug)}`, {
  headers: { Accept: "application/json" },
});
if (!resp.ok) { console.log("não consegui ler a origem: HTTP " + resp.status); process.exit(1); }
const loja = await resp.json();

/* ─── cópia ──────────────────────────────────────────────────────────── */
const produtos = await sql`
  SELECT "id","name","description","price","imageUrl","category","sortOrder","tags","isCombo","apenasEmCombo"
  FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId}`;
const categorias = await sql`
  SELECT "name","imageUrl","sortOrder" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId}`;
const grupos = await sql`
  SELECT g."id", g."menuProductId" AS pid, g."title", g."minQty", g."maxQty", g."sortOrder"
  FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
  WHERE p."franchiseeId" = ${franchiseeId}`;
const vinculos = await sql`
  SELECT i."comboGroupId" AS gid, i."additionalPrice", i."maxPerItem", o."name", o."imageUrl"
  FROM "ComboGroupItem" i
  JOIN "MenuProduct" o ON o."id" = i."menuProductId"
  JOIN "ComboGroup" g ON g."id" = i."comboGroupId"
  JOIN "MenuProduct" p ON p."id" = g."menuProductId"
  WHERE p."franchiseeId" = ${franchiseeId}`;

const catPorNome = new Map(categorias.map((c) => [chave(c.name), c]));
const prodPorNomeCat = new Map(produtos.map((p) => [chave(p.name) + "|" + chave(p.category), p]));
const gruposPorProduto = new Map();
for (const g of grupos) {
  if (!gruposPorProduto.has(g.pid)) gruposPorProduto.set(g.pid, []);
  gruposPorProduto.get(g.pid).push(g);
}
for (const lista of gruposPorProduto.values()) lista.sort((a, b) => a.sortOrder - b.sortOrder);
const vinculosPorGrupo = new Map();
for (const v of vinculos) {
  if (!vinculosPorGrupo.has(v.gid)) vinculosPorGrupo.set(v.gid, []);
  vinculosPorGrupo.get(v.gid).push(v);
}

/* ─── comparar ───────────────────────────────────────────────────────── */
const catsOrigem = loja.groups
  .slice()
  .sort((a, b) => (a.order || 0) - (b.order || 0))
  .filter((c) => !c.is_invisible && !c.deleted_at);

for (const [ordemCat, c] of catsOrigem.entries()) {
  const nomeCat = limpo(c.name);
  const copia = catPorNome.get(chave(nomeCat));
  if (!copia) { reclamar(`CATEGORIA FALTANDO: "${nomeCat}"`); continue; }
  ok.cats++;
  if (copia.sortOrder !== ordemCat) reclamar(`ORDEM DA CATEGORIA "${nomeCat}": origem ${ordemCat}, cópia ${copia.sortOrder}`);
  if (c.image && arquivo(copia.imageUrl) !== arquivo(c.image)) {
    const iguais = await mesmaImagem(c.image, copia.imageUrl);
    if (iguais === true) ok.fotosIguaisPorConteudo++;
    else reclamar(`FOTO DA CATEGORIA "${nomeCat}": ${iguais === null ? "não consegui baixar para comparar" : "IMAGEM DIFERENTE"} — origem ${arquivo(c.image)}, cópia ${arquivo(copia.imageUrl) || "(sem foto)"}`);
  }

  const prodsOrigem = (c.itens || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .filter((p) => !p.is_invisible && !p.deleted_at);

  for (const [ordemProd, p] of prodsOrigem.entries()) {
    const nome = limpo(p.name);
    const dono = prodPorNomeCat.get(chave(nome) + "|" + chave(nomeCat));
    if (!dono) { reclamar(`PRODUTO FALTANDO: "${nome}" (categoria "${nomeCat}")`); continue; }
    ok.prods++;

    if (!mesmoDinheiro(dono.price, p.price1)) reclamar(`PREÇO de "${nome}": origem R$ ${reais(p.price1).toFixed(2)}, cópia R$ ${reais(dono.price).toFixed(2)}`);
    if (limpo(dono.description) !== limpo(p.description)) reclamar(`DESCRIÇÃO de "${nome}" diferente:\n      origem: ${limpo(p.description) || "(vazia)"}\n      cópia:  ${limpo(dono.description) || "(vazia)"}`);
    if (dono.sortOrder !== ordemProd) reclamar(`ORDEM de "${nome}": origem ${ordemProd}, cópia ${dono.sortOrder}`);
    if (p.image && arquivo(dono.imageUrl) !== arquivo(p.image)) {
      const iguais = await mesmaImagem(p.image, dono.imageUrl);
      if (iguais === true) ok.fotosIguaisPorConteudo++;
      else reclamar(`FOTO de "${nome}": ${iguais === null ? "não consegui baixar para comparar" : "IMAGEM DIFERENTE"} — origem ${arquivo(p.image)}, cópia ${arquivo(dono.imageUrl) || "(sem foto)"}`);
    }

    const tagsEsperadas = [];
    if (p.is_best_seller) tagsEsperadas.push("🔥 Mais Vendido");
    if (p.is_newest) tagsEsperadas.push("✨ Novo");
    if (reais(p.strike_price) > reais(p.price1)) tagsEsperadas.push("🏷️ Promoção");
    const tagsCopia = (() => { try { return JSON.parse(dono.tags || "[]"); } catch { return []; } })();
    if (JSON.stringify(tagsEsperadas) !== JSON.stringify(tagsCopia)) {
      reclamar(`TAGS de "${nome}": esperado [${tagsEsperadas.join(", ")}], cópia [${tagsCopia.join(", ")}]`);
    }

    /* ── grupos e opções ─────────────────────────────────────────────── */
    const gruposOrigem = (p.complementos || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .filter((g) => Number(g.max) > 0);
    const gruposCopia = gruposPorProduto.get(dono.id) || [];
    if (gruposOrigem.length !== gruposCopia.length) {
      reclamar(`Nº DE PERGUNTAS de "${nome}": origem ${gruposOrigem.length}, cópia ${gruposCopia.length}`);
    }

    for (const [i, g] of gruposOrigem.entries()) {
      const gc = gruposCopia[i];
      if (!gc) { reclamar(`PERGUNTA FALTANDO em "${nome}": "${limpo(g.name)}"`); continue; }
      ok.grupos++;
      if (chave(gc.title) !== chave(g.name)) reclamar(`TÍTULO DA PERGUNTA ${i + 1} de "${nome}": origem "${limpo(g.name)}", cópia "${gc.title}"`);
      if (Number(gc.minQty) !== Number(g.min)) reclamar(`MÍNIMO de "${nome}" → "${limpo(g.name)}": origem ${g.min}, cópia ${gc.minQty}`);
      if (Number(gc.maxQty) !== Number(g.max)) reclamar(`MÁXIMO de "${nome}" → "${limpo(g.name)}": origem ${g.max}, cópia ${gc.maxQty}`);

      const opcoesOrigem = (g.complements || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .filter((o) => !o.is_invisible && !o.deleted_at);
      const opcoesCopia = vinculosPorGrupo.get(gc.id) || [];
      if (opcoesOrigem.length !== opcoesCopia.length) {
        reclamar(`Nº DE OPÇÕES em "${nome}" → "${limpo(g.name)}": origem ${opcoesOrigem.length}, cópia ${opcoesCopia.length}`);
      }
      const copiaPorNome = new Map(opcoesCopia.map((v) => [chave(v.name), v]));
      for (const o of opcoesOrigem) {
        const vc = copiaPorNome.get(chave(o.name));
        if (!vc) { reclamar(`OPÇÃO FALTANDO em "${nome}" → "${limpo(g.name)}": "${limpo(o.name)}"`); continue; }
        ok.opcoes++;
        if (!mesmoDinheiro(vc.additionalPrice, o.price)) {
          reclamar(`PREÇO DA OPÇÃO "${limpo(o.name)}" em "${nome}" → "${limpo(g.name)}": origem R$ ${reais(o.price).toFixed(2)}, cópia R$ ${reais(vc.additionalPrice).toFixed(2)}`);
        }
        if (o.image && arquivo(vc.imageUrl) !== arquivo(o.image)) {
          // Opção reaproveitada entre grupos fica com UMA foto no FireHub, e a
          // origem tem a MESMA imagem reenviada com nomes diferentes (a loja
          // subiu o arquivo uma vez por produto). Nome de arquivo diferente
          // não prova imagem diferente: compara o CONTEÚDO antes de acusar.
          const iguais = await mesmaImagem(o.image, vc.imageUrl);
          if (iguais === true) ok.fotosIguaisPorConteudo++;
          else if (iguais === null) reclamar(`FOTO DA OPÇÃO "${limpo(o.name)}" em "${limpo(g.name)}": não consegui baixar para comparar (${arquivo(o.image)} x ${arquivo(vc.imageUrl) || "sem foto"})`);
          else reclamar(`FOTO DA OPÇÃO "${limpo(o.name)}" em "${limpo(g.name)}": IMAGEM DIFERENTE — origem ${arquivo(o.image)}, cópia ${arquivo(vc.imageUrl) || "(sem foto)"}`);
        }
      }
    }

    /* ── o "a partir de" ─────────────────────────────────────────────── */
    if (Number(p.price1) === 0 && Number(p.from_price) > 0) {
      let minimo = reais(dono.price);
      for (const gc of gruposCopia) {
        const itens = vinculosPorGrupo.get(gc.id) || [];
        if (itens.length === 0) continue;
        // A mesma conta de precoMinimoDoProduto (lib/preco-combo.ts): grupo
        // opcional não entra, e o obrigatório entra com a opção mais barata.
        const quantos = gc.minQty === null ? Number(gc.maxQty) : Number(gc.minQty);
        if (quantos <= 0) continue;
        minimo += Math.min(...itens.map((i) => reais(i.additionalPrice))) * quantos;
      }
      if (!mesmoDinheiro(minimo, p.from_price)) {
        reclamar(`"A PARTIR DE" de "${nome}": o site da origem anuncia R$ ${reais(p.from_price).toFixed(2)}, o FireHub vai mostrar R$ ${reais(minimo).toFixed(2)}`);
      } else {
        ok.precos++;
      }
    }
  }
}

/* ─── sobras: o que existe na cópia e não na origem ──────────────────── */
const nomesDaOrigem = new Set();
for (const c of catsOrigem) for (const p of c.itens || []) nomesDaOrigem.add(chave(p.name) + "|" + chave(c.name));
for (const p of produtos) {
  if (p.apenasEmCombo || p.category === "Complementos") continue;
  if (!nomesDaOrigem.has(chave(p.name) + "|" + chave(p.category))) {
    reclamar(`SOBRANDO NA CÓPIA (não existe na origem): "${p.name}" em "${p.category}"`);
  }
}

/* ─── fotos: já são nossas? ──────────────────────────────────────────── */
const deFora = produtos.filter((p) => /instadelivery/i.test(p.imageUrl || "")).length
  + categorias.filter((c) => /instadelivery/i.test(c.imageUrl || "")).length;
const comFoto = produtos.filter((p) => p.imageUrl).length + categorias.filter((c) => c.imageUrl).length;

console.log("=== CONFERÊNCIA: cópia x origem ===");
console.log(`categorias conferidas: ${ok.cats}`);
console.log(`produtos conferidos:   ${ok.prods}`);
console.log(`perguntas conferidas:  ${ok.grupos}`);
console.log(`opções conferidas:     ${ok.opcoes}`);
console.log(`"a partir de" batendo:  ${ok.precos}`);
if (ok.fotosIguaisPorConteudo > 0) console.log(`fotos com nome diferente mas MESMO conteúdo (sha256): ${ok.fotosIguaisPorConteudo} — não é diferença`);
console.log(`fotos: ${comFoto} no total; ${deFora} ainda apontam para o CDN do InstaDelivery${deFora === 0 ? " (todas nossas ✅)" : " ⚠"}`);

if (problemas.length === 0) {
  console.log("\n✅ IDÊNTICO — nenhuma diferença encontrada.");
} else {
  console.log(`\n❌ ${problemas.length} DIFERENÇA(S):`);
  for (const p of problemas) console.log("  • " + p);
}
process.exit(problemas.length > 0 ? 1 : 0);
