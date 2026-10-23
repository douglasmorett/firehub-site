/**
 * scripts/teste-cardapioweb-fluxo.ts — o caminho inteiro do CardápioWeb, sem banco e sem rede.
 *
 *   npx tsx scripts/teste-cardapioweb-fluxo.ts
 *
 * Banco em memória (o jeito de scripts/teste-keeta-fluxo.ts e, para o SQL cru
 * das tabelas criadas no 1º uso, de scripts/teste-stone-connect.ts) e um
 * CardápioWeb FALSO no `fetch`: o portal que emite o `code`, o /oauth/token que
 * confere o PKCE S256 de verdade e GIRA o refresh_token, a API de pedidos com a
 * máquina de status (4002/4003 como a doc) e o 429 quando o teste manda. Cada
 * caso é um furo de outro canal:
 *
 *   - conexão só pela loja da sessão, com state opaco de uso único (99Food);
 *   - loja do pedido só pela instalação ativa (JotaJá/iFood/Brendi);
 *   - webhook responde 200 SEMPRE e rápido (o CardápioWeb pausa o webhook);
 *   - mesmo aviso duas vezes = um pedido (webhook + polling);
 *   - o polling acha o que o webhook perdeu, e a tela vê o webhook mudo;
 *   - marketplace repassado, mesa e pagamento pendente não entram;
 *   - status só avança; cancelado cancela;
 *   - a escada de status sobe na ordem, e o 429 vira fila na ordem (dispatch do iFood);
 *   - token renovado com trava, 401 renova e repete uma vez;
 *   - pedido do CardápioWeb NUNCA chama a API do JotaJá (o "senão é JotaJá").
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TOKEN_PROD = "token-do-webhook-producao";
const TOKEN_SB = "token-do-webhook-sandbox";
Object.assign(process.env, {
  NODE_ENV: "development",
  NEXTAUTH_URL: "https://firehubfood.com.br",
  CARDAPIOWEB_CLIENT_ID: "cliente-prod",
  CARDAPIOWEB_WEBHOOK_TOKEN: TOKEN_PROD,
  CARDAPIOWEB_SANDBOX_CLIENT_ID: "cliente-sb",
  CARDAPIOWEB_SANDBOX_WEBHOOK_TOKEN: TOKEN_SB,
});
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

// ── Banco em memória: o SQL cru das tabelas do CardápioWeb ──────────────────
const sqlTabelas: Record<string, Linha[]> = { CardapioWebInstalacao: [], CardapioWebConta: [], CardapioWebEstadoOAuth: [], AcaoPendenteCardapioWeb: [], CardapioWebEvento: [] };
const sequencia: Record<string, number> = { CardapioWebInstalacao: 0, AcaoPendenteCardapioWeb: 0 };
let tique = 0;
const PADROES: Record<string, () => Linha> = {
  CardapioWebInstalacao: () => ({
    nome: null, accessToken: null, refreshToken: null, tokenExpiraEm: null, escopos: null, estado: "ok", motivoDoEstado: null, ativa: true,
    conectadaEm: new Date(), conectadaPor: null, desligadaEm: null, cwUserId: null, cwUserEmail: null, importarDesde: new Date(),
    cursorDoPolling: null, ultimoPedidoEm: null, ultimoWebhookEm: null, ultimoSoPeloPollingEm: null,
  }),
  CardapioWebConta: () => ({ receberMarketplaces: false, atualizadaEm: new Date(), atualizadaPor: null }),
  CardapioWebEstadoOAuth: () => ({ criadoPor: null, criadoEm: new Date(), usadoEm: null }),
  AcaoPendenteCardapioWeb: () => ({ corpo: null, ultimoErro: null, tentativas: 0, criadaEm: new Date(), ordem: ++tique, resolvidaEm: null }),
  CardapioWebEvento: () => ({ eventType: null, orderStatus: null, recebidoEm: new Date(), processadoEm: null, tentativas: 0, resultado: null }),
};
const UNICOS: Record<string, string[][]> = {
  CardapioWebInstalacao: [["id"], ["ambiente", "companyId"]],
  CardapioWebConta: [["franchiseeId"]],
  CardapioWebEstadoOAuth: [["stateHash"]],
  AcaoPendenteCardapioWeb: [["id"], ["pedidoId", "acao"]],
  CardapioWebEvento: [["eventId"]],
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
  { id: "loja-a", email: "dono-a@teste", role: "FRANQUEADO", ownerId: null, name: "Dono A", storeName: "Frangoso", autoAcceptOrders: true, permissions: null },
  { id: "loja-b", email: "dono-b@teste", role: "FRANQUEADO", ownerId: null, name: "Dono B", storeName: "Outra Loja", autoAcceptOrders: false, permissions: null },
  { id: "func-a", email: "func-a@teste", role: "STAFF", ownerId: "loja-a", name: "Caixa", storeName: null, autoAcceptOrders: false, permissions: "orders,kds" },
);

// ── CardápioWeb falso ────────────────────────────────────────────────────────
type Amb = "producao" | "sandbox";
const AMB_DO_HOST: Record<string, Amb> = { "integracao.cardapioweb.com": "producao", "integracao.sandbox.cardapioweb.com": "sandbox" };
const CLIENTE: Record<Amb, string> = { producao: "cliente-prod", sandbox: "cliente-sb" };
const cw = {
  codigos: new Map<string, { ambiente: Amb; companyId: string; desafio: string; redirectUri: string; clientId: string; usado: boolean }>(),
  acessos: new Map<string, { ambiente: Amb; companyId: string; venceEm: number }>(),
  refreshes: new Map<string, { ambiente: Amb; companyId: string }>(),
  lojas: new Map<string, string>(),
  pedidos: new Map<string, Linha>(),
  chamadas: [] as Array<{ metodo: string; caminho: string; ambiente: Amb; corpo?: any }>,
  renovacoes: 0,
  revogados: [] as string[],
  falhas: {} as Record<string, number[]>,
  atraso: new Map<string, number>(),
  hostsInesperados: [] as string[],
  seq: 0,
};
const pkce = (v: string) => createHash("sha256").update(v).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function emitirTokens(ambiente: Amb, companyId: string) {
  const n = ++cw.seq;
  cw.acessos.set(`at-${n}`, { ambiente, companyId, venceEm: Date.now() + 7200e3 });
  cw.refreshes.set(`rt-${n}`, { ambiente, companyId });
  return { access_token: `at-${n}`, token_type: "Bearer", expires_in: 7200, refresh_token: `rt-${n}`, scope: "auth orders" };
}
const resposta = (status: number, corpo?: unknown) => new Response(corpo === undefined || status === 204 ? null : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const semInterno = (p: Linha) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("_")));

function transicao(p: Linha, acao: string, corpo: string | undefined): Response {
  const s = p.status;
  const retirada = p.order_type !== "delivery";
  const agendado = p.order_timing === "scheduled";
  const vai = (novo: string) => {
    p.status = novo;
    p.updated_at = new Date().toISOString();
    return resposta(204);
  };
  const recusa = (code: number) => resposta(400, { code, message: code === 4002 ? "Não foi possível alterar o status do pedido" : "Essa transição de status não é permitida para esse pedido.", details: `${acao} em ${s}` });
  if (s === "closed" || s === "canceled") return recusa(4002);
  switch (acao) {
    case "confirm": return s === "waiting_confirmation" ? vai(agendado ? "scheduled_confirmed" : "confirmed") : recusa(4003);
    case "start_preparation": return s === "scheduled_confirmed" ? vai("confirmed") : recusa(4003);
    case "prepared": return s === "confirmed" ? vai("ready") : recusa(4003);
    case "dispatch": return s === "ready" ? vai(retirada ? "waiting_to_catch" : "released") : recusa(4003);
    case "delivered": return s === "released" && !retirada ? vai("delivered") : recusa(4003);
    case "finalize": return ["delivered", "waiting_to_catch", "released", "ready", "confirmed"].includes(s) ? vai("closed") : recusa(4003);
    case "cancel":
      p.cancellation_reason = JSON.parse(corpo || "{}").cancellation_reason ?? null;
      return vai("canceled");
  }
  return resposta(404, { code: 4040, message: "ação desconhecida" });
}

(globalThis as any).fetch = async (entrada: any, init: any = {}) => {
  const url = new URL(String(entrada));
  const ambiente = AMB_DO_HOST[url.host];
  const metodo = String(init.method || "GET").toUpperCase();
  if (!ambiente) {
    cw.hostsInesperados.push(url.host);
    return resposta(599, { erro: `host inesperado ${url.host}` });
  }
  cw.chamadas.push({ metodo, caminho: url.pathname + url.search, ambiente, corpo: init.body && !String(init.body).includes("=") ? JSON.parse(init.body) : undefined });

  if (url.pathname === "/api/partner/oauth/token") {
    const f = new URLSearchParams(String(init.body || ""));
    if (f.get("client_id") !== CLIENTE[ambiente]) return resposta(401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      const c = cw.codigos.get(f.get("code") || "");
      if (!c || c.usado || c.ambiente !== ambiente) return resposta(400, { error: "invalid_grant", error_description: "código inválido" });
      if (f.get("redirect_uri") !== c.redirectUri) return resposta(400, { error: "invalid_grant", error_description: "redirect_uri diferente" });
      if (pkce(f.get("code_verifier") || "") !== c.desafio) return resposta(400, { error: "invalid_grant", error_description: "PKCE inválido" });
      c.usado = true;
      return resposta(200, emitirTokens(ambiente, c.companyId));
    }
    if (f.get("grant_type") === "refresh_token") {
      cw.renovacoes++;
      await sleep(30); // dá tempo de outra chamada chegar durante a renovação (a trava)
      const r = cw.refreshes.get(f.get("refresh_token") || "");
      if (!r) return resposta(400, { error: "invalid_grant", error_description: "refresh_token inválido" });
      cw.refreshes.delete(f.get("refresh_token")!); // GIRA o refresh_token
      return resposta(200, emitirTokens(ambiente, r.companyId));
    }
    return resposta(400, { error: "unsupported_grant_type" });
  }
  if (url.pathname === "/api/partner/oauth/revoke") {
    cw.revogados.push(new URLSearchParams(String(init.body || "")).get("token") || "");
    return resposta(200, {});
  }

  const token = String(init.headers?.Authorization || "").replace(/^Bearer /, "");
  const acesso = cw.acessos.get(token);
  if (!acesso || acesso.venceEm < Date.now() || acesso.ambiente !== ambiente) return resposta(401, { code: 4010, message: "Token inválido." });

  if (url.pathname === "/api/partner/v1/identity/context") {
    return resposta(200, {
      user: { id: 10, name: "Dono", email: "dono@cardapioweb.teste" },
      company: { id: Number(acesso.companyId), name: cw.lojas.get(`${ambiente}:${acesso.companyId}`) || "Loja" },
      application: { id: "7", name: "FireHub" },
      scopes: ["auth", "orders"],
    });
  }
  if (url.pathname === "/api/partner/v1/orders" && metodo === "GET") {
    const desde = new Date(url.searchParams.get("updated_since") || 0).getTime();
    const lista = [...cw.pedidos.values()]
      .filter((p) => p._amb === ambiente && String(p.merchant_id) === acesso.companyId && new Date(p.updated_at).getTime() >= desde)
      .map((p) => ({ id: p.id, status: p.status, order_type: p.order_type, order_timing: p.order_timing, sales_channel: p.sales_channel, created_at: p.created_at, updated_at: p.updated_at }));
    return resposta(200, lista);
  }
  const m = url.pathname.match(/^\/api\/partner\/v1\/orders\/(\d+)(?:\/(\w+))?$/);
  if (m) {
    const p = cw.pedidos.get(`${ambiente}:${m[1]}`);
    if (!p || String(p.merchant_id) !== acesso.companyId) return resposta(404, { code: 4041, message: "Recurso não encontrado" });
    if (!m[2]) {
      const atraso = cw.atraso.get(m[1]);
      if (atraso) await sleep(atraso);
      return resposta(200, semInterno(p));
    }
    const forcada = cw.falhas[m[2]]?.shift();
    if (forcada) return resposta(forcada, forcada === 429 ? undefined : { code: 5000, message: "falha forçada" });
    return transicao(p, m[2], init.body);
  }
  return resposta(404, { code: 4040, message: "rota falsa desconhecida" });
};

// ── Fábricas e atalhos ───────────────────────────────────────────────────────
function novoPedido(ambiente: Amb, companyId: string, id: number, extra: Linha = {}): Linha {
  const agora = new Date().toISOString();
  const p: Linha = {
    _amb: ambiente,
    id,
    display_id: id % 1000,
    merchant_id: Number(companyId),
    status: "waiting_confirmation",
    order_type: "delivery",
    order_timing: "immediate",
    sales_channel: "catalog",
    delivered_by: "merchant",
    estimated_time: 40,
    observation: null,
    delivery_fee: 5,
    service_fee: 0,
    additional_fee: 0,
    total: 35,
    created_at: agora,
    updated_at: agora,
    schedule: null,
    customer: { id: 9, name: "Ana", phone: "22999998888", ddi: "55" },
    delivery_address: { street: "Rua das Flores", number: "120", neighborhood: "Centro", complement: "", reference: null, city: "Rio das Ostras", state: "RJ", latitude: "-22.520318", longitude: "-41.944127" },
    items: [{ item_id: 1, name: "X-Salada", quantity: 1, unit_price: 30, total_price: 30, kind: "regular_item", status: "waiting", options: [], items: [] }],
    discounts: [],
    payments: [{ total: 35, payment_type: "online", status: "paid", payment_method: "pix_auto", payment_fee: 0 }],
    ...extra,
  };
  cw.pedidos.set(`${ambiente}:${id}`, p);
  return p;
}
const retiradaExtra = { order_type: "takeout", delivery_fee: 0, total: 30, delivery_address: null, payments: [{ total: 30, payment_type: "offline", status: "pending", payment_method: "money", change_for: 50, payment_fee: 0 }] };
const noFireHub = (ambiente: Amb, companyId: string, id: number) => db.customerOrder.find((o) => o.openDeliveryOrderId === `cardapioweb_${ambiente === "sandbox" ? "sandbox-" : ""}${companyId}_${id}`);
const chamadasA = (filtro: (c: { metodo: string; caminho: string }) => boolean) => cw.chamadas.filter(filtro).length;
const acoesDo = (orderId: number, desde: number) => cw.chamadas.slice(desde).filter((c) => c.metodo === "POST" && c.caminho.startsWith(`/api/partner/v1/orders/${orderId}/`)).map((c) => c.caminho.split("/").pop());
async function ate(cond: () => boolean, ms = 3000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
}
const eventoProcessado = (eventId: string) => () => (sqlTabelas.CardapioWebEvento.find((e) => e.eventId === eventId)?.tentativas ?? 0) >= 1;
const instalacaoSql = (ambiente: Amb, companyId: string) => sqlTabelas.CardapioWebInstalacao.find((l) => l.ambiente === ambiente && l.companyId === companyId);

async function main() {
  const rota = await import("../src/app/api/store/integracoes/cardapioweb/route");
  const rotaRetorno = await import("../src/app/api/store/integracoes/cardapioweb/retorno/route");
  const rotaWebhook = await import("../src/app/api/cardapioweb/webhook/route");
  const rotaCron = await import("../src/app/api/cron/cardapioweb-poll/route");
  const { sincronizarCardapioWeb, passosDaEscada, ehPedidoCardapioWeb } = await import("../src/lib/cardapioweb/status");
  const api = await import("../src/lib/cardapioweb/api");
  const { instalacaoAtiva } = await import("../src/lib/cardapioweb/instalacoes");
  const { decifrar } = await import("../src/lib/cofre");

  const integracoes = async (metodo: "GET" | "POST", corpo?: unknown, email = "dono-a@teste") => {
    sessao = email;
    const req = new NextRequest("https://firehubfood.com.br/api/store/integracoes/cardapioweb", {
      method: metodo,
      headers: { "content-type": "application/json", host: "firehubfood.com.br" },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const res = metodo === "GET" ? await rota.GET(req) : await rota.POST(req);
    return { status: res.status, corpo: await res.json() };
  };
  const retorno = async (query: string, email: string | null = "dono-a@teste") => {
    sessao = email;
    const res = await rotaRetorno.GET(new NextRequest(`https://firehubfood.com.br/api/store/integracoes/cardapioweb/retorno?${query}`, { headers: { host: "firehubfood.com.br" } }));
    const u = new URL(res.headers.get("location") || "https://x/");
    return { status: res.status, caminho: u.pathname, integracao: u.searchParams.get("integracao"), resultado: u.searchParams.get("cardapioweb"), motivo: u.searchParams.get("motivo") || "" };
  };
  const portalAutoriza = (urlDoPortal: string, companyId: string, nome: string) => {
    const u = new URL(urlDoPortal);
    const ambiente: Amb = u.host === "portal.cardapioweb.com" ? "producao" : "sandbox";
    cw.lojas.set(`${ambiente}:${companyId}`, nome);
    const code = `code-${++cw.seq}`;
    cw.codigos.set(code, { ambiente, companyId, desafio: u.searchParams.get("code_challenge") || "", redirectUri: u.searchParams.get("redirect_uri") || "", clientId: u.searchParams.get("client_id") || "", usado: false });
    return `code=${encodeURIComponent(code)}&state=${encodeURIComponent(u.searchParams.get("state") || "")}`;
  };
  const conectar = async (companyId: string, nome: string, email = "dono-a@teste", ambiente?: Amb) => {
    const r = await integracoes("POST", { acao: "conectar", ...(ambiente ? { ambiente } : {}) }, email);
    return retorno(portalAutoriza(r.corpo.url, companyId, nome), email);
  };
  let numeroDoEvento = 0;
  const webhook = async (ambiente: Amb, companyId: string, orderId: number, tipo = "ORDER_CREATED", opts: { token?: string; eventId?: string; status?: string } = {}) => {
    const eventId = opts.eventId || `ev-${++numeroDoEvento}`;
    const corpo = { event_id: eventId, event_type: tipo, merchant_id: Number(companyId), order_id: orderId, order_status: opts.status ?? cw.pedidos.get(`${ambiente}:${orderId}`)?.status, created_at: new Date().toISOString() };
    const t0 = Date.now();
    const res = await rotaWebhook.POST(
      new NextRequest("https://firehubfood.com.br/api/cardapioweb/webhook", {
        method: "POST",
        body: JSON.stringify(corpo),
        headers: { "content-type": "application/json", "x-webhook-token": opts.token ?? (ambiente === "sandbox" ? TOKEN_SB : TOKEN_PROD) },
      }),
    );
    return { status: res.status, ms: Date.now() - t0, corpo: await res.json(), eventId };
  };
  const cron = async () => {
    const res = await rotaCron.GET(new NextRequest("http://127.0.0.1:3000/api/cron/cardapioweb-poll", { headers: { host: "127.0.0.1:3000" } }));
    return res.json();
  };

  // ── 1. A tela antes de conectar ─────────────────────────────────────────────
  console.log("\n── Conexão (OAuth + PKCE) ──");
  const g0 = await integracoes("GET");
  confere("GET: configurada, produção por padrão, nenhuma loja, marketplaces desligado", g0.corpo, { configurada: true, ambiente: "producao", lojas: [], receberMarketplaces: false });
  const g403 = await integracoes("GET", undefined, "func-a@teste");
  confere("funcionário sem a caixinha de Integrações: 403", g403.status, 403);

  const c1 = await integracoes("POST", { acao: "conectar" });
  const u1 = new URL(c1.corpo.url);
  confere(
    "conectar devolve o /cw-apps de produção com client_id, redirect_uri exata e S256",
    [u1.origin + u1.pathname, u1.searchParams.get("client_id"), u1.searchParams.get("redirect_uri"), u1.searchParams.get("code_challenge_method")],
    ["https://portal.cardapioweb.com/cw-apps", "cliente-prod", "https://firehubfood.com.br/api/store/integracoes/cardapioweb/retorno", "S256"],
  );
  const state1 = u1.searchParams.get("state") || "";
  const linhaDoState = sqlTabelas.CardapioWebEstadoOAuth.at(-1)!;
  confere(
    "state opaco (sem a loja), guardado só o hash, verifier cifrado e preso à loja",
    [state1.length >= 40, state1.includes("loja-a"), linhaDoState.stateHash !== state1, String(linhaDoState.codeVerifier).startsWith("v1."), linhaDoState.franchiseeId],
    [true, false, true, true, "loja-a"],
  );
  const q1 = portalAutoriza(c1.corpo.url, "3268", "Frangoso");
  const rOutra = await retorno(q1, "dono-b@teste");
  confere("retorno com a sessão de OUTRA loja: erro, e o state não é gasto", [rOutra.resultado, rOutra.motivo.includes("outra loja"), !!linhaDoState.usadoEm], ["erro", true, false]);
  const r1 = await retorno(q1);
  confere("retorno certo: volta para Integrações com ok", [r1.status, r1.caminho, r1.integracao, r1.resultado], [303, "/store/integracoes", "cardapioweb", "ok"]);
  const inst3268 = instalacaoSql("producao", "3268")!;
  confere(
    "instalação gravada pela company do identity/context, tokens cifrados",
    [inst3268?.franchiseeId, inst3268?.nome, String(inst3268?.accessToken).startsWith("v1."), decifrar(inst3268?.accessToken), inst3268?.estado],
    ["loja-a", "Frangoso", true, [...cw.acessos.keys()].at(-1), "ok"],
  );
  const rDeNovo = await retorno(q1);
  confere("o mesmo state de novo: recusado (uso único)", [rDeNovo.resultado, rDeNovo.motivo.includes("já foi usada")], ["erro", true]);

  const c2 = await integracoes("POST", { acao: "conectar" });
  sqlTabelas.CardapioWebEstadoOAuth.at(-1)!.expiraEm = new Date(Date.now() - 1000);
  const rVencido = await retorno(portalAutoriza(c2.corpo.url, "3268", "Frangoso"));
  confere("state vencido (30 min): recusado", [rVencido.resultado, rVencido.motivo.includes("expirou")], ["erro", true]);
  const rInventado = await retorno("code=x&state=state-que-ninguem-emitiu-0000000000000000");
  confere("state que o FireHub não emitiu: recusado", [rInventado.resultado, rInventado.motivo.includes("não foi aberta pelo FireHub")], ["erro", true]);
  const rNegado = await retorno("error=access_denied&state=qualquer");
  confere("Proprietário não autorizou: o motivo fala do Proprietário", [rNegado.resultado, rNegado.motivo.includes("Proprietário")], ["erro", true]);

  await sleep(5);
  const r4000 = await conectar("4000", "Salzburg");
  confere("multimarca: a segunda loja do CardápioWeb cai na mesma conta", r4000.resultado, "ok");
  const g1 = await integracoes("GET");
  confere(
    "GET lista as duas lojas, ok, sem pedido ainda",
    g1.corpo.lojas.map((l: any) => [l.companyId, l.nome, l.ambiente, l.estado, l.ultimoPedidoEm, l.webhookMudo]),
    [["3268", "Frangoso", "producao", "ok", null, false], ["4000", "Salzburg", "producao", "ok", null, false]],
  );
  const tokenAntes = decifrar(instalacaoSql("producao", "3268")!.accessToken);
  const rRoubo = await conectar("3268", "Frangoso", "dono-b@teste");
  const depoisDoRoubo = instalacaoSql("producao", "3268")!;
  confere(
    "loja do CardápioWeb ligada em OUTRA conta: recusa com motivo; o vínculo continua na conta certa",
    [rRoubo.resultado, rRoubo.motivo.includes("já está ligada a outra conta"), depoisDoRoubo.franchiseeId],
    ["erro", true, "loja-a"],
  );
  confere("…e a conta certa fica com os tokens novos (o CardápioWeb troca os da instalação)", [decifrar(depoisDoRoubo.accessToken) !== tokenAntes, cw.acessos.has(decifrar(depoisDoRoubo.accessToken)!)], [true, true]);

  // ── 2. Webhook ──────────────────────────────────────────────────────────────
  console.log("\n── Webhook ──");
  await sleep(5);
  novoPedido("producao", "3268", 1001);
  const antesDoTokenErrado = cw.chamadas.length;
  const wErrado = await webhook("producao", "3268", 1001, "ORDER_CREATED", { token: "token-errado" });
  await sleep(100);
  confere("token errado: 200 mesmo assim (não pausar o webhook), nada processado, aviso", [wErrado.status, cw.chamadas.length - antesDoTokenErrado, !!noFireHub("producao", "3268", 1001), alertas.some((a) => a.includes("token do webhook"))], [200, 0, false, true]);
  cw.atraso.set("1001", 1500);
  const w1 = await webhook("producao", "3268", 1001);
  confere("token certo: 200 antes de buscar o pedido (resposta em < 1 s com a API lenta)", [w1.status, w1.ms < 1000], [200, true]);
  await ate(eventoProcessado(w1.eventId));
  cw.atraso.delete("1001");
  const p1001 = noFireHub("producao", "3268", 1001);
  confere("pedido gravado na conta da loja, canal e número curto", [p1001?.franchiseeId, p1001?.source, p1001?.openDeliveryReference, p1001?.deliveryType], ["loja-a", "CARDAPIOWEB", "1", "DELIVERY"]);
  confere("aceite automático: ACEITO aqui e confirm lá", [p1001?.status, cw.pedidos.get("producao:1001")?.status], ["ACEITO", "confirmed"]);
  confere("foi para a impressão; payload cru guardado", [impressos.includes(p1001?.id), payloads.some((p) => p.tipo === "pedido" && p.idNoParceiro === "cardapioweb_3268_1001")], [true, true]);
  confere("pago online", p1001?.paymentMethod, "Pix (Pago Online)");
  const antesDoRepetido = cw.chamadas.length;
  const wRepetido = await webhook("producao", "3268", 1001, "ORDER_CREATED", { eventId: w1.eventId });
  await sleep(100);
  confere("o mesmo event_id de novo: 200, sem buscar nada", [wRepetido.status, wRepetido.corpo.repetido, cw.chamadas.length - antesDoRepetido], [200, true, 0]);
  const antesDoEco = cw.chamadas.length;
  const wEco = await webhook("producao", "3268", 1001, "ORDER_STATUS_UPDATED", { status: "confirmed" });
  await ate(eventoProcessado(wEco.eventId));
  confere("eco do nosso confirm (STATUS_UPDATED confirmed): sem mudança, sem gastar chamada", [cw.chamadas.length - antesDoEco, noFireHub("producao", "3268", 1001)?.status], [0, "ACEITO"]);
  const wOutroId = await webhook("producao", "3268", 1001, "ORDER_CREATED", { status: "waiting_confirmation" });
  await ate(eventoProcessado(wOutroId.eventId));
  confere("o mesmo pedido por outro aviso: continua um pedido só", db.customerOrder.filter((o) => o.openDeliveryOrderId === "cardapioweb_3268_1001").length, 1);
  confere("o webhook ficou registrado na instalação", !!instalacaoSql("producao", "3268")!.ultimoWebhookEm, true);

  // ── 3. Polling ──────────────────────────────────────────────────────────────
  console.log("\n── Polling ──");
  novoPedido("producao", "4000", 1002);
  const ciclo1 = await cron();
  const p1002 = noFireHub("producao", "4000", 1002);
  confere("o polling acha o pedido que o webhook não trouxe", [ciclo1.ok, p1002?.franchiseeId, p1002?.status], [true, "loja-a", "ACEITO"]);
  const g2 = await integracoes("GET");
  confere(
    "a tela vê o webhook mudo só da loja em que o polling trouxe o que o webhook não trouxe",
    g2.corpo.lojas.map((l: any) => [l.companyId, l.webhookMudo, !!l.ultimoPedidoEm]),
    [["3268", false, true], ["4000", true, true]],
  );
  const pedidosAntes = db.customerOrder.length;
  await cron();
  confere("polling de novo: nenhum pedido a mais (idempotente)", db.customerOrder.length - pedidosAntes, 0);

  // ── 4. Filtros ──────────────────────────────────────────────────────────────
  console.log("\n── O que não entra ──");
  novoPedido("producao", "3268", 2001, { sales_channel: "ifood", external_order_id: "ifood-2001", external_display_id: "7788", payments: [{ total: 35, payment_type: "online", status: "paid", payment_method: "ifood", payment_fee: 0 }] });
  novoPedido("producao", "3268", 2002, { order_type: "closed_table", status: "closed", table_number: "5", delivery_address: null });
  novoPedido("producao", "3268", 2003, { status: "pending_online_payment", payments: [{ total: 35, payment_type: "online", status: "pending", payment_method: "pix_auto", payment_fee: 0 }] });
  const wIfood = await webhook("producao", "3268", 2001);
  const wMesa = await webhook("producao", "3268", 2002);
  const wPix = await webhook("producao", "3268", 2003);
  await ate(() => [wIfood, wMesa, wPix].every((w) => eventoProcessado(w.eventId)()));
  confere("iFood repassado, mesa e Pix ainda não pago: não gravam", [2001, 2002, 2003].map((id) => !!noFireHub("producao", "3268", id)), [false, false, false]);
  const pix = cw.pedidos.get("producao:2003")!;
  pix.status = "waiting_confirmation";
  pix.payments[0].status = "paid";
  pix.updated_at = new Date().toISOString();
  const wPago = await webhook("producao", "3268", 2003, "ORDER_STATUS_UPDATED");
  await ate(eventoProcessado(wPago.eventId));
  confere("o Pix pago entra no aviso seguinte", [noFireHub("producao", "3268", 2003)?.status, noFireHub("producao", "3268", 2003)?.paymentMethod], ["ACEITO", "Pix (Pago Online)"]);

  // ── 5. Status de lá → aqui ──────────────────────────────────────────────────
  console.log("\n── Status do CardápioWeb no FireHub ──");
  const c1001 = cw.pedidos.get("producao:1001")!;
  c1001.status = "canceled";
  c1001.cancellation_reason = "Cliente desistiu";
  c1001.updated_at = new Date().toISOString();
  const wCancel = await webhook("producao", "3268", 1001, "ORDER_STATUS_UPDATED");
  await ate(eventoProcessado(wCancel.eventId));
  await sleep(30); // o aviso de NFC-e sai em segundo plano
  const cancelado = noFireHub("producao", "3268", 1001)!;
  confere("cancelado lá: CANCELADO aqui, com motivo e culpa no CardápioWeb", [cancelado.status, cancelado.cancelledBy, cancelado.cancelReason], ["CANCELADO", "CARDAPIOWEB", "Cliente desistiu"]);
  confere("aviso de NFC-e já emitida disparado", notasAlertadas.some((n) => n.onde?.id === cancelado.id && n.canal === "CardápioWeb"), true);
  const p1002Banco = noFireHub("producao", "4000", 1002)!;
  p1002Banco.status = "SAIU_ENTREGA";
  const c1002 = cw.pedidos.get("producao:1002")!;
  c1002.status = "ready";
  c1002.updated_at = new Date().toISOString();
  await cron();
  confere("status atrasado de lá não volta o pedido daqui (só avança)", noFireHub("producao", "4000", 1002)?.status, "SAIU_ENTREGA");
  c1002.status = "closed";
  c1002.updated_at = new Date().toISOString();
  await cron();
  confere("finalizado lá avança aqui (pelo polling)", noFireHub("producao", "4000", 1002)?.status, "ENTREGUE");

  // ── 6. A escada de status daqui → lá ────────────────────────────────────────
  console.log("\n── Escada de status (FireHub → CardápioWeb) ──");
  db.user.find((u) => u.id === "loja-a")!.autoAcceptOrders = false;
  novoPedido("producao", "3268", 4001);
  novoPedido("producao", "3268", 4002, retiradaExtra);
  novoPedido("producao", "3268", 4003, { order_timing: "scheduled", schedule: { scheduled_date_time_start: new Date(Date.now() + 3 * 3600e3).toISOString(), scheduled_date_time_end: new Date(Date.now() + 3.2 * 3600e3).toISOString() } });
  novoPedido("producao", "3268", 4004);
  for (const id of [4001, 4002, 4003, 4004]) {
    const w = await webhook("producao", "3268", id);
    await ate(eventoProcessado(w.eventId));
  }
  confere("sem aceite automático: NOVO aqui e nada de confirm lá", [4001, 4002, 4003, 4004].map((id) => [noFireHub("producao", "3268", id)?.status, cw.pedidos.get(`producao:${id}`)?.status]), Array(4).fill(["NOVO", "waiting_confirmation"]));
  const subir = async (id: number, para: string, extra: Linha = {}) => {
    const p = noFireHub("producao", "3268", id)!;
    const desde = cw.chamadas.length;
    const r = await sincronizarCardapioWeb({ openDeliveryOrderId: p.openDeliveryOrderId, franchiseeId: p.franchiseeId, status: p.status, deliveryBy: p.deliveryBy, deliveryType: p.deliveryType, notes: p.notes }, para, extra);
    if (r.ok) p.status = para;
    return { r, acoes: acoesDo(id, desde), statusLa: cw.pedidos.get(`producao:${id}`)?.status };
  };
  const e1 = await subir(4001, "ACEITO");
  confere("entrega NOVO → ACEITO: confirm", [e1.acoes, e1.statusLa], [["confirm"], "confirmed"]);
  const e2 = await subir(4001, "PRONTO");
  confere("ACEITO → PRONTO: prepared", [e2.acoes, e2.statusLa], [["prepared"], "ready"]);
  const e3 = await subir(4001, "SAIU_ENTREGA");
  confere("PRONTO → SAIU_ENTREGA (motoboy da loja): dispatch", [e3.acoes, e3.statusLa], [["dispatch"], "released"]);
  const e4 = await subir(4001, "ENTREGUE");
  confere("SAIU_ENTREGA → ENTREGUE: delivered + finalize", [e4.acoes, e4.statusLa, e4.r.ok], [["delivered", "finalize"], "closed", true]);
  const r1a = await subir(4002, "ACEITO");
  const r1b = await subir(4002, "PRONTO");
  confere("retirada: PRONTO = prepared + dispatch (esperando retirada)", [r1a.acoes, r1b.acoes, r1b.statusLa], [["confirm"], ["prepared", "dispatch"], "waiting_to_catch"]);
  const r1c = await subir(4002, "ENTREGUE");
  confere("retirada ENTREGUE: finalize", [r1c.acoes, r1c.statusLa], [["finalize"], "closed"]);
  const a1 = await subir(4003, "ACEITO");
  const a2 = await subir(4003, "PRONTO");
  confere("agendado: confirm vira scheduled_confirmed; PRONTO = start_preparation + prepared", [a1.statusLa === "scheduled_confirmed" || a1.acoes, a2.acoes, a2.statusLa], [true, ["start_preparation", "prepared"], "ready"]);
  const x1 = await subir(4004, "CANCELADO", { motivo: "Sem entregador" });
  confere("CANCELADO: cancel com o motivo", [x1.acoes, x1.statusLa, cw.pedidos.get("producao:4004")?.cancellation_reason], [["cancel"], "canceled", "Sem entregador"]);
  const instA = (await instalacaoAtiva("producao", "3268"))!;
  const tolerado = await api.acaoNoPedidoCW(instA, "confirm", "4001");
  confere("4002/4003 contam como 'já estava' (não repetem)", [tolerado.ok, tolerado.jaEstava, tolerado.codigo], [true, true, 4002]);
  confere(
    "passos da escada (puro)",
    [
      passosDaEscada({ alvo: "ENTREGUE", statusCW: "waiting_confirmation", retirada: false, agendado: true, entregaDaLoja: true }),
      passosDaEscada({ alvo: "SAIU_ENTREGA", statusCW: "confirmed", retirada: false, agendado: false, entregaDaLoja: false }),
      passosDaEscada({ alvo: "PRONTO", statusCW: "canceled", retirada: false, agendado: false, entregaDaLoja: true }),
    ],
    [["confirm", "start_preparation", "prepared", "dispatch", "delivered", "finalize"], ["prepared"], []],
  );

  // ── 7. 429 vira fila, na ordem ──────────────────────────────────────────────
  console.log("\n── 429 → ações pendentes ──");
  novoPedido("producao", "3268", 5001);
  const w5001 = await webhook("producao", "3268", 5001);
  await ate(eventoProcessado(w5001.eventId));
  await subir(5001, "ACEITO");
  cw.falhas.prepared = [429];
  const f1 = await subir(5001, "SAIU_ENTREGA");
  const fila = sqlTabelas.AcaoPendenteCardapioWeb.filter((a) => a.pedidoId === "cardapioweb_3268_5001" && !a.resolvidaEm).sort((a, b) => a.ordem - b.ordem).map((a) => a.acao);
  confere("prepared com 429: erro na resposta, e prepared + dispatch na fila, em ordem", [f1.r.ok, f1.r.pendentes, fila, f1.statusLa], [false, ["prepared", "dispatch"], ["prepared", "dispatch"], "confirmed"]);
  noFireHub("producao", "3268", 5001)!.status = "SAIU_ENTREGA";
  const f2 = await subir(5001, "ENTREGUE");
  confere("com aviso na fila, o novo entra ATRÁS (sem chamar o CardápioWeb)", [f2.acoes, f2.r.pendentes], [[], ["delivered", "finalize"]]);
  const desdeFila = cw.chamadas.length;
  await cron();
  confere("o polling repete a fila na ordem e o pedido fecha lá", [acoesDo(5001, desdeFila), cw.pedidos.get("producao:5001")?.status], [["prepared", "dispatch", "delivered", "finalize"], "closed"]);
  confere("fila resolvida", sqlTabelas.AcaoPendenteCardapioWeb.filter((a) => a.pedidoId === "cardapioweb_3268_5001" && !a.resolvidaEm).length, 0);

  // ── 8. Token ────────────────────────────────────────────────────────────────
  console.log("\n── Token ──");
  instalacaoSql("producao", "3268")!.tokenExpiraEm = new Date(Date.now() + 60_000); // vence em 1 min (< 5 min)
  const renovacoesAntes = cw.renovacoes;
  const [b1, b2, b3] = await Promise.all([api.buscarPedidoCW(instA, "4001"), api.buscarPedidoCW(instA, "4002"), api.buscarPedidoCW(instA, "4003")]);
  confere("perto de vencer: renova ANTES, uma vez só para três chamadas juntas (a trava)", [cw.renovacoes - renovacoesAntes, b1.ok && b2.ok && b3.ok], [1, true]);
  const novoToken = decifrar(instalacaoSql("producao", "3268")!.accessToken)!;
  confere("token novo gravado (e o refresh girado)", [cw.acessos.has(novoToken), cw.refreshes.has(decifrar(instalacaoSql("producao", "3268")!.refreshToken)!)], [true, true]);
  cw.acessos.delete(novoToken); // revogado lá, mas ainda "válido" pelo relógio daqui
  const r401 = await api.buscarPedidoCW(instA, "4001");
  confere("401 com token no prazo: renova e repete UMA vez", [r401.ok, cw.renovacoes - renovacoesAntes], [true, 2]);

  // ── 9. Nunca o JotaJá ───────────────────────────────────────────────────────
  console.log("\n── Pedido do CardápioWeb nunca chama a API do JotaJá ──");
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const mudar = async (id: string, status: string, extra: Linha = {}) => {
    sessao = "dono-a@teste";
    const res = await PUT(new Request("http://teste/api/customer-order/status", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id, status, ...extra }) }) as any);
    return { status: res.status, corpo: await res.json() };
  };
  for (const id of [6001, 6002, 6003, 6004]) novoPedido("producao", "3268", id, id === 6004 ? retiradaExtra : {});
  for (const id of [6001, 6002, 6003, 6004]) {
    const w = await webhook("producao", "3268", id);
    await ate(eventoProcessado(w.eventId));
  }
  const p6001 = noFireHub("producao", "3268", 6001)!;
  const desde6001 = cw.chamadas.length;
  const s1 = await mudar(p6001.id, "ACEITO");
  const s2 = await mudar(p6001.id, "PRONTO");
  const s3 = await mudar(p6001.id, "SAIU_ENTREGA");
  const s4 = await mudar(p6001.id, "ENTREGUE");
  confere("rota de status: cada clique do painel vira a ação certa lá", [[s1, s2, s3, s4].map((s) => [s.status, s.corpo.avisoCardapioWeb]), acoesDo(6001, desde6001)], [
    [[200, null], [200, null], [200, null], [200, null]],
    ["confirm", "prepared", "dispatch", "delivered", "finalize"],
  ]);
  const p6002 = noFireHub("producao", "3268", 6002)!;
  const s5 = await mudar(p6002.id, "CANCELADO", { motivo: "Cliente pediu" });
  confere("rota de status: cancelar manda cancel com o motivo, e quem cancelou é a loja", [s5.status, cw.pedidos.get("producao:6002")?.status, cw.pedidos.get("producao:6002")?.cancellation_reason, noFireHub("producao", "3268", 6002)?.cancelledBy], [200, "canceled", "Cliente pediu", "LOJA"]);
  const p6003 = noFireHub("producao", "3268", 6003)!;
  p6003.status = "ACEITO";
  await sincronizarCardapioWeb({ openDeliveryOrderId: p6003.openDeliveryOrderId, franchiseeId: "loja-a", status: "NOVO" }, "ACEITO");
  const { POST: despachar } = await import("../src/app/api/motoboys/dispatch-whatsapp/route");
  sessao = "dono-a@teste";
  const d1 = await despachar(new Request("http://teste/api/motoboys/dispatch-whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motoboyPhone: "22998887766", routeText: "rota", orderIds: [p6003.id] }) }) as any);
  await ate(() => cw.pedidos.get("producao:6003")?.status === "released");
  confere("despacho pelo WhatsApp: sobe até 'saiu' lá", [d1.status, cw.pedidos.get("producao:6003")?.status], [200, "released"]);
  const p6004 = noFireHub("producao", "3268", 6004)!;
  const { sincronizarPedidoNasPlataformas } = await import("../src/lib/despacho-da-rota");
  await sincronizarPedidoNasPlataformas({ ...p6004, status: "NOVO", ifoodOrderId: null, ifoodReference: null, ifoodStoreMerchant: null, motoboyId: null } as any, { id: "m1", name: "Moto", phone: null }, "loja-a");
  confere("roteirização: retirada sobe até 'esperando retirada' lá", cw.pedidos.get("producao:6004")?.status, "waiting_to_catch");
  confere("NENHUMA chamada à API do JotaJá em tudo isso", jotaja, []);
  const fonte = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  const antesDoJotaja = (rel: string, marcaDoJotaja: string) => {
    const f = fonte(rel);
    const cw1 = f.indexOf("ehPedidoCardapioWeb(");
    const jj = f.indexOf(marcaDoJotaja);
    return cw1 > 0 && jj > 0 && cw1 < jj;
  };
  confere(
    "o CardápioWeb entra ANTES do 'senão é JotaJá' nos 5 pontos",
    [
      antesDoJotaja("src/app/api/customer-order/status/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/app/api/kds/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/app/api/motoboys/orders/route.ts", 'await import("@/lib/jotaja-api")'),
      fonte("src/app/api/motoboys/orders/route.ts").split("ehPedidoCardapioWeb(").length - 1 >= 2,
      antesDoJotaja("src/app/api/motoboys/dispatch-whatsapp/route.ts", 'await import("@/lib/jotaja-api")'),
      antesDoJotaja("src/lib/despacho-da-rota.ts", 'await import("@/lib/jotaja-api")'),
      /!ehPedidoKeeta\(order\) && !ehPedidoCardapioWeb\(order\)(\)| &&)/.test(fonte("src/app/api/customer-order/status/route.ts")),
      /!ehPedidoKeeta\(ord\) && !ehPedidoCardapioWeb\(ord\)(\)| &&)/.test(fonte("src/lib/despacho-da-rota.ts")),
    ],
    [true, true, true, true, true, true, true, true],
  );
  confere("ehPedidoCardapioWeb reconhece pelo canal ou pelo id, nunca pedido de outro canal", [
    ehPedidoCardapioWeb({ source: "CARDAPIOWEB", openDeliveryOrderId: "cardapioweb_1_2" }),
    ehPedidoCardapioWeb({ openDeliveryOrderId: "cardapioweb_1_2" }),
    ehPedidoCardapioWeb({ source: "KEETA", openDeliveryChannel: "KEETA", openDeliveryOrderId: "keeta_1" }),
    ehPedidoCardapioWeb({ openDeliveryOrderId: "uuid-do-jotaja" }),
  ], [true, true, false, false]);

  // ── 10. Refresh recusado → reconectar ───────────────────────────────────────
  console.log("\n── Token recusado de vez ──");
  const inst4000 = (await instalacaoAtiva("producao", "4000"))!;
  const tokens4000 = { a: decifrar(instalacaoSql("producao", "4000")!.accessToken)!, r: decifrar(instalacaoSql("producao", "4000")!.refreshToken)! };
  cw.acessos.delete(tokens4000.a);
  cw.refreshes.delete(tokens4000.r);
  const alertasAntes = alertas.length;
  const morto = await api.buscarPedidoCW(inst4000, "1002");
  await sleep(50); // o aviso ao Douglas sai em segundo plano
  const g3 = await integracoes("GET");
  confere("refresh recusado: falha, a loja vira 'reconectar' na tela e o Douglas é avisado", [morto.ok, g3.corpo.lojas.find((l: any) => l.companyId === "4000")?.estado, alertas.length > alertasAntes], [false, "reconectar", true]);
  const ciclo = await cron();
  confere("o polling deixa a loja sem token de fora (não bate 30 s em 401)", (ciclo.log as string[]).some((l) => l.includes("precisa reconectar")), true);
  const rRecon = await conectar("4000", "Salzburg");
  confere("reconectar a mesma loja volta ao normal", [rRecon.resultado, (await integracoes("GET")).corpo.lojas.find((l: any) => l.companyId === "4000")?.estado], ["ok", "ok"]);

  // ── 11. Marketplaces pelo CardápioWeb ───────────────────────────────────────
  console.log("\n── Opção: receber marketplaces pelo CardápioWeb ──");
  const mk = await integracoes("POST", { acao: "marketplaces", ligado: true });
  confere("ligar a opção", [mk.corpo, (await integracoes("GET")).corpo.receberMarketplaces], [{ ok: true }, true]);
  await sleep(5);
  novoPedido("producao", "3268", 7001, { sales_channel: "ifood", external_order_id: "ifood-7001", external_display_id: "4321", payments: [{ total: 35, payment_type: "online", status: "paid", payment_method: "ifood", payment_fee: 0 }] });
  db.customerOrder.push({ id: "pedido-ifood-direto", franchiseeId: "loja-a", ifoodOrderId: "ifood-dup", status: "ACEITO", source: "IFOOD" });
  novoPedido("producao", "3268", 7002, { sales_channel: "ifood", external_order_id: "ifood-dup" });
  const wm1 = await webhook("producao", "3268", 7001);
  const wm2 = await webhook("producao", "3268", 7002);
  await ate(() => eventoProcessado(wm1.eventId)() && eventoProcessado(wm2.eventId)());
  confere("com a opção, o iFood repassado entra, marcado", [!!noFireHub("producao", "3268", 7001), String(noFireHub("producao", "3268", 7001)?.notes).includes("Pedido do iFood recebido pelo CardápioWeb (nº no app: 4321)")], [true, true]);
  confere("…mas o que já entrou direto pelo iFood não entra de novo", !!noFireHub("producao", "3268", 7002), false);
  await integracoes("POST", { acao: "marketplaces", ligado: false });

  // ── 12. Desconectar ─────────────────────────────────────────────────────────
  console.log("\n── Desconectar ──");
  const tokensAntes = { a: decifrar(instalacaoSql("producao", "4000")!.accessToken), r: decifrar(instalacaoSql("producao", "4000")!.refreshToken) };
  const dc = await integracoes("POST", { acao: "desconectar", companyId: "4000" });
  confere("desconectar: ok, tokens apagados aqui e revogados lá", [dc.corpo, instalacaoSql("producao", "4000")!.ativa, instalacaoSql("producao", "4000")!.accessToken, cw.revogados.includes(tokensAntes.a!), cw.revogados.includes(tokensAntes.r!)], [{ ok: true }, false, null, true, true]);
  confere("a tela mostra só a loja que ficou", (await integracoes("GET")).corpo.lojas.map((l: any) => l.companyId), ["3268"]);
  novoPedido("producao", "4000", 8001);
  const antesDoDesligado = cw.chamadas.length;
  const wDesligada = await webhook("producao", "4000", 8001);
  await ate(eventoProcessado(wDesligada.eventId));
  confere("aviso de loja desligada: 200, ignorado, nenhuma chamada lá", [wDesligada.status, cw.chamadas.length - antesDoDesligado, !!noFireHub("producao", "4000", 8001)], [200, 0, false]);
  const dc404 = await integracoes("POST", { acao: "desconectar", companyId: "9999" });
  confere("desconectar loja que não é desta conta: 404", dc404.status, 404);

  // ── 13. Sandbox separado ────────────────────────────────────────────────────
  console.log("\n── Sandbox ──");
  const rSb = await conectar("3268", "Loja de teste", "dono-b@teste", "sandbox");
  confere("o mesmo company id no sandbox é OUTRA loja (outra conta pode ligar)", [rSb.resultado, instalacaoSql("sandbox", "3268")?.franchiseeId], ["ok", "loja-b"]);
  await sleep(5);
  novoPedido("sandbox", "3268", 1001, { payments: [{ total: 35, payment_type: "offline", status: "pending", payment_method: "money", change_for: 50, payment_fee: 0 }] });
  const wSb = await webhook("sandbox", "3268", 1001);
  await ate(eventoProcessado(wSb.eventId));
  const pSb = noFireHub("sandbox", "3268", 1001);
  confere("pedido do sandbox com o mesmo número não colide com o de produção", [pSb?.openDeliveryOrderId, pSb?.franchiseeId, pSb?.status, pSb?.changeAmount], ["cardapioweb_sandbox-3268_1001", "loja-b", "NOVO", 50]);
  const wSbErrado = await webhook("sandbox", "3268", 1001, "ORDER_CREATED", { token: TOKEN_PROD, eventId: "ev-sb-com-token-de-producao" });
  await ate(eventoProcessado("ev-sb-com-token-de-producao"));
  confere("o token decide o ambiente: aviso com token de produção vai para a loja de produção", [wSbErrado.status, db.customerOrder.filter((o) => String(o.openDeliveryOrderId).endsWith("_1001")).length], [200, 2]);

  // ── 14. Bloqueio e canal desligado ──────────────────────────────────────────
  console.log("\n── Loja bloqueada e servidor sem credencial ──");
  bloqueadas.add("loja-a");
  novoPedido("producao", "3268", 9001);
  const wBloq = await webhook("producao", "3268", 9001);
  await ate(eventoProcessado(wBloq.eventId));
  confere("loja bloqueada por mensalidade: 200 e não grava", [wBloq.status, !!noFireHub("producao", "3268", 9001)], [200, false]);
  bloqueadas.delete("loja-a");
  for (const k of ["CARDAPIOWEB_CLIENT_ID", "CARDAPIOWEB_WEBHOOK_TOKEN", "CARDAPIOWEB_SANDBOX_CLIENT_ID", "CARDAPIOWEB_SANDBOX_WEBHOOK_TOKEN"]) delete process.env[k];
  const antesDesligado = cw.chamadas.length;
  const gOff = await integracoes("GET");
  const cOff = await integracoes("POST", { acao: "conectar" });
  const wOff = await webhook("producao", "3268", 9001);
  const cronOff = await cron();
  const sOff = await sincronizarCardapioWeb({ openDeliveryOrderId: "cardapioweb_3268_6001", franchiseeId: "loja-a", status: "NOVO" }, "ACEITO");
  confere(
    "sem as variáveis: tela 'não configurada', conectar 503, webhook 200 ignorado, cron desligado, nada chama o CardápioWeb",
    [gOff.corpo.configurada, gOff.corpo.ambiente, cOff.status, wOff.status, wOff.corpo.ignorado, cronOff.desligada, sOff.ignorado, cw.chamadas.length - antesDesligado],
    [false, null, 503, 200, "desligado", true, true, 0],
  );

  confere("nenhuma chamada a host fora do CardápioWeb", cw.hostsInesperados, []);
  confere("nenhuma chamada à API do JotaJá no teste inteiro", jotaja, []);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
