#!/usr/bin/env node
/**
 * Diagnóstico e conserto do estado de uma loja no 99Food.
 *
 * ── Para que serve ──────────────────────────────────────────────────────────
 *
 * Responde, com a API deles e não com achismo, por que uma loja "só recebe
 * pedido quando o 99 está aberto". Duas coisas causam isso, e são diferentes:
 *
 *   1. biz_status = 2 (offline). A loja está desligada lá. Uma vez offline ela
 *      não volta sozinha — só por API ou abrindo o app deles na mão.
 *   2. order_confirm_method = BAPP. É o PADRÃO, e exige o app do 99Food online
 *      para confirmar pedido. Esta é a causa mais provável.
 *
 * ── Como rodar ──────────────────────────────────────────────────────────────
 *
 *   # só LER (não muda nada) — sempre comece por aqui
 *   node scripts/99food-loja-status.mjs <app_shop_id>
 *
 *   # ligar a loja (biz_status=1, auto_switch=3). Seguro: só liga, nunca desliga.
 *   node scripts/99food-loja-status.mjs <app_shop_id> --ligar
 *
 *   # trocar a confirmação para OPENAPI — LEIA O AVISO ABAIXO ANTES
 *   node scripts/99food-loja-status.mjs <app_shop_id> --openapi
 *
 * Precisa de FOOD99_APP_ID e FOOD99_APP_SECRET no ambiente. Elas vivem só no
 * Coolify, então o normal é rodar isto DENTRO do container:
 *
 *   docker exec -it firehub-app node scripts/99food-loja-status.mjs <id>
 *
 * ── O aviso do --openapi ────────────────────────────────────────────────────
 *
 * Em OPENAPI, SÓ o FireHub confirma pedido. Se a confirmação daqui falhar, o
 * pedido não é confirmado por ninguém e o 99Food CANCELA. Só use depois de ver
 * pedido entrando e sendo confirmado sozinho NESTA loja. Antes disso, BAPP com
 * todos os defeitos ainda deixa o lojista salvar o pedido na mão.
 */
const BASE = process.env.FOOD99_BASE_URL || "https://openapi.didi-food.com";
const APP_ID = (process.env.FOOD99_APP_ID || "").trim();
const APP_SECRET = (process.env.FOOD99_APP_SECRET || "").trim();

const [, , appShopId, ...flags] = process.argv;
const LIGAR = flags.includes("--ligar");
const OPENAPI = flags.includes("--openapi");

if (!appShopId) {
  console.error("uso: node scripts/99food-loja-status.mjs <app_shop_id> [--ligar] [--openapi]");
  process.exit(1);
}
if (!APP_ID || !APP_SECRET) {
  console.error("❌ FOOD99_APP_ID / FOOD99_APP_SECRET não estão no ambiente.");
  console.error("   Rode dentro do container: docker exec -it firehub-app node scripts/99food-loja-status.mjs " + appShopId);
  process.exit(1);
}

/** Mesmo cuidado de src/lib/json-ids-longos.ts: id de 19 dígitos não passa por Number(). */
function parseSeguro(texto) {
  return JSON.parse(texto.replace(/:\s*(-?\d{16,})/g, ': "$1"'));
}

async function chamar(caminho, { metodo = "GET", query, corpo } = {}) {
  const url = new URL(BASE + caminho);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  try {
    return parseSeguro(texto);
  } catch {
    return { errno: -1, errmsg: `resposta não-JSON (HTTP ${res.status}): ${texto.slice(0, 300)}` };
  }
}

const BIZ = { 1: "🟢 ONLINE", 2: "🔴 OFFLINE" };
const SUB = {
  0: "padrão", 1: "loja aberta", 2: "pausada", 3: "fechada",
  4: "DESCONECTADA (o app do 99Food não está online)", 5: "fechada no dia",
  6: "bloqueada", 7: "fechada pelo sistema (sem entregador)",
};
const AUTO = {
  1: "abre sozinha (não fecha sozinha)",
  2: "fecha sozinha",
  3: "abre E fecha sozinha pela agenda do 99Food",
};

async function main() {
  console.log(`\n═══ 99Food — loja ${appShopId} ═══\n`);

  const auth = await chamar("/v1/auth/authtoken/get", {
    query: { app_id: APP_ID, app_secret: APP_SECRET, app_shop_id: appShopId },
  });
  if (auth.errno !== 0 || !auth.data?.auth_token) {
    console.error(`❌ não consegui o auth_token: ${auth.errno} ${auth.errmsg}`);
    console.error("   errno 10101 = a loja ainda não autorizou o FireHub.");
    process.exit(1);
  }
  const token = auth.data.auth_token;
  const venceEm = new Date((auth.data.token_expiration_time || 0) * 1000);
  console.log(`✅ auth_token obtido — vence em ${venceEm.toISOString()}`);
  const diasVida = Math.round((venceEm.getTime() - Date.now()) / 86400000);
  console.log(`   ${diasVida} dia(s) de vida restante${diasVida < 2 ? "  ⚠️  RENOVAR JÁ" : ""}\n`);

  const ler = async (rotulo) => {
    const d = await chamar("/v1/shop/shop/detail", { query: { auth_token: token } });
    if (d.errno !== 0) {
      console.error(`❌ shop/detail falhou: ${d.errno} ${d.errmsg}`);
      return null;
    }
    const s = d.data || {};
    console.log(`── ${rotulo} ──`);
    console.log(`   loja:              ${s.shop_name || "(sem nome)"}`);
    console.log(`   biz_status:        ${BIZ[s.biz_status] || s.biz_status}`);
    console.log(`   sub_biz_status:    ${SUB[s.sub_biz_status] ?? s.sub_biz_status}`);
    console.log(`   auto_switch:       ${AUTO[s.auto_switch] || s.auto_switch}`);
    // Nem toda conta devolve este campo no detail; quando não vier, dizer isso
    // é melhor do que imprimir "undefined" e deixar o leitor concluir errado.
    console.log(`   confirmação:       ${
      s.order_confirm_method === undefined
        ? "(não informado neste endpoint — o padrão do 99Food é BAPP)"
        : s.order_confirm_method === 2 ? "OPENAPI (o app deles NÃO precisa ficar online)"
        : "BAPP (o app deles PRECISA ficar online) ⚠️"
    }`);
    console.log("");
    return s;
  };

  const antes = await ler("ESTADO ATUAL");
  if (!antes) process.exit(1);

  if (!LIGAR && !OPENAPI) {
    console.log("ℹ️  Só leitura. Nada foi alterado.");
    if (antes.biz_status === 2) console.log("   → a loja está OFFLINE. Rode com --ligar para ligá-la.");
    if (antes.sub_biz_status === 4) {
      console.log("   → sub_biz_status 4 = DESCONECTADA: é o sintoma de BAPP com o app deles fechado.");
      console.log("     O conserto definitivo é --openapi, mas leia o aviso no topo deste arquivo.");
    }
    return;
  }

  if (LIGAR) {
    // Preserva o auto_switch que ja estava la. Sobrescrever a escolha do
    // lojista as cegas mudaria o funcionamento da loja sem ninguem pedir --
    // mesma regra do cron em src/lib/food99-abertura.ts.
    const auto = [1, 2, 3].includes(antes.auto_switch) ? antes.auto_switch : 3;
    console.log(`→ setStatus(biz_status=1, auto_switch=${auto}${auto === 3 && antes.auto_switch === undefined ? " — nao havia valor valido para preservar" : " — preservado"})...`);
    const r = await chamar("/v1/shop/shop/setStatus", {
      metodo: "POST",
      corpo: { auth_token: token, biz_status: 1, auto_switch: auto },
    });
    console.log(r.errno === 0 ? "  ✅ aceito" : `  ❌ recusado: ${r.errno} ${r.errmsg}`);
    if (r.errno === 0 && r.data?.biz_status === false) {
      console.log("  ⚠️  ATENCAO: errno 0, mas o 99Food respondeu biz_status=false —");
      console.log("     a loja NAO ficou online. Motivo e do lado deles (bloqueio, vinculo,");
      console.log("     sem entregador). Veja o ESTADO DEPOIS abaixo.");
    }
  }

  if (OPENAPI) {
    console.log("\n⚠️  OPENAPI: a partir de agora SÓ o FireHub confirma pedido nesta loja.");
    console.log("   Se a confirmação daqui falhar, o 99Food CANCELA o pedido.");
    console.log("→ setconfirmmethod(order_confirm_method=2 OPENAPI)...");
    const r = await chamar("/v1/shop/shop/setconfirmmethod", {
      metodo: "POST",
      corpo: { auth_token: token, order_confirm_method: 2 },
    });
    console.log(r.errno === 0 ? "  ✅ aceito" : `  ❌ recusado: ${r.errno} ${r.errmsg}`);
  }

  console.log("");
  await ler("ESTADO DEPOIS");
}

main().catch((e) => {
  console.error("erro:", e?.message);
  process.exit(1);
});
