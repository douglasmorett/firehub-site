/**
 * Copia um cardápio do InstaDelivery para uma loja do FireHub — categorias na
 * ORDEM da origem, produtos, fotos, descrições, tags e COMPLEMENTOS.
 *
 * InstaDelivery (instadelivery.com.br) é plataforma de cardápio próprio de
 * pizzaria. Entrou aqui em 18/09/2026 com a Pizzaria do Digão (embaixador).
 *
 * ── A FONTE ─────────────────────────────────────────────────────────────────
 *
 *   https://app.instadelivery.com.br/api/stores/by-slug/<slug>
 *
 * É pública (sem sessão) e traz a LOJA INTEIRA num JSON só: `groups` são as
 * categorias, `groups[].itens` os produtos (grafia em português — `items` não
 * existe e devolve `undefined` calado), `itens[].complementos` os grupos de
 * pergunta e `complementos[].complements` as opções. Foto em todos os níveis.
 *
 * ── A REGRA DE PREÇO, CONFERIDA E NÃO SUPOSTA ───────────────────────────────
 *
 * Metade do cardápio é "monte a sua": produto com `price1: 0` e um grupo
 * obrigatório de sabores. A pergunta que decide a cópia inteira é COMO a
 * plataforma soma dois sabores — somando os dois, ou cobrando o mais caro.
 * Errar aqui é o que inflou os combos do Ragnar em R$ 18,80 na cópia do
 * Menudino.
 *
 * A prova está no próprio JSON: `from_price` (o "a partir de" que o site
 * mostra) bate com `Σ(min do grupo × opção mais barata)` nos SEIS produtos de
 * preço zero — "Escolha sua Pizza Grande" tem from_price 45,90 e sabor mais
 * barato 22,95 com min 2 (22,95 × 2 = 45,90). Se fosse "o mais caro manda",
 * from_price seria 22,95. É soma.
 *
 * E é exatamente o modelo de combo do FireHub: `precoUnitarioDoItem` =
 * preço base + Σ dos adicionais, e `precoMinimoDoProduto` usa a MESMA fórmula
 * do from_price — então o cardápio copiado mostra "A partir de R$ 45,90", o
 * mesmo número da origem, sem nenhuma conversão.
 *
 * (A loja estava fechada — 17:00 às 23:59 — e o modal não deixa selecionar
 * sabor fora do horário, então a conferência na tela fica para o lojista.
 * A aritmética acima é da plataforma, não minha.)
 *
 * ── OPÇÃO DE MESMO NOME COM PREÇO DIFERENTE ────────────────────────────────
 *
 * 55 dos 70 nomes de opção repetem com preços diferentes: "Mussarela" é
 * R$ 24,45 como meia pizza grande e R$ 28,90 como pizza pequena inteira;
 * "Borda de Cheddar" é R$ 10 em alguns produtos e R$ 12 em outros.
 *
 * Isso NÃO é problema aqui porque no FireHub o preço mora no VÍNCULO
 * (`ComboGroupItem.additionalPrice`), não no produto-opção: uma opção
 * "Mussarela" atende os dois grupos com preços diferentes. É o mesmo desenho
 * do importador do Menu Integrado.
 *
 * Cinco nomes repetem com URL de foto diferente ("Sem Borda Recheada" tem 3).
 * Baixei as três: MESMO sha256, mesmo tamanho — é a mesma imagem reenviada
 * pela loja. Deduplicar por nome não perde foto nenhuma.
 *
 * ── O QUE O FIREHUB NÃO TEM (fica registrado, não é esquecimento) ──────────
 *
 *   • `is_pizza` no grupo de sabores: o InstaDelivery marca o grupo como "de
 *     pizza" (42 sabores, escolha 2). O FireHub não tem modo pizza — mas com
 *     min 2 / max 2 e preço somado o resultado para o cliente é idêntico,
 *     inclusive escolher o mesmo sabor duas vezes para a pizza inteira.
 *   • `strike_price` (de/por): vira o preço vigente + tag "🏷️ Promoção".
 *     14 dos 20 produtos têm.
 *   • `cost`, `stock`/`stock_control`, `ncm_code`, `printer_group_id`: campos
 *     de gestão da origem que não entram num cardápio copiado.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-instadelivery.mjs <slug> <franchiseeId>
 *   node scripts/copiar-cardapio-instadelivery.mjs <slug> <franchiseeId> --gravar
 *
 * Sem `--gravar` só mostra o que faria. Rodar de novo ATUALIZA, nunca duplica:
 * produto é identificado por nome+categoria, grupo por produto+posição.
 *
 * Depois de gravar, as fotos ainda apontam para o CDN do InstaDelivery — o
 * cron /api/admin/internalizar-imagens traz cada uma para o volume da loja.
 * Não precisa cadastrar o host em lugar nenhum: o cron pega qualquer URL
 * absoluta que não seja nossa.
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [slug, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");

if (!slug || !franchiseeId) {
  console.log("uso: node scripts/copiar-cardapio-instadelivery.mjs <slug> <franchiseeId> [--gravar]");
  console.log("ex:  node scripts/copiar-cardapio-instadelivery.mjs dgforneria1 cmu3ago9401wsp4015pqqq5q0 --gravar");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;

function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/bebida|refri|suco|cerveja/.test(n)) return "🥤";
  if (/doce|sobremesa|chocolate|pudim|bolo/.test(n)) return "🍮";
  if (/calzone/.test(n)) return "🥟";
  if (/borda/.test(n)) return "🧀";
  if (/combo|oferta|promo|mega|mais pedid/.test(n)) return "🔥";
  if (/pizza/.test(n)) return "🍕";
  if (/burguer|burger|lanche|hamb/.test(n)) return "🍔";
  return "🍽️";
}

const EH_BEBIDA = /bebida|coca|guaran|pepsi|suco|refrigerante|água|agua|cerveja|fanta|sprite|sukita|dolly|h2o/i;

/** Os sete booleanos de dia da semana. Todos ligados = NULL (todo dia). */
const DIAS = [["mon", "SEG"], ["tue", "TER"], ["wed", "QUA"], ["thu", "QUI"], ["fri", "SEX"], ["sat", "SAB"], ["sun", "DOM"]];
function diasDaSemana(o) {
  const marcados = DIAS.filter(([k]) => o?.[k] === true).map(([, s]) => s);
  return marcados.length === 0 || marcados.length === 7 ? null : marcados;
}
function interseccaoDeDias(a, b) {
  if (!a) return b;
  if (!b) return a;
  const j = a.filter((d) => b.includes(d));
  return j.length === 0 || j.length === 7 ? null : j;
}

/* ─── 1. A FONTE ─────────────────────────────────────────────────────── */
const url = `https://app.instadelivery.com.br/api/stores/by-slug/${encodeURIComponent(slug)}`;
const resposta = await fetch(url, { headers: { Accept: "application/json" } });
if (!resposta.ok) {
  console.log(`não consegui ler ${url} (HTTP ${resposta.status})`);
  process.exit(1);
}
const loja = await resposta.json();
if (!loja || !Array.isArray(loja.groups)) {
  console.log("a API não devolveu a loja com `groups` que eu esperava");
  process.exit(1);
}

const avisos = [];

/* ─── 2. Normalizar ──────────────────────────────────────────────────── */
const cardapio = loja.groups
  .slice()
  .sort((a, b) => (a.order || 0) - (b.order || 0))
  .filter((c) => {
    if (!c.is_invisible && !c.deleted_at) return true;
    avisos.push(`CATEGORIA OCULTA NA ORIGEM, não copiei: "${limpo(c.name)}" (${(c.itens || []).length} produtos)`);
    return false;
  })
  .map((c, ordemCat) => {
    const diasDaCategoria = diasDaSemana(c);
    if (c.start_time || c.end_time) {
      avisos.push(`HORÁRIO NÃO COPIADO: categoria "${limpo(c.name)}" sai das ${c.start_time} às ${c.end_time} na origem; no FireHub sai o dia todo`);
    }
    return {
      ordem: ordemCat,
      nome: limpo(c.name),
      foto: c.image || null,
      dias: diasDaCategoria,
      produtos: (c.itens || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .filter((p) => {
          if (!p.is_invisible && !p.deleted_at) return true;
          avisos.push(`PRODUTO OCULTO NA ORIGEM, não copiei: "${limpo(p.name)}"`);
          return false;
        })
        .map((p, ordemProd) => {
          if (p.start_time || p.end_time) {
            avisos.push(`HORÁRIO NÃO COPIADO: "${limpo(p.name)}" sai das ${p.start_time} às ${p.end_time} na origem; no FireHub sai o dia todo`);
          }
          const preco = reais(p.price1);
          const de = reais(p.strike_price);
          if (de > preco) {
            avisos.push(`"DE/POR" NÃO COPIADO: "${limpo(p.name)}" é de R$ ${de.toFixed(2)} por R$ ${preco.toFixed(2)} na origem; copiei R$ ${preco.toFixed(2)} e marquei a tag "Promoção"`);
          }
          if (Number(p.minimum_quantity) > 1) {
            avisos.push(`QUANTIDADE MÍNIMA NÃO COPIADA: "${limpo(p.name)}" exige ${p.minimum_quantity} na origem`);
          }
          const tags = [];
          if (p.is_best_seller) tags.push("🔥 Mais Vendido");
          if (p.is_newest) tags.push("✨ Novo");
          if (de > preco) tags.push("🏷️ Promoção");

          return {
            ordem: ordemProd,
            nome: limpo(p.name),
            descricao: limpo(p.description),
            preco,
            tags,
            foto: p.image || null,
            ativo: true,
            dias: interseccaoDeDias(diasDaSemana(p), diasDaCategoria),
            grupos: (p.complementos || [])
              .slice()
              .sort((a, b) => (a.order || 0) - (b.order || 0))
              .map((g, i) => ({ g, posicao: i + 1 }))
              /* `max: 0` seria grupo desligado — a armadilha do Menu Integrado.
                 Não existe neste cardápio, mas a guarda fica: um grupo novo com
                 max 0 tem que ficar de fora, não virar adicional livre. */
              .filter(({ g }) => {
                if (Number(g.max) > 0) return true;
                avisos.push(`GRUPO DESLIGADO NA ORIGEM (max=0), não copiei: "${limpo(p.name)}" → "${limpo(g.name)}" (${(g.complements || []).length} opções)`);
                return false;
              })
              .map(({ g, posicao }) => ({
                posicao,
                titulo: limpo(g.name),
                min: Number.isFinite(Number(g.min)) ? Math.max(0, Number(g.min)) : 0,
                max: Math.max(1, Number(g.max)),
                opcoes: (g.complements || [])
                  .slice()
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .filter((o) => !o.is_invisible && !o.deleted_at)
                  .map((o) => ({
                    titulo: limpo(o.name),
                    descricao: limpo(o.description),
                    foto: o.image || null,
                    precoExtra: reais(o.price),
                    /* `max_quantity` é o teto por opção; 0 = sem teto próprio,
                       que no FireHub é NULL (só vale o teto do grupo). */
                    maxPorItem: Number(o.max_quantity) > 0 ? Number(o.max_quantity) : null,
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
/* Grupo identificado por produto + POSIÇÃO, nunca por título: produto com dois
   grupos de mesmo nome (uma borda para cada pizza) é comum nessas plataformas
   e deduplicar por título apagaria o segundo. */
const gruposExistentes = new Map(
  (await sql`
    SELECT g."id", g."menuProductId" AS pid, g."sortOrder"
    FROM "ComboGroup" g JOIN "MenuProduct" p ON p."id" = g."menuProductId"
    WHERE p."franchiseeId" = ${franchiseeId}`).map((r) => [r.pid + "#" + r.sortOrder, r.id]),
);

/* ─── 4. Gravar ──────────────────────────────────────────────────────── */
const conta = { catsNovas: 0, catsAtualizadas: 0, prodNovos: 0, prodAtualizados: 0, grupos: 0, opcoesNovas: 0, opcoesReaproveitadas: 0, vinculos: 0 };

for (const cat of cardapio) {
  const existente = catsExistentes.get(chave(cat.nome));
  if (existente) {
    conta.catsAtualizadas++;
    if (GRAVAR) {
      await sql`
        UPDATE "MenuCategory"
        SET "sortOrder" = ${cat.ordem}, "imageUrl" = COALESCE(${cat.foto}, "imageUrl"), "updatedAt" = NOW()
        WHERE "id" = ${existente.id}`;
    }
  } else {
    conta.catsNovas++;
    if (GRAVAR) {
      await sql`
        INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","imageUrl","color","sortOrder","createdAt","updatedAt")
        VALUES (${novoId("cat_")}, ${franchiseeId}, ${cat.nome}, ${emojiDaCategoria(cat.nome)},
                ${cat.foto}, ${"#64748B"}, ${cat.ordem}, NOW(), NOW())`;
    }
  }

  for (const p of cat.produtos) {
    const bebida = EH_BEBIDA.test(cat.nome) || EH_BEBIDA.test(p.nome);
    const temGrupo = p.grupos.length > 0;
    const dias = p.dias ? JSON.stringify(p.dias) : null;
    const tags = p.tags.length ? JSON.stringify(p.tags) : null;
    const jaExiste = porNomeCat.get(chave(p.nome) + "|" + chave(cat.nome));
    let produtoId = jaExiste?.id;

    if (jaExiste) {
      conta.prodAtualizados++;
      if (GRAVAR) {
        await sql`
          UPDATE "MenuProduct"
          SET "description" = ${p.descricao}, "price" = ${p.preco},
              "imageUrl" = COALESCE(${p.foto}, "imageUrl"), "sortOrder" = ${p.ordem},
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
                  ${cat.nome}, ${p.ordem}, ${p.ativo}, ${temGrupo}, ${bebida}, false, ${dias}, ${tags}, NOW(), NOW())`;
      }
      porNomeCat.set(chave(p.nome) + "|" + chave(cat.nome), { id: produtoId, name: p.nome });
    }

    /* Os complementos. No FireHub cada OPÇÃO é um MenuProduct `apenasEmCombo`
       em "Complementos", reaproveitado entre grupos — e o PREÇO fica no
       vínculo, que é o que permite "Mussarela" custar 24,45 numa pergunta e
       28,90 em outra sem virar dois produtos. */
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
            // A foto da opção importa: o ComboModal do FireHub mostra a imagem
            // de cada item do grupo, igual ao site de origem.
            await sql`
              INSERT INTO "MenuProduct"
                ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
                 "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
              VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${o.descricao}, ${0}, ${o.foto},
                      ${"Complementos"}, ${0}, ${true}, false, ${EH_BEBIDA.test(o.titulo)}, true, NOW(), NOW())`;
          }
        } else {
          conta.opcoesReaproveitadas++;
        }
        conta.vinculos++;
        if (GRAVAR) {
          await sql`
            INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice","maxPerItem")
            VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${o.precoExtra}, ${o.maxPorItem})`;
        }
      }
    }
  }
}

console.log(GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
console.log(`origem:                 ${url}`);
console.log(`loja na origem:         ${loja.name}`);
console.log(`categorias novas:       ${conta.catsNovas}  (atualizadas: ${conta.catsAtualizadas})`);
console.log(`produtos novos:         ${conta.prodNovos}  (atualizados: ${conta.prodAtualizados})`);
console.log(`grupos de complemento:  ${conta.grupos}`);
console.log(`opções novas:           ${conta.opcoesNovas}  (reaproveitadas: ${conta.opcoesReaproveitadas})`);
console.log(`vínculos grupo→opção:   ${conta.vinculos}`);
if (avisos.length) {
  console.log(`\nAVISOS (${avisos.length}) — leia todos antes de dar o cardápio por copiado:`);
  for (const a of [...new Set(avisos)]) console.log("  ⚠ " + a);
}
console.log(
  "\nDepois de gravar: confira com scripts/conferir-cardapio-instadelivery.mjs" +
  "\n(compara item a item com a origem) e internalize as fotos — elas ainda" +
  "\napontam para o CDN do InstaDelivery.",
);
