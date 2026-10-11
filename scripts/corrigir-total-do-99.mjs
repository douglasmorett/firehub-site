/**
 * Corrige o TOTAL dos pedidos do 99Food gravados com o preço cheio dos itens.
 *
 *   npx tsx scripts/corrigir-total-do-99.mjs                  só MOSTRA (não grava nada)
 *   npx tsx scripts/corrigir-total-do-99.mjs --loja <id>      só uma loja (franchiseeId)
 *   npx tsx scripts/corrigir-total-do-99.mjs --gravar         grava (decisão do dono)
 *
 * Roda com `npx tsx` (e não `node`) porque usa o tradutor de verdade
 * (src/lib/food99-pedido.ts) e a régua da mensalidade (src/lib/firehub-billing.ts).
 * Banco: DATABASE_URL do ambiente, senão a do .env / .env.local da pasta onde roda.
 *
 * ── O erro ──────────────────────────────────────────────────────────────────
 *
 * O `order/detail` do 99 não manda `real_pay_price` quando quem entrega é o
 * motoboy do 99, e o tradutor caía em `order_price` — os itens CHEIOS, sem
 * desconto, sem entrega e sem a taxa do app. O pedido gravava o que o cliente
 * não pagou; o caixa (totalAmount + a parte do 99) contava o cupom do 99 duas
 * vezes; a nota dizia "a loja recebe" a mais. Corrigido no tradutor em
 * 11/10/2026 (teste: scripts/teste-total-do-99.ts). Este script acerta os
 * pedidos que já estavam gravados, a partir do `price` que o 99 mandou e que o
 * pedido guarda em `discountDetails.precoCru` (com as `promocoes`).
 *
 * ── O que ele mexe, e o que não mexe ───────────────────────────────────────
 *
 * Só pedido com a assinatura do erro: 99Food, `precoCru` sem `real_pay_price`
 * (nem `customer_need_paying_money`), e `totalAmount` IGUAL a `order_price`.
 * Pedido com total diferente disso foi mexido depois de entrar (cancelamento
 * parcial, edição) e o `precoCru` não descreve mais o pedido: fica na lista
 * "não mexo", com o motivo. Também fica de fora se a divisão do desconto
 * (loja × 99) gravada não bater com a de agora.
 *
 * Grava: `totalAmount`; em `discountDetails`, o `recebeLoja` novo, o
 * complemento do pedido mínimo e `correcaoDoTotal` (quando, de quanto para
 * quanto — dá para desfazer); e o "a loja recebe R$ X" da observação. NÃO
 * toca em `updatedAt`: o feed do painel, a lista do motoboy e o fiscal
 * automático olham "atualizado agora", e 300 pedidos velhos acordariam juntos.
 * O UPDATE confere de novo o total antigo: rodar duas vezes não faz nada.
 *
 * ── A mensalidade ──────────────────────────────────────────────────────────
 *
 * A mensalidade é sobre o bruto (totalAmount + discountTotal) dos pedidos do
 * mês (lib/billing.ts): o total inflado inflou a base. A última parte da saída
 * refaz setembro e outubro de cada loja afetada com a mesma régua (1% até
 * 03/10/2026, 2% depois; piso R$ 100, teto R$ 400; teste e isenção) e mostra a
 * mensalidade com e sem a inflação. Só leitura, mesmo com --gravar: o ciclo
 * de outubro se refaz sozinho no próximo pedido confirmado depois da correção;
 * setembro já fechou, e devolver é decisão do dono.
 */
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { traduzirPedido99Food } from "../src/lib/food99-pedido.ts";
import { calcMensalidade, VIRADA_DOS_2_POR_CENTO } from "../src/lib/firehub-billing.ts";

const GRAVAR = process.argv.includes("--gravar");
const iLoja = process.argv.indexOf("--loja");
const SO_A_LOJA = iLoja > 0 ? process.argv[iLoja + 1] : null;
const MESES = ["2026-09", "2026-10"];

/** Uma variável do ambiente, senão do .env / .env.local da pasta onde roda. */
function variavel(nome) {
  if (process.env[nome]) return process.env[nome];
  for (const arquivo of [".env", ".env.local"]) {
    if (!existsSync(arquivo)) continue;
    const m = readFileSync(arquivo, "utf8").match(new RegExp(`^${nome}="?([^"\\r\\n]*)`, "m"));
    if (m) return m[1];
  }
  return "";
}
const URL_DO_BANCO = variavel("DATABASE_URL");
if (!URL_DO_BANCO) throw new Error("Sem DATABASE_URL (nem no ambiente, nem em .env/.env.local desta pasta).");
const sql = neon(URL_DO_BANCO);

const r2 = (n) => Math.round(n * 100) / 100;
const reais = (n) => `R$ ${r2(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const virgula = (n) => r2(n).toFixed(2).replace(".", ",");
// `createdAt` é timestamp SEM fuso, gravado em UTC; lido como texto para o
// driver não aplicar o fuso da máquina (+3h aqui).
const instante = (texto) => new Date(String(texto).replace(" ", "T") + "Z");
const paraOBanco = (d) => d.toISOString().replace("T", " ").replace("Z", "");

// O tradutor avisa no log quando falta coordenada/código de coleta; aqui o
// pedido é só o preço, e o aviso só polui a saída.
function traduzir(order) {
  const aviso = console.warn;
  console.warn = () => {};
  try { return traduzirPedido99Food(order); } finally { console.warn = aviso; }
}

const RE_NOTA = /\[99Food pagou R\$ ([\d.]+,\d{2}) de cupom — a loja recebe R\$ ([\d.]+,\d{2})\]/;

// ── 1. Os pedidos com a assinatura do erro ─────────────────────────────────
const candidatos = await sql`
  SELECT o.id, o."franchiseeId" AS "lojaId", u."storeName" AS loja, o.status, o."createdAt"::text AS criado,
         o."totalAmount"::float AS total, o."discountTotal"::float AS dt, o."discountMerchant"::float AS dm,
         o."discountIfood"::float AS di, o."discountDetails" AS dd, o.notes, o."fiscalStatus" AS fiscal,
         (o."cancelamentoParcial" IS NOT NULL) AS parcial
    FROM "CustomerOrder" o JOIN "User" u ON u.id = o."franchiseeId"
   WHERE (o.source = '99FOOD' OR o."openDeliveryChannel" = '99FOOD')
     AND jsonb_typeof(o."discountDetails"->'precoCru') = 'object'
     AND NOT ((o."discountDetails"->'precoCru') ? 'real_pay_price')
     AND NOT ((o."discountDetails"->'precoCru') ? 'customer_need_paying_money')
   ORDER BY o."createdAt"`;

const corrigir = [];
const naoMexo = [];
for (const p of candidatos) {
  if (SO_A_LOJA && p.lojaId !== SO_A_LOJA) continue;
  const dd = p.dd || {};
  const pc = dd.precoCru;
  const cheio = r2((Number(pc.order_price) || 0) / 100);
  if (dd.correcaoDoTotal) { naoMexo.push({ p, motivo: `já corrigido em ${dd.correcaoDoTotal.em}` }); continue; }
  if (p.parcial) { naoMexo.push({ p, motivo: "teve cancelamento parcial: o precoCru é de antes do corte" }); continue; }
  if (r2(p.total) !== cheio) { naoMexo.push({ p, motivo: `total gravado ${reais(p.total)} não é o preço cheio ${reais(cheio)} — mexido depois de entrar` }); continue; }
  const t = traduzir({ order_id: p.id, price: pc, promotions: Array.isArray(dd.promocoes) ? dd.promocoes : [] });
  // O pedido de antes de 18/09/2026 não tem as colunas loja/99 (as duas
  // nulas): a divisão dele é lida das promoções na hora (desconto-99food.ts).
  // Com coluna gravada, ela tem de ser a mesma de agora — o webhook só grava
  // a que passa de zero, então nula ali vale zero.
  const semColunas = p.dm == null && p.di == null;
  const divisaoGravada = semColunas ? [r2(p.dt ?? 0)] : [r2(p.dt ?? 0), r2(p.dm ?? 0), r2(p.di ?? 0)];
  const divisaoDeAgora = semColunas ? [r2(t.descontos.total)] : [r2(t.descontos.total), r2(t.descontos.loja), r2(t.descontos.plataforma)];
  if (JSON.stringify(divisaoGravada) !== JSON.stringify(divisaoDeAgora)) {
    naoMexo.push({ p, motivo: `desconto gravado ${JSON.stringify(divisaoGravada)} × de agora ${JSON.stringify(divisaoDeAgora)} (total, loja, 99)` });
    continue;
  }
  if (r2(t.total) === r2(p.total)) continue;
  corrigir.push({ p, t, novo: r2(t.total), aMais: r2(p.total - t.total) });
}

// ── 2. O que muda, por loja ─────────────────────────────────────────────────
console.log(`\n${GRAVAR ? "GRAVANDO" : "SIMULAÇÃO (nada é gravado; use --gravar)"} — pedidos do 99Food com o total = preço cheio dos itens\n`);
const porLoja = new Map();
for (const c of corrigir) {
  const k = c.p.loja.trim();
  const a = porLoja.get(k) || { lojaId: c.p.lojaId, n: 0, nCancelados: 0, nAMenos: 0, gravado: 0, certo: 0, recebeAntes: 0, recebeDepois: 0, set: 0, out: 0, fiscal: 0, de: c.p.criado, ate: c.p.criado };
  a.n++;
  if (c.p.status === "CANCELADO") a.nCancelados++;
  if (c.aMais < 0) a.nAMenos++;
  a.gravado += c.p.total; a.certo += c.novo;
  // "Antes" pela conta da nota com o total velho (pedido de antes de 17/09/2026 não gravou o recebeLoja).
  a.recebeAntes += c.p.total + c.t.descontos.plataforma - c.t.descontos.taxaServico; a.recebeDepois += c.t.descontos.recebeLoja;
  if (c.p.criado < "2026-10-01 03:00") a.set += c.aMais; else a.out += c.aMais;
  if (String(c.p.fiscal || "").toUpperCase() === "EMITTED") a.fiscal++;
  if (c.p.criado > a.ate) a.ate = c.p.criado;
  porLoja.set(k, a);
}
const linhas = [...porLoja.entries()].sort((x, y) => (y[1].gravado - y[1].certo) - (x[1].gravado - x[1].certo));
for (const [loja, a] of linhas) {
  console.log(`${loja} (${a.lojaId})`);
  console.log(`  ${a.n} pedidos (${a.nCancelados} cancelados), de ${a.de.slice(0, 10)} a ${a.ate.slice(0, 10)}` +
    (a.nAMenos ? ` — ${a.nAMenos} gravados ABAIXO do pago (frete pago pelo cliente ou taxa do app maior que o desconto)` : ""));
  console.log(`  total gravado ${reais(a.gravado)} → o que os clientes pagaram ${reais(a.certo)}  (−${reais(a.gravado - a.certo)}: set ${reais(a.set)} · out ${reais(a.out)})`);
  console.log(`  "a loja recebe" (pago + 99 − taxa do app): ${reais(a.recebeAntes)} → ${reais(a.recebeDepois)}`);
  if (a.fiscal) console.log(`  ⚠ ${a.fiscal} com NFC-e emitida: a nota já saiu, este script não mexe nela`);
}
const soma = (f) => r2(corrigir.reduce((s, c) => s + f(c), 0));
console.log(`\nTOTAL: ${corrigir.length} pedidos em ${porLoja.size} lojas — gravado ${reais(soma((c) => c.p.total))} → pago ${reais(soma((c) => c.novo))} (−${reais(soma((c) => c.aMais))})`);
const validos = corrigir.filter((c) => c.p.status !== "CANCELADO");
console.log(`  fora os cancelados: ${validos.length} pedidos, −${reais(validos.reduce((s, c) => s + c.aMais, 0))} no valor vendido`);
if (naoMexo.length) {
  console.log(`\nNÃO MEXO (${naoMexo.length}):`);
  for (const { p, motivo } of naoMexo) console.log(`  ${p.id} ${p.loja.trim()} ${p.criado.slice(0, 16)} — ${motivo}`);
}
console.log("\nExemplos:");
for (const c of corrigir.slice(-3)) {
  console.log(`  ${c.p.id} ${c.p.loja.trim()} ${c.p.criado.slice(0, 16)}: ${reais(c.p.total)} → ${reais(c.novo)}; a loja recebe ${reais(Number(c.p.dd.recebeLoja) || 0)} → ${reais(c.t.descontos.recebeLoja)}`);
}

// ── 3. A mensalidade de setembro e outubro (só leitura) ─────────────────────
// A régua de lib/billing.ts, refeita aqui sem importar o módulo (ele puxa o
// Prisma e o Asaas): VENDAS_QUE_CONTAM, faturamentoBruto, intervaloDoMes,
// inicioDaCobranca e lojaIsenta. Se aquela régua mudar, mude aqui também.
function offsetDoFuso(data, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {};
  for (const parte of dtf.formatToParts(data)) if (parte.type !== "literal") p[parte.type] = parte.value;
  return data.getTime() - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}
function intervaloDoMes(ym, tz) {
  const [ano, mes] = ym.split("-").map(Number);
  const meiaNoite = (a, m) => { const chute = Date.UTC(a, m, 1); const o1 = offsetDoFuso(new Date(chute), tz); return new Date(chute + offsetDoFuso(new Date(chute + o1), tz)); };
  return { inicio: meiaNoite(ano, mes - 1), fim: meiaNoite(ano, mes) };
}
function inicioDaCobranca(inicio, fim, fimDoTeste) {
  if (!fimDoTeste) return inicio;
  if (fimDoTeste >= fim) return null;
  return fimDoTeste > inicio ? fimDoTeste : inicio;
}
const ISENTOS = ["contatohakim@gmail.com", "viniciusmenezes.ofc@gmail.com", "brendi-sandbox@firehubfood.com.br",
  ...variavel("BYPASS_BILLING_EMAILS").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)];

async function brutoDoPeriodo(lojaId, de, ate) {
  const [r] = await sql`
    SELECT COALESCE(SUM(o."totalAmount"), 0)::float + COALESCE(SUM(o."discountTotal"), 0)::float AS bruto
      FROM "CustomerOrder" o
     WHERE o."franchiseeId" = ${lojaId} AND o."createdAt" >= ${paraOBanco(de)} AND o."createdAt" < ${paraOBanco(ate)}
       AND o.status <> 'CRIANDO_IA'
       AND NOT (o.status = 'AGUARDANDO_PAGAMENTO' AND o."paymentPaidAt" IS NULL)
       AND (o.status <> 'CANCELADO' OR o."createdAt" >= ${paraOBanco(VIRADA_DOS_2_POR_CENTO)})`;
  return Number(r.bruto) || 0;
}
const contaNaBase = (c, de, ate) => {
  const quando = instante(c.p.criado);
  if (quando < de || quando >= ate) return false;
  return c.p.status !== "CANCELADO" || quando >= VIRADA_DOS_2_POR_CENTO;
};

const idsDasLojas = [...new Set(corrigir.map((c) => c.p.lojaId))];
const lojas = idsDasLojas.length ? await sql`
  SELECT u.id, u."storeName" AS loja, u.email, u."planPercent"::float AS "planPercent", u."isFranqueadoHakim" AS hakim,
         u."trialEndsAt"::text AS teste, COALESCE(u."storeTimezone", 'America/Sao_Paulo') AS tz,
         EXISTS (SELECT 1 FROM "Ambassador" a WHERE a."linkedUserId" = u.id AND a.active) AS parceiro
    FROM "User" u WHERE u.id = ANY(${idsDasLojas})` : [];
const ciclos = idsDasLojas.length ? await sql`
  SELECT "franchiseeId" AS "lojaId", "yearMonth" AS mes, status, "totalSales"::float AS "totalSales", "amountDue"::float AS "amountDue", "paidValue"::float AS pago
    FROM "FranchiseeBillingCycle" WHERE "franchiseeId" = ANY(${idsDasLojas}) AND "yearMonth" = ANY(${MESES})` : [];

console.log("\nMENSALIDADE — a base (bruto do mês) com o total inflado × corrigido, e a mensalidade de cada uma (só leitura)");
let somaAMais = { "2026-09": 0, "2026-10": 0 };
for (const l of lojas.sort((a, b) => a.loja.localeCompare(b.loja))) {
  const isenta = ISENTOS.includes(String(l.email || "").toLowerCase().replace(/\s+/g, "")) || l.planPercent === 0 || l.hakim === true || l.parceiro === true;
  const meus = corrigir.filter((c) => c.p.lojaId === l.id);
  console.log(`\n${l.loja.trim()}${isenta ? " — ISENTA (não paga mensalidade)" : ""}`);
  for (const mes of MESES) {
    const { inicio, fim } = intervaloDoMes(mes, l.tz);
    const desde = inicioDaCobranca(inicio, fim, l.teste ? instante(l.teste) : null);
    const ciclo = ciclos.find((c) => c.lojaId === l.id && c.mes === mes);
    const doCiclo = ciclo ? `ciclo ${ciclo.status}, gravado: base ${reais(ciclo.totalSales)}, mensalidade ${reais(ciclo.amountDue)}${ciclo.pago != null ? `, pago ${reais(ciclo.pago)}` : ""}` : "sem ciclo";
    if (!desde) { console.log(`  ${mes}: em teste o mês inteiro — nada cobrado (${doCiclo})`); continue; }
    const base = await brutoDoPeriodo(l.id, desde, fim);
    const virada = VIRADA_DOS_2_POR_CENTO;
    const antes = mes === "2026-10" && desde < virada ? await brutoDoPeriodo(l.id, desde, fim < virada ? fim : virada) : 0;
    const inflado = meus.filter((c) => contaNaBase(c, desde, fim)).reduce((s, c) => s + c.aMais, 0);
    const infladoAntes = mes === "2026-10" ? meus.filter((c) => contaNaBase(c, desde, fim < virada ? fim : virada)).reduce((s, c) => s + c.aMais, 0) : 0;
    const hoje = isenta ? 0 : calcMensalidade(base, false, mes, antes).mensalidade;
    const certa = isenta ? 0 : calcMensalidade(base - inflado, false, mes, antes - infladoAntes).mensalidade;
    if (!isenta) somaAMais[mes] += hoje - certa;
    // A base refeita aqui tem de ser a do ciclo; quando não é, o ciclo está
    // parado (loja isenta ou ciclo já pago não é recalculado) — e é dito.
    const parado = ciclo && Math.abs(ciclo.totalSales - base) > 0.01 ? " (o ciclo gravado está parado numa base antiga)" : "";
    console.log(`  ${mes}: base ${reais(base)} (inflada em ${reais(inflado)}) → ${reais(base - inflado)}; mensalidade ${reais(hoje)} → ${reais(certa)}` +
      ` (${hoje - certa > 0.004 ? `${reais(hoje - certa)} a mais` : "sem diferença"})${desde > inicio ? ` [cobra desde ${desde.toISOString().slice(0, 10)}]` : ""} — ${doCiclo}${parado}`);
  }
}
console.log(`\nMensalidade a mais por causa do total inflado: setembro ${reais(somaAMais["2026-09"])} · outubro (até agora) ${reais(somaAMais["2026-10"])}`);

// ── 4. Gravar ───────────────────────────────────────────────────────────────
if (!GRAVAR) {
  console.log("\nNada foi gravado. Para corrigir os pedidos: npx tsx scripts/corrigir-total-do-99.mjs --gravar");
  process.exit(0);
}
let gravados = 0;
const em = new Date().toISOString();
for (const c of corrigir) {
  const dd = c.p.dd;
  const novoDd = {
    ...dd,
    recebeLoja: c.t.descontos.recebeLoja,
    complementoMinimo: c.t.descontos.complementoMinimo,
    totalCalculado: true,
    correcaoDoTotal: {
      em, totalAntes: c.p.total, totalDepois: c.novo, recebeLojaAntes: dd.recebeLoja ?? null,
      motivo: "o 99 não mandou real_pay_price (entrega do 99) e o total gravado era o preço cheio dos itens (order_price)",
      script: "scripts/corrigir-total-do-99.mjs",
    },
  };
  const novaNota = c.p.notes
    ? c.p.notes.replace(RE_NOTA, (_, plataforma) => `[99Food pagou R$ ${plataforma} de cupom — a loja recebe R$ ${virgula(c.t.descontos.recebeLoja)}]`)
    : c.p.notes;
  const r = await sql`
    UPDATE "CustomerOrder"
       SET "totalAmount" = ${c.novo}, "discountDetails" = ${JSON.stringify(novoDd)}::jsonb, notes = ${novaNota}
     WHERE id = ${c.p.id} AND "totalAmount" = ${c.p.total}
       AND NOT (("discountDetails"->'precoCru') ? 'real_pay_price')
       AND "discountDetails"->'correcaoDoTotal' IS NULL
    RETURNING id`;
  if (r.length) gravados++;
}
console.log(`\nGravados: ${gravados} de ${corrigir.length}. O ciclo de outubro se refaz no próximo pedido confirmado de cada loja.`);
