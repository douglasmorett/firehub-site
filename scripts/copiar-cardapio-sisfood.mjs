/**
 * Copia um cardápio do SisFood para uma loja do FireHub — categorias na ORDEM
 * da origem, produtos, fotos, descrições, promoções e PERGUNTAS (complementos).
 *
 * SisFood (sisfood.com.br) é plataforma de cardápio próprio. Entrou aqui em
 * 07/10/2026 com a GARAGEM BURGUER BUTIÁ.
 *
 * ── A FONTE ─────────────────────────────────────────────────────────────────
 *
 * Duas chamadas, as duas públicas (sem sessão), base
 * `https://www.sisfood.com.br/pedido/<slug>`:
 *
 *   POST /init     → a loja inteira. `menu.products_categories` são as
 *                    categorias e `menu.products` os 246 produtos — mas SEM as
 *                    perguntas. É o erro fácil: copiar só o /init entrega um
 *                    cardápio de hambúrguer sem "escolha o hambúrguer".
 *   POST /produto  → `{code}` devolve `complements_groups` (as perguntas) e
 *                    `complements` (as opções) daquele produto.
 *
 * O HTML da página é só a casca do SPA: o cardápio não está nele, e
 * `GET /produto/<code>` devolve a mesma casca. Quem responde é o POST.
 *
 * ── RATE LIMIT: 1 DE CADA VEZ ───────────────────────────────────────────────
 *
 * Quatro requisições em paralelo derrubaram 207 dos 246 produtos em HTTP 429.
 * Este script vai um por vez, com pausa, e GRAVA O PROGRESSO: interrompeu,
 * rodar de novo retoma de onde parou em vez de recomeçar os 246.
 *
 * ── A REGRA DE PREÇO, CONFERIDA E NÃO SUPOSTA ───────────────────────────────
 *
 * NENHUM dos 246 produtos tem preço zero, e nenhum grupo é de "monte o seu":
 * todo produto se vende sozinho e a opção SOMA ao preço base ("Marmita de
 * Lasanha" R$ 19,99 + "lasanha de carne" R$ 10). É exatamente
 * `precoUnitarioDoItem` do FireHub — preço base + Σ dos adicionais —, então o
 * cardápio copiado cobra o mesmo número da origem, sem conversão nenhuma.
 *
 * As opções de "RETIRAR DO LANCHE" ("Sem Alface", "Sem Bacon") vêm com preço
 * 0: viram opção de R$ 0,00 no grupo, que é como o FireHub escreve "sem X" na
 * comanda.
 *
 * ── DE/POR ──────────────────────────────────────────────────────────────────
 *
 * 15 produtos têm `price_old` maior que `price`. Isso NÃO vira tag: vira
 * promoção de verdade — `price` = o "de" e `promoPrice` = o "por". É o mesmo
 * desenho do campo no FireHub (promoção tem que ser MENOR que o preço de
 * venda) e sai com o riscado na vitrine, igual à origem.
 *
 * ── O MESMO GRUPO COM OPÇÕES DIFERENTES POR PRODUTO ────────────────────────
 *
 * O grupo 8 ("ADICIONAL") aparece em 72 produtos com 50 conjuntos de opções
 * diferentes. Por isso cada produto leva as perguntas DELE, montadas do
 * `complements` da resposta dele — nunca um grupo global reaproveitado. No
 * FireHub isso é natural: o preço da opção mora no VÍNCULO
 * (`ComboGroupItem.additionalPrice`), então a mesma opção serve a vários
 * grupos com preços diferentes sem virar vários produtos.
 *
 * ── O QUE O FIREHUB NÃO TEM (fica registrado, não é esquecimento) ──────────
 *
 *   • `select_quantity_accumulated` e `description_print` do grupo: a origem
 *     usa para imprimir um rótulo curto ("ADD") na comanda. Não copiado.
 *   • `stock_quantity` / `flag_product_stock_zero`: estoque da origem. O
 *     FireHub tem estoque próprio (Cardápio → 📦 Estoque) e copiar número de
 *     outra plataforma deixaria a loja com um estoque que ninguém baixa.
 *   • `fidelity_program_product_points`: programa de pontos da origem.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-sisfood.mjs <slug> <franchiseeId>
 *   node scripts/copiar-cardapio-sisfood.mjs <slug> <franchiseeId> --gravar
 *
 * Sem `--gravar` só mostra o que faria. Rodar de novo ATUALIZA, nunca duplica:
 * produto é identificado por nome+categoria, grupo por produto+posição.
 *
 * Depois de gravar, as fotos ainda apontam para o CDN do SisFood — o cron
 * /api/admin/internalizar-imagens traz cada uma para o volume da loja.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [slug, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");
const CACHE = process.argv.includes("--cache");

if (!slug || !franchiseeId) {
  console.log("uso: node scripts/copiar-cardapio-sisfood.mjs <slug> <franchiseeId> [--gravar] [--cache]");
  console.log("ex:  node scripts/copiar-cardapio-sisfood.mjs garagemhamburgueria cmuvr6cjo00lao301d2juf1la --gravar");
  process.exit(1);
}

const sql = neon(readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/)[0]);

const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/bebida|refri|suco|cerveja/.test(n)) return "🥤";
  if (/sorvete|milkshake|açaí|acai/.test(n)) return "🍦";
  if (/doce|sobremesa|chocolate|pudim|bolo/.test(n)) return "🍮";
  if (/molho/.test(n)) return "🥫";
  if (/porç|porc|batata/.test(n)) return "🍟";
  if (/marmita|alaminuta|buffet/.test(n)) return "🍱";
  if (/combo|oferta|promo/.test(n)) return "🔥";
  if (/dog|cachorro/.test(n)) return "🌭";
  if (/xis|burguer|burger|lanche|hamb/.test(n)) return "🍔";
  return "🍽️";
}

const EH_BEBIDA = /bebida|coca|guaran|pepsi|suco|refrigerante|água|agua|cerveja|fanta|sprite|sukita|dolly|h2o|energetic/i;

/* ─── 1. A FONTE ─────────────────────────────────────────────────────── */
const BASE = `https://www.sisfood.com.br/pedido/${encodeURIComponent(slug)}`;
const CABECALHO = {
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded",
  Referer: BASE,
  "User-Agent": "Mozilla/5.0",
};
const ARQUIVO_CACHE = `scratch/sisfood-${slug}.json`;

async function postar(caminho, dados) {
  const res = await fetch(BASE + caminho, {
    method: "POST",
    headers: CABECALHO,
    body: new URLSearchParams(dados || {}),
  });
  if (res.status === 429) {
    const e = new Error("429");
    e.rate = true;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const init = await postar("/init", {});
if (!init?.menu?.products) {
  console.log("a API não devolveu `menu.products` — confira o slug");
  process.exit(1);
}
const fuso = init.company?.time_zone || "America/Sao_Paulo";
const CDN = (init.system?.path_public_upload || "https://sisfood.com.br/uploads/").replace(/\/$/, "");

/* Cada produto precisa do POST /produto para trazer as perguntas. Um de cada
   vez (ver o cabeçalho), com o progresso em disco para poder retomar. */
const baixados = new Map();
if (existsSync(ARQUIVO_CACHE)) {
  for (const r of JSON.parse(readFileSync(ARQUIVO_CACHE, "utf8"))) baixados.set(r.code, r);
  console.log(`cache: ${baixados.size} produtos já baixados`);
}
const semDetalhe = [];
for (const p of init.menu.products) {
  if (baixados.has(p.code)) continue;
  if (CACHE) { semDetalhe.push(p); continue; }
  let espera = 900;
  let ok = false;
  for (let t = 1; t <= 5 && !ok; t++) {
    try {
      const d = await postar("/produto", { code: String(p.code), modo_operacao: "", combo: "", timezone: fuso });
      baixados.set(p.code, { code: p.code, ...d });
      ok = true;
    } catch (e) {
      if (e.rate && t < 5) { espera = Math.min(espera * 2, 20000); await dormir(espera); }
    }
  }
  if (!ok) semDetalhe.push(p);
  if (baixados.size % 25 === 0) writeFileSync(ARQUIVO_CACHE, JSON.stringify([...baixados.values()]));
  await dormir(900);
}
writeFileSync(ARQUIVO_CACHE, JSON.stringify([...baixados.values()]));

const avisos = [];
for (const p of semDetalhe) {
  avisos.push(`PERGUNTAS NÃO LIDAS: "${limpo(p.name)}" (código ${p.code}) — a origem recusou; copiei o produto sem os complementos`);
}

/* ─── 2. Normalizar ──────────────────────────────────────────────────── */
const porCategoria = new Map();
/* Nome repetido DENTRO da mesma categoria vira um produto só: o FireHub casa
   produto por nome+categoria, então o segundo sobrescreveria o primeiro e o
   lojista acabaria com um item cujas perguntas são as do outro. A Garagem tinha
   "Chuleta de Gado" duas vezes em "Porção Em Marmita", códigos 734 e 125, as
   duas a R$ 10,00. Junta-se o primeiro e avisa-se — nunca em silêncio. */
const nomesVistos = new Map();
for (const p of init.menu.products) {
  const nome = limpo(p.category_name) || "Outros";
  const k = chave(p.name) + "|" + chave(nome);
  if (nomesVistos.has(k)) {
    const antes = nomesVistos.get(k);
    avisos.push(
      `REPETIDO NA ORIGEM, copiei UMA vez: "${limpo(p.name)}" em "${nome}" aparece nos códigos ${antes.code} (R$ ${reais(antes.price).toFixed(2)}) e ${p.code} (R$ ${reais(p.price).toFixed(2)})`,
    );
    continue;
  }
  nomesVistos.set(k, p);
  if (!porCategoria.has(nome)) porCategoria.set(nome, []);
  porCategoria.get(nome).push(p);
}

/* A ordem das categorias é a de `products_categories` — a que o lojista
   arrumou no painel da origem. Categoria que só aparece nos produtos vai para
   o fim, não some. */
const ordemDaOrigem = init.menu.products_categories.map((c) => limpo(c.name));
const nomesDeCategoria = [
  ...ordemDaOrigem.filter((n) => porCategoria.has(n)),
  ...[...porCategoria.keys()].filter((n) => !ordemDaOrigem.includes(n)),
];

const cardapio = nomesDeCategoria.map((nomeCat, ordemCat) => ({
  ordem: ordemCat,
  nome: nomeCat,
  produtos: porCategoria.get(nomeCat).map((p, ordemProd) => {
    const detalhe = baixados.get(p.code);
    const complementos = detalhe?.complements || [];
    const preco = reais(p.price);
    const de = reais(p.price_old);

    /* "de/por": o preço DE é o de tabela e o POR é a promoção. O FireHub exige
       promoção MENOR que o preço de venda — o inverso seria um aumento
       anunciado como desconto, então só entra quando de > por. */
    const temPromo = de > preco && preco > 0;
    if (temPromo) {
      avisos.push(`PROMOÇÃO: "${limpo(p.name)}" é de R$ ${de.toFixed(2)} por R$ ${preco.toFixed(2)} na origem — copiei como promoção (sai com o riscado)`);
    }

    const grupos = (detalhe?.complements_groups || []).map((g, i) => {
      const opcoes = complementos.filter((o) => o.group_code === g.group_code);
      return {
        posicao: i + 1,
        titulo: limpo(g.group_name) || "Escolha",
        min: Math.max(0, Number(g.choose_option_minimum) || 0),
        max: Math.max(1, Number(g.choose_option_maximum) || 1),
        opcoes: opcoes.map((o) => ({
          titulo: limpo(o.name),
          descricao: limpo(o.description),
          foto: o.image ? `${CDN}/${o.image}` : null,
          precoExtra: reais(o.price),
          maxPorItem: Math.max(1, Number(o.max_quantity) || 1),
        })),
      };
    })
      /* Grupo sem opção nenhuma é pergunta vazia: no ComboModal ela aparece e
         não dá para responder, travando o item obrigatório. Fica de fora. */
      .filter((g) => {
        if (g.opcoes.length > 0) return true;
        avisos.push(`PERGUNTA VAZIA, não copiei: "${g.titulo}" em "${limpo(p.name)}"`);
        return false;
      });

    return {
      ordem: ordemProd,
      nome: limpo(p.name),
      descricao: limpo(p.ingredients),
      preco: temPromo ? de : preco,
      promo: temPromo ? preco : null,
      foto: p.image ? `${CDN}/${p.image}` : null,
      grupos,
    };
  }),
}));

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
const conta = { catsNovas: 0, catsAtualizadas: 0, prodNovos: 0, prodAtualizados: 0, grupos: 0, opcoesNovas: 0, opcoesReaproveitadas: 0, vinculos: 0 };

for (const cat of cardapio) {
  const existente = catsExistentes.get(chave(cat.nome));
  if (existente) {
    conta.catsAtualizadas++;
    if (GRAVAR) {
      await sql`UPDATE "MenuCategory" SET "sortOrder" = ${cat.ordem}, "updatedAt" = NOW() WHERE "id" = ${existente.id}`;
    }
  } else {
    conta.catsNovas++;
    if (GRAVAR) {
      await sql`
        INSERT INTO "MenuCategory" ("id","franchiseeId","name","emoji","color","sortOrder","createdAt","updatedAt")
        VALUES (${novoId("cat_")}, ${franchiseeId}, ${cat.nome}, ${emojiDaCategoria(cat.nome)}, ${"#64748B"}, ${cat.ordem}, NOW(), NOW())`;
    }
  }

  for (const p of cat.produtos) {
    const bebida = EH_BEBIDA.test(cat.nome) || EH_BEBIDA.test(p.nome);
    const temGrupo = p.grupos.length > 0;
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

    /* Cada OPÇÃO é um MenuProduct `apenasEmCombo` em "Complementos",
       reaproveitado entre grupos — o preço fica no vínculo, que é o que
       permite a mesma opção custar valores diferentes em perguntas
       diferentes. */
    for (const g of p.grupos) {
      conta.grupos++;
      const antigo = produtoId ? gruposExistentes.get(produtoId + "#" + g.posicao) : null;
      const grupoId = antigo || novoId("cg_");
      if (GRAVAR) {
        if (antigo) {
          await sql`UPDATE "ComboGroup" SET "title" = ${g.titulo}, "maxQty" = ${g.max}, "minQty" = ${g.min} WHERE "id" = ${grupoId}`;
          // Reconstruir: preço de opção muda na origem e um INSERT cego
          // duplicaria a opção dentro do grupo.
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
            await sql`
              INSERT INTO "MenuProduct"
                ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
                 "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
              VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${o.descricao}, ${0}, ${o.foto},
                      ${"Complementos"}, ${0}, true, false, ${EH_BEBIDA.test(o.titulo)}, true, NOW(), NOW())`;
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

/* ─── 5. O relatório ─────────────────────────────────────────────────── */
console.log("");
console.log(`CATEGORIAS: ${cardapio.length}`);
for (const c of cardapio) {
  const comPergunta = c.produtos.filter((p) => p.grupos.length > 0).length;
  console.log(`  ${String(c.ordem + 1).padStart(2)}. ${c.nome} — ${c.produtos.length} produtos (${comPergunta} com pergunta)`);
}
console.log("");
console.log("CONTAGEM:", JSON.stringify(conta, null, 1));
if (avisos.length) {
  console.log("");
  console.log(`AVISOS (${avisos.length}):`);
  for (const a of avisos) console.log("  • " + a);
}
console.log("");
console.log(GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
