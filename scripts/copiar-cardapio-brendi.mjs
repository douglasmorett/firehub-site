/**
 * Copia um cardápio da Brendi para uma loja do FireHub — categorias, produtos,
 * fotos, descrições e COMPLEMENTOS.
 *
 * ── Por que este arquivo existe ─────────────────────────────────────────────
 *
 * Copiar cardápio de concorrente é rotina na entrada de cliente novo, e a
 * primeira vez que fiz (Frangoso, 12/09/2026) saiu pela metade: trouxe os 62
 * produtos e deixei para trás 178 grupos de complemento com 754 opções — mais de
 * 90% do cardápio. O lojista percebeu antes de mim.
 *
 * A causa foi usar a fonte errada: o EDITOR da Brendi não mostra descrição nem
 * complemento. Quem tem tudo é a API do cardápio PÚBLICO.
 *
 * O protocolo completo (incluindo as outras plataformas) está no Obsidian:
 * "Projetos/Protocolo - Copiar Cardapio.md".
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-brendi.mjs <slug-brendi> <franchiseeId>
 *   node scripts/copiar-cardapio-brendi.mjs <slug-brendi> <franchiseeId> --gravar
 *
 * Sem `--gravar` ele só mostra o que faria. Rodar de novo ATUALIZA, nunca
 * duplica: produto é identificado por nome+categoria, grupo por produto+título.
 *
 * A URL do banco sai de scratch/check-firehub-db-clean.js (ver a memória
 * "Consultar o banco de produção do FireHub").
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [slugBrendi, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");

if (!slugBrendi || !franchiseeId) {
  console.log("uso: node scripts/copiar-cardapio-brendi.mjs <slug-brendi> <franchiseeId> [--gravar]");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const reais = (c) => (c == null ? null : Math.round(Number(c)) / 100);
const idDoPath = (p) => String(p || "").split("/").pop();
const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Emoji por palavra no nome da categoria. Só enfeite; nunca decide nada. */
function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/bebida|refri|suco|cerveja/.test(n)) return "🥤";
  if (/sobremesa|doce|pudim|bolo/.test(n)) return "🍮";
  if (/açaí|acai/.test(n)) return "🍧";
  if (/porç|porc|batata|fritas/.test(n)) return "🍟";
  if (/pizza/.test(n)) return "🍕";
  if (/burguer|burger|lanche|hamb/.test(n)) return "🍔";
  if (/frango|chicken/.test(n)) return "🍗";
  if (/combo/.test(n)) return "🍱";
  if (/salgad|coxinha|past/.test(n)) return "🥟";
  if (/indica|destaque|casa/.test(n)) return "⭐";
  return "🍽️";
}

const EH_BEBIDA = /bebida|coca|guaran|pepsi|suco|refrigerante|água|agua|cerveja|fanta|sprite/i;

/* ─── 1. A FONTE: a API do cardápio público ──────────────────────────── */
const url = `https://pedido.brendi.com.br/api/${slugBrendi}/menu`;
const resposta = await fetch(url);
if (!resposta.ok) { console.log(`não consegui ler ${url} (HTTP ${resposta.status})`); process.exit(1); }
const cru = await resposta.json();
const d = cru.data ?? cru;

const grupos = new Map((d.customs || []).map((g) => [g.id, g]));
const produtos = new Map();
for (const lista of Object.values(d.productsByCategory || {})) {
  for (const p of lista) if (!p.$ref && !produtos.has(p.id)) produtos.set(p.id, p);
}

/* ─── 2. Normalizar nos cinco níveis ─────────────────────────────────── */
const cardapio = (d.categories || []).map((c, ordem) => ({
  ordem,
  nome: c.name,
  ativa: c.active !== false,
  produtos: (c.productsPaths || []).map(idDoPath).map((pid, i) => {
    const p = produtos.get(pid);
    if (!p) return { id: pid, oculto: true };
    return {
      ordem: i,
      nome: String(p.name || "").trim(),
      descricao: String(p.description || "").trim(),
      // `currentPrice` é o vigente (com promoção); `price` é o cheio.
      preco: reais(p.currentPrice ?? p.price),
      precoBase: reais(p.price),
      ativo: p.active !== false,
      // A FOTO SÓ VEM COM `?alt=media`.
      //
      // Sem esse parâmetro o Firebase Storage responde 200 com 1 KB de METADADOS
      // em JSON, não com a imagem — e o cardápio ficaria com 60 fotos quebradas
      // sem nenhum erro no caminho. Conferido em 12/09/2026: 1 KB sem, 176 KB com.
      //
      // O caminho `public/...` é aberto, então não precisa de token. É a imagem
      // ORIGINAL, melhor que a `_600x600` que o editor da Brendi serve.
      foto: p.picture
        ? `https://firebasestorage.googleapis.com/v0/b/brendi-app.appspot.com/o/${encodeURIComponent(p.picture)}?alt=media`
        : null,
      grupos: (p.customsPaths || []).map(idDoPath).map((gid) => {
        const g = grupos.get(gid);
        if (!g) return null;
        return {
          titulo: String(g.title || "").trim(),
          // "unique" = escolha uma; "increase" = adicionais.
          min: Number.isFinite(Number(g.minChoices)) ? Number(g.minChoices) : (g.required ? 1 : 0),
          max: Number(g.maxChoices) > 0 ? Number(g.maxChoices) : (g.type === "unique" ? 1 : null),
          opcoes: (g.choices || []).map((o) => ({
            titulo: String(o.title || "").trim(),
            precoExtra: reais(o.extraPrice) || 0,
            ativo: o.active !== false,
          })).filter((o) => o.titulo),
        };
      }).filter(Boolean),
    };
  }),
}));

/* ─── 3. O que já existe na loja ─────────────────────────────────────── */
const jaTem = await sql`
  SELECT "id","name","category","price","description","isCombo"
  FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId}`;
const porNomeCat = new Map(jaTem.map((p) => [chave(p.name) + "|" + chave(p.category), p]));
const opcoesExistentes = new Map(jaTem.filter((p) => p.category === "Complementos").map((p) => [chave(p.name), p]));
const catsExistentes = new Set(
  (await sql`SELECT "name" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId}`).map((c) => chave(c.name)),
);
const gruposExistentes = new Set(
  (await sql`
    SELECT g."menuProductId" AS pid, g."title"
    FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
    WHERE p."franchiseeId" = ${franchiseeId}`).map((r) => r.pid + "|" + chave(r.title)),
);

/* ─── 4. Gravar ──────────────────────────────────────────────────────── */
const conta = { categorias: 0, produtosNovos: 0, produtosAtualizados: 0, ocultos: 0, gruposNovos: 0, opcoesNovas: 0, vinculos: 0 };
const avisos = [];

for (const cat of cardapio) {
  if (!catsExistentes.has(chave(cat.nome))) {
    conta.categorias++;
    if (GRAVAR) {
      await sql`
        INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","sortOrder","createdAt","updatedAt")
        VALUES (${novoId("cat_")}, ${franchiseeId}, ${cat.nome}, ${emojiDaCategoria(cat.nome)}, ${cat.ordem}, NOW(), NOW())`;
    }
  }

  for (const p of cat.produtos) {
    if (p.oculto) {
      conta.ocultos++;
      avisos.push(`OCULTO na Brendi (não veio pela API pública): ${cat.nome} / id ${p.id}`);
      continue;
    }

    // PREÇO DE CENTAVO É DEDO ERRADO, NÃO PROMOÇÃO. O "Combo Tradicional
    // Turbinado" do Frangoso estava "de R$ 49,99 por R$ 0,01": copiar entregaria
    // o combo de graça. Vai o preço cheio e o dono decide.
    let preco = p.preco;
    if (preco != null && preco < 1 && (p.precoBase ?? 0) >= 5) {
      avisos.push(`PREÇO SUSPEITO: "${p.nome}" está R$ ${preco} na Brendi (cheio R$ ${p.precoBase}) — usei o cheio`);
      preco = p.precoBase;
    }

    const ordem = cat.ordem * 100 + p.ordem;
    const bebida = EH_BEBIDA.test(cat.nome) || EH_BEBIDA.test(p.nome);
    const existente = porNomeCat.get(chave(p.nome) + "|" + chave(cat.nome));
    let produtoId = existente?.id;

    if (existente) {
      conta.produtosAtualizados++;
      if (GRAVAR) {
        await sql`
          UPDATE "MenuProduct"
          SET "price" = ${preco}, "description" = ${p.descricao || existente.description || ""},
              "imageUrl" = COALESCE(${p.foto}, "imageUrl"), "sortOrder" = ${ordem},
              "active" = ${p.ativo}, "isBeverage" = ${bebida},
              "isCombo" = ${p.grupos.length > 0 || existente.isCombo === true}, "updatedAt" = NOW()
          WHERE "id" = ${existente.id}`;
      }
    } else {
      conta.produtosNovos++;
      produtoId = novoId("prd_");
      if (GRAVAR) {
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
          VALUES (${produtoId}, ${franchiseeId}, ${p.nome}, ${p.descricao || ""}, ${preco}, ${p.foto},
                  ${cat.nome}, ${ordem}, ${p.ativo}, ${p.grupos.length > 0}, ${bebida}, false, NOW(), NOW())`;
      }
      porNomeCat.set(chave(p.nome) + "|" + chave(cat.nome), { id: produtoId, name: p.nome });
    }

    /* Os complementos. No FireHub cada OPÇÃO é um MenuProduct `apenasEmCombo`,
       reaproveitado entre grupos: no Frangoso, 754 vínculos usam 74 opções. */
    let ordemGrupo = 0;
    for (const g of p.grupos) {
      ordemGrupo++;
      if (!produtoId || gruposExistentes.has(produtoId + "|" + chave(g.titulo))) continue;
      conta.gruposNovos++;

      // `max` nulo na origem = livre; o FireHub guarda número.
      const maxQty = g.max || g.opcoes.length || 1;
      const grupoId = novoId("cg_");
      if (GRAVAR) {
        await sql`
          INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","sortOrder")
          VALUES (${grupoId}, ${produtoId}, ${g.titulo}, ${maxQty}, ${g.min}, ${ordemGrupo})`;
      }

      for (const o of g.opcoes) {
        let opcao = opcoesExistentes.get(chave(o.titulo));
        if (!opcao) {
          conta.opcoesNovas++;
          const opId = novoId("prd_");
          opcao = { id: opId, name: o.titulo };
          opcoesExistentes.set(chave(o.titulo), opcao);
          if (GRAVAR) {
            await sql`
              INSERT INTO "MenuProduct"
                ("id","franchiseeId","name","description","price","category","sortOrder",
                 "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
              VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${""}, ${0}, ${"Complementos"}, ${0},
                      ${o.ativo}, false, false, true, NOW(), NOW())`;
          }
        }
        conta.vinculos++;
        if (GRAVAR) {
          await sql`
            INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice")
            VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${o.precoExtra})`;
        }
      }
    }
  }
}

console.log(GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
console.log(`loja na Brendi:        ${d.store?.name || slugBrendi}`);
console.log(`categorias novas:      ${conta.categorias}`);
console.log(`produtos novos:        ${conta.produtosNovos}`);
console.log(`produtos atualizados:  ${conta.produtosAtualizados}`);
console.log(`grupos de complemento: ${conta.gruposNovos}`);
console.log(`opções novas:          ${conta.opcoesNovas}`);
console.log(`vínculos grupo→opção:  ${conta.vinculos}`);
if (conta.ocultos) console.log(`produtos ocultos na origem: ${conta.ocultos}`);
if (avisos.length) {
  console.log("\nAVISOS (leia todos antes de dar o cardápio por copiado):");
  for (const a of avisos) console.log("  ⚠ " + a);
}
console.log(
  "\nDepois de gravar: confira no cardápio público (não só no banco) e" +
  "\ninternalize as fotos — elas ainda apontam para o storage da Brendi." +
  "\nProtocolo completo no Obsidian: Projetos/Protocolo - Copiar Cardapio.md",
);
