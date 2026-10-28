/**
 * scripts/teste-uso-legado.ts — a contagem no banco de quem ainda usa os
 * caminhos antigos que a fase 2 vai travar (lib/uso-legado.ts):
 *
 *   - soma em memória e grava no máximo 1 vez a cada 10 min por chave;
 *   - a gravação soma no banco (ON CONFLICT … vezes + EXCLUDED.vezes) e só
 *     para loja que existe;
 *   - nunca lança, sem banco postgres não faz nada;
 *   - os três pontos (fila sem token do Assistente, extensão com id cru,
 *     motoboy sem sessão assinada) contam SÓ no caminho antigo, e a resposta
 *     das rotas é a mesma com o banco do contador de pé ou quebrado;
 *   - GET /api/admin/uso-legado: 403 fora da equipe interna, resumo para ela.
 *
 *   DATABASE_URL="postgresql://127.0.0.1:1/teste" NEXTAUTH_SECRET=teste-local npx tsx scripts/teste-uso-legado.ts
 *
 * Banco falso em globalThis.prisma e libs trocadas no cache do require (o
 * molde de teste-diversos-n6). Sem banco nem rede.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/teste";
process.env.NEXTAUTH_SECRET ||= "teste-local";
delete process.env.FIREHUB_LOCAL;

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Banco falso ─────────────────────────────────────────────────────────────
const LOJA = "cl0lojalegado01";
const MOTO = { id: "mb_legado", name: "Joao", franchiseeId: LOJA, active: true, password: "hash-da-senha" };
const LOJAS_QUE_EXISTEM = new Set([LOJA]);

/** As gravações na UsoLegado e a "tabela" que elas somam (o ON CONFLICT). */
let inserts: { sql: string; args: any[] }[] = [];
const tabelaUso = new Map<string, number>();
let bancoQuebrado = false;

const vazio = (metodo: string) => async () =>
  metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
let linhasDaLeitura: any[] = [];
let usuarios: Record<string, { role: string; ownerId: string | null }> = {};

(globalThis as any).prisma = new Proxy(
  {
    user: tabela({
      findUnique: async ({ where }: any) => (usuarios[where?.id] ? { ...usuarios[where.id] } : null),
      findFirst: async ({ where }: any) => (LOJAS_QUE_EXISTEM.has(where?.id) ? { id: where.id, ownerId: null, role: "FRANCHISEE", name: "Loja", etaConfig: { motoboysCount: 3 } } : null),
    }),
    motoboy: tabela({
      findUnique: async ({ where }: any) => (where?.id === MOTO.id ? { ...MOTO } : null),
      findFirst: async ({ where }: any) => (where?.id === MOTO.id && where?.franchiseeId === LOJA ? { id: MOTO.id, name: MOTO.name } : null),
      updateMany: async ({ where }: any) => ({ count: where?.id === MOTO.id && (!where.franchiseeId || where.franchiseeId === LOJA) ? 1 : 0 }),
    }),
    $transaction: async (ops: any[]) => Promise.all(ops),
    // BootDDL/Vez existem e o grupo já foi aplicado: a DDL pula.
    $queryRawUnsafe: async (sql: string) => (/FROM "UsoLegado"/.test(sql) ? linhasDaLeitura : [{ boot: true, vez: true, ok: 1 }]),
    $executeRawUnsafe: async (sql: string, ...args: any[]) => {
      if (!/INSERT INTO "UsoLegado"/.test(sql)) return 0;
      if (bancoQuebrado) throw new Error("banco fora do ar");
      inserts.push({ sql, args });
      const [tipo, lojaId, detalhe, dia, vezes] = args;
      if (!LOJAS_QUE_EXISTEM.has(lojaId)) return 0; // o WHERE EXISTS
      const k = `${tipo}|${lojaId}|${detalhe}|${dia}`;
      tabelaUso.set(k, (tabelaUso.get(k) || 0) + vezes); // o ON CONFLICT … vezes + EXCLUDED.vezes
      return 1;
    },
  },
  { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
);

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = null;
const getServerSession = async () => sessao;
stub("next-auth/next", { getServerSession });
stub("next-auth", { getServerSession, default: () => null });
stub("../src/lib/auth", { authOptions: {}, renovarMarcaDaSessao: async () => {} });

let ip = 0;
const req = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
  const { NextRequest } = require("next/server");
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method || "GET",
    headers: { "x-forwarded-for": `10.1.0.${++ip}`, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
};

async function main() {
  const uso = await import("../src/lib/uso-legado");
  const { anotarUsoLegado, usoLegadoParaTeste: T, JANELA_DA_GRAVACAO_MS: J } = uso;
  const pendentes = () => [...T.contas().values()].reduce((s, c) => s + c.pendentes, 0);
  const somaNoBanco = () => [...tabelaUso.values()].reduce((s, v) => s + v, 0);
  const limpar = async () => { await T.esperar(); T.zerar(); inserts = []; tabelaUso.clear(); bancoQuebrado = false; };

  // ── Acúmulo e limite de 10 min ────────────────────────────────────────────
  console.log("\n── Acúmulo: 1 gravação a cada 10 min por chave, somando ──");
  const t0 = Date.parse("2026-10-28T15:00:00Z");
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", t0);
  for (let i = 1; i <= 4; i++) anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", t0 + i * 1000);
  await T.esperar();
  confere("a 1ª chamada grava na hora (vezes=1); as outras 4 ficam em memória", [inserts.length, inserts[0]?.args[4], pendentes()], [1, 1, 4]);
  confere("dia no fuso de São Paulo e argumentos na ordem da tabela", inserts[0]?.args.slice(0, 4), ["motoboy-sem-sessao", LOJA, "orders GET", "2026-10-28"]);
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", t0 + 5 * 60_000);
  T.descarregar(t0 + J - 1);
  await T.esperar();
  confere("antes de 10 min não grava de novo", [inserts.length, pendentes()], [1, 5]);
  T.descarregar(t0 + J);
  await T.esperar();
  confere("com 10 min, uma gravação só com a soma (5)", [inserts.length, inserts[1]?.args[4], pendentes()], [2, 5, 0]);
  confere("ultimoEm = a última chamada", inserts[1]?.args[5], new Date(t0 + 5 * 60_000).toISOString());
  confere("no banco: 6 chamadas = 6 vezes", somaNoBanco(), 6);
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders PATCH", t0 + J + 1);
  anotarUsoLegado("extensao-token-cru", LOJA, "orders GET", t0 + J + 1);
  await T.esperar();
  confere("outro detalhe ou outro tipo = outra chave, grava na hora", inserts.length, 4);
  const sql = inserts[0]?.sql || "";
  confere("SQL soma no banco (duas instâncias juntam) e só para loja que existe", [
    /ON CONFLICT \("tipo", "lojaId", "detalhe", "dia"\) DO UPDATE/.test(sql),
    /"vezes" = "UsoLegado"\."vezes" \+ EXCLUDED\."vezes"/.test(sql),
    /WHERE EXISTS \(SELECT 1 FROM "User" WHERE "id" = \$2\)/.test(sql),
  ], [true, true, true]);
  // Virada do dia em São Paulo (03:00 UTC): chave nova, grava na hora.
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", Date.parse("2026-10-29T02:59:00Z"));
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", Date.parse("2026-10-29T03:00:00Z"));
  await T.esperar();
  confere("o dia vira à meia-noite de São Paulo", inserts.slice(-1).map((i) => i.args[3]), ["2026-10-29"]);
  await limpar();

  console.log("\n── Nunca lança, nunca espera; lixo não conta ──");
  bancoQuebrado = true;
  let lancou = false;
  try {
    const r = anotarUsoLegado("assistente-sem-token", LOJA, "rota=fila sessao=nao", t0);
    confere("devolve na hora (void, sem promessa)", r, undefined);
  } catch { lancou = true; }
  await T.esperar();
  confere("banco quebrado: não lança e a chamada volta para a fila", [lancou, pendentes()], [false, 1]);
  bancoQuebrado = false;
  T.descarregar(t0 + J);
  await T.esperar();
  confere("…e sai na janela seguinte", [somaNoBanco(), pendentes()], [1, 0]);
  await limpar();
  anotarUsoLegado("motoboy-sem-sessao", "-", "orders GET", t0);
  anotarUsoLegado("motoboy-sem-sessao", null, "orders GET", t0);
  anotarUsoLegado("motoboy-sem-sessao", "x".repeat(65), "orders GET", t0);
  await T.esperar();
  confere("loja vazia, '-' ou id gigante: nem entra na memória", [T.contas().size, inserts.length], [0, 0]);
  anotarUsoLegado("motoboy-sem-sessao", "loja_que_nao_existe", "orders GET", t0);
  await T.esperar();
  confere("loja que não existe: o INSERT não grava linha (WHERE EXISTS)", [inserts.length, somaNoBanco()], [1, 0]);
  await limpar();
  const urlDeVerdade = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "file:./dev.db";
  anotarUsoLegado("motoboy-sem-sessao", LOJA, "orders GET", t0);
  process.env.DATABASE_URL = urlDeVerdade;
  await T.esperar();
  confere("sem banco postgres: não faz nada", [T.contas().size, inserts.length], [0, 0]);
  await limpar();

  // ── Os três pontos ────────────────────────────────────────────────────────
  const contados = () => [...T.contas().values()].map((c) => `${c.tipo}|${c.lojaId}|${c.detalhe}`).sort();

  console.log("\n── Assistente: fila sem token conta; com token, não ──");
  const ast = await import("../src/lib/token-do-assistente");
  const H = ast.CABECALHO_DO_TOKEN_DO_ASSISTENTE;
  let r = await ast.barrarChamadaDaFila(new Headers(), LOJA, "fila");
  await T.esperar();
  confere("sem token: passa como sempre (null) e conta sessao=nao", [r, contados()], [null, [`assistente-sem-token|${LOJA}|rota=fila sessao=nao`]]);
  await limpar();
  r = await ast.barrarChamadaDaFila(new Headers({ [H]: ast.criarTokenDoAssistente(LOJA) }), LOJA, "fila");
  confere("token certo: passa e não conta", [r, contados()], [null, []]);
  const recusa = await ast.barrarChamadaDaFila(new Headers({ [H]: "outra.loja" }), LOJA, "fila");
  confere("token errado: 403 como antes e não conta", [recusa?.status, contados()], [403, []]);
  r = await ast.barrarChamadaDaFila(new Headers({ cookie: "next-auth.session-token=x" }), LOJA, "ack", async () => true);
  await T.esperar();
  confere("sem token com sessão da loja: passa e conta sessao=sim (à parte)", [r, contados()], [null, [`assistente-sem-token|${LOJA}|rota=ack sessao=sim`]]);
  await limpar();

  console.log("\n── Extensão: id cru conta; assinado, não ──");
  const ext = await import("../src/lib/extensao-token");
  const etaConfig = await import("../src/app/api/store/eta-config/route");
  const comCru = await etaConfig.GET(req(`/api/store/eta-config?token=${LOJA}`));
  const corpoCru = await comCru.json();
  await T.esperar();
  confere("eta-config com id cru: lê como sempre e conta", [comCru.status, contados()], [200, [`extensao-token-cru|${LOJA}|eta-config`]]);
  await limpar();
  const comAssinado = await etaConfig.GET(req(`/api/store/eta-config?token=${encodeURIComponent(ext.criarTokenDeExtensao(LOJA))}`));
  confere("eta-config com token assinado: mesma resposta e não conta", [comAssinado.status, JSON.stringify(await comAssinado.json()) === JSON.stringify(corpoCru), contados()], [200, true, []]);
  await etaConfig.GET(req(`/api/store/eta-config?token=loja_que_nao_existe`));
  confere("id cru de loja que não existe: não conta", contados(), []);

  console.log("\n── Motoboy: par solto conta; sessão assinada, não ──");
  const { criarSessaoDeMotoboy } = await import("../src/lib/motoboy-sessao");
  const bearer = { authorization: `Bearer ${criarSessaoDeMotoboy(MOTO.id, LOJA, MOTO.password)}` };
  const orders = await import("../src/app/api/motoboys/orders/route");
  const ranking = await import("../src/app/api/motoboys/ranking/route");
  const relatorio = await import("../src/app/api/motoboys/relatorio/route");
  const location = await import("../src/app/api/motoboys/location/route");
  const par = `motoboyId=${MOTO.id}&storeId=${LOJA}`;
  const corpoGps = { lat: -22.37, lng: -41.78 };

  /** Roda a chamada com o banco do contador de pé e quebrado: a resposta tem de ser igual. */
  // (sem os carimbos de hora: o período do relatório sai do Date.now() de cada chamada)
  const semHora = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<hora>");
  const resposta = async (fazer: () => Promise<Response>) => {
    const a = await fazer();
    const corpoA = semHora(await a.text());
    await T.esperar();
    const contou = contados();
    await limpar();
    bancoQuebrado = true;
    const b = await fazer();
    const corpoB = semHora(await b.text());
    await T.esperar();
    await limpar();
    return { status: a.status, contou, igual: a.status === b.status && corpoA === corpoB };
  };
  const casos: [string, () => Promise<Response>, string | null][] = [
    ["orders GET", () => orders.GET(req(`/api/motoboys/orders?${par}`)), "orders GET"],
    ["orders PATCH", () => orders.PATCH(req("/api/motoboys/orders", { method: "PATCH", body: { orderId: "pedido_x", motoboyId: MOTO.id, storeId: LOJA } })), "orders PATCH"],
    ["ranking GET", () => ranking.GET(req(`/api/motoboys/ranking?${par}`)), "ranking GET"],
    ["relatorio GET", () => relatorio.GET(req(`/api/motoboys/relatorio?${par}`)), "relatorio GET"],
    ["location POST", () => location.POST(req("/api/motoboys/location", { method: "POST", body: { ...corpoGps, motoboyId: MOTO.id, storeId: LOJA } })), "location POST"],
  ];
  for (const [nome, fazer, detalhe] of casos) {
    const x = await resposta(fazer);
    confere(`${nome} com o par solto: conta e a resposta não muda (status ${x.status})`, [x.contou, x.igual], [[`motoboy-sem-sessao|${LOJA}|${detalhe}`], true]);
  }
  const comSessao: [string, () => Promise<Response>][] = [
    ["orders GET", () => orders.GET(req(`/api/motoboys/orders?formato=app`, { headers: bearer }))],
    ["orders PATCH", () => orders.PATCH(req("/api/motoboys/orders", { method: "PATCH", body: { orderId: "pedido_x" }, headers: bearer }))],
    ["ranking GET", () => ranking.GET(req(`/api/motoboys/ranking`, { headers: bearer }))],
    ["relatorio GET", () => relatorio.GET(req(`/api/motoboys/relatorio`, { headers: bearer }))],
    ["location POST", () => location.POST(req("/api/motoboys/location", { method: "POST", body: corpoGps, headers: bearer }))],
  ];
  for (const [nome, fazer] of comSessao) {
    const x = await resposta(fazer);
    confere(`${nome} com sessão assinada: não conta (status ${x.status})`, x.contou, []);
  }
  let x = await resposta(() => orders.GET(req(`/api/motoboys/orders?motoboyId=${MOTO.id}&storeId=loja_que_nao_existe`)));
  confere("par solto de loja/motoboy que não existe: 401 como antes e não conta", [x.status, x.contou], [401, []]);
  x = await resposta(() => location.POST(req("/api/motoboys/location", { method: "POST", body: { ...corpoGps, motoboyId: MOTO.id } })));
  confere("location do app antigo sem storeId: grava como antes, não diz a loja e não conta", [x.status, x.contou], [200, []]);
  x = await resposta(() => orders.GET(req(`/api/motoboys/orders?formato=app`, { headers: { authorization: "Bearer v1.falso" } })));
  confere("sessão que não confere: 401 como antes e não conta", [x.status, x.contou], [401, []]);

  // ── Rota da equipe interna ────────────────────────────────────────────────
  console.log("\n── GET /api/admin/uso-legado ──");
  const admin = await import("../src/app/api/admin/uso-legado/route");
  usuarios = { adm: { role: "ADMIN", ownerId: null }, interno: { role: "STAFF", ownerId: null }, caixa: { role: "STAFF", ownerId: LOJA }, dono: { role: "FRANCHISEE", ownerId: null } };
  const status = async (id: string | null) => {
    sessao = id ? { user: { id } } : null;
    return (await admin.GET(req("/api/admin/uso-legado?dias=14"))).status;
  };
  confere("sem sessão, dono de loja e funcionário de loja: 403", [await status(null), await status("dono"), await status("caixa")], [403, 403, 403]);
  linhasDaLeitura = [
    { tipo: "assistente-sem-token", lojaId: LOJA, detalhe: "rota=fila sessao=nao", dia: "2026-10-27", vezes: 120, ultimoEm: new Date("2026-10-27T23:50:00Z"), storeName: "Pizzaria X", slug: "pizzaria-x" },
    { tipo: "assistente-sem-token", lojaId: LOJA, detalhe: "rota=fila sessao=nao", dia: "2026-10-28", vezes: 30, ultimoEm: new Date("2026-10-28T14:00:00Z"), storeName: "Pizzaria X", slug: "pizzaria-x" },
    { tipo: "assistente-sem-token", lojaId: LOJA, detalhe: "rota=ack sessao=sim", dia: "2026-10-28", vezes: 4, ultimoEm: new Date("2026-10-28T14:10:00Z"), storeName: "Pizzaria X", slug: "pizzaria-x" },
    { tipo: "motoboy-sem-sessao", lojaId: "outra", detalhe: "orders GET", dia: "2026-10-28", vezes: 7, ultimoEm: new Date("2026-10-28T12:00:00Z"), storeName: null, slug: null },
  ];
  sessao = { user: { id: "interno" } };
  const resp = await admin.GET(req("/api/admin/uso-legado?dias=999"));
  const corpo = await resp.json();
  confere("equipe interna (ADMIN e STAFF sem dono): 200", [await status("adm"), resp.status], [200, 200]);
  confere("dias limitado a 90", corpo.dias, 90);
  confere("resumo por tipo (os três sempre aparecem)", corpo.resumo, [
    { tipo: "assistente-sem-token", lojas: 1, ultimoUso: "2026-10-28T14:10:00.000Z" },
    { tipo: "extensao-token-cru", lojas: 0, ultimoUso: null },
    { tipo: "motoboy-sem-sessao", lojas: 1, ultimoUso: "2026-10-28T12:00:00.000Z" },
  ]);
  const loja = corpo.porTipo["assistente-sem-token"][0];
  confere("por loja: total, dias com uso, último uso e detalhes", [loja.storeName, loja.slug, loja.vezes, loja.diasComUso, loja.ultimoUso, loja.detalhes], [
    "Pizzaria X", "pizzaria-x", 154, 2, "2026-10-28T14:10:00.000Z",
    [
      { detalhe: "rota=fila sessao=nao", vezes: 150, diasComUso: 2, ultimoUso: "2026-10-28T14:00:00.000Z" },
      { detalhe: "rota=ack sessao=sim", vezes: 4, diasComUso: 1, ultimoUso: "2026-10-28T14:10:00.000Z" },
    ],
  ]);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
