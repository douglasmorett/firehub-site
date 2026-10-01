/**
 * Copia o cardápio de uma loja do FireHub para OUTRA loja do FireHub —
 * categorias (na ordem da loja), produtos, fotos, descrições, preços por canal,
 * promoções, selos, dias, canais, pausados, combos, perguntas e opções.
 *
 * Nasceu em 30/09/2026 para o Victor (embaixador e vendedor): a loja dele no
 * FireHub existe para apresentar o sistema e estava vazia. O Douglas pediu o
 * cardápio da Hakim Centro "igualzinho lá para ele".
 *
 * ── COMO COPIA ──────────────────────────────────────────────────────────────
 *
 * Tudo DENTRO do banco: `INSERT … SELECT` da linha de origem com id novo e a
 * loja nova. Nenhum valor passa pelo JavaScript, então preço, JSON
 * (precoPorEscolha, comboConfig) e coluna que o boot criou e o schema ainda
 * não conhece chegam exatamente como estão — a lista de colunas vem do
 * information_schema, não de uma lista escrita aqui.
 *
 *   • Espelho das integrações (iFood, JotaJá, 99…) NÃO vem: é catálogo de
 *     pedido de fora, não cardápio (mesma regra de src/lib/cardapio-interno.ts).
 *     A exceção é o espelho que alguma pergunta usa como opção — esse vem,
 *     senão a opção some do combo. A categoria de integração também não vem.
 *   • Estoque disponível (estoqueQtd/estoqueDesde) fica em branco: é conta da
 *     operação da origem, não cardápio. "Pausar ao zerar" vem.
 *   • Foto: o mesmo endereço (/uploads/…) — o arquivo é um só no servidor.
 *   • Ficha técnica não vem: aponta para o estoque da origem.
 *   • comboConfig (formato antigo de combo) tem os ids de produto trocados
 *     pelos novos.
 *
 * ── A PROVA ─────────────────────────────────────────────────────────────────
 *
 * Antes de gravar, a mesma transação compara linha a linha origem e cópia —
 * toda coluna, com os vínculos (produto do grupo, grupo da opção, produto da
 * opção) conferidos pelo mapa de ids. Qualquer diferença desfaz tudo. Como as
 * duas lojas usam a MESMA conta de preço (lib/preco-combo, lib/preco-por-canal),
 * dados iguais cobram igual em toda escolha.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *
 *   node --experimental-strip-types scripts/copiar-cardapio-entre-lojas.mjs \
 *        --de contatohakim@gmail.com --para victor33costa@gmail.com            (só mostra)
 *   … --aplicar                 grava (recusa se o destino já tem cardápio)
 *   … --aplicar --substituir    apaga antes o cardápio que o destino já tem —
 *                               só de loja que nunca vendeu (sem item de pedido
 *                               nem ficha técnica ligados ao cardápio)
 *
 * A loja é achada pelo e-mail do login (funcionário vira a loja do dono; e-mail
 * de embaixador vira a loja vinculada a ele). DATABASE_URL do ambiente, ou a
 * do .env.
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import pkg from "@prisma/client";
import { ehProdutoDeIntegracao } from "../src/lib/cardapio-interno.ts";

const { PrismaClient } = pkg;

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const DE = valor("--de");
const PARA = valor("--para");
const APLICAR = args.includes("--aplicar");
const SUBSTITUIR = args.includes("--substituir");

if (!DE || !PARA) {
  console.error("Uso: node --experimental-strip-types scripts/copiar-cardapio-entre-lojas.mjs --de <email> --para <email> [--aplicar] [--substituir]");
  process.exit(1);
}

function urlDoBanco() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const m = readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
  if (!m) throw new Error("sem DATABASE_URL no ambiente nem no .env");
  return m[1];
}

const db = new PrismaClient({ datasources: { db: { url: urlDoBanco() } } });

/** Id no formato do Prisma (cuid): começa com "c", nunca com prefixo de espelho. */
const novoId = () => "c" + randomBytes(12).toString("hex").slice(0, 24);
const q = (c) => `"${c.replace(/"/g, '""')}"`;

async function lojaDoEmail(email) {
  const achadas = await db.$queryRaw`
    SELECT id, name, email, role, "storeName", slug, "ownerId" FROM "User"
    WHERE lower(email) = lower(${email}) LIMIT 2`;
  // O e-mail é único só com a MESMA caixa: dois cadastros "Fulano@" e "fulano@"
  // existem, e escolher um no escuro é copiar (ou apagar) a loja errada.
  if (achadas.length > 1) throw new Error(`Mais de uma conta com o e-mail ${email} (caixa diferente): ${achadas.map((a) => a.email).join(", ")}. Use o e-mail exato.`);
  const [u] = achadas;
  if (u?.ownerId) {
    const [dono] = await db.$queryRaw`SELECT id, name, email, role, "storeName", slug, "ownerId" FROM "User" WHERE id = ${u.ownerId}`;
    if (dono) return { ...dono, via: `funcionário ${u.email}` };
  }
  if (u) return { ...u, via: "e-mail da loja" };
  const [emb] = await db.$queryRaw`SELECT "linkedUserId" FROM "Ambassador" WHERE lower(email) = lower(${email}) LIMIT 1`;
  if (emb?.linkedUserId) {
    const [l] = await db.$queryRaw`SELECT id, name, email, role, "storeName", slug, "ownerId" FROM "User" WHERE id = ${emb.linkedUserId}`;
    if (l) return { ...l, via: `loja vinculada ao embaixador ${email}` };
  }
  return null;
}

async function colunas(tabela) {
  const r = await db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${tabela}
    ORDER BY ordinal_position`;
  return r.map((c) => c.column_name);
}

/**
 * INSERT … SELECT de `tabela`, trocando o id (e as chaves estrangeiras) pelo
 * mapa. `fixos` são colunas com valor SQL próprio (loja nova, estoque em branco).
 */
function sqlDeCopia(tabela, cols, { mapas, fixos = {} }) {
  // mapas: { coluna: índice do par de arrays ($n, $n+1) }
  const lista = cols.map(q).join(", ");
  const select = cols
    .map((c) => {
      if (c in fixos) return fixos[c];
      if (c in mapas) return `m_${c}.novo`;
      return `t.${q(c)}`;
    })
    .join(", ");
  const joins = Object.entries(mapas)
    .map(([c, n]) => `JOIN unnest($${n}::text[], $${n + 1}::text[]) AS m_${c}(antigo, novo) ON t.${q(c)} = m_${c}.antigo`)
    .join("\n    ");
  return `INSERT INTO ${q(tabela)} (${lista})\n  SELECT ${select}\n    FROM ${q(tabela)} t\n    ${joins}`;
}

/** Valor comparável, venha como vier do driver. */
function norm(v) {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object" && typeof v.toFixed === "function" && typeof v.toString === "function" && !Array.isArray(v)) return v.toString();
  return JSON.stringify(v);
}

/** Troca, em qualquer profundidade do JSON, o texto que for id antigo pelo novo. */
function trocarIds(v, mapa) {
  if (typeof v === "string") return mapa.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => trocarIds(x, mapa));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trocarIds(x, mapa)]));
  return v;
}

/** comboConfig gravado como TEXTO de JSON: troca dentro e devolve texto. Texto que não é JSON fica como está. */
function configTrocada(texto, mapa) {
  try {
    return JSON.stringify(trocarIds(JSON.parse(texto), mapa));
  } catch {
    return mapa.get(texto) ?? texto;
  }
}

/**
 * Compara as linhas de origem com as da cópia. `fks`: coluna → mapa de ids
 * que ela deve seguir. `ignorar`: colunas que mudam de propósito.
 */
async function conferir(tx, tabela, mapaDoId, { fks = {}, ignorar = [], transformar = {} }) {
  const antigos = [...mapaDoId.keys()];
  const novos = [...mapaDoId.values()];
  const origem = await tx.$queryRawUnsafe(`SELECT * FROM ${q(tabela)} WHERE id = ANY($1::text[])`, antigos);
  const copia = await tx.$queryRawUnsafe(`SELECT * FROM ${q(tabela)} WHERE id = ANY($1::text[])`, novos);
  const porId = new Map(copia.map((r) => [r.id, r]));
  const diferencas = [];
  if (origem.length !== copia.length) diferencas.push(`${tabela}: ${origem.length} na origem, ${copia.length} na cópia`);
  for (const o of origem) {
    const c = porId.get(mapaDoId.get(o.id));
    if (!c) {
      diferencas.push(`${tabela} ${o.id}: não copiado`);
      continue;
    }
    for (const col of Object.keys(o)) {
      if (col === "id" || ignorar.includes(col)) continue;
      const esperado = col in fks ? (o[col] == null ? null : fks[col].get(o[col]) ?? `«${o[col]} sem par»`) : col in transformar ? transformar[col](o[col]) : o[col];
      if (norm(esperado) !== norm(c[col])) diferencas.push(`${tabela} ${o.id}.${col}: ${norm(esperado).slice(0, 80)} ≠ ${norm(c[col]).slice(0, 80)}`);
    }
  }
  return diferencas;
}

async function main() {
  const origem = await lojaDoEmail(DE);
  const destino = await lojaDoEmail(PARA);
  if (!origem) throw new Error(`Nenhuma loja com o e-mail ${DE}.`);
  if (!destino) throw new Error(`Nenhuma loja com o e-mail ${PARA} (nem loja vinculada a um embaixador com esse e-mail).`);
  if (origem.id === destino.id) throw new Error("Origem e destino são a mesma loja.");

  console.log(`Origem : ${origem.storeName || origem.name} <${origem.email}> (${origem.role}, ${origem.via}) id=${origem.id}`);
  console.log(`Destino: ${destino.storeName || destino.name} <${destino.email}> (${destino.role}, ${destino.via}) id=${destino.id}`);

  // ── O que vem ───────────────────────────────────────────────────────────
  const produtosDaOrigem = await db.$queryRaw`
    SELECT id, name, category, active, "isCombo", "apenasEmCombo" FROM "MenuProduct" WHERE "franchiseeId" = ${origem.id}`;
  const espelho = produtosDaOrigem.filter((p) => ehProdutoDeIntegracao(p.category, p.id, p.active));
  const ids = new Set(produtosDaOrigem.filter((p) => !ehProdutoDeIntegracao(p.category, p.id, p.active)).map((p) => p.id));

  // Fecho: opção de pergunta que aponta para produto fora do conjunto (espelho
  // usado como opção, ou produto de outra loja) vem junto — e as perguntas dele.
  const deFora = [];
  let grupos = [];
  let itens = [];
  for (let volta = 0; ; volta++) {
    if (volta > 50) throw new Error("O fecho das opções de combo não terminou em 50 voltas — cadastro circular?");
    grupos = await db.$queryRaw`SELECT id, "menuProductId" FROM "ComboGroup" WHERE "menuProductId" = ANY(${[...ids]}::text[])`;
    itens = grupos.length
      ? await db.$queryRaw`SELECT id, "comboGroupId", "menuProductId" FROM "ComboGroupItem" WHERE "comboGroupId" = ANY(${grupos.map((g) => g.id)}::text[])`
      : [];
    const faltando = [...new Set(itens.map((i) => i.menuProductId).filter((id) => !ids.has(id)))];
    if (!faltando.length) break;
    const achados = await db.$queryRaw`SELECT id, name, "franchiseeId" FROM "MenuProduct" WHERE id = ANY(${faltando}::text[])`;
    for (const p of achados) {
      ids.add(p.id);
      deFora.push(p);
    }
    if (achados.length !== faltando.length) throw new Error("Há opção de combo apontando para produto que não existe mais.");
  }
  // Categoria de integração ("iFood") não vem: o espelho não vem, ela ficaria vazia.
  const categorias = (await db.$queryRaw`SELECT id, name FROM "MenuCategory" WHERE "franchiseeId" = ${origem.id}`).filter(
    (c) => !ehProdutoDeIntegracao(c.name)
  );

  // comboConfig (formato antigo) que cita produto que NÃO vem: avisa, porque
  // esse id seguiria apontando para a origem.
  const configs = await db.$queryRaw`SELECT "comboConfig" FROM "MenuProduct" WHERE id = ANY(${[...ids]}::text[]) AND "comboConfig" IS NOT NULL`;
  const textos = new Set();
  const coletar = (v) => {
    if (typeof v === "string") {
      textos.add(v);
      try { coletar(JSON.parse(v)); } catch {}
    } else if (Array.isArray(v)) v.forEach(coletar);
    else if (v && typeof v === "object") Object.values(v).forEach(coletar);
  };
  configs.forEach((c) => coletar(c.comboConfig));
  const citados = textos.size ? await db.$queryRaw`SELECT id FROM "MenuProduct" WHERE id = ANY(${[...textos]}::text[])` : [];
  const citadosDeFora = citados.filter((c) => !ids.has(c.id));

  const conjunto = produtosDaOrigem.filter((p) => ids.has(p.id));
  console.log("\nCardápio da origem que vai para o destino:");
  console.log(`  categorias        ${categorias.length}`);
  console.log(`  produtos          ${ids.size}  (ativos ${conjunto.filter((p) => p.active).length}, pausados ${conjunto.filter((p) => !p.active).length}, combos ${conjunto.filter((p) => p.isCombo).length}, só-opção ${conjunto.filter((p) => p.apenasEmCombo).length})`);
  console.log(`  perguntas         ${grupos.length}`);
  console.log(`  opções            ${itens.length}`);
  console.log(`  fora (espelho)    ${espelho.length - deFora.filter((p) => p.franchiseeId === origem.id).length} produtos de integração não vêm`);
  if (deFora.length) console.log(`  ⚠️  ${deFora.length} produto(s) entram só porque uma pergunta os usa: ${deFora.map((p) => p.name).slice(0, 8).join(", ")}${deFora.length > 8 ? "…" : ""}`);
  if (citadosDeFora.length) console.log(`  ⚠️  ${citadosDeFora.length} id(s) no comboConfig antigo apontam para produto que não vem (seguem apontando para a origem).`);
  const outraLoja = deFora.filter((p) => p.franchiseeId !== origem.id);
  if (outraLoja.length) console.log(`  ⚠️  ${outraLoja.length} desses são de OUTRA loja (cadastro antigo) — viram produtos do destino.`);

  // ── O destino ───────────────────────────────────────────────────────────
  const [jaTem] = await db.$queryRaw`
    SELECT (SELECT count(*)::int FROM "MenuProduct" WHERE "franchiseeId" = ${destino.id}) AS produtos,
           (SELECT count(*)::int FROM "MenuCategory" WHERE "franchiseeId" = ${destino.id}) AS categorias,
           (SELECT count(*)::int FROM "CustomerOrderItem" i JOIN "MenuProduct" p ON p.id = i."menuProductId" WHERE p."franchiseeId" = ${destino.id}) AS itens_de_pedido,
           (SELECT count(*)::int FROM "ProductRecipe" r JOIN "MenuProduct" p ON p.id = r."menuProductId" WHERE p."franchiseeId" = ${destino.id}) AS fichas`;
  console.log(`\nO destino já tem: ${jaTem.produtos} produtos, ${jaTem.categorias} categorias.`);
  if ((jaTem.produtos || jaTem.categorias) && !SUBSTITUIR) {
    console.log("⛔ O destino não está vazio. Para apagar o cardápio dele e copiar por cima, rode com --substituir.");
    if (APLICAR) process.exitCode = 2;
    return;
  }
  if (SUBSTITUIR && (jaTem.itens_de_pedido || jaTem.fichas)) {
    // Apagar o cardápio de loja que já vendeu desliga o histórico do produto
    // (o item de pedido fica sem vínculo) e leva as fichas técnicas junto.
    // Isto é para loja vazia ou de demonstração — loja de verdade se acerta à mão.
    console.log(`⛔ --substituir recusado: o cardápio do destino já tem ${jaTem.itens_de_pedido} itens de pedido e ${jaTem.fichas} fichas técnicas ligados a ele.`);
    if (APLICAR) process.exitCode = 2;
    return;
  }
  if (SUBSTITUIR && (jaTem.produtos || jaTem.categorias)) {
    console.log(`   --substituir: o cardápio atual do destino (${jaTem.produtos} produtos, ${jaTem.categorias} categorias, nenhum pedido) será APAGADO.`);
  }

  if (!APLICAR) {
    console.log("\nNada gravado. Para copiar, rode de novo com --aplicar.");
    return;
  }

  // ── Copiar ──────────────────────────────────────────────────────────────
  const mapaProduto = new Map([...ids].map((id) => [id, novoId()]));
  const mapaGrupo = new Map(grupos.map((g) => [g.id, novoId()]));
  const mapaItem = new Map(itens.map((i) => [i.id, novoId()]));
  const mapaCategoria = new Map(categorias.map((c) => [c.id, novoId()]));
  const par = (m) => [[...m.keys()], [...m.values()]];

  const [colCat, colProd, colGrupo, colItem] = await Promise.all(["MenuCategory", "MenuProduct", "ComboGroup", "ComboGroupItem"].map(colunas));
  const loja = `'${destino.id.replace(/'/g, "''")}'`;
  const zerar = Object.fromEntries(["estoqueQtd", "estoqueDesde"].filter((c) => colProd.includes(c)).map((c) => [c, "NULL"]));
  const agora = (cols) => (cols.includes("updatedAt") ? { updatedAt: "now()" } : {});

  const resultado = await db.$transaction(
    async (tx) => {
      if (SUBSTITUIR) {
        await tx.$executeRawUnsafe(
          `DELETE FROM "ComboGroupItem" WHERE "comboGroupId" IN (SELECT g.id FROM "ComboGroup" g JOIN "MenuProduct" p ON p.id = g."menuProductId" WHERE p."franchiseeId" = $1)`,
          destino.id
        );
        await tx.$executeRawUnsafe(`DELETE FROM "ComboGroup" WHERE "menuProductId" IN (SELECT id FROM "MenuProduct" WHERE "franchiseeId" = $1)`, destino.id);
        await tx.$executeRawUnsafe(`DELETE FROM "MenuProduct" WHERE "franchiseeId" = $1`, destino.id);
        await tx.$executeRawUnsafe(`DELETE FROM "MenuCategory" WHERE "franchiseeId" = $1`, destino.id);
      }

      const n = {};
      n.categorias = await tx.$executeRawUnsafe(
        sqlDeCopia("MenuCategory", colCat, { mapas: { id: 1 }, fixos: { franchiseeId: loja, ...agora(colCat) } }),
        ...par(mapaCategoria)
      );
      n.produtos = await tx.$executeRawUnsafe(
        sqlDeCopia("MenuProduct", colProd, { mapas: { id: 1 }, fixos: { franchiseeId: loja, ...zerar, ...agora(colProd) } }),
        ...par(mapaProduto)
      );
      n.perguntas = grupos.length
        ? await tx.$executeRawUnsafe(sqlDeCopia("ComboGroup", colGrupo, { mapas: { id: 1, menuProductId: 3 }, fixos: agora(colGrupo) }), ...par(mapaGrupo), ...par(mapaProduto))
        : 0;
      n.opcoes = itens.length
        ? await tx.$executeRawUnsafe(
            sqlDeCopia("ComboGroupItem", colItem, { mapas: { id: 1, comboGroupId: 3, menuProductId: 5 }, fixos: agora(colItem) }),
            ...par(mapaItem),
            ...par(mapaGrupo),
            ...par(mapaProduto)
          )
        : 0;

      // comboConfig (formato antigo): ids de produto da origem → da cópia.
      if (colProd.includes("comboConfig")) {
        const comConfig = await tx.$queryRawUnsafe(
          `SELECT id, "comboConfig" FROM "MenuProduct" WHERE id = ANY($1::text[]) AND "comboConfig" IS NOT NULL`,
          [...mapaProduto.values()]
        );
        for (const p of comConfig) {
          const emTexto = typeof p.comboConfig === "string";
          const antes = emTexto ? p.comboConfig : JSON.stringify(p.comboConfig);
          const depois = emTexto ? configTrocada(p.comboConfig, mapaProduto) : JSON.stringify(trocarIds(p.comboConfig, mapaProduto));
          if (depois === antes) continue;
          // O app lê os dois formatos (objeto ou JSON em texto); o que era texto continua texto.
          await tx.$executeRawUnsafe(
            emTexto ? `UPDATE "MenuProduct" SET "comboConfig" = to_jsonb($2::text) WHERE id = $1` : `UPDATE "MenuProduct" SET "comboConfig" = $2::jsonb WHERE id = $1`,
            p.id,
            depois
          );
        }
      }

      // A prova, antes do commit.
      const ignorarSempre = ["createdAt", "updatedAt"];
      const diferencas = [
        ...(await conferir(tx, "MenuCategory", mapaCategoria, { ignorar: [...ignorarSempre, "franchiseeId"] })),
        ...(await conferir(tx, "MenuProduct", mapaProduto, {
          ignorar: [...ignorarSempre, "franchiseeId", ...Object.keys(zerar)],
          transformar: {
            comboConfig: (v) => (v == null ? v : typeof v === "string" ? configTrocada(v, mapaProduto) : trocarIds(v, mapaProduto)),
          },
        })),
        ...(await conferir(tx, "ComboGroup", mapaGrupo, { ignorar: ignorarSempre, fks: { menuProductId: mapaProduto } })),
        ...(await conferir(tx, "ComboGroupItem", mapaItem, { ignorar: ignorarSempre, fks: { comboGroupId: mapaGrupo, menuProductId: mapaProduto } })),
      ];
      if (diferencas.length) {
        console.error(`\n⛔ A cópia não bateu com a origem (${diferencas.length} diferença(s)) — nada foi gravado:`);
        for (const d of diferencas.slice(0, 30)) console.error("   " + d);
        throw new Error("conferência falhou");
      }
      return n;
    },
    { timeout: 180_000, maxWait: 30_000 }
  );

  console.log(`\n✅ Copiado e conferido linha a linha: ${resultado.categorias} categorias, ${resultado.produtos} produtos, ${resultado.perguntas} perguntas, ${resultado.opcoes} opções.`);
  if (destino.slug) console.log(`   Cardápio: https://www.firehubfood.com.br/loja/${destino.slug}`);
}

main()
  .catch((e) => {
    console.error("\n" + (e?.message || e));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
