/**
 * Põe UMA loja num gateway de WhatsApp à parte (ou devolve ao principal),
 * gravando `chatbotConfig.evolutionUrl` — ver src/lib/gateway-da-loja.ts.
 *
 * Criado para o gateway de teste com Baileys 7 (25/09/2026), começando pela
 * Divinos Burger, cuja conta tem aparelho hospedado (API oficial em
 * coexistência) que o Baileys 6 não entende.
 *
 *   npx tsx scripts/gateway-de-teste-da-loja.ts --url https://<gateway-teste>        (só mostra)
 *   npx tsx scripts/gateway-de-teste-da-loja.ts --url https://<gateway-teste> --gravar
 *   npx tsx scripts/gateway-de-teste-da-loja.ts --voltar --gravar                    (volta ao principal)
 *   --loja <id>   outra loja (padrão: Divinos)
 *
 * Depois de trocar de gateway a loja precisa ler o QR de novo: a sessão do
 * WhatsApp mora no gateway, e o novo começa sem nenhuma.
 */
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

const DIVINOS = "cmudbzcus0008ka010pmo1e0w";
const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const LOJA = arg("--loja") || DIVINOS;
const URL_NOVA = (arg("--url") || "").trim().replace(/\/+$/, "");
const VOLTAR = process.argv.includes("--voltar");
const GRAVAR = process.argv.includes("--gravar");

function urlDoBanco(): string {
  for (const arq of ["C:/Users/Micro/Documents/firehub-site/.env", ".env"]) {
    if (!existsSync(arq)) continue;
    const m = readFileSync(arq, "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
    if (m) return m[1];
  }
  throw new Error("sem DATABASE_URL");
}

(async () => {
  if (!VOLTAR) {
    let ok = false;
    try { const u = new URL(URL_NOVA); ok = u.protocol === "https:" && (u.pathname === "/" || u.pathname === ""); } catch {}
    if (!ok) {
      console.log("Informe --url https://<endereço do gateway de teste> (só o domínio, https) — ou --voltar.");
      process.exit(1);
    }
  }

  const sql = neon(urlDoBanco());
  const [loja] = await sql`SELECT "storeName", "chatbotConfig" FROM "User" WHERE id = ${LOJA}`;
  if (!loja) throw new Error("loja não encontrada");
  const cfg = (loja.chatbotConfig || {}) as Record<string, unknown>;
  console.log(`Loja: ${loja.storeName}`);
  console.log(`  instância: ${cfg.instanceName || "-"} | conectada: ${cfg.connected === true ? "sim" : "não"}`);
  console.log(`  gateway hoje: ${cfg.evolutionUrl || "(principal)"}${cfg.evolutionApiKey ? " | chave própria: sim" : ""}`);
  console.log(`  gateway depois: ${VOLTAR ? "(principal)" : URL_NOVA}`);

  if (!GRAVAR) { console.log("\n(simulação — use --gravar)"); return; }

  if (VOLTAR) {
    await sql`UPDATE "User" SET "chatbotConfig" = coalesce("chatbotConfig", '{}'::jsonb) - 'evolutionUrl' - 'evolutionApiKey' WHERE id = ${LOJA}`;
  } else {
    await sql`UPDATE "User" SET "chatbotConfig" = coalesce("chatbotConfig", '{}'::jsonb) || jsonb_build_object('evolutionUrl', ${URL_NOVA}::text) WHERE id = ${LOJA}`;
  }
  const [depois] = await sql`SELECT "chatbotConfig"->>'evolutionUrl' url FROM "User" WHERE id = ${LOJA}`;
  console.log(`\nGRAVADO. Gateway da loja agora: ${depois.url || "(principal)"}`);
  console.log("A loja precisa ler o QR de novo (Chatbot IA → Conectar).");
})().catch((e) => { console.error(e); process.exit(1); });
