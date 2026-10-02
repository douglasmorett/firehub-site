/**
 * Liga à loja os cadastros que ela trouxe de outro sistema, para o balcão
 * dela achar o cliente por prefixo do telefone antes do primeiro pedido
 * (StoreCustomer.lojaDeOrigemId — lib/busca-de-clientes.ts).
 *
 *   node scripts/vincular-clientes-a-loja.mjs <clientes.csv> <slug-da-loja>            → só simula
 *   node scripts/vincular-clientes-a-loja.mjs <clientes.csv> <slug-da-loja> --gravar   → grava
 *
 * O CSV é o mesmo da importação (telefone,nome,email,codigo_gama). Só mexe
 * em cadastro SEM loja (lojaDeOrigemId nulo): quem já está ligado a outra
 * loja, ou se cadastrou pelo site, não é tocado. Idempotente.
 *
 * Caso de uso: os 13.380 clientes do Gama da Showrrascão, importados em
 * 02/10/2026 antes de a coluna existir (scripts/importar-clientes-do-gama.mjs).
 */
import { readFileSync, existsSync } from "fs";

const [arquivo, slug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GRAVAR = process.argv.includes("--gravar");
if (!arquivo || !slug) {
  console.error("uso: node scripts/vincular-clientes-a-loja.mjs <clientes.csv> <slug-da-loja> [--gravar]");
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
function urlDoBanco() {
  for (const env of [".env.local", ".env"]) {
    if (!existsSync(env)) continue;
    const m = readFileSync(env, "utf8").match(/^DATABASE_URL="?([^"\r\n]+)/m);
    if (m) return m[1];
  }
  throw new Error("sem DATABASE_URL no .env.local nem no .env");
}
const sql = neon(urlDoBanco());

const semPais = (t) => {
  const d = String(t || "").replace(/\D/g, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
};

const [loja] = await sql`SELECT id, name FROM "User" WHERE slug = ${slug} LIMIT 1`;
if (!loja) {
  console.error(`loja com slug "${slug}" não encontrada`);
  process.exit(1);
}

const linhas = readFileSync(arquivo, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
const telefones = [...new Set(linhas.map((l) => semPais(l.split(",")[0])).filter((t) => t.length >= 10))];
console.log(`${loja.name} (${loja.id}): ${telefones.length} telefones no CSV`);

// Em lotes: uma consulta de 13 mil valores de uma vez é desnecessariamente pesada.
// A classe é '[^0-9]' (e não '\D'): '\D' não limpava a máscara no Postgres local.
let ligados = 0;
let jaTinham = 0;
for (let i = 0; i < telefones.length; i += 1000) {
  const lote = telefones.slice(i, i + 1000);
  const achados = await sql`
    SELECT "id" FROM "StoreCustomer"
    WHERE "lojaDeOrigemId" IS NULL
      AND (CASE WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) IN (12, 13) AND left(regexp_replace("phone", '[^0-9]', '', 'g'), 2) = '55'
                THEN substr(regexp_replace("phone", '[^0-9]', '', 'g'), 3) ELSE regexp_replace("phone", '[^0-9]', '', 'g') END) = ANY(${lote}::text[])`;
  jaTinham += lote.length - achados.length;
  if (achados.length === 0) continue;
  if (GRAVAR) {
    await sql`UPDATE "StoreCustomer" SET "lojaDeOrigemId" = ${loja.id} WHERE "id" = ANY(${achados.map((a) => a.id)}::text[]) AND "lojaDeOrigemId" IS NULL`;
  }
  ligados += achados.length;
  console.log(`  lote ${i / 1000 + 1}: ${achados.length} ${GRAVAR ? "ligados" : "a ligar"}`);
}
console.log(`${GRAVAR ? "ligados" : "a ligar"}: ${ligados}; já ligados a uma loja ou fora do banco: ${jaTinham}`);
if (!GRAVAR) console.log("(simulação — rode com --gravar para gravar)");
