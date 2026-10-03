/**
 * Aplica lib/aviso-do-boleto.ts nos clientes do Asaas que já têm boleto de
 * mensalidade pendente: celular no cadastro e WhatsApp só no aviso de criação.
 * Não manda mensagem — o aviso de criação desses boletos já saiu.
 *
 *   npx tsx scripts/aviso-do-boleto-nos-clientes.ts            (só mostra)
 *   npx tsx scripts/aviso-do-boleto-nos-clientes.ts --gravar
 *
 * Lê .env.local e .env como o Next (ENV_DIR aponta a pasta numa worktree). A
 * chave que vale é a ASAAS_API_KEY_B64 do .env: a ASAAS_API_KEY solta do
 * .env.local estava recusada (401) em 02/10/2026.
 */
import path from "path";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { getAsaasKey } from "../src/lib/asaas";
import { celularDoBoleto, prepararAvisoDoBoleto } from "../src/lib/aviso-do-boleto";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

const gravar = process.argv.includes("--gravar");
const chave = getAsaasKey();
if (!chave?.startsWith("$aact_prod")) throw new Error("Sem a chave de produção do Asaas.");
const BASE = "https://api.asaas.com/v3";
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const resp = await fetch(`${BASE}/payments?status=PENDING&limit=100`, { headers: { access_token: chave!, "User-Agent": "firehub" } });
  const pend = await resp.json();
  const boletos = (pend.data || []).filter((p: any) => String(p.externalReference || "").startsWith("billing:"));
  console.log(`Asaas ${resp.status}: ${boletos.length} boleto(s) de mensalidade pendente(s)${pend.errors ? " — " + JSON.stringify(pend.errors) : ""}`);

  for (const p of boletos) {
    const [loja] = await sql`select u."storeName", u."notificationPhone", u."storePhone", u."chatbotConfig"
      from "FranchiseeBillingCycle" c join "User" u on u.id = c."franchiseeId"
      where c.id = ${p.externalReference.slice("billing:".length)}`;
    if (!loja) { console.log(p.customer, "— ciclo não encontrado no banco"); continue; }
    const lojaDoBoleto = { notificationPhone: loja.notificationPhone, storePhone: loja.storePhone, chatbotConfig: loja.chatbotConfig };
    if (!gravar) {
      console.log(String(loja.storeName).padEnd(24), p.customer, "→", celularDoBoleto(lojaDoBoleto) ?? "(sem celular: só e-mail)");
      continue;
    }
    const r = await prepararAvisoDoBoleto(BASE, chave, p.customer, lojaDoBoleto);
    console.log(String(loja.storeName).padEnd(24), p.customer, "→", r);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
