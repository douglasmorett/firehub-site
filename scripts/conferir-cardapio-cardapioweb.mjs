/**
 * Confere, campo a campo, se o cardápio copiado do CardápioWeb ficou IGUAL ao
 * da origem — e SIMULA pedidos dos dois lados para provar que o preço bate.
 *
 * "Copiou 75 produtos" não prova nada: a cópia do Menudino gravou 100% dos
 * itens do Ragnar e ainda inflou os combos em R$ 18,80, porque o erro estava
 * no preço DENTRO da pergunta. Aqui cada lado calcula com a SUA regra:
 *
 *   origem  → a fórmula do bundle do CardápioWeb (opções repetidas pela
 *             quantidade; SUM soma, MEAN média com 2 casas, MAX, MIN)
 *   FireHub → src/lib/preco-combo.ts e src/lib/preco-por-canal.ts, importados
 *             de verdade — a mesma conta do modal e do servidor
 *
 * Para cada produto são geradas escolhas por pergunta: vazio, cada opção 1×,
 * cada opção 2×, todos os pares de opções distintas, a mais barata no mínimo,
 * a mais cara no máximo e uma a mais que o máximo. Cada escolha é julgada
 * VÁLIDA ou não pelas regras de cada lado (mínimo, máximo, repetição) — as duas
 * respostas têm de coincidir — e, quando válida, o preço tem de coincidir.
 * O preço base é comparado em CADA dia da semana, por causa da promoção por
 * dia que a origem tem e o FireHub não.
 *
 *   node --experimental-strip-types scripts/conferir-cardapio-cardapioweb.mjs <slug> <franchiseeId>
 */
import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { neon } from "@neondatabase/serverless";
import { precoUnitarioDoItem, precoMinimoDoProduto, minimoExigidoDoGrupo } from "../src/lib/preco-combo.ts";
import { aplicarPrecoDoCanal } from "../src/lib/preco-por-canal.ts";

const [slug, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!slug || !franchiseeId) {
  console.log("uso: node --experimental-strip-types scripts/conferir-cardapio-cardapioweb.mjs <slug> <franchiseeId>");
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
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;
const igual = (a, b) => Math.abs(reais(a) - reais(b)) < 0.005;
const r2 = (n) => Math.round(n * 100) / 100;

/* Imagem igual = mesmo conteúdo. A URL muda quando o cron traz a foto para
   o nosso volume; a imagem não. */
const cacheHash = new Map();
async function hash(u) {
  if (!u) return null;
  if (cacheHash.has(u)) return cacheHash.get(u);
  let h = null;
  try {
    const r = await fetch(u.startsWith("http") ? u : `https://firehubfood.com.br${u}`);
    if (r.ok) h = createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
  } catch {}
  cacheHash.set(u, h);
  return h;
}
async function mesmaFoto(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a === b) return true;
  const [ha, hb] = await Promise.all([hash(a), hash(b)]);
  return ha && hb ? ha === hb : null;
}

/* ─── ORIGEM ─────────────────────────────────────────────────────────── */
const html = await (await fetch(`https://app.cardapioweb.com/${slug}`)).text();
const companyId = html.match(/companyId["']?\s*,\s*\{\s*value\s*:\s*(\d+)/)[1];
const lerCanal = async (canal) =>
  (await fetch(`https://integracao.cardapioweb.com/api/menu/company/categories?only_available_for=${canal}&origin=catalogo`, {
    headers: { Accept: "application/json", "Company-ID": companyId, Company: slug },
  })).json();
const CANAIS = ["delivery", "service_desk", "table"];
const origemPorCanal = Object.fromEntries(await Promise.all(CANAIS.map(async (c) => [c, await lerCanal(c)])));
const cats = new Map();
for (const canal of CANAIS)
  for (const c of origemPorCanal[canal]) {
    if (!cats.has(c.id)) cats.set(c.id, { c, itens: new Map() });
    for (const p of c.items) {
      const m = cats.get(c.id).itens;
      if (!m.has(p.id)) m.set(p.id, { p, canais: new Set() });
      m.get(p.id).canais.add(canal);
    }
  }
const origem = [...cats.values()];

/* A conta da origem, transcrita do bundle (função que soma os add_ons). */
function totalDoGrupoOrigem(g, escolha) {
  const precos = [];
  for (const o of g.subitems) for (let i = 0; i < (escolha[o.id] || 0); i++) precos.push(o.price || 0);
  if (precos.length === 0) return 0;
  const soma = precos.reduce((a, b) => a + b, 0);
  switch (g.price_calculation_type) {
    case "MEAN": return r2(soma / precos.length);
    case "MIN": return Math.min(...precos);
    case "MAX": return Math.max(...precos);
    default: return soma;
  }
}
function validaOrigem(g, escolha) {
  const total = Object.values(escolha).reduce((a, b) => a + b, 0);
  const max = g.choice_type === "SINGLE" ? 1 : g.maximum_quantity;
  if (total < g.minimum_quantity || total > max) return false;
  for (const o of g.subitems) {
    const q = escolha[o.id] || 0;
    if (g.choice_type !== "SUMMABLE" && q > 1) return false;
    if (g.choice_type === "SUMMABLE" && o.max_quantity > 0 && q > o.max_quantity) return false;
  }
  return true;
}
const DIA = { monday: "SEG", tuesday: "TER", wednesday: "QUA", thursday: "QUI", friday: "SEX", saturday: "SAB", sunday: "DOM" };
const SIGLAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];
function baseOrigemNoDia(p, dia) {
  const dias = (p.promotional_price_availability || []).map((d) => DIA[d]);
  if (p.promotional_price_active && p.promotional_price > 0 && p.promotional_price < p.price && dias.includes(dia))
    return p.promotional_price;
  return p.price;
}

/* ─── FIREHUB ────────────────────────────────────────────────────────── */
const catsFH = await sql`SELECT "name","imageUrl","sortOrder" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId} ORDER BY "sortOrder"`;
const prodsFH = await sql`
  SELECT * FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId} AND NOT "apenasEmCombo"`;
const gruposFH = await sql`
  SELECT g.* FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
  WHERE p."franchiseeId" = ${franchiseeId} ORDER BY g."sortOrder"`;
const itensFH = await sql`
  SELECT i.*, m."name" AS "opcaoNome", m."imageUrl" AS "opcaoFoto", m."description" AS "opcaoDesc"
  FROM "ComboGroupItem" i JOIN "MenuProduct" m ON m."id" = i."menuProductId"
  WHERE m."franchiseeId" = ${franchiseeId} ORDER BY i."sortOrder", i."id"`;
const gruposDoProduto = new Map();
for (const g of gruposFH) {
  g.items = itensFH.filter((i) => i.comboGroupId === g.id).map((i) => ({ ...i, menuProduct: { name: i.opcaoNome } }));
  if (!gruposDoProduto.has(g.menuProductId)) gruposDoProduto.set(g.menuProductId, []);
  gruposDoProduto.get(g.menuProductId).push(g);
}

function validaFH(g, escolha) {
  const total = Object.values(escolha).reduce((a, b) => a + b, 0);
  const max = Math.max(1, Number(g.maxQty) || 1);
  if (total > max || total < minimoExigidoDoGrupo(g)) return false;
  for (const i of g.items) {
    const teto = Number(i.maxPerItem) > 0 ? Number(i.maxPerItem) : max;
    if ((escolha[i.opcaoNome] || 0) > teto) return false;
  }
  return true;
}

/* ─── COMPARAR ───────────────────────────────────────────────────────── */
const dif = [];
const d = (onde, campo, o, f) => dif.push(`${onde} — ${campo}: origem ${JSON.stringify(o)} × FireHub ${JSON.stringify(f)}`);
const stats = { produtos: 0, grupos: 0, opcoes: 0, simulacoes: 0, validasIguais: 0, precosConferidos: 0, fotosConferidas: 0 };
const diferencasEsperadas = [];

// categorias
if (catsFH.length !== origem.length) d("cardápio", "nº de categorias", origem.length, catsFH.length);
for (const [i, { c }] of origem.entries()) {
  const f = catsFH.find((x) => chave(x.name) === chave(c.name));
  if (!f) { d(`categoria "${c.name}"`, "existe", true, false); continue; }
  if (f.sortOrder !== i) d(`categoria "${c.name}"`, "ordem", i, f.sortOrder);
  const foto = await mesmaFoto(c.image_url, f.imageUrl);
  if (foto === false) d(`categoria "${c.name}"`, "foto", c.image_url, f.imageUrl);
}

const totalOrigem = origem.reduce((s, x) => s + x.itens.size, 0);
if (prodsFH.length !== totalOrigem) d("cardápio", "nº de produtos", totalOrigem, prodsFH.length);

for (const { c, itens } of origem) {
  for (const [ordem, { p, canais }] of [...itens.values()].entries()) {
    stats.produtos++;
    const onde = `"${limpo(p.name)}" (${limpo(c.name)})`;
    const f = prodsFH.find((x) => chave(x.name) === chave(p.name) && chave(x.category) === chave(c.name));
    if (!f) { d(onde, "existe", true, false); continue; }

    if (limpo(f.description) !== limpo(p.description)) d(onde, "descrição", limpo(p.description).slice(0, 60), limpo(f.description).slice(0, 60));
    if (!igual(f.price, p.price)) d(onde, "preço de tabela", p.price, f.price);
    if (f.sortOrder !== ordem) d(onde, "ordem", ordem, f.sortOrder);
    if (f.active !== (p.status === "ACTIVE")) d(onde, "ativo", p.status === "ACTIVE", f.active);
    if (f.activeDelivery !== canais.has("delivery")) d(onde, "delivery", canais.has("delivery"), f.activeDelivery);
    if (f.activePDV !== canais.has("service_desk")) d(onde, "balcão", canais.has("service_desk"), f.activePDV);
    if (f.activeGarcom !== canais.has("table")) d(onde, "mesa", canais.has("table"), f.activeGarcom);
    const tags = JSON.parse(f.tags || "[]");
    if (p.badge === "best_seller" && !tags.includes("🔥 Mais Vendido")) d(onde, "selo", "Mais Vendido", tags);
    if (p.badge === "recommended" && !tags.includes("⭐ Destaque")) d(onde, "selo", "Destaque", tags);
    const foto = await mesmaFoto(p.image_url, f.imageUrl);
    stats.fotosConferidas++;
    if (foto === false) d(onde, "foto", p.image_url, f.imageUrl);
    if (foto === null) d(onde, "foto (não baixou)", p.image_url, f.imageUrl);

    // dias de venda
    const diasFH = f.availableDays ? JSON.parse(f.availableDays) : SIGLAS;
    const diasVenda = p.allowed_times?.length
      ? SIGLAS.filter((s) => p.allowed_times.some((j) => DIA[j.weekday] === s && !(j.start_at === "00:00" && j.end_at < "06:00")))
      : SIGLAS;
    if (diasFH.join() !== diasVenda.join()) d(onde, "dias", diasVenda, diasFH);

    // preço base em cada dia
    const fhCanal = aplicarPrecoDoCanal({ ...f }, "delivery");
    for (const dia of diasVenda) {
      const o = baseOrigemNoDia(p, dia);
      if (!igual(o, fhCanal.price)) diferencasEsperadas.push(`${onde} ${dia}: origem R$ ${o.toFixed(2)} × FireHub R$ ${fhCanal.price.toFixed(2)} (promoção por dia)`);
    }

    // perguntas
    const gs = gruposDoProduto.get(f.id) || [];
    const gsOrigem = p.add_ons.filter((g) => g.status === "ACTIVE" && g.subitems.length);
    if (gs.length !== gsOrigem.length) d(onde, "nº de perguntas", gsOrigem.length, gs.length);
    if (f.isCombo !== gsOrigem.length > 0) d(onde, "isCombo", gsOrigem.length > 0, f.isCombo);

    for (const [gi, go] of gsOrigem.entries()) {
      stats.grupos++;
      const gf = gs[gi];
      const og = `${onde} → "${limpo(go.name)}"`;
      if (!gf) { d(og, "existe", true, false); continue; }
      if (limpo(gf.title) !== limpo(go.name)) d(og, "título", go.name, gf.title);
      const maxO = go.choice_type === "SINGLE" ? 1 : go.maximum_quantity;
      if (gf.maxQty !== maxO) d(og, "máximo", maxO, gf.maxQty);
      if (gf.minQty !== go.minimum_quantity) d(og, "mínimo", go.minimum_quantity, gf.minQty);
      const regra = { SUM: null, MEAN: "MEDIA", MAX: "MAIOR" }[go.price_calculation_type];
      if ((gf.priceRule || null) !== regra) d(og, "regra de preço", go.price_calculation_type, gf.priceRule);

      const ops = go.subitems.filter((o) => o.status === "ACTIVE");
      if (gf.items.length !== ops.length) d(og, "nº de opções", ops.length, gf.items.length);
      const nomes = ops.map((o) => chave(o.name));
      if (new Set(nomes).size !== nomes.length) d(og, "nomes de opção repetidos na pergunta", nomes.length, new Set(nomes).size);
      for (const [oi, o] of ops.entries()) {
        stats.opcoes++;
        const it = gf.items[oi];
        if (!it) { d(og, `opção ${oi + 1}`, o.name, null); continue; }
        if (limpo(it.opcaoNome) !== limpo(o.name)) d(og, `opção ${oi + 1} (ordem/nome exato)`, o.name, it.opcaoNome);
        if (!igual(it.additionalPrice, o.price)) d(og + ` → "${o.name}"`, "preço da opção", o.price, it.additionalPrice);
        if (o.image_url) {
          const fo = await mesmaFoto(o.image_url, it.opcaoFoto);
          stats.fotosConferidas++;
          if (fo === false) d(og + ` → "${o.name}"`, "foto da opção", o.image_url, it.opcaoFoto);
        }
      }
    }

    /* ── SIMULAÇÃO ─────────────────────────────────────────────────────
       Escolhas por pergunta; as outras perguntas ficam na escolha válida mais
       barata (ou vazias, se opcionais). */
    const pares = gsOrigem.map((go, gi) => ({ go, gf: gs[gi] })).filter((x) => x.gf);
    const cenarios = (go) => {
      const ops = go.subitems.filter((o) => o.status === "ACTIVE");
      const lista = [{}];
      const maxO = go.choice_type === "SINGLE" ? 1 : go.maximum_quantity;
      for (const o of ops) { lista.push({ [o.id]: 1 }); lista.push({ [o.id]: 2 }); }
      for (let a = 0; a < ops.length; a++) for (let b = a + 1; b < ops.length; b++) lista.push({ [ops[a].id]: 1, [ops[b].id]: 1 });
      const barata = [...ops].sort((x, y) => x.price - y.price)[0];
      const cara = [...ops].sort((x, y) => y.price - x.price)[0];
      if (go.minimum_quantity > 0) lista.push({ [barata.id]: go.minimum_quantity });
      lista.push({ [cara.id]: maxO });
      lista.push({ [cara.id]: maxO + 1 });
      if (ops.length >= 3 && maxO >= 3) lista.push({ [ops[0].id]: 1, [ops[1].id]: 1, [ops[2].id]: maxO - 2 });
      return lista;
    };
    const paraFH = (go, escolha) => {
      const e = {};
      for (const o of go.subitems) if (escolha[o.id]) e[limpo(o.name)] = escolha[o.id];
      return e;
    };
    const basePadrao = pares.map(({ go }) => {
      const validos = cenarios(go).filter((e) => validaOrigem(go, e));
      return validos.sort((a, b) => totalDoGrupoOrigem(go, a) - totalDoGrupoOrigem(go, b))[0] || {};
    });
    const produtoFH = { price: fhCanal.price, comboGroups: gs };
    const diaDeReferencia = diasVenda.find((dia) => igual(baseOrigemNoDia(p, dia), fhCanal.price));
    const baseOrigem = diaDeReferencia ? baseOrigemNoDia(p, diaDeReferencia) : null;

    for (const [gi, { go, gf }] of pares.entries()) {
      for (const escolha of cenarios(go)) {
        stats.simulacoes++;
        const vO = validaOrigem(go, escolha);
        const vF = validaFH(gf, paraFH(go, escolha));
        if (vO !== vF) {
          d(`${onde} → "${limpo(go.name)}"`, `escolha ${JSON.stringify(paraFH(go, escolha))} é válida?`, vO, vF);
          continue;
        }
        stats.validasIguais++;
        if (!vO || baseOrigem === null) continue;
        const todas = basePadrao.map((b, j) => (j === gi ? escolha : b));
        const precoO = r2(baseOrigem + pares.reduce((s, { go: g2 }, j) => s + totalDoGrupoOrigem(g2, todas[j]), 0));
        const escolhasFH = Object.fromEntries(pares.map(({ go: g2, gf: f2 }, j) => [f2.id, paraFH(g2, todas[j])]));
        const precoF = precoUnitarioDoItem(produtoFH, escolhasFH);
        stats.precosConferidos++;
        if (!igual(precoO, precoF)) d(`${onde}`, `preço com ${JSON.stringify(escolhasFH).slice(0, 120)}`, precoO, precoF);
      }
    }

    // "a partir de"
    if (baseOrigem !== null && pares.length) {
      let minO = baseOrigem;
      for (const { go } of pares) {
        const validos = cenarios(go).filter((e) => validaOrigem(go, e));
        minO += Math.min(...validos.map((e) => totalDoGrupoOrigem(go, e)));
      }
      const minF = precoMinimoDoProduto(produtoFH);
      if (!igual(minO, minF)) d(onde, '"a partir de"', r2(minO), minF);
    }
  }
}

console.log(`=== CONFERÊNCIA ${slug} → ${franchiseeId} ===`);
console.log(`produtos ${stats.produtos} · perguntas ${stats.grupos} · opções ${stats.opcoes} · fotos ${stats.fotosConferidas}`);
console.log(`simulações ${stats.simulacoes} · validade igual nos dois lados ${stats.validasIguais} · preços comparados ${stats.precosConferidos}`);
if (diferencasEsperadas.length) {
  console.log(`\nDIFERENÇAS CONHECIDAS (promoção só em alguns dias — o FireHub não tem) (${diferencasEsperadas.length}):`);
  for (const x of diferencasEsperadas) console.log("  · " + x);
}
if (dif.length) {
  console.log(`\nDIFERENÇAS (${dif.length}):`);
  for (const x of dif.slice(0, 200)) console.log("  ✖ " + x);
  process.exitCode = 1;
} else {
  console.log("\nNENHUMA DIFERENÇA — o cardápio copiado é igual ao da origem.");
}
