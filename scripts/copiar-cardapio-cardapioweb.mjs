/**
 * Copia um cardápio do CardápioWeb para uma loja do FireHub — categorias na
 * ORDEM da origem, produtos, fotos, descrições, promoções, selos, canais e
 * COMPLEMENTOS (com a regra de preço de cada pergunta).
 *
 * CardápioWeb (app.cardapioweb.com/<slug>) entrou aqui em 24/09/2026 com a
 * Divinos Burger (Cabo Frio).
 *
 * ── A FONTE ─────────────────────────────────────────────────────────────────
 *
 *   GET https://integracao.cardapioweb.com/api/menu/company/categories
 *       ?only_available_for=<canal>&origin=catalogo
 *   cabeçalhos:  Company-ID: <número>   Company: <slug>
 *
 * Pública, sem sessão, mas SEM OS DOIS CABEÇALHOS responde 200 com
 * {"message":"Parâmetros inválidos!"} — foi preciso abrir a página num
 * navegador e capturar a requisição para descobrir o `Company`. O número vem
 * embutido no HTML da página (`companyId",{value:9989`).
 *
 * O `only_available_for` FILTRA: `delivery` esconde o produto que a loja só
 * vende no balcão (na Divinos, o "Palito de mussarela empanado"). Por isso a
 * cópia lê delivery, service_desk e table e junta — e o canal que não trouxe
 * o produto vira o `active<Canal> = false` dele.
 *
 * Estrutura: categoria → `items` (produtos) → `add_ons` (perguntas) →
 * `subitems` (opções). Foto em produto e em opção.
 *
 * ── A REGRA DE PREÇO, LIDA NO CÓDIGO DA ORIGEM ──────────────────────────────
 *
 * Cada pergunta traz `price_calculation_type`. O bundle do site (função que
 * soma os add_ons) faz, com as opções repetidas pela quantidade escolhida:
 *
 *   SUM  → soma            → FireHub priceRule nulo ("SOMA")
 *   MEAN → média, 2 casas  → FireHub "MEDIA" (também ponderada pela quantidade)
 *   MAX  → a mais cara     → FireHub "MAIOR"
 *   MIN  → a mais barata   → o FireHub NÃO TEM: a cópia para e avisa.
 *
 * A pizza da Divinos é MEAN: meia Mussarela (48,90) + meia Camarão (77,90)
 * custa 63,40. Cada sabor é cadastrado pelo preço CHEIO, igual ao FireHub.
 *
 * E `choice_type` decide a repetição:
 *
 *   SINGLE    → escolha 1 (rádio)
 *   MULTIPLE  → cada opção no máximo 1× (sabor não repete) → maxPerItem = 1
 *   SUMMABLE  → a opção repete até o teto do grupo (2× "3 unidades" de
 *               coxinha) → maxPerItem = `max_quantity` da opção, ou nulo
 *
 * ── PROMOÇÃO ────────────────────────────────────────────────────────────────
 *
 * `promotional_price` com `promotional_price_active` vira `promoPrice` — o
 * FireHub mostra o preço de tabela riscado, como a origem. Mas a promoção da
 * origem pode valer só em alguns dias (`promotional_price_availability`) e o
 * `promoPrice` do FireHub vale todo dia. A regra: se a promoção cobre TODOS os
 * dias em que o produto está à venda, copia; senão fica o preço de tabela e o
 * aviso sai no relatório, para a loja decidir.
 *
 * ── HORÁRIO ─────────────────────────────────────────────────────────────────
 *
 * `allowed_times` é janela por dia ("segunda 19:00–23:59"). O FireHub só tem
 * dia da semana: viram os dias, e a hora vai para os avisos. Janela que começa
 * 00:00 e termina de madrugada é a CONTINUAÇÃO da noite anterior (a loja
 * cadastra "terça 00:00–00:59" para a segunda que passa da meia-noite) — não
 * abre o dia seguinte.
 *
 * ── O QUE O FIREHUB NÃO TEM (fica registrado, não é esquecimento) ──────────
 *
 *   • `extra_images`: galeria de fotos do produto. Só a principal vem.
 *   • `hide_observation_field`, `adults_only`, `unit_type`, `print_area_id`,
 *     `stock`: gestão da origem, não entram num cardápio copiado.
 *   • `combo_steps` (combo em etapas, `kind` diferente de regular_item): não
 *     existe nesta loja. Se aparecer, a cópia para — não é para adivinhar.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-cardapio-cardapioweb.mjs <slug> <franchiseeId>
 *   node scripts/copiar-cardapio-cardapioweb.mjs <slug> <franchiseeId> --gravar
 *
 * Sem `--gravar` só mostra o que faria. Rodar de novo ATUALIZA, nunca duplica:
 * produto é identificado por nome+categoria, grupo por produto+posição.
 *
 * Depois: scripts/conferir-cardapio-cardapioweb.mjs compara campo a campo e
 * SIMULA o preço de cada combinação nos dois lados.
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

const [slug, franchiseeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");

if (!slug || !franchiseeId) {
  console.log("uso: node scripts/copiar-cardapio-cardapioweb.mjs <slug> <franchiseeId> [--gravar]");
  console.log("ex:  node scripts/copiar-cardapio-cardapioweb.mjs divinos_burger cmudbzcus0008ka010pmo1e0w --gravar");
  process.exit(1);
}

/** O banco: o scratch dos outros PCs, ou o DATABASE_URL do .env. */
function urlDoBanco() {
  if (existsSync("scratch/check-firehub-db-clean.js")) {
    const m = readFileSync("scratch/check-firehub-db-clean.js", "utf8").match(/postgresql:\/\/[^"']*/);
    if (m) return m[0];
  }
  const m = readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
  if (!m) throw new Error("sem DATABASE_URL no .env");
  return m[1];
}
const sql = neon(urlDoBanco());

const novoId = (p) => p + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const chave = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const limpo = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
const reais = (v) => Math.round((Number(v) || 0) * 100) / 100;
/**
 * A opção é reaproveitada entre perguntas pelo nome EXATO — maiúscula conta.
 * A Divinos tem "5 unidades" nas coxinhas e "5 Unidades" no bolinho; juntar
 * as duas pela chave minúscula fazia o bolinho exibir o nome da coxinha, e o
 * conferidor pegou isso simulando o preço pelo nome da origem.
 */
const nomeDaOpcao = (s) => String(s || "").trim().replace(/\s+/g, " ");

function emojiDaCategoria(nome) {
  const n = chave(nome);
  if (/bebida|refri|suco|cerveja/.test(n)) return "🥤";
  if (/milk|shake|doce|sobremesa|chocolate|pudim|bolo/.test(n)) return "🍨";
  if (/batata|frita/.test(n)) return "🍟";
  if (/entrada|porç|porc/.test(n)) return "🍗";
  if (/combo|oferta|promo|mega|mais pedid/.test(n)) return "🔥";
  if (/pizza/.test(n)) return "🍕";
  if (/burguer|burger|lanche|hamb/.test(n)) return "🍔";
  return "🍽️";
}

/** Só para OPÇÕES (produto-complemento). Produto de vitrine é bebida só pela
 *  categoria: "X Tudo + refri 269ml" é combo, e `isBeverage` num combo o
 *  tiraria da produção no KDS. */
const EH_BEBIDA = /\bcoca\b|guaran|pepsi|suco|refrigerante|refri\b|água|agua|cerveja|fanta|sprite|sukita|h2oh|del valle|clip cola|mineirinho|guaravit|ativ plus/i;
const CATEGORIA_DE_BEBIDA = /bebida/i;

const DIA = { monday: "SEG", tuesday: "TER", wednesday: "QUA", thursday: "QUI", friday: "SEX", saturday: "SAB", sunday: "DOM" };
const SIGLAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];
const ordenarDias = (l) => SIGLAS.filter((s) => l.includes(s));

/** `allowed_times` → dias. Janela 00:00→madrugada é a noite anterior. */
function diasDasJanelas(janelas) {
  if (!Array.isArray(janelas) || janelas.length === 0) return null;
  const dias = new Set();
  for (const j of janelas) {
    const continuacao = j.start_at === "00:00" && String(j.end_at) < "06:00";
    if (!continuacao && DIA[j.weekday]) dias.add(DIA[j.weekday]);
  }
  const l = ordenarDias([...dias]);
  return l.length === 0 || l.length === 7 ? null : l;
}
function interseccaoDeDias(a, b) {
  if (!a) return b;
  if (!b) return a;
  const j = a.filter((d) => b.includes(d));
  return j.length === 7 ? null : j;
}

const REGRA = { SUM: null, MEAN: "MEDIA", MAX: "MAIOR" };

/* ─── 1. A FONTE ─────────────────────────────────────────────────────── */
const html = await (await fetch(`https://app.cardapioweb.com/${slug}`)).text();
const companyId = html.match(/companyId["']?\s*,\s*\{\s*value\s*:\s*(\d+)/)?.[1];
if (!companyId) {
  console.log(`não achei o companyId no HTML de app.cardapioweb.com/${slug}`);
  process.exit(1);
}
async function lerCanal(canal) {
  const url = `https://integracao.cardapioweb.com/api/menu/company/categories?only_available_for=${canal}&origin=catalogo`;
  const r = await fetch(url, { headers: { Accept: "application/json", "Company-ID": companyId, Company: slug } });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`${canal}: a API não devolveu a lista de categorias (${JSON.stringify(j).slice(0, 120)})`);
  return j;
}
const CANAIS = ["delivery", "service_desk", "table"];
const porCanal = Object.fromEntries(await Promise.all(CANAIS.map(async (c) => [c, await lerCanal(c)])));

/* Junta os canais: a ordem é a do delivery; o que só existe no balcão/mesa
   entra na posição em que aparece lá. */
const categorias = new Map(); // catId → { cat, itens: Map(prodId → { p, canais:Set }) }
for (const canal of CANAIS) {
  for (const c of porCanal[canal]) {
    if (!categorias.has(c.id)) categorias.set(c.id, { cat: c, itens: new Map() });
    const alvo = categorias.get(c.id);
    for (const p of c.items || []) {
      if (!alvo.itens.has(p.id)) alvo.itens.set(p.id, { p, canais: new Set() });
      alvo.itens.get(p.id).canais.add(canal);
    }
  }
}

const avisos = [];
const paradas = [];

/* ─── 2. Normalizar ──────────────────────────────────────────────────── */
const cardapio = [...categorias.values()].map(({ cat: c, itens }, ordemCat) => {
  if (c.status !== "ACTIVE") avisos.push(`CATEGORIA "${limpo(c.name)}" está ${c.status} na origem — copiada assim mesmo`);
  if (c.allowed_times?.length) avisos.push(`HORÁRIO DE CATEGORIA NÃO COPIADO: "${limpo(c.name)}" ${JSON.stringify(c.allowed_times)}`);
  return {
    ordem: ordemCat,
    nome: limpo(c.name),
    foto: c.image_url || null,
    produtos: [...itens.values()].map(({ p, canais }, ordemProd) => {
      const nome = limpo(p.name);
      if (p.kind !== "regular_item" || p.combo_steps?.length) {
        paradas.push(`"${nome}" é ${p.kind} com ${p.combo_steps?.length || 0} etapas de combo — este copiador não sabe traduzir isso`);
      }
      if (p.extra_images?.length) avisos.push(`FOTOS EXTRAS NÃO COPIADAS: "${nome}" tem ${p.extra_images.length} além da principal`);

      const dias = diasDasJanelas(p.allowed_times);
      if (p.allowed_times?.length) {
        const janelas = p.allowed_times.map((j) => `${DIA[j.weekday]} ${j.start_at}–${j.end_at}`).join(", ");
        avisos.push(`HORÁRIO NÃO COPIADO: "${nome}" só sai em ${janelas} na origem; no FireHub sai ${dias ? dias.join("/") : "todo dia"} o dia todo`);
      }

      const preco = reais(p.price);
      let promo = null;
      const valorPromo = reais(p.promotional_price);
      if (p.promotional_price_active && valorPromo > 0 && valorPromo < preco) {
        const diasPromo = ordenarDias((p.promotional_price_availability || []).map((d) => DIA[d]).filter(Boolean));
        const diasDeVenda = dias || SIGLAS;
        const cobre = diasDeVenda.every((d) => diasPromo.includes(d));
        if (cobre) promo = valorPromo;
        else {
          avisos.push(
            `PROMOÇÃO SÓ EM ALGUNS DIAS, NÃO COPIADA: "${nome}" é R$ ${preco.toFixed(2)} por R$ ${valorPromo.toFixed(2)} ` +
              `só em ${diasPromo.join("/")}; o FireHub não tem promoção por dia — ficou R$ ${preco.toFixed(2)} todo dia`,
          );
        }
      }

      const tags = [];
      if (p.badge === "best_seller") tags.push("🔥 Mais Vendido");
      else if (p.badge === "recommended") tags.push("⭐ Destaque");
      else if (p.badge) avisos.push(`SELO DESCONHECIDO: "${nome}" tem badge "${p.badge}"`);
      if (promo) tags.push("🏷️ Promoção");

      const esgotado = p.status !== "ACTIVE";
      if (esgotado) avisos.push(`ESGOTADO NA ORIGEM (${p.status}): "${nome}" — copiado INATIVO`);

      return {
        ordem: ordemProd,
        nome,
        descricao: limpo(p.description),
        preco,
        promo,
        tags,
        foto: p.image_url || null,
        ativo: !esgotado,
        dias,
        canais: {
          delivery: canais.has("delivery"),
          pdv: canais.has("service_desk"),
          totem: canais.has("service_desk"),
          garcom: canais.has("table"),
        },
        grupos: (p.add_ons || [])
          .map((g, i) => ({ g, posicao: i + 1 }))
          .filter(({ g }) => {
            if (g.status === "ACTIVE" && (g.subitems || []).length > 0) return true;
            avisos.push(`PERGUNTA ${g.status}/vazia NA ORIGEM, não copiei: "${nome}" → "${limpo(g.name)}"`);
            return false;
          })
          .map(({ g, posicao }) => {
            if (!(g.price_calculation_type in REGRA)) {
              paradas.push(`"${nome}" → "${limpo(g.name)}" cobra por ${g.price_calculation_type}, que o FireHub não tem`);
            }
            const min = Math.max(0, Number(g.minimum_quantity) || 0);
            const max = g.choice_type === "SINGLE" ? 1 : Math.max(1, Number(g.maximum_quantity) || 1);
            return {
              posicao,
              titulo: limpo(g.name),
              min: Math.min(min, max),
              max,
              regra: REGRA[g.price_calculation_type] ?? null,
              opcoes: (g.subitems || [])
                .filter((o) => {
                  if (o.status === "ACTIVE") return true;
                  avisos.push(`OPÇÃO ${o.status} NA ORIGEM, não copiei: "${nome}" → "${limpo(g.name)}" → "${limpo(o.name)}"`);
                  return false;
                })
                .map((o) => ({
                  titulo: limpo(o.name),
                  descricao: limpo(o.description),
                  foto: o.image_url || null,
                  precoExtra: reais(o.price),
                  maxPorItem:
                    g.choice_type === "MULTIPLE" ? 1 : Number(o.max_quantity) > 0 ? Number(o.max_quantity) : null,
                }))
                .filter((o) => o.titulo),
            };
          }),
      };
    }),
  };
});

if (paradas.length) {
  console.log("PAREI — o cardápio tem coisa que este copiador não traduz:");
  for (const p of paradas) console.log("  ✖ " + p);
  process.exit(1);
}

/* Produto de preço zero com todas as perguntas opcionais sai DE GRAÇA. */
for (const cat of cardapio) {
  for (const p of cat.produtos) {
    const base = p.promo ?? p.preco;
    const exige = p.grupos.some((g) => g.min > 0 && g.opcoes.some((o) => o.precoExtra > 0));
    if (base === 0 && !exige) {
      avisos.push(`R$ 0,00 POSSÍVEL: "${p.nome}" tem preço zero e nenhuma pergunta obrigatória paga — na origem também. Vale a loja tornar a pergunta obrigatória`);
    }
  }
}

/* ─── 3. O que já existe na loja ─────────────────────────────────────── */
const [loja] = await sql`SELECT "id","storeName" FROM "User" WHERE "id" = ${franchiseeId}`;
if (!loja) {
  console.log(`não existe loja com id ${franchiseeId}`);
  process.exit(1);
}
const jaTem = await sql`
  SELECT "id","name","category" FROM "MenuProduct" WHERE "franchiseeId" = ${franchiseeId}`;
const porNomeCat = new Map(jaTem.map((p) => [chave(p.name) + "|" + chave(p.category), p]));
const opcoesExistentes = new Map(
  jaTem.filter((p) => p.category === "Complementos").map((p) => [nomeDaOpcao(p.name), p]),
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

/* A opção é UM produto reaproveitado entre perguntas; a foto e a descrição
   são a primeira que aparecer com conteúdo (a mesma opção vem sem foto num
   grupo e com foto em outro). O preço fica no vínculo. */
const fotoDaOpcao = new Map();
const descDaOpcao = new Map();
for (const cat of cardapio)
  for (const p of cat.produtos)
    for (const g of p.grupos)
      for (const o of g.opcoes) {
        if (o.foto && !fotoDaOpcao.has(nomeDaOpcao(o.titulo))) fotoDaOpcao.set(nomeDaOpcao(o.titulo), o.foto);
        if (o.descricao && !descDaOpcao.has(nomeDaOpcao(o.titulo))) descDaOpcao.set(nomeDaOpcao(o.titulo), o.descricao);
      }

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
    catsExistentes.set(chave(cat.nome), { id: "novo", name: cat.nome });
  }

  for (const p of cat.produtos) {
    const bebida = CATEGORIA_DE_BEBIDA.test(cat.nome);
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
          SET "description" = ${p.descricao}, "price" = ${p.preco}, "promoPrice" = ${p.promo},
              "imageUrl" = COALESCE(${p.foto}, "imageUrl"), "sortOrder" = ${p.ordem},
              "active" = ${p.ativo}, "isCombo" = ${temGrupo}, "isBeverage" = ${bebida},
              "activeDelivery" = ${p.canais.delivery}, "activePDV" = ${p.canais.pdv},
              "activeTotem" = ${p.canais.totem}, "activeGarcom" = ${p.canais.garcom},
              "availableDays" = ${dias}, "tags" = ${tags}, "updatedAt" = NOW()
          WHERE "id" = ${jaExiste.id}`;
      }
    } else {
      conta.prodNovos++;
      produtoId = novoId("prd_");
      if (GRAVAR) {
        await sql`
          INSERT INTO "MenuProduct"
            ("id","franchiseeId","name","description","price","promoPrice","imageUrl","category","sortOrder",
             "active","isCombo","isBeverage","apenasEmCombo","availableDays","tags",
             "activeDelivery","activePDV","activeTotem","activeGarcom","createdAt","updatedAt")
          VALUES (${produtoId}, ${franchiseeId}, ${p.nome}, ${p.descricao}, ${p.preco}, ${p.promo}, ${p.foto},
                  ${cat.nome}, ${p.ordem}, ${p.ativo}, ${temGrupo}, ${bebida}, false, ${dias}, ${tags},
                  ${p.canais.delivery}, ${p.canais.pdv}, ${p.canais.totem}, ${p.canais.garcom}, NOW(), NOW())`;
      }
      porNomeCat.set(chave(p.nome) + "|" + chave(cat.nome), { id: produtoId, name: p.nome });
    }

    for (const g of p.grupos) {
      conta.grupos++;
      const antigo = jaExiste ? gruposExistentes.get(produtoId + "#" + g.posicao) : null;
      const grupoId = antigo || novoId("cg_");
      if (GRAVAR) {
        if (antigo) {
          await sql`
            UPDATE "ComboGroup" SET "title" = ${g.titulo}, "maxQty" = ${g.max}, "minQty" = ${g.min}, "priceRule" = ${g.regra}
            WHERE "id" = ${grupoId}`;
          // Vínculos reconstruídos: preço de opção muda na origem e um INSERT
          // cego duplicaria a opção dentro do grupo.
          await sql`DELETE FROM "ComboGroupItem" WHERE "comboGroupId" = ${grupoId}`;
        } else {
          await sql`
            INSERT INTO "ComboGroup" ("id","menuProductId","title","maxQty","minQty","priceRule","sortOrder")
            VALUES (${grupoId}, ${produtoId}, ${g.titulo}, ${g.max}, ${g.min}, ${g.regra}, ${g.posicao})`;
          gruposExistentes.set(produtoId + "#" + g.posicao, grupoId);
        }
      }

      for (const [ordemOpcao, o] of g.opcoes.entries()) {
        let opcao = opcoesExistentes.get(nomeDaOpcao(o.titulo));
        if (!opcao) {
          conta.opcoesNovas++;
          const opId = novoId("prd_");
          opcao = { id: opId, name: o.titulo };
          opcoesExistentes.set(nomeDaOpcao(o.titulo), opcao);
          if (GRAVAR) {
            await sql`
              INSERT INTO "MenuProduct"
                ("id","franchiseeId","name","description","price","imageUrl","category","sortOrder",
                 "active","isCombo","isBeverage","apenasEmCombo","createdAt","updatedAt")
              VALUES (${opId}, ${franchiseeId}, ${o.titulo}, ${descDaOpcao.get(nomeDaOpcao(o.titulo)) || ""}, ${0},
                      ${fotoDaOpcao.get(nomeDaOpcao(o.titulo)) || null}, ${"Complementos"}, ${0}, ${true}, false,
                      ${EH_BEBIDA.test(o.titulo)}, true, NOW(), NOW())`;
          }
        } else {
          conta.opcoesReaproveitadas++;
          if (GRAVAR && fotoDaOpcao.get(nomeDaOpcao(o.titulo))) {
            await sql`
              UPDATE "MenuProduct" SET "imageUrl" = COALESCE("imageUrl", ${fotoDaOpcao.get(nomeDaOpcao(o.titulo))})
              WHERE "id" = ${opcao.id}`;
          }
        }
        conta.vinculos++;
        if (GRAVAR) {
          await sql`
            INSERT INTO "ComboGroupItem" ("id","comboGroupId","menuProductId","additionalPrice","maxPerItem","sortOrder")
            VALUES (${novoId("cgi_")}, ${grupoId}, ${opcao.id}, ${o.precoExtra}, ${o.maxPorItem}, ${ordemOpcao})`;
        }
      }
    }
  }
}

console.log(GRAVAR ? "=== GRAVADO ===" : "=== SIMULAÇÃO (use --gravar) ===");
console.log(`origem:                 app.cardapioweb.com/${slug} (companyId ${companyId})`);
console.log(`destino:                ${loja.storeName} (${franchiseeId})`);
console.log(`categorias novas:       ${conta.catsNovas}  (atualizadas: ${conta.catsAtualizadas})`);
console.log(`produtos novos:         ${conta.prodNovos}  (atualizados: ${conta.prodAtualizados})`);
console.log(`grupos de complemento:  ${conta.grupos}`);
console.log(`opções novas:           ${conta.opcoesNovas}  (reaproveitadas: ${conta.opcoesReaproveitadas})`);
console.log(`vínculos grupo→opção:   ${conta.vinculos}`);
if (avisos.length) {
  console.log(`\nAVISOS (${new Set(avisos).size}) — leia todos antes de dar o cardápio por copiado:`);
  for (const a of [...new Set(avisos)]) console.log("  ⚠ " + a);
}
console.log(
  "\nDepois de gravar: node --experimental-strip-types scripts/conferir-cardapio-cardapioweb.mjs" +
    "\n(compara campo a campo e simula os preços) e internalize as fotos — elas" +
    "\nainda apontam para storage.googleapis.com/prod-cardapio-web.",
);
