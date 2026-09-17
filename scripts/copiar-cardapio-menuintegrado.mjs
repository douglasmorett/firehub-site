/**
 * Copia um cardápio do Menu Integrado para uma loja do FireHub — categorias na
 * ORDEM da origem, produtos, fotos, descrições, dias da semana e COMPLEMENTOS.
 *
 * Menu Integrado (assets.menuintegrado.com) é a plataforma por trás de sites de
 * delivery próprios como rdpizza.com.br. Entrou aqui em 17/09/2026 com a
 * entrada do R&D Pizzaria (Rafas Chefe, embaixador).
 *
 * ── A FONTE ─────────────────────────────────────────────────────────────────
 *
 *   https://<dominio-da-loja>/internal/categories?channel=platform
 *
 * É pública (não precisa de sessão) e traz o cardápio INTEIRO de uma vez, já
 * ordenado: categoria → produtos → `variations` (grupos) → `items` (opções),
 * com preço, descrição e foto em todos os níveis. Não precisa abrir produto por
 * produto no navegador para montar a cópia — mas precisa abrir para CONFERIR,
 * e foi conferindo que apareceu a regra do `max: 0` abaixo.
 *
 * ── AS DUAS ARMADILHAS (descobertas conferindo na tela, não lendo o JSON) ───
 *
 * 1. GRUPO COM `max: 0` NÃO EXISTE PARA O CLIENTE.
 *
 *    O JSON do R&D traz 3 grupos com `min: 0, max: 0` e `hint: ""` — "Refrigerante"
 *    (5 opções, R$ 8 a R$ 16), "REFRI" (8 opções) e "ADICIONAL" (4 opções).
 *    Parecem adicionais livres. Abri os três produtos no site, deslogado, e
 *    NENHUM dos grupos aparece no modal: `max: 0` é grupo desligado.
 *
 *    Copiar como "livre" teria colocado 17 opções à venda que a loja não vende
 *    hoje — inclusive refrigerante dentro de uma promoção cuja descrição diz,
 *    em maiúsculas, "NÃO ACRESCENTAMOS ITENS NESSA PROMOÇÃO".
 *
 * 2. O MESMO TÍTULO DE GRUPO SE REPETE DENTRO DE UM PRODUTO.
 *
 *    "2 PIZZAS 35CM / 1 COCA 2L" tem DOIS grupos "Borda Recheada" — um para
 *    cada pizza. Deduplicar grupo por (produto + título), que é o que o
 *    importador da Brendi faz, apagaria a borda da segunda pizza. Aqui o grupo
 *    é identificado pela POSIÇÃO na origem.
 *
 * ── O QUE O FIREHUB NÃO TEM (fica registrado, não é esquecimento) ──────────
 *
 *   • janela de horário por produto (`start1`/`stop1`): a origem tem produto de
 *     17:00 às 23:59. O FireHub só tem dia da semana. O produto vem o dia todo.
 *   • preço "de/por" (`originalPrice`): vira o preço vigente + tag "Promoção".
 *   • dia da semana por OPÇÃO: existe na origem (uma opção não sai na terça),
 *     não existe em ComboGroupItem.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-menuintegrado.mjs <dominio> <franchiseeId>
 *   node scripts/copiar-cardapio-menuintegrado.mjs <dominio> <franchiseeId> --gravar
 *
 * Sem `--gravar` só mostra o que faria. Rodar de novo ATUALIZA, nunca duplica:
 * produto é identificado por nome+categoria, grupo por produto+posição.
 *
 * Depois de gravar, as fotos ainda apontam para assets.menuintegrado.com — o
 * cron /api/admin/internalizar-imagens (a cada 6 h) traz cada uma para o volume
 * da loja. `menuintegrado` está na lista ORIGENS_DE_FORA de lá.
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [dominio, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");

if (!dominio || !franchiseeId) {
  console.log("uso: node scripts/copiar-cardapio-menuintegrado.mjs <dominio> <franchiseeId> [--gravar]");
  console.log("ex:  node scripts/copiar-cardapio-menuintegrado.mjs www.rdpizza.com.br cmu4bopb6028cmp01vmgpldtx --gravar");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Emoji por palavra no nome da categoria. Só enfeite; nunca decide nada. */
function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/bebida|refri|suco|cerveja/.test(n)) return "🥤";
  if (/doce|sobremesa|chocolate|pudim|bolo/.test(n)) return "🍮";
  if (/calzone/.test(n)) return "🥟";
  if (/borda/.test(n)) return "🧀";
  if (/pizza/.test(n)) return "🍕";
  if (/burguer|burger|lanche|hamb/.test(n)) return "🍔";
  if (/combo|oferta|promo|mega|mais pedid/.test(n)) return "🔥";
  return "🍽️";
}

const EH_BEBIDA = /bebida|coca|guaran|pepsi|suco|refrigerante|água|agua|cerveja|fanta|sprite|sukita|guaravita|h2o|limoneto/i;

/**
 * `days` do Menu Integrado tem OITO posições. As sete últimas são os dias:
 * 1=SEG … 7=DOM. A posição 0 não é dia (a categoria "OFERTA DO DIA / SEGUNDA"
 * vem [false,true,false,…], a "QUARTA" com o true no índice 3 e a "QUINTA" no
 * 4 — e foi a de QUINTA que apareceu no site numa quinta-feira).
 *
 * Tudo ligado = sem restrição; o FireHub grava NULL, que é "todo dia".
 */
const SIGLAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];
function diasDaSemana(days) {
  if (!Array.isArray(days) || days.length < 8) return null;
  const marcados = SIGLAS.filter((_, i) => days[i + 1] === true);
  return marcados.length === 0 || marcados.length === 7 ? null : marcados;
}
/** Produto só sai quando o dia serve para ELE **e** para a categoria dele. */
function interseccaoDeDias(a, b) {
  if (!a) return b;
  if (!b) return a;
  const j = a.filter((d) => b.includes(d));
  return j.length === 0 || j.length === 7 ? null : j;
}

/* ─── 1. A FONTE ─────────────────────────────────────────────────────── */
const url = `https://${dominio.replace(/^https?:\/\//, "").replace(/\/$/, "")}/internal/categories?channel=platform`;
const resposta = await fetch(url, { headers: { Accept: "application/json" } });
if (!resposta.ok) {
  console.log(`não consegui ler ${url} (HTTP ${resposta.status})`);
  process.exit(1);
}
const cru = await resposta.json();
if (!Array.isArray(cru)) {
  console.log("a API não devolveu a lista de categorias que eu esperava");
  process.exit(1);
}

const avisos = [];

/* ─── 2. Normalizar ──────────────────────────────────────────────────── */
const cardapio = cru.map((c, ordemCat) => {
  const diasDaCategoria = diasDaSemana(c.days);
  if (!c.alwaysAvailable && (c.start1 !== "00:00" || c.stop1 !== "23:59")) {
    avisos.push(`HORÁRIO NÃO COPIADO: categoria "${limpo(c.name)}" sai das ${c.start1} às ${c.stop1} na origem; no FireHub ela sai o dia todo`);
  }
  return {
    ordem: ordemCat,
    nome: limpo(c.name),
    foto: c.coverImageUrl || null,
    cor: /^#[0-9a-f]{6}$/i.test(String(c.color)) ? c.color : null,
    dias: diasDaCategoria,
    produtos: (c.products || []).map((p, ordemProd) => {
      if (!p.alwaysAvailable && (p.start1 !== "00:00" || p.stop1 !== "23:59")) {
        avisos.push(`HORÁRIO NÃO COPIADO: "${limpo(p.name)}" sai das ${p.start1} às ${p.stop1} na origem; no FireHub sai o dia todo`);
      }
      const original = Number(p.originalPrice) || 0;
      const preco = reais(p.price);
      if (original > preco) {
        avisos.push(`"DE/POR" NÃO COPIADO: "${limpo(p.name)}" é ${p.textOriginalPrice} por ${p.textPrice} na origem; copiei ${p.textPrice} e marquei a tag "Promoção"`);
      }
      return {
        ordem: ordemProd,
        nome: limpo(p.name),
        descricao: limpo(p.description),
        preco,
        emPromocao: original > preco,
        foto: p.coverImageUrl || null,
        // `salePaused` é o "pausar venda" e `inStock` o esgotado da origem.
        ativo: p.salePaused !== true && p.inStock !== false,
        dias: interseccaoDeDias(diasDaSemana(p.days), diasDaCategoria),
        grupos: (p.variations || [])
          .slice()
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map((g, i) => ({ g, posicao: i + 1 }))
          // `max: 0` é grupo DESLIGADO: conferido no site, não aparece para o
          // cliente em nenhum dos três produtos que têm um. Ver o cabeçalho.
          .filter(({ g }) => {
            if (Number(g.max) > 0) return true;
            avisos.push(`GRUPO DESLIGADO NA ORIGEM (max=0), não copiei: "${limpo(p.name)}" → "${limpo(g.name)}" (${(g.items || []).length} opções)`);
            return false;
          })
          .map(({ g, posicao }) => ({
            posicao,
            titulo: limpo(g.name),
            min: Number.isFinite(Number(g.min)) ? Math.max(0, Number(g.min)) : 0,
            max: Math.max(1, Number(g.max)),
            opcoes: (g.items || [])
              .map((o) => ({
                titulo: limpo(o.name),
                descricao: limpo(o.description),
                foto: o.coverImageUrl || null,
                precoExtra: reais(o.price),
                ativo: o.salePaused !== true && o.inStock !== false,
              }))
              .filter((o) => o.titulo),
          })),
      };
    }),
  };
});

/* ─── 3. O que já existe na loja ─────────────────────────────────────── */
const jaTem = await sql`
  SELECT "id","name","category","description","isCombo","imageUrl"
  FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId}`;
const porNomeCat = new Map(jaTem.map((p) => [chave(p.name) + "|" + chave(p.category), p]));
const opcoesExistentes = new Map(
  jaTem.filter((p) => p.category === "Complementos").map((p) => [chave(p.name), p]),
);
const catsExistentes = new Map(
  (await sql`SELECT "id","name" FROM "MenuCategory" WHERE "franchiseeId" = ${franchiseeId}`).map((c) => [chave(c.name), c]),
);
/* Grupo identificado por produto + POSIÇÃO, nunca por título: há produto com
   dois grupos de mesmo nome (uma borda para cada pizza). */
const gruposExistentes = new Map(
  (await sql`
    SELECT g."id", g."menuProductId" AS pid, g."sortOrder"
    FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
    WHERE p."franchiseeId" = ${franchiseeId}`).map((r) => [r.pid + "#" + r.sortOrder, r.id]),
);

/* ─── 4. Gravar ──────────────────────────────────────────────────────── */
const conta = { catsNovas: 0, catsAtualizadas: 0, prodNovos: 0, prodAtualizados: 0, grupos: 0, opcoesNovas: 0, vinculos: 0 };

for (const cat of cardapio) {
  const existente = catsExistentes.get(chave(cat.nome));
  if (existente) {
    conta.catsAtualizadas++;
    if (GRAVAR) {
      await sql`
        UPDATE "MenuCategory"
        SET "sortOrder" = ${cat.ordem}, "imageUrl" = COALESCE(${cat.foto}, "imageUrl"),
            "color" = COALESCE(${cat.cor}, "color"), "updatedAt" = NOW()
        WHERE "id" = ${existente.id}`;
    }
  } else {
    conta.catsNovas++;
    if (GRAVAR) {
      await sql`
        INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","imageUrl","color","sortOrder","createdAt","updatedAt")
        VALUES (${novoId("cat_")}, ${franchiseeId}, ${cat.nome}, ${emojiDaCategoria(cat.nome)},
                ${cat.foto}, ${cat.cor || "#64748B"}, ${cat.ordem}, NOW(), NOW())`;
    }
  }

  for (const p of cat.produtos) {
    /* A ordem DENTRO da categoria. O FireHub ordena por (categoria, sortOrder,
       nome); a categoria já tem a ordem dela em MenuCategory.sortOrder. */
    const ordem = p.ordem;
    const bebida = EH_BEBIDA.test(cat.nome) || EH_BEBIDA.test(p.nome);
    const temGrupo = p.grupos.length > 0;
    const dias = p.dias ? JSON.stringify(p.dias) : null;
    const tags = p.emPromocao ? JSON.stringify(["Promoção"]) : null;
    const jaExiste = porNomeCat.get(chave(p.nome) + "|" + chave(cat.nome));
    let produtoId = jaExiste?.id;

    if (jaExiste) {
      conta.prodAtualizados++;
      if (GRAVAR) {
        await sql`
          UPDATE "MenuProduct"
          SET "description" = ${p.descricao}, "price" = ${p.preco},
              "imageUrl" = COALESCE(${p.foto}, "imageUrl"), "sortOrder" = ${ordem},
              "active" = ${p.ativo}, "isCombo" = ${temGrupo}, "isBeverage" = ${bebida},
              "availableDays" = ${dias}, "tags" = COALESCE(${tags}, "tags"), "updatedAt" = NOW()
          WHERE "id" = ${jaExiste.id}`;
      }
    } else {
      conta.prodNovos++;
      produtoId = novoId("prd_");
      if (GRAVAR) {
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","availableDays","tags","createdAt","updatedAt")
          VALUES (${produtoId}, ${franchiseeId}, ${p.nome}, ${p.descricao}, ${p.preco}, ${p.foto},
                  ${cat.nome}, ${ordem}, ${p.ativo}, ${temGrupo}, ${bebida}, false, ${dias}, ${tags}, NOW(), NOW())`;
      }
      porNomeCat.set(chave(p.nome) + "|" + chave(cat.nome), { id: produtoId, name: p.nome });
    }

    /* Os complementos. No FireHub cada OPÇÃO é um MenuProduct `apenasEmCombo`
       em "Complementos", reaproveitado entre grupos — as 211 opções do R&D
       cabem em 76 produtos. */
    for (const g of p.grupos) {
      conta.grupos++;
      const antigo = produtoId ? gruposExistentes.get(produtoId + "#" + g.posicao) : null;
      const grupoId = antigo || novoId("cg_");
      if (GRAVAR) {
        if (antigo) {
          await sql`
            UPDATE "ComboGroup" SET "title" = ${g.titulo}, "maxQty" = ${g.max}, "minQty" = ${g.min}
            WHERE "id" = ${grupoId}`;
          // Os vínculos são reconstruídos: preço de opção muda na origem e um
          // INSERT cego duplicaria a opção dentro do grupo.
          await sql`DELETE FROM "ComboGroupItem" WHERE "comboGroupId" = ${grupoId}`;
        } else {
          await sql`
            INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","sortOrder")
            VALUES (${grupoId}, ${produtoId}, ${g.titulo}, ${g.max}, ${g.min}, ${g.posicao})`;
          gruposExistentes.set(produtoId + "#" + g.posicao, grupoId);
        }
      }

      for (const o of g.opcoes) {
        let opcao = opcoesExistentes.get(chave(o.titulo));
        if (!opcao) {
          conta.opcoesNovas++;
          const opId = novoId("prd_");
          opcao = { id: opId, name: o.titulo };
          opcoesExistentes.set(chave(o.titulo), opcao);
          if (GRAVAR) {
            // A foto da opção importa: o ComboModal do FireHub mostra a
            // imagem de cada item do grupo, igual ao site de origem.
            await sql`
              INSERT INTO "MenuProduct"
                ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
                 "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
              VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${o.descricao}, ${0}, ${o.foto},
                      ${"Complementos"}, ${0}, ${o.ativo}, false, ${EH_BEBIDA.test(o.titulo)}, true, NOW(), NOW())`;
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
console.log(`origem:                ${url}`);
console.log(`categorias novas:      ${conta.catsNovas}  (atualizadas: ${conta.catsAtualizadas})`);
console.log(`produtos novos:        ${conta.prodNovos}  (atualizados: ${conta.prodAtualizados})`);
console.log(`grupos de complemento: ${conta.grupos}`);
console.log(`opções novas:          ${conta.opcoesNovas}`);
console.log(`vínculos grupo→opção:  ${conta.vinculos}`);
if (avisos.length) {
  console.log(`\nAVISOS (${avisos.length}) — leia todos antes de dar o cardápio por copiado:`);
  for (const a of [...new Set(avisos)]) console.log("  ⚠ " + a);
}
console.log(
  "\nDepois de gravar: confira no cardápio PÚBLICO (não só no banco) com" +
  "\nscripts/conferir-cardapio-menuintegrado.mjs, e internalize as fotos —" +
  "\nelas ainda apontam para assets.menuintegrado.com.",
);
