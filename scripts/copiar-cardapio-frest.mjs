/**
 * Copia um cardápio do Frest para uma loja do FireHub — categorias na ORDEM da
 * origem, produtos, fotos, descrições e promoções.
 *
 * Frest (app.frest.com.br) é plataforma de cardápio próprio. Entrou aqui em
 * 07/10/2026 com a Hlanchex (H LANCHES), indicação do Victor.
 *
 * ── A FONTE, E POR QUE ELA DÁ TRABALHO ──────────────────────────────────────
 *
 *   GET https://app.frest.com.br/api/lojas/<slug>          → dados da loja
 *   GET https://app.frest.com.br/api/lojas/listarprodutosvenda  → o cardápio
 *
 * A segunda rota NÃO leva a loja na URL nem em cookie: ela identifica a loja
 * pelo **JWT** que o SPA guarda em `localStorage['@infoLoja']` depois de abrir
 * a primeira. Chamar de fora, com cookie ou com `?loja=<cod>`, responde
 * `400 "Loja não identificada"` — perdi várias tentativas nisso. O token traz
 * `CodLoja` dentro e vai em `Authorization: Bearer <jwt>`.
 *
 * Por isso este script aceita o JSON já capturado (`--arquivo`): o caminho que
 * funciona é abrir a página no Chrome de depuração, deixar o SPA buscar o
 * cardápio e salvar a resposta (ver scratchpad `frest-espiar.cjs`, que espia
 * pelo Network do CDP). Com `--token` ele busca sozinho.
 *
 * ── O QUE A ORIGEM TEM E O QUE NÃO ENTRA ────────────────────────────────────
 *
 * Fotos: `caminhoImagem` é relativo a `https://f-rest.s3.amazonaws.com/`.
 * Promoção: `emPromocao` + `precoPromocao` — o site mostra o promocional e
 * risca o cheio, que é exatamente `price` + `promoPrice` no FireHub.
 * Opções: o formato prevê `tamanhos`, `sabores`, `massas`, `bordas`,
 * `adicionais` e `catSubItens` (é plataforma com modo pizza). Na Hlanchex
 * todos vieram vazios — o cardápio é plano. O código copia o que houver de
 * `adicionais` e avisa quando encontra algo que ele ainda não sabe converter,
 * em vez de descartar calado.
 *
 * ── CARD DE AVISO NÃO É PRODUTO ─────────────────────────────────────────────
 *
 * A Hlanchex usa um item de R$ 0,00 chamado "Aviso importante" só para
 * escrever o recado do PIX no cardápio. Copiar isso vira um produto de R$ 0,00
 * vendável, que entra na comanda sem somar nada. Item de preço zero e sem
 * opção nenhuma fica de fora, e o aviso sai no relatório para o lojista
 * decidir onde colocar o recado.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-frest.mjs <slug> <franchiseeId> --arquivo <json> [--gravar]
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const posicionais = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--arquivo" && args[i - 1] !== "--token");
const [slug, franchiseeId] = posicionais;
const GRAVAR = args.includes("--gravar");
const ARQUIVO = args.includes("--arquivo") ? args[args.indexOf("--arquivo") + 1] : null;
const TOKEN = args.includes("--token") ? args[args.indexOf("--token") + 1] : null;

if (!slug || !franchiseeId || (!ARQUIVO && !TOKEN)) {
  console.log("uso: node scripts/copiar-cardapio-frest.mjs <slug> <franchiseeId> --arquivo <json> [--gravar]");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;
const S3 = "https://f-rest.s3.amazonaws.com";

function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/suco|bebida|refri/.test(n)) return "🥤";
  if (/congelad/.test(n)) return "🧊";
  if (/mini salgado|salgad/.test(n)) return "🥟";
  if (/pizza/.test(n)) return "🍕";
  if (/lanche|burguer|burger/.test(n)) return "🍔";
  return "🍽️";
}
const EH_BEBIDA = /suco|refrigerante|bebida|coca|guaran|água|agua|cerveja/i;

/* ─── 1. A FONTE ─────────────────────────────────────────────────────── */
let bruto;
if (ARQUIVO) {
  bruto = JSON.parse(readFileSync(ARQUIVO, "utf8"));
} else {
  const res = await fetch("https://app.frest.com.br/api/lojas/listarprodutosvenda", {
    headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) { console.log(`a API respondeu ${res.status} — o token expirou?`); process.exit(1); }
  bruto = await res.json();
}
const categorias = bruto?.data?.categorias;
if (!Array.isArray(categorias)) { console.log("não achei `data.categorias` no JSON"); process.exit(1); }

const avisos = [];

/* ─── 2. Normalizar ──────────────────────────────────────────────────── */
const cardapio = categorias.map((c, ordemCat) => ({
  ordem: ordemCat,
  nome: limpo(c.descricao) || "Outros",
  produtos: (c.itens || []).map((p, ordemProd) => {
    const preco = reais(p.preco);
    const promo = p.emPromocao && reais(p.precoPromocao) > 0 ? reais(p.precoPromocao) : null;

    for (const campo of ["tamanhos", "sabores", "massas", "bordas", "catSubItens"]) {
      const v = p[campo];
      if (Array.isArray(v) && v.length > 0) {
        avisos.push(`OPÇÃO NÃO CONVERTIDA: "${limpo(p.descricao)}" tem ${v.length} em "${campo}" na origem — confira no cadastro`);
      }
    }

    return {
      ordem: ordemProd,
      nome: limpo(p.descricao),
      descricao: limpo(p.descricaoCompleta),
      // Promoção: o preço cheio é o `price` e o promocional é o `promoPrice`,
      // que é o que faz a vitrine mostrar o riscado igual à origem.
      preco: promo ? preco : preco,
      promo: promo && promo < preco ? promo : null,
      foto: p.caminhoImagem && p.caminhoImagem.trim() ? `${S3}/${p.caminhoImagem.trim()}` : null,
      /** Card de recado, não produto (ver cabeçalho). */
      ehAviso: preco === 0 && !(p.adicionais || []).length && !(p.catSubItens || []).length,
      adicionais: (p.adicionais || []).map((a) => ({
        titulo: limpo(a.descricao || a.nome),
        precoExtra: reais(a.preco ?? a.valor),
      })).filter((a) => a.titulo),
    };
  }),
}));

for (const c of cardapio) {
  for (const p of c.produtos) {
    if (p.ehAviso) {
      avisos.push(`CARD DE AVISO, não copiei como produto: "${p.nome}" (R$ 0,00, categoria "${c.nome}")${p.descricao ? ` — o texto era: "${p.descricao.slice(0, 160)}"` : ""}`);
    }
  }
}

/* ─── 3. O que já existe na loja ─────────────────────────────────────── */
const jaTem = await sql`
  SELECT "id","name","category" FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId}`;
const porNomeCat = new Map(jaTem.map((p) => [chave(p.name) + "|" + chave(p.category), p]));
const opcoesExistentes = new Map(
  jaTem.filter((p) => p.category === "Complementos").map((p) => [chave(p.name), p]),
);
const catsExistentes = new Map(
  (await sql`SELECT "id","name" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId}`).map((c) => [chave(c.name), c]),
);
const gruposExistentes = new Map(
  (await sql`
    SELECT g."id", g."menuProductId" AS pid, g."sortOrder"
    FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
    WHERE p."franchiseeId" = ${franchiseeId}`).map((r) => [r.pid + "#" + r.sortOrder, r.id]),
);

/* ─── 4. Gravar ──────────────────────────────────────────────────────── */
const conta = { catsNovas: 0, catsAtualizadas: 0, prodNovos: 0, prodAtualizados: 0, avisosPulados: 0, grupos: 0, opcoes: 0 };

for (const cat of cardapio) {
  const vendaveis = cat.produtos.filter((p) => !p.ehAviso);
  conta.avisosPulados += cat.produtos.length - vendaveis.length;
  if (vendaveis.length === 0) continue;

  const existente = catsExistentes.get(chave(cat.nome));
  if (existente) {
    conta.catsAtualizadas++;
    if (GRAVAR) await sql`UPDATE "MenuCategory" SET "sortOrder" = ${cat.ordem}, "updatedAt" = NOW() WHERE "id" = ${existente.id}`;
  } else {
    conta.catsNovas++;
    if (GRAVAR) {
      await sql`
        INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","color","sortOrder","createdAt","updatedAt")
        VALUES (${novoId("cat_")}, ${franchiseeId}, ${cat.nome}, ${emojiDaCategoria(cat.nome)}, ${"#64748B"}, ${cat.ordem}, NOW(), NOW())`;
    }
  }

  for (const p of vendaveis) {
    const bebida = EH_BEBIDA.test(cat.nome) || EH_BEBIDA.test(p.nome);
    const temGrupo = p.adicionais.length > 0;
    const jaExiste = porNomeCat.get(chave(p.nome) + "|" + chave(cat.nome));
    let produtoId = jaExiste?.id;

    if (jaExiste) {
      conta.prodAtualizados++;
      if (GRAVAR) {
        await sql`
          UPDATE "MenuProduct"
          SET "description" = ${p.descricao}, "price" = ${p.preco}, "promoPrice" = ${p.promo},
              "imageUrl" = COALESCE(${p.foto}, "imageUrl"), "sortOrder" = ${p.ordem},
              "active" = true, "isCombo" = ${temGrupo}, "isBeverage" = ${bebida}, "updatedAt" = NOW()
          WHERE "id" = ${jaExiste.id}`;
      }
    } else {
      conta.prodNovos++;
      produtoId = novoId("prd_");
      if (GRAVAR) {
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","promoPrice","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
          VALUES (${produtoId}, ${franchiseeId}, ${p.nome}, ${p.descricao}, ${p.preco}, ${p.promo}, ${p.foto},
                  ${cat.nome}, ${p.ordem}, true, ${temGrupo}, ${bebida}, false, NOW(), NOW())`;
      }
      porNomeCat.set(chave(p.nome) + "|" + chave(cat.nome), { id: produtoId, name: p.nome });
    }

    if (p.adicionais.length === 0) continue;
    conta.grupos++;
    const antigo = produtoId ? gruposExistentes.get(produtoId + "#1") : null;
    const grupoId = antigo || novoId("cg_");
    if (GRAVAR) {
      if (antigo) {
        await sql`UPDATE "ComboGroup" SET "title" = ${"Adicionais"}, "maxQty" = ${p.adicionais.length}, "minQty" = ${0} WHERE "id" = ${grupoId}`;
        await sql`DELETE FROM "ComboGroupItem" WHERE "comboGroupId" = ${grupoId}`;
      } else {
        await sql`
          INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","sortOrder")
          VALUES (${grupoId}, ${produtoId}, ${"Adicionais"}, ${p.adicionais.length}, ${0}, ${1})`;
        gruposExistentes.set(produtoId + "#1", grupoId);
      }
    }
    for (const o of p.adicionais) {
      let opcao = opcoesExistentes.get(chave(o.titulo));
      if (!opcao) {
        const opId = novoId("prd_");
        opcao = { id: opId, name: o.titulo };
        opcoesExistentes.set(chave(o.titulo), opcao);
        if (GRAVAR) {
          await sql`
            INSERT INTO "MenuProduct"
              ("id","franchiseeId","name","description","price","category","sortOrder",
               "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
            VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${""}, ${0}, ${"Complementos"}, ${0}, true, false, false, true, NOW(), NOW())`;
        }
      }
      conta.opcoes++;
      if (GRAVAR) {
        await sql`
          INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice","maxPerItem")
          VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${o.precoExtra}, ${1})`;
      }
    }
  }
}

/* ─── 5. Relatório ───────────────────────────────────────────────────── */
console.log("");
for (const c of cardapio) {
  const v = c.produtos.filter((p) => !p.ehAviso).length;
  console.log(`  ${String(c.ordem + 1).padStart(2)}. ${c.nome} — ${v} produto(s)` + (v !== c.produtos.length ? ` (+${c.produtos.length - v} card de aviso)` : ""));
}
console.log("\nCONTAGEM:", JSON.stringify(conta, null, 1));
if (avisos.length) {
  console.log(`\nAVISOS (${avisos.length}):`);
  for (const a of avisos) console.log("  • " + a);
}
console.log("\n" + (GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ==="));
