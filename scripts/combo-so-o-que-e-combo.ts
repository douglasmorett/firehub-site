/**
 * Deixa `isCombo` só no que é combo (02/10/2026).
 *
 * Até aqui o cadastro só mostrava as perguntas em "Novo Combo", então todo
 * item com pergunta (pizza por tamanho, lanche com adicional, pastel com sabor)
 * foi gravado como combo: 776 dos 995 "combos" do banco, com selo 📦 COMBO na
 * vitrine e na lista de combos do robô. Com a pergunta solta do combo
 * (src/lib/combo-e-pergunta.ts), o que não é combo volta a ser produto — e
 * continua com TODAS as perguntas, porque quem abre as escolhas agora é ter
 * pergunta.
 *
 * Fica combo: o que parece combo pelo nome ou pela categoria (`pareceCombo`)
 * e o que tem composição fiscal (`fiscalBreakdown`, que a nota só lê de combo).
 *
 * RODAR SÓ DEPOIS DO DEPLOY do código que abre as perguntas por `comboGroups`:
 * com o código antigo, o produto que deixa de ser combo iria para a sacola sem
 * as escolhas obrigatórias.
 *
 *   npx tsx scripts/combo-so-o-que-e-combo.ts              (só mostra)
 *   npx tsx scripts/combo-so-o-que-e-combo.ts --gravar     (grava; cópia em scratch/)
 *   npx tsx scripts/combo-so-o-que-e-combo.ts --loja <id>  (uma loja só)
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { pareceCombo } from "../src/lib/combo-e-pergunta";

const GRAVAR = process.argv.includes("--gravar");
const iLoja = process.argv.indexOf("--loja");
const LOJA = iLoja > 0 ? process.argv[iLoja + 1] : null;

const url = readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
if (!url) throw new Error("sem DATABASE_URL no .env");
const sql = neon(url);

type Linha = { id: string; franchiseeId: string | null; name: string; category: string; fiscalBreakdown: unknown; grupos: number; loja: string | null };
async function main() {
const linhas = (await sql`
  select p.id, p."franchiseeId", p.name, p.category, p."fiscalBreakdown",
         (select count(*)::int from "ComboGroup" g where g."menuProductId" = p.id) as grupos,
         coalesce(u."storeName", u.name) as loja
  from "MenuProduct" p left join "User" u on u.id = p."franchiseeId"
  where p."isCombo" and not p."apenasEmCombo"
    and (${LOJA}::text is null or p."franchiseeId" = ${LOJA})
  order by loja, p.category, p.name`) as Linha[];

const temFiscal = (f: unknown) => {
  if (!f) return false;
  try { const v = typeof f === "string" ? JSON.parse(f) : f; return Array.isArray(v) && v.length > 0; } catch { return false; }
};

const fica = linhas.filter((p) => pareceCombo(p.name, p.category) || temFiscal(p.fiscalBreakdown));
const sai = linhas.filter((p) => !fica.includes(p));

const porLoja = new Map<string, { fica: Linha[]; sai: Linha[] }>();
for (const p of linhas) {
  const k = p.loja || p.franchiseeId || "?";
  if (!porLoja.has(k)) porLoja.set(k, { fica: [], sai: [] });
  (fica.includes(p) ? porLoja.get(k)!.fica : porLoja.get(k)!.sai).push(p);
}
for (const [loja, { fica: f, sai: s }] of porLoja) {
  console.log(`\n## ${loja} — continuam combo: ${f.length} · viram produto: ${s.length}`);
  if (f.length) console.log("   combo:  " + f.map((p) => p.name).join(" · "));
  if (s.length) console.log("   produto: " + s.map((p) => `${p.name}${p.grupos ? "" : " (sem pergunta)"}`).join(" · "));
}
console.log(`\nTOTAL: ${linhas.length} marcados como combo · continuam ${fica.length} · viram produto ${sai.length} · ${porLoja.size} lojas`);

if (GRAVAR && sai.length) {
  mkdirSync("scratch", { recursive: true });
  const copia = `scratch/combo-antes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(copia, JSON.stringify(sai.map((p) => ({ id: p.id, franchiseeId: p.franchiseeId, name: p.name, isCombo: true })), null, 1));
  const ids = sai.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 500) {
    await sql`update "MenuProduct" set "isCombo" = false, "updatedAt" = now() where id = any(${ids.slice(i, i + 500)}) and "isCombo"`;
  }
  console.log(`GRAVADO: ${ids.length} produtos voltaram a ser produto. Para desfazer: ${copia}`);
}
}

main().catch((e) => { console.error(e); process.exit(1); });
