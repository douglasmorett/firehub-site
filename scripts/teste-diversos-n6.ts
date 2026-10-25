/**
 * Trava as correções de baixo risco da auditoria de 23/10/2026 (branch
 * fix/n6-diversos):
 *
 *   F31/F40   scripts soltos: senha fixa sai do código (vem de variável de ambiente).
 *   F112…F124 extensão: o id cru da loja ainda lê (fase 1), mas vira log; a
 *             constante EXIGIR_TOKEN_ASSINADO_DA_EXTENSAO recusa quando ligada.
 *   F125/F131 token da extensão Prazos leva a marca da senha: trocar a senha
 *             derruba o token emitido antes da troca; o token sem marca segue.
 *   F37       GTM: consulta de sessão que falha não carrega o contêiner.
 *   F84       store-settings: gtmContainerId só no formato GTM-XXXXXXX.
 *   F127/F133 supervisor da contingência: testar/parar recusam o navegador.
 *   F47/F61   Clube: cancelar, ver e o desconto só da assinatura DA conta.
 *   F50/F76   login do motoboy: o limite não se dribla variando o slug.
 *
 * Sem banco nem rede (só um servidor em 127.0.0.1 para ver os cabeçalhos do
 * fetch do Node, que é o do Assistente): banco falso em globalThis.prisma e
 * libs trocadas no cache do require — o molde de teste-seguranca-da-madrugada.
 *
 *   npx tsx scripts/teste-diversos-n6.ts
 */
export {};

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const ler = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const espera = () => new Promise((r) => setTimeout(r, 0));

// ── Banco falso ──────────────────────────────────────────────────────────────
const LOJA = { id: "cl0loja0001", name: "Pizzaria X", storeName: "Pizzaria X", slug: "pizzaria-x", ownerId: null, role: "FRANCHISEE", email: "dono@loja", etaConfig: { motoboysCount: 3 }, storeAddress: "", city: "" };
const gravados: Record<string, any[]> = {};
const gravou = (onde: string, dados: any) => ((gravados[onde] ||= []).push(dados), dados);
const SENHA_PRAZOS = "senha-antiga";
const PRAZO = { id: "pz1", email: "loja@prazos", senhaHash: bcrypt.hashSync(SENHA_PRAZOS, 4), status: "ATIVO", nomeLoja: "Loja", motoboys: 2, config: null, lojasIncluidas: 1 };
const CLIENTES: Record<string, { id: string; name: string; phone: string; address: null; birthDate: null }> = {
  "cli-v": { id: "cli-v", name: "Vítima", phone: "22999991234", address: null, birthDate: null },
  "cli-a": { id: "cli-a", name: "Atacante", phone: "5522999991234", address: null, birthDate: null },
  "cli-b": { id: "cli-b", name: "Outro DDD", phone: "11999991234", address: null, birthDate: null },
};
const SENHA_MOTO = "senha-do-joao";
const MOTOBOYS = [{ id: "m1", name: "Joao", phone: "21988887777", password: bcrypt.hashSync(SENHA_MOTO, 4), active: true, franchiseeId: LOJA.id }];

(globalThis as any).prisma = {
  user: {
    findFirst: async ({ where }: any) => ({ ...LOJA, id: where?.id || LOJA.id }),
    findUnique: async ({ where }: any) => (where.email && where.email !== LOJA.email ? null : { ...LOJA }),
    findMany: async () => [{ id: LOJA.id }],
    update: async ({ data }: any) => gravou("user.update", data),
    updateMany: async ({ data }: any) => (gravou("user.updateMany", data), { count: 0 }),
  },
  $transaction: async (ops: any[]) => Promise.all(ops),
  cashSession: { findFirst: async () => null },
  customerOrder: { findMany: async () => [], count: async () => 0 },
  prazoConta: {
    findUnique: async ({ where }: any) => (where.id === PRAZO.id ? { ...PRAZO } : null),
    update: async ({ data }: any) => (Object.assign(PRAZO, data), { ...PRAZO }),
  },
  storeCustomer: { findUnique: async ({ where }: any) => (CLIENTES[where.id] ? { ...CLIENTES[where.id] } : null) },
  motoboy: { findMany: async () => MOTOBOYS.map((m) => ({ ...m })), update: async () => ({}) },
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = null;
const getServerSession = async () => sessao;
stub("next-auth/next", { getServerSession });
stub("next-auth", { getServerSession, default: () => null });
stub("next/cache", { revalidatePath: () => {}, revalidateTag: () => {} });
stub("../src/lib/auth", { authOptions: {}, renovarMarcaDaSessao: async () => {} });

let ip = 0;
const req = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
  const { NextRequest } = require("next/server");
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method || "GET",
    headers: { "x-forwarded-for": `10.0.0.${++ip}`, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
};

// console.log capturado (as linhas de log que as rotas escrevem).
const linhas: string[] = [];
const logOriginal = console.log;
const capturando = async <T>(fn: () => Promise<T>): Promise<T> => {
  linhas.length = 0;
  console.log = (...a: any[]) => { linhas.push(a.join(" ")); };
  try { return await fn(); } finally { console.log = logOriginal; }
};

async function main() {
  // ── F31/F40 ────────────────────────────────────────────────────────────────
  console.log("\n── F31/F40: senhas fixas fora dos scripts ──");
  const scripts = ["check-admin.js", "swap-user-email.js", "create-tester.js", "test-ui.js", "src/scripts/reset-pass.ts", "scripts/create-test-user.js"];
  for (const s of scripts) {
    const t = ler(s);
    const literal = /hash\(\s*['"`][^'"`]+['"`]|['"](123456|hakim123|FireHub@2026)['"]|paulocoutinhocastilho/.test(t);
    confere(`${s}: sem senha literal, lê do ambiente e para sem ela`, { literal, doAmbiente: /process\.env\.[A-Z_]*(PASSWORD|EMAIL)/.test(t) && /throw new Error\('Defina|throw new Error\("Defina/.test(t) }, { literal: false, doAmbiente: true });
  }

  // ── Extensão (F112…F124) ───────────────────────────────────────────────────
  console.log("\n── Extensão: id cru ainda lê, mas é contado; a fase 2 recusa ──");
  const ext = await import("../src/lib/extensao-token");
  const assinado = ext.criarTokenDeExtensao(LOJA.id);
  confere("fase 1: a exigência está desligada", ext.EXIGIR_TOKEN_ASSINADO_DA_EXTENSAO, false);
  confere("desligada: id cru vale para leitura (sem assinatura)", ext.lerTokenDeExtensao(LOJA.id), { valido: true, assinado: false, userId: LOJA.id });
  confere("desligada: token assinado vale", ext.lerTokenDeExtensao(assinado), { valido: true, assinado: true, userId: LOJA.id });
  confere("ligada: id cru recusado", (ext.lerTokenDeExtensao as any)(LOJA.id, true), { valido: false });
  confere("ligada: token assinado segue valendo", (ext.lerTokenDeExtensao as any)(assinado, true), { valido: true, assinado: true, userId: LOJA.id });
  confere("assinatura falsa recusada", ext.lerTokenDeExtensao(`${LOJA.id}.${"0".repeat(32)}`), { valido: false });
  const t0 = 1_000_000_000_000;
  // `|| …`: no código antigo a função não existe e o teste segue, falhando.
  const anotar = (ext as any).anotarTokenCruDaExtensao || (() => {});
  await capturando(async () => {
    anotar("loja-log", "dynamic-eta", t0);
    anotar("loja-log", "eta-config", t0 + 10 * 60_000);
    anotar("loja-log", "dynamic-eta", t0 + 61 * 60_000);
  });
  confere("log: 1 linha por loja por hora", linhas, ["[Extensão sem assinatura] loja=loja-log rota=dynamic-eta", "[Extensão sem assinatura] loja=loja-log rota=dynamic-eta"]);

  const etaConfig = await import("../src/app/api/store/eta-config/route");
  sessao = null;
  let r: any = await capturando(() => etaConfig.GET(req(`/api/store/eta-config?token=${LOJA.id}`)));
  confere("eta-config GET com id cru: lê como sempre", [r.status, (await r.json()).motoboysCount], [200, 3]);
  confere("…e registra o uso do id cru", linhas.filter((l) => l.startsWith("[Extensão")), [`[Extensão sem assinatura] loja=${LOJA.id} rota=eta-config`]);
  r = await capturando(() => etaConfig.GET(req(`/api/store/eta-config?token=${encodeURIComponent(assinado)}`)));
  confere("eta-config GET com token assinado: lê e não registra", [r.status, linhas.filter((l) => l.startsWith("[Extensão")).length], [200, 0]);
  r = await etaConfig.PUT(req(`/api/store/eta-config?token=${LOJA.id}`, { method: "PUT", body: { motoboysCount: 5 } }));
  confere("eta-config PUT com id cru: continua recusado", r.status, 401);

  const dyn = await import("../src/app/api/store/dynamic-eta/route");
  // Outra loja: a de cima já logou nesta hora (o limite é por loja).
  r = await capturando(() => dyn.GET(req("/api/store/dynamic-eta?token=cl0loja0002")));
  confere("dynamic-eta com id cru: lê (não 401) e registra", [r.status !== 401, linhas.filter((l) => l.startsWith("[Extensão"))], [true, ["[Extensão sem assinatura] loja=cl0loja0002 rota=dynamic-eta"]]);
  r = await capturando(() => dyn.GET(req("/api/store/dynamic-eta?token=cl0loja0002")));
  confere("…a 2ª chamada na mesma hora não repete o log", linhas.filter((l) => l.startsWith("[Extensão")).length, 0);

  // ── Prazos (F125/F131) ─────────────────────────────────────────────────────
  console.log("\n── Prazos: trocar a senha derruba o token emitido antes ──");
  const pz = await import("../src/lib/prazos-token");
  const { resolverConta } = await import("../src/lib/prazos");
  const comToken = (t: string) => req(`/api/prazos/estado?token=${encodeURIComponent(t)}`);
  // O token que as extensões instaladas guardaram (formato de antes, sem marca).
  const antigo = `${PRAZO.id}.${crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`prazos:${PRAZO.id}`).digest("hex").slice(0, 32)}`;
  const novo = (pz.criarTokenDePrazos as any)(PRAZO.id, PRAZO.senhaHash);
  confere("token antigo (sem marca) continua valendo", (await resolverConta(comToken(antigo)))?.id, PRAZO.id);
  confere("token novo leva a marca (3 partes) e vale", [novo.split(".").length, (await resolverConta(comToken(novo)))?.id], [3, PRAZO.id]);
  confere("marca adulterada não passa", await resolverConta(comToken(novo.replace(/\.(\w+)\./, ".000000000000."))), null);
  const senha = await import("../src/app/api/prazos/senha/route");
  r = await senha.POST(req(`/api/prazos/senha?token=${encodeURIComponent(novo)}`, { method: "POST", body: { senhaAtual: SENHA_PRAZOS, novaSenha: "senha-nova-1" } }));
  const trocou = await r.json();
  confere("troca de senha responde ok e devolve o token novo", [r.status, trocou.success, typeof trocou.token], [200, true, "string"]);
  confere("depois da troca: o token de antes da troca cai", await resolverConta(comToken(novo)), null);
  confere("…o token devolvido pela troca vale", (await resolverConta(comToken(trocou.token)))?.id, PRAZO.id);
  confere("…e o token antigo sem marca segue (ninguém cai no deploy)", (await resolverConta(comToken(antigo)))?.id, PRAZO.id);

  // ── F84 ────────────────────────────────────────────────────────────────────
  console.log("\n── F84: container do GTM validado no servidor ──");
  const settings = await import("../src/app/api/store-settings/route");
  sessao = { user: { email: LOJA.email } };
  const salvar = async (gtm: unknown) => {
    gravados["user.update"] = [];
    const resp: any = await settings.PUT(req("/api/store-settings", { method: "PUT", body: { gtmContainerId: gtm } }) as any);
    const body = await resp.json();
    return { status: resp.status, gravado: (gravados["user.update"] || []).map((d) => d.gtmContainerId).find((v) => v !== undefined), erro: body.error ? "sim" : "nao" };
  };
  confere("GTM-AB12CD3 grava", await salvar("GTM-AB12CD3"), { status: 200, gravado: "GTM-AB12CD3", erro: "nao" });
  confere("' gtm-ab12cd3 ' normaliza e grava", await salvar(" gtm-ab12cd3 "), { status: 200, gravado: "GTM-AB12CD3", erro: "nao" });
  confere("vazio apaga", await salvar(""), { status: 200, gravado: "", erro: "nao" });
  confere("ID do GA4 no campo do GTM → 400", await salvar("G-ABCDEF1234"), { status: 400, gravado: undefined, erro: "sim" });
  confere("lixo com aspas → 400", await salvar('GTM-1"><script>'), { status: 400, gravado: undefined, erro: "sim" });
  sessao = null;

  // ── F127/F133 ──────────────────────────────────────────────────────────────
  console.log("\n── Contingência: testar/parar só por programa, do próprio PC ──");
  const pedidoDoProprioComputador = ((await import("../contingencia/supervisor/regras")) as any).pedidoDoProprioComputador || (() => "não existe");
  const cab = (h: Record<string, string> = {}) => h;
  confere("Assistente (sem Origin/Sec-Fetch-Site) do 127.0.0.1 passa", pedidoDoProprioComputador({ remoto: "127.0.0.1", metodo: "POST", cabecalhos: cab({ "sec-fetch-mode": "cors" }) }), true);
  confere("::ffff:127.0.0.1 passa", pedidoDoProprioComputador({ remoto: "::ffff:127.0.0.1", metodo: "POST", cabecalhos: cab() }), true);
  confere("site no navegador (Origin) → recusado", pedidoDoProprioComputador({ remoto: "127.0.0.1", metodo: "POST", cabecalhos: cab({ origin: "https://site-qualquer.com" }) }), false);
  confere("navegador com Sec-Fetch-Site → recusado", pedidoDoProprioComputador({ remoto: "::1", metodo: "POST", cabecalhos: cab({ "sec-fetch-site": "cross-site" }) }), false);
  confere("outra máquina da rede → recusado", pedidoDoProprioComputador({ remoto: "192.168.0.20", metodo: "POST", cabecalhos: cab() }), false);
  confere("GET → recusado", pedidoDoProprioComputador({ remoto: "127.0.0.1", metodo: "GET", cabecalhos: cab() }), false);
  // O fetch de verdade do Node (o que o Assistente usa) passa pela regra.
  const vistos = await new Promise<any>((resolve) => {
    const srv = http.createServer((q, s) => {
      resolve(pedidoDoProprioComputador({ remoto: q.socket.remoteAddress, metodo: q.method, cabecalhos: q.headers }));
      s.end("{}");
      srv.close();
    });
    srv.listen(0, "127.0.0.1", () => {
      void fetch(`http://127.0.0.1:${(srv.address() as any).port}/__contingencia/parar`, { method: "POST", signal: AbortSignal.timeout(3000) }).catch(() => {});
    });
  });
  confere("fetch do Node (Assistente) para /__contingencia/parar passa", vistos, true);
  const idx = ler("contingencia/supervisor/index.ts");
  confere("index.ts: testar e parar usam a regra", (idx.match(/pedidoDoProprioComputador\(\{ remoto: req\.socket\.remoteAddress/g) || []).length, 2);

  // ── F47/F61 ────────────────────────────────────────────────────────────────
  console.log("\n── Clube: só a assinatura DA conta da sessão ──");
  const noBancoReal = await import("../src/lib/clube/no-banco");
  const { criarSessaoDoCliente } = await import("../src/lib/sessao-do-cliente");
  let socio: any = null;
  const cancelados: string[] = [];
  const preparados: string[] = [];
  stub("../src/lib/clube/no-banco", {
    ...noBancoReal,
    clubeValendoNaLoja: async () => ({ chave: LOJA.id, config: { cobranca: "cakto", linkDoCheckout: "https://pay.cakto.com.br/abc", nome: "Clube", valor: 20, percentual: 10, teto: null, acumulaComCupom: false, chamada: null } }),
    assinanteDoTelefone: async () => (socio ? { ...socio } : null),
    prepararAssinatura: async (_c: string, d: any) => (preparados.push(d.clienteId), { callback: "clb-1" }),
  });
  stub("../src/lib/clube/assinatura-asaas", {
    cancelarSocio: async (_c: string, s: any) => (cancelados.push(s.id), { ok: true }),
    assinarNoAsaas: async () => ({ ok: false, erro: "não usado" }),
    sincronizarSeVelho: async (_c: string, s: any) => s,
  });
  const clube = await import("../src/app/api/clube/route");
  const sessaoDe = (id: string) => criarSessaoDoCliente(id, CLIENTES[id].phone)!;
  const ativo = (extra: any) => ({ id: "s1", chave: LOJA.id, status: "ATIVO", pagoAte: new Date(Date.now() + 10 * 86_400_000).toISOString(), desde: new Date().toISOString(), cobranca: "cakto", ...extra });
  const cancelar = async (cli: string) => {
    cancelados.length = 0;
    const resp: any = await clube.POST(req("/api/clube", { method: "POST", body: { acao: "cancelar", loja: LOJA.id, sessao: sessaoDe(cli) } }));
    return [resp.status, cancelados.length];
  };
  const situacao = async (cli: string) => (await (await clube.GET(req(`/api/clube?loja=${LOJA.id}`, { headers: { "x-sessao-cliente": sessaoDe(cli) } }))).json()).situacao;

  socio = ativo({ clienteId: "cli-v", telefone: "22999991234" });
  confere("sócio com dono: outra conta com o mesmo final (55 na frente) não cancela", await cancelar("cli-a"), [404, 0]);
  confere("…nem vê a situação dela", await situacao("cli-a"), "nao_assinante");
  confere("…a dona cancela como sempre", await cancelar("cli-v"), [200, 1]);
  confere("…e vê a situação dela", await situacao("cli-v"), "ativo");
  preparados.length = 0;
  let resp: any = await clube.POST(req("/api/clube", { method: "POST", body: { loja: LOJA.id, sessao: sessaoDe("cli-a") } }));
  confere("…outra conta não 'assina' por cima da linha dela (trocaria o dono)", [resp.status, preparados.length], [409, 0]);
  resp = await clube.POST(req("/api/clube", { method: "POST", body: { loja: LOJA.id, sessao: sessaoDe("cli-v") } }));
  confere("…a dona abre o checkout como sempre", [resp.status, typeof (await resp.json()).checkout, preparados], [200, "string", ["cli-v"]]);

  socio = ativo({ clienteId: null, telefone: "5522999991234" });
  confere("sócio sem dono (comprou pelo link): o mesmo telefone inteiro cancela", await cancelar("cli-v"), [200, 1]);
  confere("…outro DDD com o mesmo final não", await cancelar("cli-b"), [404, 0]);

  socio = ativo({ clienteId: "cli-excluida", telefone: "22999991234" });
  confere("conta dona excluída: o mesmo telefone inteiro assume", await cancelar("cli-v"), [200, 1]);
  confere("…outro DDD não", await cancelar("cli-b"), [404, 0]);

  socio = null;
  resp = await clube.POST(req("/api/clube", { method: "POST", body: { loja: LOJA.id, sessao: sessaoDe("cli-b") } }));
  confere("sem assinatura: assinar abre o checkout como sempre", resp.status, 200);
  resp = await clube.POST(req("/api/clube", { method: "POST", body: { acao: "cancelar", loja: LOJA.id } }));
  confere("cancelar sem sessão: 401 como sempre", resp.status, 401);

  const pedido = ler("src/app/api/customer-order/route.ts");
  confere("desconto no pedido: confere o dono pela sessão", /socioEhDoCliente\(assinante, \{ id: sessao\.clienteId, phone: sessao\.telefone \}\)/.test(pedido), true);

  // ── F50/F76 ────────────────────────────────────────────────────────────────
  console.log("\n── Motoboy: o limite de tentativas não se dribla pelo slug ──");
  const moto = await import("../src/app/api/motoboys/login/route");
  const logar = (slug: string, senhaDigitada: string, deIp: string) =>
    moto.POST(req("/api/motoboys/login", { method: "POST", body: { storeSlug: slug, phone: "Joao", password: senhaDigitada }, headers: { "x-forwarded-for": deIp } }));
  const st: number[] = [];
  for (let i = 0; i < 10; i++) st.push((await logar("pizzaria-x", "errada", "20.0.0.1")).status);
  confere("10 tentativas erradas: 401", [...new Set(st)], [401]);
  confere("11ª com o slug em maiúsculas e espaço: 429", (await logar("  PIZZARIA-X ", "errada", "20.0.0.1")).status, 429);
  const st2: number[] = [];
  for (const s of ["pizz", "pizza", "pizzar", "pizzari", "pizzaria", "Pizzaria", "pizzaria ", "pizzaria x", "PIZZARIA X", "izzaria"]) st2.push((await logar(s, "errada", "20.0.0.2")).status);
  confere("10 pedaços do nome da mesma loja: 401", [...new Set(st2)], [401]);
  confere("…o 11º pedaço cai no limite da loja achada: 429", (await logar("zzaria", "errada", "20.0.0.2")).status, 429);
  resp = await logar("pizzaria-x", SENHA_MOTO, "20.0.0.3");
  confere("motoboy com a senha certa entra como sempre", [resp.status, (await resp.json()).motoboyId], [200, "m1"]);

  // ── F37 (por último: põe window/document de mentira) ───────────────────────
  console.log("\n── F37: o GTM só carrega com a sessão confirmada vazia ──");
  stub("react", { useEffect: (fn: () => void) => { fn(); } });
  const scriptsCarregados: string[] = [];
  const doc: any = {
    getElementById: (id: string) => (scriptsCarregados.includes(id) ? {} : null),
    createElement: () => ({}),
    head: { appendChild: (s: any) => scriptsCarregados.push(s.id) },
    body: { appendChild: () => {} },
  };
  (globalThis as any).window = { dataLayer: [] };
  (globalThis as any).document = doc;
  const { default: GoogleAnalytics } = await import("../src/components/customer/GoogleAnalytics");
  const fetchOriginal = globalThis.fetch;
  const carrega = async (id: string, resposta: () => Promise<any>) => {
    (globalThis as any).fetch = resposta;
    (GoogleAnalytics as any)({ gtmId: id });
    for (let i = 0; i < 5; i++) await espera();
    return scriptsCarregados.includes(`gtm-${id}`);
  };
  const json = (status: number, corpo: any) => async () => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  confere("cliente sem login (sessão {}): carrega", await carrega("GTM-AAAA01", json(200, {})), true);
  confere("logado (sessão com user): não carrega", await carrega("GTM-AAAA02", json(200, { user: { email: "dono@loja" } })), false);
  confere("consulta da sessão falhou (rede): não carrega", await carrega("GTM-AAAA03", async () => { throw new Error("rede"); }), false);
  confere("sessão respondeu 500 em HTML: não carrega", await carrega("GTM-AAAA04", async () => new Response("<html>erro</html>", { status: 500 })), false);
  confere("sessão respondeu 500 com {}: não carrega", await carrega("GTM-AAAA05", json(500, {})), false);
  confere("sessão respondeu null: não carrega", await carrega("GTM-AAAA06", json(200, null)), false);
  (globalThis as any).fetch = fetchOriginal;

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
