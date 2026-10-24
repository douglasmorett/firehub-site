/**
 * scripts/teste-aiqfome-fluxo.ts — o caminho inteiro do aiqfome, sem banco e sem a rede de verdade.
 *
 *   npx tsx scripts/teste-aiqfome-fluxo.ts
 *
 * Banco em memória (o mesmo emulador de scripts/teste-cardapioweb-fluxo.ts, para
 * o SQL cru das tabelas criadas no 1º uso) e um aiqfome FALSO num servidor
 * HTTP local de verdade (AIQFOME_BASE_URL e AIQFOME_ID_URL apontam para ele):
 * o ID Magalu que emite o `code`, confere client_secret e redirect_uri e GIRA
 * o refresh_token; a API V2 com /store, /orders/open, /orders/cancelled,
 * /orders/{id}, mark-as-read/ready/delivered, os eventos de webhook e o
 * cadastro deles; 429 e 500 quando o teste manda. Qualquer chamada para fora
 * de 127.0.0.1 é anotada e falha. Cada caso é um furo de outro canal:
 *
 *   - conexão só pela conta da sessão, com state opaco de uso único (99Food);
 *   - N lojas do token → 1 conta; loja ativa em outra conta é recusada;
 *   - loja do pedido só pela instalação ativa (JotaJá/iFood/Brendi);
 *   - webhook responde 200 SEMPRE e rápido; mesmo aviso duas vezes = um pedido;
 *   - o polling acha o que o webhook perdeu; filtros (antes da conexão, já pronto);
 *   - aceite automático só de pedido recente; status só avança; cancelado cancela;
 *   - a escada de status sobe na ordem, e o 429 vira fila na ordem;
 *   - token renovado com trava POR CREDENCIAL (duas lojas, um par de tokens);
 *   - pedido do aiqfome NUNCA chama a API do JotaJá (o "senão é JotaJá").
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";

let falhas = 0;
let total = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEGREDO = "segredo-do-webhook-do-firehub";
const ENV_AIQFOME = { AIQFOME_CLIENT_ID: "cliente-firehub", AIQFOME_CLIENT_SECRET: "segredo-do-app", AIQFOME_WEBHOOK_SECRET: SEGREDO };
Object.assign(process.env, { NODE_ENV: "development", NEXTAUTH_URL: "https://firehubfood.com.br", ...ENV_AIQFOME });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "teste";
delete process.env.COFRE_CHAVE;

// ── Banco em memória: os models ──────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; menuProduct: Linha[] } = { user: [], customerOrder: [], menuProduct: [] };
let proximoId = 1;
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object" || Array.isArray(filtro) || filtro instanceof Date) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (!igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else if (op === "startsWith") { if (!String(valor ?? "").startsWith(String(alvo))) return false; }
    else return false;
  }
  return true;
}
function casa(l: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as any[]).every((w) => casa(l, w))) return false; }
    else if (k === "OR") { if (!(v as any[]).some((w) => casa(l, w))) return false; }
    else if (k === "NOT") { if (casa(l, v)) return false; }
    else if (k === "franchisee") return false; // relação: o banco falso não carrega
    else if (!casaCampo(l[k], v)) return false;
  }
  return true;
}
const projetar = (l: Linha | undefined, select?: Record<string, any>) => {
  if (!l) return null;
  if (!select) return { ...l };
  const saida: Linha = {};
  for (const [k, v] of Object.entries(select)) saida[k] = v === true ? l[k] ?? null : l[k] ?? null;
  return saida;
};
const delegado = (tabela: keyof typeof db) => ({
  findFirst: async ({ where, select }: any = {}) => projetar(db[tabela].find((l) => casa(l, where)), select),
  findUnique: async ({ where, select }: any = {}) => projetar(db[tabela].find((l) => casa(l, where)), select),
  findMany: async ({ where, select }: any = {}) => db[tabela].filter((l) => casa(l, where)).map((l) => projetar(l, select)),
  update: async ({ where, data, select }: any) => {
    const l = db[tabela].find((x) => casa(x, where));
    if (!l) throw new Error(`update sem linha em ${tabela}`);
    Object.assign(l, data);
    return projetar(l, select);
  },
  updateMany: async ({ where, data }: any) => {
    const alvos = db[tabela].filter((x) => casa(x, where));
    for (const l of alvos) Object.assign(l, data);
    return { count: alvos.length };
  },
  create: async ({ data, select }: any) => {
    if (tabela === "customerOrder" && data.openDeliveryOrderId && db.customerOrder.some((o) => o.openDeliveryOrderId === data.openDeliveryOrderId)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    }
    const l: Linha = { id: `id${proximoId++}`, createdAt: new Date(), ...data };
    if (tabela === "customerOrder") l.items = data.items?.create || [];
    db[tabela].push(l);
    return projetar(l, select);
  },
});


// ── Banco em memória: o SQL cru das tabelas do aiqfome ──────────────────────
const sqlTabelas: Record<string, Linha[]> = { AiqfomeInstalacao: [], AiqfomeEstadoOAuth: [], AcaoPendenteAiqfome: [], AiqfomeEvento: [] };
const sequencia: Record<string, number> = { AiqfomeInstalacao: 0, AcaoPendenteAiqfome: 0 };
let tique = 0;
const PADROES: Record<string, () => Linha> = {
  AiqfomeInstalacao: () => ({
    nome: null, credencial: null, accessToken: null, refreshToken: null, tokenExpiraEm: null, escopos: null, estado: "ok", motivoDoEstado: null, ativa: true,
    conectadaEm: new Date(), conectadaPor: null, desligadaEm: null, importarDesde: new Date(), ultimoPedidoEm: null, ultimoWebhookEm: null,
    ultimoSoPeloPollingEm: null, webhooksEm: null, webhooksErro: null,
  }),
  AiqfomeEstadoOAuth: () => ({ criadoPor: null, criadoEm: new Date(), usadoEm: null }),
  AcaoPendenteAiqfome: () => ({ ultimoErro: null, tentativas: 0, criadaEm: new Date(), ordem: ++tique, resolvidaEm: null }),
  AiqfomeEvento: () => ({ motivo: null, recebidoEm: new Date(), processadoEm: null, tentativas: 0, resultado: null }),
};
const UNICOS: Record<string, string[][]> = {
  AiqfomeInstalacao: [["id"], ["storeId"]],
  AiqfomeEstadoOAuth: [["stateHash"]],
  AcaoPendenteAiqfome: [["id"], ["pedidoId", "acao"]],
  AiqfomeEvento: [["eventId"]],
};
const sqlsVistos = new Set<string>();

/** Divide no separador de topo (fora de parênteses e aspas). */
function dividir(s: string, sep: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let aspas = false;
  let atual = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") aspas = !aspas;
    if (!aspas && c === "(") nivel++;
    if (!aspas && c === ")") nivel--;
    if (!aspas && nivel === 0 && s.startsWith(sep, i)) {
      partes.push(atual);
      atual = "";
      i += sep.length - 1;
      continue;
    }
    atual += c;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter((p) => p !== "");
}

function valorSql(expr: string, p: any[], linha: Linha | null, excluded: Linha | null): any {
  const e = expr.trim();
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^\$(\d+)(?:::(\w+))?$/))) {
    const v = p[Number(m[1]) - 1];
    return m[2] === "jsonb" ? (v == null ? null : JSON.parse(v)) : v;
  }
  if (e === "now()") return new Date();
  if (e === "clock_timestamp()") return ++tique;
  if (e === "NULL") return null;
  if (e === "true" || e === "false") return e === "true";
  if ((m = e.match(/^'(.*)'$/))) return m[1];
  if ((m = e.match(/^COALESCE\((.+),\s*"(\w+)"\)$/))) return valorSql(m[1], p, linha, excluded) ?? linha?.[m[2]] ?? null;
  if ((m = e.match(/^"(\w+)" \+ 1$/))) return Number(linha?.[m[1]] ?? 0) + 1;
  if ((m = e.match(/^CASE WHEN \$(\d+) THEN now\(\) ELSE NULL END$/))) return p[Number(m[1]) - 1] ? new Date() : null;
  if ((m = e.match(/^EXCLUDED\."(\w+)"$/))) return excluded?.[m[1]];
  throw new Error(`valor SQL não emulado: ${e}`);
}

const MS: Record<string, number> = { minute: 60e3, minutes: 60e3, hour: 3600e3, hours: 3600e3, day: 864e5, days: 864e5 };
function condicao(c: string, l: Linha, p: any[]): boolean {
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^"(\w+)" = \$(\d+)(?:::\w+)?$/))) return String(l[m[1]]) === String(p[Number(m[2]) - 1]);
  if ((m = c.match(/^"(\w+)" = (true|false)$/))) return Boolean(l[m[1]]) === (m[2] === "true");
  if ((m = c.match(/^"(\w+)" IS NULL$/))) return l[m[1]] == null;
  if ((m = c.match(/^"(\w+)" = ANY\(\$(\d+)::text\[\]\)$/))) return (p[Number(m[2]) - 1] as any[]).map(String).includes(String(l[m[1]]));
  if ((m = c.match(/^"(\w+)" ([<>]) now\(\) - \(\$(\d+) \|\| ' milliseconds'\)::interval$/))) {
    const limite = Date.now() - Number(p[Number(m[3]) - 1]);
    const t = new Date(l[m[1]]).getTime();
    return m[2] === ">" ? t > limite : t < limite;
  }
  if ((m = c.match(/^"(\w+)" ([<>]) now\(\) - interval '(\d+) (\w+)'$/))) {
    const limite = Date.now() - Number(m[3]) * MS[m[4]];
    const t = new Date(l[m[1]]).getTime();
    return m[2] === ">" ? t > limite : t < limite;
  }
  if ((m = c.match(/^"(\w+)" < (\d+)$/))) return Number(l[m[1]]) < Number(m[2]);
  throw new Error(`condição SQL não emulada: ${c}`);
}
const ondeCasa = (onde: string | undefined, l: Linha, p: any[]) => !onde || dividir(onde, " AND ").every((c) => condicao(c, l, p));

function aplicarSet(sets: string, l: Linha, p: any[], excluded: Linha | null) {
  const novos: Linha = {};
  for (const a of dividir(sets, ",")) {
    const m = a.match(/^"(\w+)" = (.+)$/);
    if (!m) throw new Error(`SET não emulado: ${a}`);
    novos[m[1]] = valorSql(m[2], p, l, excluded);
  }
  Object.assign(l, novos);
}

async function executarSql(bruto: string, ...p: any[]): Promise<number> {
  const q = bruto.replace(/\s+/g, " ").trim();
  sqlsVistos.add(q.slice(0, 60));
  if (/^CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(q)) return 0;
  let m: RegExpMatchArray | null;
  if ((m = q.match(/^INSERT INTO "(\w+)" \((.+?)\) VALUES \((.+?)\)(?: ON CONFLICT \((.+?)\) DO (NOTHING|UPDATE SET (.+)))?$/))) {
    const [, tabela, colunas, valores, conflito, acao, sets] = m;
    const nomes = dividir(colunas, ",").map((c) => c.replace(/"/g, ""));
    const vals = dividir(valores, ",");
    const nova: Linha = { ...(PADROES[tabela]?.() ?? {}) };
    nomes.forEach((n, i) => (nova[n] = valorSql(vals[i], p, null, null)));
    if (sequencia[tabela] !== undefined && nova.id === undefined) nova.id = ++sequencia[tabela];
    for (const chave of UNICOS[tabela] || []) {
      const existente = sqlTabelas[tabela].find((l) => chave.every((k) => l[k] !== undefined && String(l[k]) === String(nova[k])));
      if (!existente) continue;
      const chaveDoConflito = conflito ? conflito.split(",").map((c) => c.trim().replace(/"/g, "")) : null;
      if (!chaveDoConflito || !igual(chaveDoConflito, chave)) throw Object.assign(new Error(`unique violada em ${tabela}`), { code: "23505" });
      if (acao === "NOTHING") return 0;
      aplicarSet(sets!, existente, p, nova);
      return 1;
    }
    sqlTabelas[tabela].push(nova);
    return 1;
  }
  if ((m = q.match(/^UPDATE "(\w+)" SET (.+) WHERE (.+)$/))) {
    const [, tabela, sets, onde] = m;
    const alvos = sqlTabelas[tabela].filter((l) => ondeCasa(onde, l, p));
    for (const l of alvos) aplicarSet(sets, l, p, null);
    return alvos.length;
  }
  if ((m = q.match(/^DELETE FROM "(\w+)" WHERE (.+)$/))) {
    const [, tabela, onde] = m;
    const antes = sqlTabelas[tabela].length;
    sqlTabelas[tabela] = sqlTabelas[tabela].filter((l) => !ondeCasa(onde, l, p));
    return antes - sqlTabelas[tabela].length;
  }
  throw new Error(`SQL não emulado: ${q}`);
}

async function consultarSql(bruto: string, ...p: any[]): Promise<any[]> {
  const q = bruto.replace(/\s+/g, " ").trim();
  sqlsVistos.add(q.slice(0, 60));
  const m = q.match(/^SELECT (.+?) FROM "(\w+)"(?: WHERE (.+?))?(?: ORDER BY (.+?))?(?: LIMIT (\d+))?$/);
  if (!m) throw new Error(`SELECT não emulado: ${q}`);
  const [, colunas, tabela, onde, ordem, limite] = m;
  let linhas = sqlTabelas[tabela].filter((l) => ondeCasa(onde, l, p));
  if (ordem) {
    const chaves = dividir(ordem, ",").map((c) => c.replace(/"/g, ""));
    linhas = [...linhas].sort((a, b) => {
      for (const k of chaves) {
        const va = a[k] instanceof Date ? a[k].getTime() : a[k];
        const vb = b[k] instanceof Date ? b[k].getTime() : b[k];
        if (va < vb) return -1;
        if (va > vb) return 1;
      }
      return 0;
    });
  }
  if (limite) linhas = linhas.slice(0, Number(limite));
  if (colunas.trim() === "*") return linhas.map((l) => ({ ...l }));
  const nomes = dividir(colunas, ",").map((c) => c.replace(/"/g, ""));
  return linhas.map((l) => Object.fromEntries(nomes.map((n) => [n, l[n]])));
}

const prismaFalso: any = {
  user: delegado("user"),
  customerOrder: delegado("customerOrder"),
  menuProduct: delegado("menuProduct"),
  $executeRawUnsafe: executarSql,
  $queryRawUnsafe: consultarSql,
  $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prismaFalso)),
};
(globalThis as any).prisma = prismaFalso;

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let numeroDoDia = 0;
stub("../src/lib/order-number", { generateDailyOrderNumberTx: async () => ++numeroDoDia, generateDailyOrderNumber: async () => ++numeroDoDia });
stub("../src/lib/fuso-da-loja", { fusoDaLoja: async () => "America/Sao_Paulo" });
stub("../src/lib/distancia-da-entrega", { pontoEDistanciaDoParceiro: async (_: string, ponto: any) => ({ ponto, km: ponto ? 2.4 : null }) });
stub("../src/lib/stock", { deductStockForOrder: async () => {}, tratarEstoqueDoCancelamento: async () => "OK" });
const impressos: string[] = [];
stub("../src/app/api/store/print-queue/route", { pushJobToPrintQueue: (_l: string, pedido: any) => impressos.push(pedido.id) });
const alertas: string[] = [];
stub("../src/lib/server-monitor", { alertarFalhaDeIntegracao: async (canal: string, loja: string, d: string) => void alertas.push(`${canal} | ${loja}: ${d}`) });
const notasAlertadas: any[] = [];
stub("../src/lib/fiscal-automatico", {
  alertarCancelamentoComNota: async (onde: any, canal: string) => void notasAlertadas.push({ onde, canal }),
  emitirNfceDosPedidos: async () => {},
  emitirNfceAutomatica: async () => {},
});
const payloads: any[] = [];
stub("../src/lib/open-delivery/payload-cru", { guardarPayloadCru: async (r: any) => void payloads.push(r) });
const bloqueadas = new Set<string>();
stub("../src/lib/loja-bloqueada", { lojaBloqueadaPorMensalidade: async (id: string) => bloqueadas.has(id) });
stub("../src/lib/loja-sem-conexao-no-banco", { aceitaSozinhoAgora: async (l: any) => !!l?.autoAcceptOrders });
let sessao: string | null = null;
stub("next-auth/next", { getServerSession: async () => (sessao ? { user: { email: sessao } } : null) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/ifood-token", {
  lojaDaSessao: async (email: string) => {
    const u = db.user.find((x) => x.email === email);
    return u ? u.ownerId || u.id : null;
  },
});
const jotaja: string[] = [];
stub("../src/lib/jotaja-api", {
  jotajaMutate: async (caminho: string) => {
    jotaja.push(caminho);
    return new Response(null, { status: 200 });
  },
  jotajaFetch: async (caminho: string) => {
    jotaja.push(caminho);
    return new Response(null, { status: 200 });
  },
});
stub("../src/lib/order-notifications", { sendOrderNotification: async () => {} });
stub("../src/lib/whatsapp-evolution", { sendEvolutionMessage: async () => true });
stub("../src/lib/billing", { trackSaleForBilling: async () => {} });

db.user.push(
  { id: "loja-a", email: "dono-a@teste", role: "FRANQUEADO", ownerId: null, name: "Dono A", storeName: "Pizzaria A", autoAcceptOrders: true, permissions: null },
  { id: "loja-b", email: "dono-b@teste", role: "FRANQUEADO", ownerId: null, name: "Dono B", storeName: "Outra Loja", autoAcceptOrders: false, permissions: null },
  { id: "func-a", email: "func-a@teste", role: "STAFF", ownerId: "loja-a", name: "Caixa", storeName: null, autoAcceptOrders: false, permissions: "orders,kds" },
);

// ── aiqfome FALSO (ID Magalu + API V2) num servidor HTTP local ───────────────
const REDIRECT = "https://firehubfood.com.br/api/store/integracoes/aiqfome/retorno";
const URL_DO_WEBHOOK = "https://firehubfood.com.br/api/aiqfome/webhook";
const UA = "FireHub (contato@firehubfood.com.br)";
const EVENTOS = [{ id: 31, name: "new-order" }, { id: 32, name: "read-order" }, { id: 33, name: "ready-order" }, { id: 34, name: "cancel-order" }, { id: 35, name: "order-refund" }];
const aq = {
  codigos: new Map<string, { lojas: string[]; redirectUri: string; usado: boolean }>(),
  acessos: new Map<string, { lojas: string[]; venceEm: number }>(),
  refreshes: new Map<string, { lojas: string[] }>(),
  lojas: new Map<string, string>(),
  pedidos: new Map<string, Linha>(),
  cancelados: [] as Linha[],
  webhooks: new Map<string, Linha[]>(),
  chamadas: [] as Array<{ metodo: string; caminho: string; ua: string; corpo?: any }>,
  renovacoes: 0,
  falhas: {} as Record<string, number[]>,
  atraso: new Map<string, number>(),
  seq: 0,
};

/** "YYYY-MM-DD HH:mm:ss" no relógio de São Paulo — o formato do aiqfome. */
function horaLocal(ms: number): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

function emitirTokens(lojas: string[]) {
  const n = ++aq.seq;
  aq.acessos.set(`at-${n}`, { lojas, venceEm: Date.now() + 7200e3 });
  aq.refreshes.set(`rt-${n}`, { lojas });
  return { access_token: `at-${n}`, token_type: "Bearer", expires_in: 7200, refresh_token: `rt-${n}`, scope: "aqf:order:read aqf:order:create aqf:store:read aqf:store:create", created_at: 1 };
}

const SINAL: Record<string, string> = { "mark-as-read": "is_read", "mark-as-ready": "is_ready", "mark-as-delivered": "is_delivered" };
const resumo = (p: Linha) => ({
  order_id: p.id, created_at: p.created_at, is_ready: p.is_ready, is_read: p.is_read, is_cancelled: p.is_cancelled, is_in_separation: false,
  is_delivered: p.is_delivered, user_name: p.user?.name, is_aiqentrega_delivery: p.is_aiqentrega_delivery, order_is_pickup: p.is_pickup,
  is_scheduled: p.is_scheduled, store_id: p.store.id, store_name: p.store.name, order_delivery_time: p.delivery_time,
});

async function atender(req: IncomingMessage, res: ServerResponse) {
  const pedacos: Buffer[] = [];
  for await (const c of req) pedacos.push(c as Buffer);
  const texto = Buffer.concat(pedacos).toString("utf8");
  const url = new URL(req.url || "/", "http://falso");
  const metodo = String(req.method || "GET").toUpperCase();
  const responder = (status: number, corpo?: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(corpo === undefined ? "" : JSON.stringify(corpo));
  };
  let corpo: any;
  try { corpo = texto && !texto.includes("=") ? JSON.parse(texto) : undefined; } catch { corpo = undefined; }
  aq.chamadas.push({ metodo, caminho: url.pathname + url.search, ua: String(req.headers["user-agent"] || ""), corpo });

  if (url.pathname === "/oauth/token") {
    const f = new URLSearchParams(texto);
    if (f.get("client_id") !== "cliente-firehub" || f.get("client_secret") !== "segredo-do-app") return responder(401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      const c = aq.codigos.get(f.get("code") || "");
      if (!c || c.usado) return responder(400, { error: "invalid_grant", error_description: "código inválido" });
      if (f.get("redirect_uri") !== c.redirectUri) return responder(400, { error: "invalid_grant", error_description: "redirect_uri diferente" });
      c.usado = true;
      return responder(200, emitirTokens(c.lojas));
    }
    if (f.get("grant_type") === "refresh_token") {
      aq.renovacoes++;
      await sleep(30); // tempo para outra chamada chegar durante a renovação (a trava)
      if (f.get("redirect_uri") !== REDIRECT) return responder(400, { error: "invalid_request", error_description: "redirect_uri" });
      const r = aq.refreshes.get(f.get("refresh_token") || "");
      if (!r) return responder(400, { error: "invalid_grant", error_description: "refresh_token inválido" });
      aq.refreshes.delete(f.get("refresh_token")!); // GIRA o refresh_token
      return responder(200, emitirTokens(r.lojas));
    }
    return responder(400, { error: "unsupported_grant_type" });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
  const acesso = aq.acessos.get(token);
  if (!acesso || acesso.venceEm < Date.now()) return responder(401, { message: "Unauthenticated." });
  const forcada = aq.falhas[`${metodo} ${url.pathname}`]?.shift();
  if (forcada) return responder(forcada, { message: "falha forçada" });
  const pode = (storeId: unknown) => acesso.lojas.includes(String(storeId));
  const doFiltro = () => String(url.searchParams.get("filter[store_ids]") || "").split(",").filter(Boolean);

  if (metodo === "GET" && url.pathname === "/api/v2/store") return responder(200, { data: acesso.lojas.map((id) => ({ id: Number(id), name: aq.lojas.get(id) || "Loja" })) });
  if (metodo === "GET" && url.pathname === "/api/v2/auxiliary/webhook-events") return responder(200, { data: EVENTOS });
  let m = url.pathname.match(/^\/api\/v2\/store\/(\d+)\/webhooks$/);
  if (m) {
    if (!pode(m[1])) return responder(403, { message: "loja de outro token" });
    const lista = aq.webhooks.get(m[1]) || [];
    if (metodo === "POST") for (const w of corpo?.webhooks || []) lista.push({ id: ++aq.seq, url: w.url, event_id: w.webhook_event_id, secret_key: w.secret_key, status: 1 });
    aq.webhooks.set(m[1], lista);
    return responder(200, { data: lista.map((w) => ({ id: w.id, url: w.url, status: 1, event_id: w.event_id, event_name: EVENTOS.find((e) => e.id === w.event_id)?.name })) });
  }
  if (metodo === "GET" && url.pathname === "/api/v2/orders/open") {
    const lojas = doFiltro();
    if (!lojas.every(pode)) return responder(403, { message: "loja de outro token" });
    return responder(200, { data: [...aq.pedidos.values()].filter((p) => lojas.includes(String(p.store.id)) && !p.is_cancelled && !p.is_delivered).map(resumo), meta: {} });
  }
  if (metodo === "GET" && url.pathname === "/api/v2/orders/cancelled") {
    const lojas = doFiltro();
    if (!lojas.every(pode)) return responder(403, { message: "loja de outro token" });
    return responder(200, { data: aq.cancelados.filter((c) => lojas.includes(String(c.store_id))) });
  }
  m = url.pathname.match(/^\/api\/v2\/orders\/(mark-as-read|mark-as-ready|mark-as-delivered)$/);
  if (m && metodo === "POST") {
    const p = aq.pedidos.get(String(corpo?.order_id));
    if (!p || !pode(p.store.id)) return responder(404, { message: "pedido não encontrado" });
    if (p.is_cancelled) return responder(422, { message: "pedido cancelado" });
    if (p[SINAL[m[1]]]) return responder(422, { message: "status já atualizado" });
    if (m[1] !== "mark-as-read" && !p.is_read) return responder(422, { message: "pedido não lido" });
    p[SINAL[m[1]]] = true;
    return responder(200, { data: { order_id: p.id } });
  }
  m = url.pathname.match(/^\/api\/v2\/orders\/(\d+)$/);
  if (m && metodo === "GET") {
    const p = aq.pedidos.get(m[1]);
    if (!p || !pode(p._servir ?? p.store.id)) return responder(404, { message: "pedido não encontrado" });
    const atraso = aq.atraso.get(m[1]);
    if (atraso) await sleep(atraso);
    return responder(200, { data: p });
  }
  return responder(404, { message: "rota falsa desconhecida" });
}

const servidor = createServer((req, res) => void atender(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
const fetchDeVerdade = globalThis.fetch;
const hostsInesperados: string[] = [];
let hostDoFalso = "";

// ── Fábricas e atalhos ───────────────────────────────────────────────────────
const MODELO = JSON.parse(readFileSync(join(__dirname, "fixtures", "aiqfome", "pedido-entrega.json"), "utf8")).data;
function novoPedido(storeId: string, id: number, extra: Linha = {}, criadoHaMs = 0): Linha {
  const p: Linha = JSON.parse(JSON.stringify(MODELO));
  const criado = horaLocal(Date.now() - criadoHaMs);
  Object.assign(p, { id, created_at: criado, store: { ...p.store, id: Number(storeId), name: aq.lojas.get(storeId) || "Loja" }, timeline: { ...p.timeline, created_at: criado, timezone: "America/Sao_Paulo" } }, extra);
  aq.pedidos.set(String(id), p);
  return p;
}
const retiradaExtra = { is_pickup: true, pickup_at: horaLocal(Date.now() + 30 * 60e3) };
const noFireHub = (storeId: string, id: number) => db.customerOrder.find((o) => o.openDeliveryOrderId === `aiqfome_${storeId}_${id}`);
const chamadasDesde = (n: number) => aq.chamadas.slice(n);
const acoesDo = (orderId: number, desde: number) => chamadasDesde(desde).filter((c) => c.metodo === "POST" && /mark-as-/.test(c.caminho) && c.corpo?.order_id === orderId).map((c) => c.caminho.split("/").pop());
async function ate(cond: () => boolean, ms = 4000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
}
const eventosProcessados = () => sqlTabelas.AiqfomeEvento.filter((e) => e.tentativas >= 1).length;
const instalacaoSql = (storeId: string) => sqlTabelas.AiqfomeInstalacao.find((l) => l.storeId === storeId);

async function main() {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  hostDoFalso = `127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env.AIQFOME_BASE_URL = `http://${hostDoFalso}/api/v2`;
  process.env.AIQFOME_ID_URL = `http://${hostDoFalso}`;
  (globalThis as any).fetch = async (entrada: any, init: any = {}) => {
    const url = new URL(String(entrada));
    if (url.host === hostDoFalso) return fetchDeVerdade(entrada, init);
    hostsInesperados.push(url.host);
    return new Response(JSON.stringify({ erro: `host inesperado ${url.host}` }), { status: 599 });
  };

  const rota = await import("../src/app/api/store/integracoes/aiqfome/route");
  const rotaRetorno = await import("../src/app/api/store/integracoes/aiqfome/retorno/route");
  const rotaWebhook = await import("../src/app/api/aiqfome/webhook/route");
  const rotaCron = await import("../src/app/api/cron/aiqfome-poll/route");
  const { sincronizarAiqfome, passosDaEscada, ehPedidoAiqfome } = await import("../src/lib/aiqfome/status");
  const api = await import("../src/lib/aiqfome/api");
  const { instalacaoAtiva } = await import("../src/lib/aiqfome/instalacoes");
  const { decifrar } = await import("../src/lib/cofre");

  const integracoes = async (metodo: "GET" | "POST", corpo?: unknown, email = "dono-a@teste") => {
    sessao = email;
    const req = new NextRequest("https://firehubfood.com.br/api/store/integracoes/aiqfome", {
      method: metodo,
      headers: { "content-type": "application/json", host: "firehubfood.com.br" },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const res = metodo === "GET" ? await rota.GET(req) : await rota.POST(req);
    return { status: res.status, corpo: await res.json() };
  };
  const retorno = async (query: string, email: string | null = "dono-a@teste") => {
    sessao = email;
    const res = await rotaRetorno.GET(new NextRequest(`https://firehubfood.com.br/api/store/integracoes/aiqfome/retorno?${query}`, { headers: { host: "firehubfood.com.br" } }));
    const u = new URL(res.headers.get("location") || "https://x/");
    return { status: res.status, caminho: u.pathname, integracao: u.searchParams.get("integracao"), resultado: u.searchParams.get("aiqfome"), motivo: u.searchParams.get("motivo") || "" };
  };
  /** O ID Magalu: o lojista escolhe as lojas e autoriza; volta com code + state. */
  const idMagaluAutoriza = (urlDoLogin: string, lojas: string[]) => {
    const u = new URL(urlDoLogin);
    const code = `code-${++aq.seq}`;
    aq.codigos.set(code, { lojas, redirectUri: u.searchParams.get("redirect_uri") || "", usado: false });
    return `code=${encodeURIComponent(code)}&state=${encodeURIComponent(u.searchParams.get("state") || "")}`;
  };
  const conectar = async (lojas: string[], email = "dono-a@teste") => {
    const r = await integracoes("POST", { acao: "conectar" }, email);
    return retorno(idMagaluAutoriza(r.corpo.url, lojas), email);
  };
  const webhook = async (evento: string, storeId: string, orderId: number, opts: { segredo?: string | null; dados?: Linha } = {}) => {
    const corpo = { event: evento, store_id: Number(storeId), data: { order_id: orderId, ...(opts.dados || {}) } };
    const t0 = Date.now();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.segredo !== null) headers.authorization = opts.segredo ?? SEGREDO;
    const res = await rotaWebhook.POST(new NextRequest("https://firehubfood.com.br/api/aiqfome/webhook", { method: "POST", body: JSON.stringify(corpo), headers }));
    return { status: res.status, ms: Date.now() - t0, corpo: await res.json() };
  };
  const cron = async () => {
    const res = await rotaCron.GET(new NextRequest("http://127.0.0.1:3000/api/cron/aiqfome-poll", { headers: { host: "127.0.0.1:3000" } }));
    return res.json();
  };
  /** Espera o after() do webhook terminar. */
  const processou = async (antes: number) => ate(() => eventosProcessados() > antes);

  // ── 1. Conexão ──────────────────────────────────────────────────────────────
  console.log("\n── Conexão (OAuth pelo ID Magalu) ──");
  aq.lojas.set("53852", "Pizzaria A Centro");
  aq.lojas.set("53853", "Pizzaria A Bairro");
  aq.lojas.set("70000", "Loja do Dono B");
  const g0 = await integracoes("GET");
  confere("GET: configurada, nenhuma loja", g0.corpo, { configurada: true, lojas: [] });
  confere("funcionário sem a caixinha de Integrações: 403", (await integracoes("GET", undefined, "func-a@teste")).status, 403);

  const c1 = await integracoes("POST", { acao: "conectar" });
  const u1 = new URL(c1.corpo.url);
  confere(
    "conectar devolve o /login do ID Magalu com client_id, code, redirect_uri exata, os 4 escopos e choose_tenants",
    [u1.origin + u1.pathname, u1.searchParams.get("client_id"), u1.searchParams.get("response_type"), u1.searchParams.get("redirect_uri"), u1.searchParams.get("scope"), u1.searchParams.get("choose_tenants")],
    [`http://${hostDoFalso}/login`, "cliente-firehub", "code", REDIRECT, "aqf:order:read aqf:order:create aqf:store:read aqf:store:create", "true"],
  );
  confere("escopos separados por %20 (não '+')", [c1.corpo.url.includes("scope=aqf%3Aorder%3Aread%20aqf"), c1.corpo.url.includes("+")], [true, false]);
  const state1 = u1.searchParams.get("state") || "";
  const linhaDoState = sqlTabelas.AiqfomeEstadoOAuth.at(-1)!;
  confere("state opaco (sem a loja), banco guarda só o hash, preso à conta", [state1.length >= 40, state1.includes("loja-a"), linhaDoState.stateHash !== state1, linhaDoState.franchiseeId], [true, false, true, "loja-a"]);
  const q1 = idMagaluAutoriza(c1.corpo.url, ["53852", "53853"]);
  const rOutra = await retorno(q1, "dono-b@teste");
  confere("retorno com a sessão de OUTRA loja: erro, e o state não é gasto", [rOutra.resultado, rOutra.motivo.includes("outra loja"), !!linhaDoState.usadoEm], ["erro", true, false]);
  const r1 = await retorno(q1);
  confere("retorno certo: volta para Integrações com ok", [r1.status, r1.caminho, r1.integracao, r1.resultado], [303, "/store/integracoes", "aiqfome", "ok"]);
  const i52 = instalacaoSql("53852")!;
  const i53 = instalacaoSql("53853")!;
  confere(
    "um token, duas lojas do aiqfome → duas instalações na mesma conta, mesma credencial, tokens cifrados",
    [i52?.franchiseeId, i53?.franchiseeId, i52?.nome, i52?.credencial === i53?.credencial, String(i52?.accessToken).startsWith("v1."), decifrar(i52?.accessToken), decifrar(i53?.refreshToken)],
    ["loja-a", "loja-a", "Pizzaria A Centro", true, true, "at-" + [...aq.acessos.keys()].at(-1)!.slice(3), "rt-" + [...aq.acessos.keys()].at(-1)!.slice(3)],
  );
  await ate(() => !!instalacaoSql("53852")?.webhooksEm && !!instalacaoSql("53853")?.webhooksEm);
  confere(
    "webhooks cadastrados depois da resposta: os 4 eventos casados pelo NOME, nossa url e o segredo",
    (aq.webhooks.get("53852") || []).map((w) => [w.event_id, w.url, w.secret_key === SEGREDO]),
    [[31, URL_DO_WEBHOOK, true], [32, URL_DO_WEBHOOK, true], [33, URL_DO_WEBHOOK, true], [34, URL_DO_WEBHOOK, true]],
  );
  confere("o mesmo state de novo: recusado (uso único)", (await retorno(q1)).motivo.includes("já foi usada"), true);
  const c2 = await integracoes("POST", { acao: "conectar" });
  sqlTabelas.AiqfomeEstadoOAuth.at(-1)!.expiraEm = new Date(Date.now() - 1000);
  confere("state vencido (30 min): recusado", (await retorno(idMagaluAutoriza(c2.corpo.url, ["53852"]))).motivo.includes("expirou"), true);
  confere("state que o FireHub não emitiu: recusado", (await retorno("code=x&state=state-que-ninguem-emitiu-0000000000000000")).motivo.includes("não foi aberta pelo FireHub"), true);
  confere("ID Magalu negou: o motivo manda vincular no Geraldo", (await retorno("error=access_denied&state=x")).motivo.includes("Geraldo"), true);
  confere("token sem loja nenhuma: erro que manda vincular no Geraldo", (await conectar([])).motivo.includes("vincule a loja ao ID Magalu"), true);

  const rRoubo = await conectar(["53852"], "dono-b@teste");
  confere("loja do aiqfome ativa em OUTRA conta: recusa com motivo; o vínculo fica na conta certa", [rRoubo.resultado, rRoubo.motivo.includes("já está ligada a outra conta"), instalacaoSql("53852")!.franchiseeId], ["erro", true, "loja-a"]);
  aq.falhas["POST /api/v2/store/70000/webhooks"] = [500];
  const rB = await conectar(["70000"], "dono-b@teste");
  await ate(() => !!instalacaoSql("70000")?.webhooksErro);
  const gB = await integracoes("GET", undefined, "dono-b@teste");
  confere("falha no cadastro dos webhooks NÃO impede a conexão; a tela mostra", [rB.resultado, gB.corpo.lojas.map((l: any) => [l.storeId, l.webhooksOk, !!l.webhooksErro])], ["ok", [["70000", false, true]]]);
  const wRetry = await integracoes("POST", { acao: "webhooks", storeId: "70000" }, "dono-b@teste");
  confere("'tentar de novo' cadastra os webhooks", [wRetry.corpo.ok, (await integracoes("GET", undefined, "dono-b@teste")).corpo.lojas[0].webhooksOk, (aq.webhooks.get("70000") || []).length], [true, true, 4]);
  const g1 = await integracoes("GET");
  confere("GET lista as duas lojas da conta, ok, webhooks ok, sem pedido ainda", g1.corpo.lojas.map((l: any) => [l.storeId, l.nome, l.estado, l.webhooksOk, l.ultimoPedidoEm]), [["53852", "Pizzaria A Centro", "ok", true, null], ["53853", "Pizzaria A Bairro", "ok", true, null]]);

  // ── 2. Webhook ──────────────────────────────────────────────────────────────
  console.log("\n── Webhook ──");
  await sleep(5);
  novoPedido("53852", 1001);
  const antesErrado = aq.chamadas.length;
  const wErrado = await webhook("new-order", "53852", 1001, { segredo: "segredo-errado" });
  const wSem = await webhook("new-order", "53852", 1001, { segredo: null });
  await sleep(100);
  confere("segredo errado ou ausente: 200 mesmo assim, nada processado, aviso", [wErrado.status, wSem.status, wErrado.corpo.ignorado, aq.chamadas.length - antesErrado, !!noFireHub("53852", 1001), alertas.some((a) => a.includes("segredo do webhook"))], [200, 200, "segredo", 0, false, true]);
  aq.atraso.set("1001", 1500);
  let ev = eventosProcessados();
  const w1 = await webhook("new-order", "53852", 1001, { dados: { created_at: aq.pedidos.get("1001")!.created_at } });
  confere("segredo certo: 200 antes de buscar o pedido (resposta em < 1 s com a API lenta)", [w1.status, w1.ms < 1000], [200, true]);
  await processou(ev);
  aq.atraso.delete("1001");
  const p1001 = noFireHub("53852", 1001);
  confere("pedido gravado na conta da loja, canal, número e tipo", [p1001?.franchiseeId, p1001?.source, p1001?.openDeliveryReference, p1001?.deliveryType, p1001?.totalAmount], ["loja-a", "AIQFOME", "1001", "DELIVERY", 26]);
  confere("aceite automático: ACEITO aqui e LIDO lá (mark-as-read)", [p1001?.status, aq.pedidos.get("1001")?.is_read], ["ACEITO", true]);
  confere("foi para a impressão; payload cru guardado", [impressos.includes(p1001?.id), payloads.some((p) => p.canal === "AIQFOME" && p.tipo === "pedido" && p.idNoParceiro === "aiqfome_53852_1001")], [true, true]);
  const antesRep = aq.chamadas.length;
  const wRep = await webhook("new-order", "53852", 1001, { dados: { created_at: aq.pedidos.get("1001")!.created_at } });
  await sleep(100);
  confere("o mesmo aviso de novo (retentativa): 200, repetido, nada buscado", [wRep.status, wRep.corpo.repetido, aq.chamadas.length - antesRep], [200, true, 0]);
  ev = eventosProcessados();
  const antesEco = aq.chamadas.length;
  await webhook("read-order", "53852", 1001, { dados: { read_at: horaLocal(Date.now()) } });
  await processou(ev);
  confere("eco do nosso aceite (read-order): sem mudança, sem gastar chamada", [aq.chamadas.length - antesEco, noFireHub("53852", 1001)?.status], [0, "ACEITO"]);
  confere("o webhook ficou registrado na instalação", !!instalacaoSql("53852")!.ultimoWebhookEm, true);
  ev = eventosProcessados();
  const antesOutra = aq.chamadas.length;
  await webhook("new-order", "99999", 5);
  await processou(ev);
  confere("aviso de loja que não está ligada: ignorado, nada buscado", [aq.chamadas.length - antesOutra, db.customerOrder.some((o) => String(o.openDeliveryOrderId).startsWith("aiqfome_99999_"))], [0, false]);
  // Pedido que o token da loja 53852 lê, mas que diz ser de outra loja (bug de lá).
  novoPedido("53852", 1002, { store: { id: 70000, name: "Loja do Dono B" }, _servir: "53852" });
  ev = eventosProcessados();
  const alertasAntesDoRecusado = alertas.length;
  await webhook("new-order", "53852", 1002);
  await processou(ev);
  confere("pedido que diz ser de outra loja que a do token: não grava e avisa", [!!noFireHub("53852", 1002), !!noFireHub("70000", 1002), alertas.slice(alertasAntesDoRecusado).some((a) => a.includes("1002"))], [false, false, true]);
  aq.pedidos.delete("1002");

  // ── 3. Polling ──────────────────────────────────────────────────────────────
  console.log("\n── Polling ──");
  aq.pedidos.delete("1002");
  novoPedido("53853", 2001);
  const ciclo1 = await cron();
  const p2001 = noFireHub("53853", 2001);
  confere("o polling acha o pedido que o webhook não trouxe (na loja certa)", [ciclo1.ok, p2001?.franchiseeId, p2001?.status, aq.pedidos.get("2001")?.is_read], [true, "loja-a", "ACEITO", true]);
  confere("o polling mandou o User-Agent do FireHub em toda chamada à API", aq.chamadas.filter((c) => c.caminho.startsWith("/api/v2")).every((c) => c.ua === UA), true);
  const pedidosAntes = db.customerOrder.length;
  const antesCiclo = aq.chamadas.length;
  await cron();
  confere("polling de novo: nenhum pedido a mais, e não busca pedido que já está aqui", [db.customerOrder.length - pedidosAntes, chamadasDesde(antesCiclo).filter((c) => /\/orders\/\d+$/.test(c.caminho)).length], [0, 0]);

  // ── 4. Filtros ──────────────────────────────────────────────────────────────
  console.log("\n── O que não entra ──");
  novoPedido("53852", 3001, {}, 2 * 3600e3); // feito 2 h antes da conexão
  novoPedido("53852", 3002, { is_read: true, is_ready: true });
  novoPedido("53852", 3003, { is_cancelled: true });
  const alertasAntes = alertas.length;
  await cron();
  confere("pedido de antes da conexão, já pronto lá e cancelado: não gravam", [3001, 3002, 3003].map((id) => !!noFireHub("53852", id)), [false, false, false]);
  confere("o já pronto avisa (o FireHub perdeu o começo) e guarda o payload cru", [alertas.slice(alertasAntes).some((a) => a.includes("#3002") && a.includes("pronto")), payloads.some((p) => p.idNoParceiro === "aiqfome_53852_3002")], [true, true]);
  confere("e o de antes da conexão nem é buscado", aq.chamadas.some((c) => c.caminho === "/api/v2/orders/3001"), false);
  const inst52 = (await instalacaoAtiva("53852"))!;
  instalacaoSql("53852")!.importarDesde = new Date(Date.now() - 3 * 3600e3);
  novoPedido("53852", 3004, {}, 20 * 60e3); // 20 min atrás, depois do importarDesde
  await cron();
  confere("aceite automático só de pedido recente: o de 20 min entra ACEITO, mas não é aceito em massa lá", [noFireHub("53852", 3004)?.status, aq.pedidos.get("3004")?.is_read], ["ACEITO", false]);
  confere("o de antes da conexão, com o importarDesde para trás, entra — e também não é aceito lá", [!!noFireHub("53852", 3001), aq.pedidos.get("3001")?.is_read], [true, false]);
  instalacaoSql("53852")!.importarDesde = inst52.importarDesde;

  // ── 5. Status de lá → aqui ──────────────────────────────────────────────────
  console.log("\n── Status do aiqfome no FireHub ──");
  ev = eventosProcessados();
  aq.pedidos.get("2001")!.is_ready = true;
  await webhook("ready-order", "53853", 2001, { dados: { ready_at: horaLocal(Date.now()) } });
  await processou(ev);
  confere("ready-order: PRONTO aqui, sem buscar nada", noFireHub("53853", 2001)?.status, "PRONTO");
  ev = eventosProcessados();
  aq.pedidos.get("1001")!.is_cancelled = true;
  await webhook("cancel-order", "53852", 1001, { dados: { canceled_at: horaLocal(Date.now()), reason: "Cliente solicitou cancelamento" } });
  await processou(ev);
  await sleep(30);
  const cancelado = noFireHub("53852", 1001)!;
  confere("cancel-order: CANCELADO aqui, com o motivo e a culpa no aiqfome", [cancelado.status, cancelado.cancelledBy, cancelado.cancelReason], ["CANCELADO", "AIQFOME", "Cliente solicitou cancelamento"]);
  confere("aviso de NFC-e já emitida disparado", notasAlertadas.some((n) => n.onde?.id === cancelado.id && n.canal === "aiqfome"), true);
  novoPedido("53852", 3005);
  await cron();
  aq.pedidos.get("3005")!.is_cancelled = true;
  aq.cancelados.push({ order_id: 3005, store_id: 53852, cancelled_at: horaLocal(Date.now()), reason: "Loja não aceitou em 10 minutos", cancelled_by: "aiqfome" });
  await sleep(60); // o intervalo dos cancelados é por loja; o teste encurta o relógio abaixo
  const { pollingDaInstalacao } = await import("../src/lib/aiqfome/eventos");
  // Força a consulta dos cancelados agora (o ciclo normal faz a cada 60 s).
  const esperaReal = Date.now;
  Date.now = () => esperaReal() + 120_000;
  await pollingDaInstalacao((await instalacaoAtiva("53852"))!, () => true);
  Date.now = esperaReal;
  const c3005 = noFireHub("53852", 3005)!;
  confere("cancelado pela lista de cancelados (polling): CANCELADO com motivo e quem cancelou", [c3005.status, c3005.cancelReason, String(c3005.notes).includes("(por aiqfome)")], ["CANCELADO", "Loja não aceitou em 10 minutos", true]);
  const p2001b = noFireHub("53853", 2001)!;
  p2001b.status = "ENTREGUE";
  await webhook("read-order", "53853", 2001, { dados: { read_at: "atrasado" } });
  await sleep(100);
  confere("aviso atrasado não volta o pedido (só avança)", noFireHub("53853", 2001)?.status, "ENTREGUE");

  // ── 6. A escada daqui → lá (loja que aceita na mão) ─────────────────────────
  console.log("\n── Escada de status (FireHub → aiqfome) ──");
  db.user.find((u) => u.id === "loja-a")!.autoAcceptOrders = false;
  novoPedido("53852", 4001);
  novoPedido("53852", 4002, retiradaExtra);
  novoPedido("53852", 4003, { is_aiqentrega_delivery: true });
  novoPedido("53852", 4004);
  await cron();
  confere("sem aceite automático: NOVO aqui e não lido lá", [4001, 4002, 4003, 4004].map((id) => [noFireHub("53852", id)?.status, aq.pedidos.get(String(id))?.is_read]), Array(4).fill(["NOVO", false]));
  confere("a comanda avisa dos 10 minutos", String(noFireHub("53852", 4001)?.notes).includes("⏰ Aceite em até 10 min"), true);
  const subir = async (id: number, para: string) => {
    const p = noFireHub("53852", id)!;
    const desde = aq.chamadas.length;
    const r = await sincronizarAiqfome({ openDeliveryOrderId: p.openDeliveryOrderId, franchiseeId: p.franchiseeId, status: p.status, deliveryBy: p.deliveryBy, deliveryType: p.deliveryType, notes: p.notes }, para);
    if (r.ok) p.status = para;
    return { r, acoes: acoesDo(id, desde) };
  };
  confere("NOVO → ACEITO: mark-as-read", (await subir(4001, "ACEITO")).acoes, ["mark-as-read"]);
  confere("ACEITO → PRONTO: mark-as-ready", (await subir(4001, "PRONTO")).acoes, ["mark-as-ready"]);
  confere("PRONTO → SAIU_ENTREGA: nada (a V2 não tem despachar)", (await subir(4001, "SAIU_ENTREGA")).acoes, []);
  const e4 = await subir(4001, "ENTREGUE");
  confere("SAIU_ENTREGA → ENTREGUE: mark-as-delivered", [e4.acoes, aq.pedidos.get("4001")?.is_delivered, e4.r.ok], [["mark-as-delivered"], true, true]);
  confere("retirada NOVO → ENTREGUE de uma vez: os três passos na ordem", (await subir(4002, "ENTREGUE")).acoes, ["mark-as-read", "mark-as-ready", "mark-as-delivered"]);
  const a3 = await subir(4003, "ENTREGUE");
  confere("aiqentrega: lido e pronto, mas o entregue é do motoboy do aiqfome", [a3.acoes, noFireHub("53852", 4003)?.deliveryBy], [["mark-as-read", "mark-as-ready"], "LOGISTICS"]);
  const x4 = await subir(4004, "CANCELADO");
  confere("CANCELADO: nada é chamado, e volta o aviso de cancelar no Geraldo", [x4.acoes, x4.r.aviso?.includes("Geraldo"), aq.pedidos.get("4004")?.is_cancelled], [[], true, false]);
  aq.pedidos.get("4001")!.is_ready = true;
  const instA = (await instalacaoAtiva("53852"))!;
  const tolerado = await api.acaoNoPedidoAQ(instA, "mark-as-ready", "4001");
  confere("recusa 4xx com o sinal já lá (relido): conta como 'já estava', não repete", [tolerado.ok, tolerado.jaEstava], [true, true]);
  aq.pedidos.get("4004")!.is_cancelled = true;
  const recusa = await api.acaoNoPedidoAQ(instA, "mark-as-ready", "4004");
  confere("recusa 4xx de verdade (outro motivo): falha sem 'repetir'", [recusa.ok, recusa.repetir], [false, false]);
  confere(
    "passos da escada (puro)",
    [
      passosDaEscada({ alvo: "ENTREGUE", sinais: { lido: false, pronto: false, entregue: false }, entregaDaLoja: true }),
      passosDaEscada({ alvo: "PREPARANDO", sinais: { lido: false, pronto: false, entregue: false }, entregaDaLoja: true }),
      passosDaEscada({ alvo: "PRONTO", sinais: { lido: true, pronto: false, entregue: false, cancelado: true }, entregaDaLoja: true }),
      passosDaEscada({ alvo: "ENTREGUE", sinais: { lido: true, pronto: true, entregue: false }, entregaDaLoja: false }),
    ],
    [["mark-as-read", "mark-as-ready", "mark-as-delivered"], ["mark-as-read"], [], []],
  );

  // ── 7. 429 vira fila, na ordem ──────────────────────────────────────────────
  console.log("\n── 429 → ações pendentes ──");
  novoPedido("53852", 5001);
  await cron();
  await subir(5001, "ACEITO");
  aq.falhas["POST /api/v2/orders/mark-as-ready"] = [429];
  const f1 = await subir(5001, "PRONTO");
  const fila = () => sqlTabelas.AcaoPendenteAiqfome.filter((a) => a.pedidoId === "aiqfome_53852_5001" && !a.resolvidaEm).sort((a, b) => a.ordem - b.ordem).map((a) => a.acao);
  confere("mark-as-ready com 429: erro na resposta e na fila", [f1.r.ok, f1.r.pendentes, fila(), aq.pedidos.get("5001")?.is_ready], [false, ["mark-as-ready"], ["mark-as-ready"], false]);
  noFireHub("53852", 5001)!.status = "PRONTO";
  const f2 = await subir(5001, "ENTREGUE");
  confere("com aviso na fila, o novo entra ATRÁS (sem chamar o aiqfome)", [f2.acoes, f2.r.pendentes, fila()], [[], ["mark-as-delivered"], ["mark-as-ready", "mark-as-delivered"]]);
  const desdeFila = aq.chamadas.length;
  await cron();
  confere("o polling repete a fila na ordem e o pedido fecha lá", [acoesDo(5001, desdeFila), aq.pedidos.get("5001")?.is_delivered], [["mark-as-ready", "mark-as-delivered"], true]);
  confere("fila resolvida", fila(), []);
  // Duas falhas: a do aceite e a da repetição no fim do mesmo ciclo.
  aq.falhas["POST /api/v2/orders/mark-as-read"] = [503, 503];
  db.user.find((u) => u.id === "loja-a")!.autoAcceptOrders = true;
  novoPedido("53852", 5002);
  await cron();
  confere("aceite automático com 503: o pedido fica na cozinha, o aceite na fila", [noFireHub("53852", 5002)?.status, sqlTabelas.AcaoPendenteAiqfome.some((a) => a.pedidoId === "aiqfome_53852_5002" && a.acao === "mark-as-read" && !a.resolvidaEm)], ["ACEITO", true]);
  await cron();
  confere("…e o ciclo seguinte aceita lá", aq.pedidos.get("5002")?.is_read, true);

  // ── 8. Token ────────────────────────────────────────────────────────────────
  console.log("\n── Token (trava por credencial) ──");
  for (const s of ["53852", "53853"]) instalacaoSql(s)!.tokenExpiraEm = new Date(Date.now() + 60_000); // vence em 1 min (< 5 min)
  const renovacoesAntes = aq.renovacoes;
  const i53a = (await instalacaoAtiva("53853"))!;
  const [b1, b2, b3] = await Promise.all([api.buscarPedidoAQ(instA, "4001"), api.buscarPedidoAQ(i53a, "2001"), api.buscarPedidoAQ(instA, "4002")]);
  confere("perto de vencer: UMA renovação para três chamadas de DUAS lojas da mesma credencial", [aq.renovacoes - renovacoesAntes, b1.ok && b2.ok && b3.ok], [1, true]);
  const novo52 = decifrar(instalacaoSql("53852")!.accessToken)!;
  confere(
    "o par novo vai para as duas lojas (o refresh girou)",
    [novo52 === decifrar(instalacaoSql("53853")!.accessToken), aq.acessos.has(novo52), aq.refreshes.has(decifrar(instalacaoSql("53853")!.refreshToken)!)],
    [true, true, true],
  );
  aq.acessos.delete(novo52); // revogado lá, mas ainda "válido" pelo relógio daqui
  const r401 = await api.buscarPedidoAQ(instA, "4001");
  confere("401 com token no prazo: renova e repete UMA vez", [r401.ok, aq.renovacoes - renovacoesAntes], [true, 2]);

  // ── 9. Nunca o JotaJá ───────────────────────────────────────────────────────
  console.log("\n── Pedido do aiqfome nunca chama a API do JotaJá ──");
  db.user.find((u) => u.id === "loja-a")!.autoAcceptOrders = false;
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const mudar = async (id: string, status: string, extra: Linha = {}) => {
    sessao = "dono-a@teste";
    const res = await PUT(new Request("http://teste/api/customer-order/status", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id, status, ...extra }) }) as any);
    return { status: res.status, corpo: await res.json() };
  };
  for (const id of [6001, 6002, 6003, 6004]) novoPedido("53852", id, id === 6004 ? retiradaExtra : {});
  await cron();
  const p6001 = noFireHub("53852", 6001)!;
  const desde6001 = aq.chamadas.length;
  const s = [await mudar(p6001.id, "ACEITO"), await mudar(p6001.id, "PRONTO"), await mudar(p6001.id, "SAIU_ENTREGA"), await mudar(p6001.id, "ENTREGUE")];
  confere("rota de status: cada clique do painel vira a ação certa lá", [s.map((x) => [x.status, x.corpo.avisoAiqfome]), acoesDo(6001, desde6001)], [
    [[200, null], [200, null], [200, null], [200, null]],
    ["mark-as-read", "mark-as-ready", "mark-as-delivered"],
  ]);
  const p6002 = noFireHub("53852", 6002)!;
  const desde6002 = aq.chamadas.length;
  const s5 = await mudar(p6002.id, "CANCELADO", { motivo: "Cliente pediu" });
  confere(
    "rota de status: cancelar não chama nada, quem cancelou é a loja, e a tela recebe o aviso do Geraldo",
    [s5.status, chamadasDesde(desde6002).length, noFireHub("53852", 6002)?.status, noFireHub("53852", 6002)?.cancelledBy, String(s5.corpo.avisoAiqfome).includes("Geraldo")],
    [200, 0, "CANCELADO", "LOJA", true],
  );
  const p6003 = noFireHub("53852", 6003)!;
  const { POST: despachar } = await import("../src/app/api/motoboys/dispatch-whatsapp/route");
  sessao = "dono-a@teste";
  const d1 = await despachar(new Request("http://teste/api/motoboys/dispatch-whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motoboyPhone: "22998887766", routeText: "rota", orderIds: [p6003.id] }) }) as any);
  await ate(() => aq.pedidos.get("6003")?.is_ready === true);
  confere("despacho pelo WhatsApp: lido + pronto lá", [d1.status, aq.pedidos.get("6003")?.is_read, aq.pedidos.get("6003")?.is_ready], [200, true, true]);
  const p6004 = noFireHub("53852", 6004)!;
  const { sincronizarPedidoNasPlataformas } = await import("../src/lib/despacho-da-rota");
  await sincronizarPedidoNasPlataformas({ ...p6004, status: "NOVO", ifoodOrderId: null, ifoodReference: null, ifoodStoreMerchant: null, motoboyId: null } as any, { id: "m1", name: "Moto", phone: null }, "loja-a");
  confere("roteirização: lido + pronto lá", [aq.pedidos.get("6004")?.is_read, aq.pedidos.get("6004")?.is_ready], [true, true]);
  confere("NENHUMA chamada à API do JotaJá em tudo isso", jotaja, []);
  const fonte = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  const antesDoJotaja = (rel: string, marcaDoJotaja: string) => {
    const f = fonte(rel);
    const a = f.indexOf("ehPedidoAiqfome(");
    const j = f.indexOf(marcaDoJotaja);
    return a > 0 && j > 0 && a < j;
  };
  confere(
    "o aiqfome entra ANTES do 'senão é JotaJá' nos 6 pontos, e é excluído do ramo",
    [
      antesDoJotaja("src/app/api/customer-order/status/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/app/api/kds/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/app/api/motoboys/orders/route.ts", 'await import("@/lib/jotaja-api")'),
      fonte("src/app/api/motoboys/orders/route.ts").split("ehPedidoAiqfome(").length - 1 >= 2,
      antesDoJotaja("src/app/api/motoboys/dispatch-whatsapp/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/lib/despacho-da-rota.ts", 'await import("@/lib/jotaja-api")'),
      /!ehPedidoCardapioWeb\(order\) && !ehPedidoAiqfome\(order\)(?: && !ehPedido\w+\(order\))*\)/.test(fonte("src/app/api/customer-order/status/route.ts")),
      /!ehPedidoCardapioWeb\(ord\) && !ehPedidoAiqfome\(ord\)(?: && !ehPedido\w+\(ord\))*\)/.test(fonte("src/lib/despacho-da-rota.ts")),
    ],
    [true, true, true, true, true, true, true, true],
  );
  confere("ehPedidoAiqfome reconhece pelo canal ou pelo id, nunca pedido de outro canal", [
    ehPedidoAiqfome({ source: "AIQFOME", openDeliveryOrderId: "aiqfome_1_2" }),
    ehPedidoAiqfome({ openDeliveryOrderId: "aiqfome_1_2" }),
    ehPedidoAiqfome({ source: "CARDAPIOWEB", openDeliveryChannel: "CARDAPIOWEB", openDeliveryOrderId: "cardapioweb_1_2" }),
    ehPedidoAiqfome({ openDeliveryOrderId: "uuid-do-jotaja" }),
    ehPedidoAiqfome({ source: "AIQFOME" }),
  ], [true, true, false, false, false]);

  // ── 10. Refresh recusado → reconectar ───────────────────────────────────────
  console.log("\n── Token recusado de vez ──");
  const t52 = { a: decifrar(instalacaoSql("53852")!.accessToken)!, r: decifrar(instalacaoSql("53852")!.refreshToken)! };
  aq.acessos.delete(t52.a);
  aq.refreshes.delete(t52.r);
  const alertasAntes2 = alertas.length;
  const morto = await api.buscarPedidoAQ((await instalacaoAtiva("53852"))!, "4001");
  await sleep(50);
  const g3 = await integracoes("GET");
  confere(
    "refresh recusado: falha, as DUAS lojas da credencial viram 'reconectar' e o Douglas é avisado",
    [morto.ok, g3.corpo.lojas.map((l: any) => l.estado), alertas.length > alertasAntes2],
    [false, ["reconectar", "reconectar"], true],
  );
  const ciclo = await cron();
  confere("o polling deixa a loja sem token de fora (não bate 30 s em 401)", (ciclo.log as string[]).filter((l) => l.includes("precisa reconectar")).length, 2);
  const rRecon = await conectar(["53852", "53853"]);
  await sleep(50);
  confere("reconectar volta ao normal, sem cadastrar os webhooks de novo", [rRecon.resultado, (await integracoes("GET")).corpo.lojas.map((l: any) => l.estado), (aq.webhooks.get("53852") || []).length], ["ok", ["ok", "ok"], 4]);

  // ── 11. Desconectar ─────────────────────────────────────────────────────────
  console.log("\n── Desconectar ──");
  const dc = await integracoes("POST", { acao: "desconectar", storeId: "53853" });
  confere("desconectar: ok, tokens apagados", [dc.corpo, instalacaoSql("53853")!.ativa, instalacaoSql("53853")!.accessToken], [{ ok: true }, false, null]);
  confere("a tela mostra só a loja que ficou", (await integracoes("GET")).corpo.lojas.map((l: any) => l.storeId), ["53852"]);
  novoPedido("53853", 8001);
  ev = eventosProcessados();
  const antesDesl = aq.chamadas.length;
  const wDesl = await webhook("new-order", "53853", 8001);
  await processou(ev);
  confere("aviso de loja desligada: 200, ignorado, nenhuma chamada lá", [wDesl.status, aq.chamadas.length - antesDesl, !!noFireHub("53853", 8001)], [200, 0, false]);
  confere("desconectar loja que não é desta conta: 404", (await integracoes("POST", { acao: "desconectar", storeId: "70000" })).status, 404);

  // ── 12. Bloqueio e canal desligado ──────────────────────────────────────────
  console.log("\n── Loja bloqueada e servidor sem credencial ──");
  bloqueadas.add("loja-a");
  novoPedido("53852", 9001);
  ev = eventosProcessados();
  const wBloq = await webhook("new-order", "53852", 9001);
  await processou(ev);
  const cBloq = await cron();
  confere("loja bloqueada por mensalidade: 200 e não grava (nem pelo polling)", [wBloq.status, !!noFireHub("53852", 9001), (cBloq.log as string[]).some((l) => l.includes("bloqueada"))], [200, false, true]);
  bloqueadas.delete("loja-a");
  for (const k of Object.keys(ENV_AIQFOME)) delete process.env[k];
  const antesOff = aq.chamadas.length;
  const gOff = await integracoes("GET");
  const cOff = await integracoes("POST", { acao: "conectar" });
  const wOff = await webhook("new-order", "53852", 9001);
  const cronOff = await cron();
  const sOff = await sincronizarAiqfome({ openDeliveryOrderId: "aiqfome_53852_6001", franchiseeId: "loja-a", status: "NOVO" }, "ACEITO");
  confere(
    "sem as variáveis: tela 'não configurada', conectar 503, webhook 200 ignorado, cron desligado, nada chama o aiqfome",
    [gOff.corpo.configurada, cOff.status, wOff.status, wOff.corpo.ignorado, cronOff.desligada, sOff.ignorado, aq.chamadas.length - antesOff],
    [false, 503, 200, "desligado", true, true, 0],
  );

  confere("nenhuma chamada a host fora do aiqfome falso", hostsInesperados, []);
  confere("nenhuma chamada à API do JotaJá no teste inteiro", jotaja, []);

  servidor.close();
  console.log(falhas === 0 ? `\nTudo certo (${total} conferências).` : `\n${falhas} falha(s) de ${total}.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
