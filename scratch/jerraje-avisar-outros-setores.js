/**
 * Jerrajê (Gil, 17/10/2026): liga "📋 Avisar os outros itens do pedido"
 * (printerConfig.printers[].avisarOutrosSetores = true) em TODAS as impressoras
 * das lojas da Jerrajê. RODAR SÓ DEPOIS DO DEPLOY (sem o deploy o campo é
 * ignorado, mas a tela antiga regravaria a config sem ele).
 *
 *   node scratch/jerraje-avisar-outros-setores.js            → só mostra (não grava)
 *   node scratch/jerraje-avisar-outros-setores.js --gravar   → backup + grava
 *
 * Lojas: User.storeName ilike '%jerraj%' (confere com os ids conhecidos —
 * matriz e filiais). Loja sem printerConfig/printers é pulada. Antes de gravar,
 * o printerConfig de cada loja vai para scratch/backup-jerraje-printerConfig-<data>.json.
 * Desfazer: gravar de volta o printerConfig do backup.
 *
 * Depois: pedir F5 no painel do Gil (painel aberto fica com a versão velha).
 */
const fs = require("fs");
const path = require("path");
const { Pool, neonConfig } = require("@neondatabase/serverless");
const ws = require("ws");

const GRAVAR = process.argv.includes("--gravar");
const IDS_CONHECIDOS = [
  "cmv2ffhjz01bxkg01jseu5udr",
  "cmv8urtjt5ffdd19ed77d",
  "cmv7clp6e07q7kc01oz8lbmva",
  "cmva75ap201d4nt01if9vm68p",
];

function urlDoBanco() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidatos = [
    path.join(__dirname, "..", ".env.local"),
    "C:/Users/Micro/Documents/firehub-site/.env.local",
    "C:/Users/Micro/Documents/firehub-site/.env",
  ];
  for (const f of candidatos) {
    if (!fs.existsSync(f)) continue;
    for (const linha of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      if (linha.startsWith("DATABASE_URL=")) return linha.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL não encontrada");
}

neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: urlDoBanco() });
  try {
    const { rows } = await pool.query(
      `SELECT id, "storeName", "printerConfig" FROM "User" WHERE "storeName" ILIKE '%jerraj%' OR id = ANY($1) ORDER BY id`,
      [IDS_CONHECIDOS]
    );
    console.log(`${rows.length} loja(s) encontrada(s):`);
    for (const r of rows) console.log(`  - ${r.id}  ${r.storeName}${IDS_CONHECIDOS.includes(r.id) ? "" : "  (FORA da lista conhecida — confira!)"}`);
    const faltando = IDS_CONHECIDOS.filter((id) => !rows.some((r) => r.id === id));
    if (faltando.length) console.log(`  (ids conhecidos não encontrados: ${faltando.join(", ")})`);

    const mudancas = [];
    for (const r of rows) {
      const pc = r.printerConfig && typeof r.printerConfig === "object" ? r.printerConfig : null;
      const printers = Array.isArray(pc?.printers) ? pc.printers : [];
      if (!printers.length) {
        console.log(`\n${r.storeName} (${r.id}): sem impressora cadastrada — pulada`);
        continue;
      }
      console.log(`\n${r.storeName} (${r.id}):`);
      for (const p of printers) {
        console.log(`  ${p.avisarOutrosSetores === true ? "já ligada" : "LIGAR    "}  ${p.label || "(sem nome)"} [${p.name || "?"}]  categorias: ${(p.categories || []).join(", ") || "(todas)"}${p.somenteBebidas ? "  (só bebidas: o aviso não sai nela)" : ""}`);
      }
      if (printers.every((p) => p.avisarOutrosSetores === true)) continue;
      const novo = { ...pc, printers: printers.map((p) => ({ ...p, avisarOutrosSetores: true })) };
      mudancas.push({ id: r.id, storeName: r.storeName, antes: pc, depois: novo });
    }

    if (!mudancas.length) {
      console.log("\nNada a mudar.");
      return;
    }
    if (!GRAVAR) {
      console.log(`\n${mudancas.length} loja(s) a mudar. Nada gravado (rode com --gravar).`);
      return;
    }

    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    const arquivo = path.join(__dirname, `backup-jerraje-printerConfig-${carimbo}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(mudancas.map((m) => ({ id: m.id, storeName: m.storeName, printerConfig: m.antes })), null, 2));
    console.log(`\nBackup: ${arquivo}`);

    for (const m of mudancas) {
      // Só grava se o printerConfig não mudou desde a leitura (a loja pode
      // ter salvo a tela de Impressoras no meio-tempo).
      const res = await pool.query(
        `UPDATE "User" SET "printerConfig" = $1::jsonb WHERE id = $2 AND "printerConfig"::text = $3::jsonb::text`,
        [JSON.stringify(m.depois), m.id, JSON.stringify(m.antes)]
      );
      console.log(`  ${res.rowCount === 1 ? "gravado" : "NÃO gravado (config mudou desde a leitura — rode de novo)"}: ${m.storeName} (${m.id})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
