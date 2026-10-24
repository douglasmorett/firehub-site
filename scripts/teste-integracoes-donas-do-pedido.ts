/**
 * scripts/teste-integracoes-donas-do-pedido.ts — Anota AI e aiqfome só mexem na página/pedido da PRÓPRIA loja.
 *
 *   npx tsx scripts/teste-integracoes-donas-do-pedido.ts
 *
 * Sem banco e sem rede: prisma falso em memória (só a tabela AnotaAiLoja e o
 * User) e um Anota AI FALSO atrás do `fetch` (qualquer outro endereço é
 * barrado). Os furos de 24/10/2026 (relatório de segurança F2–F5):
 *
 *   - JWT montado à mão com o `idpage` de outro restaurante não liga a página;
 *   - o `idpage` só vem da resposta do `linkpage-by-token`, nunca da chave colada;
 *   - o Token da unidade (vínculo à mão no portal) segue valendo para o ADMIN;
 *   - página ligada (mesmo desligada) em outra conta não troca de dono sem ADMIN;
 *   - status do Anota AI/aiqfome com pedido de outra loja não chama nada lá —
 *     e o da loja dona continua indo.
 */
import { NextRequest } from "next/server";

let falhas = 0;
let total = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

Object.assign(process.env, { ANOTAAI_CLIENT_ID: "cliente-teste", ANOTAAI_CLIENT_SECRET: "segredo-teste", ANOTAAI_BASE_URL: "http://anotaai.falso" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "teste";

// ── Prisma falso ─────────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const usuarios: Linha[] = [
  { id: "loja-v", email: "vitima@teste", role: "FRANQUEADO", ownerId: null, permissions: null },
  { id: "loja-x", email: "atacante@teste", role: "FRANQUEADO", ownerId: null, permissions: null },
  { id: "loja-c", email: "loja-c@teste", role: "FRANQUEADO", ownerId: null, permissions: null },
  { id: "admin", email: "admin@teste", role: "ADMIN", ownerId: null, permissions: null },
];
const paginas: Linha[] = [];
const norm = (q: string) => q.replace(/\s+/g, " ").trim();

async function executar(bruto: string, ...p: any[]): Promise<number> {
  const q = norm(bruto);
  if (/^CREATE (TABLE|INDEX)/.test(q)) return 0;
  if (/"AcaoPendente/.test(q)) return 1;
  if (q.startsWith(`INSERT INTO "AnotaAiLoja"`)) {
    const [pageId, franchiseeId, nome, quem] = p;
    const l = paginas.find((x) => x.pageId === pageId);
    if (l) Object.assign(l, { franchiseeId, nome: nome ?? l.nome, ativa: true, conectadaPor: quem, conectadaEm: new Date(), importarDesde: new Date() });
    else paginas.push({ pageId, franchiseeId, nome, ativa: true, conectadaPor: quem, conectadaEm: new Date(), importarDesde: new Date() });
    return 1;
  }
  if (q.startsWith(`UPDATE "AnotaAiLoja" SET "nome" = $2 WHERE "pageId" = $1`)) {
    const l = paginas.find((x) => x.pageId === p[0]);
    if (l) l.nome = p[1];
    return l ? 1 : 0;
  }
  if (q.startsWith(`UPDATE "AnotaAiLoja" SET "ativa" = false`)) {
    const l = paginas.find((x) => x.pageId === p[0] && x.franchiseeId === p[1] && x.ativa);
    if (l) l.ativa = false;
    return l ? 1 : 0;
  }
  throw new Error(`SQL não emulado: ${q}`);
}
async function consultar(bruto: string, ...p: any[]): Promise<any[]> {
  const q = norm(bruto);
  if (/"AcaoPendente/.test(q)) return [];
  if (q === `SELECT * FROM "AnotaAiLoja" WHERE "pageId" = $1`) return paginas.filter((l) => l.pageId === p[0]).map((l) => ({ ...l }));
  if (q === `SELECT * FROM "AnotaAiLoja" WHERE "pageId" = $1 AND "ativa" = true`) return paginas.filter((l) => l.pageId === p[0] && l.ativa).map((l) => ({ ...l }));
  throw new Error(`SELECT não emulado: ${q}`);
}
(globalThis as any).prisma = {
  user: { findUnique: async ({ where }: any) => usuarios.find((u) => u.email === where.email) ?? null },
  $executeRawUnsafe: executar,
  $queryRawUnsafe: consultar,
};

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: string | null = null;
stub("next-auth/next", { getServerSession: async () => (sessao ? { user: { email: sessao } } : null) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/ifood-token", {
  // Igual ao de verdade: ADMIN usa a loja escolhida; o resto, a própria conta.
  lojaDaSessao: async (email: string, ativa?: string | null) => {
    const u = usuarios.find((x) => x.email === email);
    if (!u) return null;
    if (u.role === "ADMIN" && ativa && ativa !== "all") return ativa;
    return u.ownerId || u.id;
  },
});

// aiqfome: instalação e API falsas (o que se testa é a conferência da conta).
const chamadasAQ: string[] = [];
stub("../src/lib/aiqfome/instalacoes", {
  instalacaoAtiva: async (storeId: string) => (String(storeId) === "53852" ? { id: "1", storeId: "53852", franchiseeId: "loja-v", nome: "Pizzaria da Vítima", ativa: true } : null),
});
stub("../src/lib/aiqfome/api", {
  aiqfomeConfigurada: () => true,
  buscarPedidoAQ: async (_i: any, id: string) => (chamadasAQ.push(`get ${id}`), { ok: true, status: 200, dados: { is_read: false } }),
  acaoNoPedidoAQ: async (_i: any, acao: string, id: string) => (chamadasAQ.push(`${acao} ${id}`), { ok: true, status: 200 }),
});

// ── Anota AI falso ───────────────────────────────────────────────────────────
const VITIMA = "vvvvvvvvvvvvvvvvvvvvvvv1";
const PAGINA_X = "xxxxxxxxxxxxxxxxxxxxxxx2";
const PAGINA_V2 = "vvvvvvvvvvvvvvvvvvvvvvv3";
const UNIDADE = "uuuuuuuuuuuuuuuuuuuuuuu4";
const jwt = (p: object) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(p)).toString("base64url")}.x`;
const FORJADO = jwt({ idpartner: "firehub", idpage: VITIMA });
// Chave que o Anota AI aceita (é da loja X), mas que traz o idpage da vítima dentro.
const CHAVE_X_COM_VITIMA_DENTRO = jwt({ idpage: VITIMA, loja: "x" });
const CHAVE_SEM_IDPAGE = jwt({ idpage: VITIMA, sem: "resposta" });
const CHAVES: Record<string, string | null> = {
  [CHAVE_X_COM_VITIMA_DENTRO]: PAGINA_X,
  "chave-da-vitima-0123456789": VITIMA,
  "chave-da-vitima-2-0123456789": PAGINA_V2,
  [CHAVE_SEM_IDPAGE]: null,
};
const chamadas: Array<{ caminho: string; pagina?: string; pageToken?: string }> = [];
const barradas: string[] = [];
globalThis.fetch = (async (entrada: any, init?: any) => {
  const alvo = String(typeof entrada === "string" ? entrada : entrada?.url || entrada);
  if (!alvo.startsWith("http://anotaai.falso/")) {
    barradas.push(alvo.slice(0, 80));
    throw new Error("rede barrada no teste");
  }
  const url = new URL(alvo);
  const pagina = init?.headers?.["x-page-id"];
  const corpo = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : {};
  chamadas.push({ caminho: url.pathname, pagina, pageToken: corpo.pageToken });
  const json = (status: number, d: unknown) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
  if (url.pathname.endsWith("/oauth-client/token")) return json(200, { accessToken: "tok-1", expiresIn: 3600 });
  if (url.pathname.endsWith("/linkpage-by-token")) {
    if (!(corpo.pageToken in CHAVES)) return json(200, { success: false, message: "Failed to link page by token", info: null });
    const idpage = CHAVES[corpo.pageToken];
    return json(200, { success: true, info: idpage ? { token: jwt({ idpartner: "firehub", idpage }) } : {} });
  }
  // Com a credencial do PARCEIRO, qualquer página ligada ao FireHub abre — por isso a lista não prova dono.
  if (url.pathname.endsWith("/ping/list")) return json(200, { success: true, info: { docs: [], limit: 100 } });
  if (url.pathname.includes("/ping/get/")) return json(200, { success: true, info: { _id: "p", check: 0 } });
  if (/\/order\/(accept|ready|finalize|cancel)\//.test(url.pathname)) return json(200, { success: true, info: {} });
  return json(404, {});
}) as typeof fetch;

async function main() {
  const rota = await import("../src/app/api/store/integracoes/anotaai/route");
  const lojas = await import("../src/lib/anotaai/lojas");
  const { sincronizarAnotaAi } = await import("../src/lib/anotaai/status");
  const { sincronizarAiqfome } = await import("../src/lib/aiqfome/status");

  const conectar = async (email: string, chave: string, lojaAtiva?: string) => {
    sessao = email;
    const req = new NextRequest("http://localhost/api/store/integracoes/anotaai", {
      method: "POST",
      headers: { "content-type": "application/json", ...(lojaAtiva ? { cookie: `firehub_active_store=${lojaAtiva}` } : {}) },
      body: JSON.stringify({ acao: "conectar", chave }),
    });
    const res = await rota.POST(req);
    return { status: res.status, corpo: await res.json() };
  };
  const pagina = (id: string) => {
    const l = paginas.find((x) => x.pageId === id);
    return l ? [l.franchiseeId, l.ativa] : null;
  };

  // A vítima ligou e depois desligou (desligar não solta a página no Anota AI).
  confere("vítima liga a página dela pela chave", (await conectar("vitima@teste", "chave-da-vitima-0123456789")).status, 200);
  confere("vítima desliga", await lojas.desligarLojaAnotaAi("loja-v", VITIMA), true);

  // ── JWT forjado ────────────────────────────────────────────────────────────
  chamadas.length = 0;
  let r = await conectar("atacante@teste", FORJADO);
  confere("JWT forjado (idpartner + idpage da vítima): recusado", r.status, 400);
  confere("o JWT forjado foi mandado ao linkpage-by-token (sem atalho)", chamadas.filter((c) => c.caminho.endsWith("/linkpage-by-token")).map((c) => c.pageToken === FORJADO), [true]);
  confere("nem abriu a lista da página da vítima", chamadas.some((c) => c.pagina === VITIMA), false);
  confere("a página da vítima segue dela (desligada)", pagina(VITIMA), ["loja-v", false]);

  // ── idpage só da resposta do Anota AI ──────────────────────────────────────
  r = await conectar("atacante@teste", CHAVE_X_COM_VITIMA_DENTRO);
  confere("chave aceita: liga o idpage que o Anota AI DEVOLVEU, não o de dentro da chave", [r.status, r.corpo.pageId], [200, PAGINA_X]);
  confere("página X na loja X; a da vítima intocada", [pagina(PAGINA_X), pagina(VITIMA)], [["loja-x", true], ["loja-v", false]]);
  r = await conectar("atacante@teste", CHAVE_SEM_IDPAGE);
  confere("Anota AI aceitou mas não devolveu idpage: falha (sem cair no idpage da chave)", r.status, 502);
  confere("…e a página da vítima continua dela", pagina(VITIMA), ["loja-v", false]);

  // ── Página de outra loja não troca de dono ─────────────────────────────────
  r = await conectar("atacante@teste", "chave-da-vitima-0123456789");
  confere("página desligada de outra conta: lojista não leva (409)", [r.status, pagina(VITIMA)], [409, ["loja-v", false]]);
  confere("a recusa não mostra o nome gravado pela outra conta", /Vítima/.test(String(r.corpo.error)), false);
  r = await conectar("vitima@teste", "chave-da-vitima-0123456789");
  confere("a própria vítima religa a página dela", [r.status, pagina(VITIMA)], [200, ["loja-v", true]]);
  r = await conectar("atacante@teste", "chave-da-vitima-0123456789");
  confere("página ATIVA de outra conta: recusada", [r.status, pagina(VITIMA)], [409, ["loja-v", true]]);
  confere("ATIVA em outra conta: nem o ADMIN move direto", (await lojas.ligarLojaAnotaAi({ pageId: VITIMA, franchiseeId: "loja-c", nome: null, quem: "admin", podeTrocarDono: true })).ok, false);
  confere("loja nova liga página nova normalmente", (await conectar("vitima@teste", "chave-da-vitima-2-0123456789")).status, 200);
  await lojas.desligarLojaAnotaAi("loja-v", PAGINA_V2);
  r = await conectar("admin@teste", "chave-da-vitima-2-0123456789", "loja-c");
  confere("ADMIN move a página DESLIGADA para outra loja", [r.status, pagina(PAGINA_V2)], [200, ["loja-c", true]]);

  // ── Token da unidade: só ADMIN ─────────────────────────────────────────────
  const tokenDaUnidade = jwt({ idpartner: "firehub", idpage: UNIDADE });
  r = await conectar("loja-c@teste", tokenDaUnidade);
  confere("Token da unidade colado pelo lojista: recusado, com a dica da chave certa", [r.status, /Token da unidade/.test(String(r.corpo.error)), pagina(UNIDADE)], [400, true, null]);
  chamadas.length = 0;
  r = await conectar("admin@teste", tokenDaUnidade, "loja-c");
  confere("Token da unidade pelo ADMIN: liga na loja escolhida", [r.status, pagina(UNIDADE)], [200, ["loja-c", true]]);
  confere("…sem passar pelo linkpage-by-token (vínculo feito no portal)", chamadas.some((c) => c.caminho.endsWith("/linkpage-by-token")), false);

  // ── Status do Anota AI ─────────────────────────────────────────────────────
  const idDaVitima = `anotaai_${VITIMA}_pedido000000000000001_recovered`;
  chamadas.length = 0;
  let s = await sincronizarAnotaAi({ openDeliveryOrderId: idDaVitima, franchiseeId: "loja-x", status: "ACEITO" }, "CANCELADO", { motivo: "x" });
  confere("Anota AI: pedido de outra loja com a página da vítima — nada vai", [s.ok, s.acoes, chamadas.length], [false, [], 0]);
  s = await sincronizarAnotaAi({ openDeliveryOrderId: idDaVitima, franchiseeId: "loja-x", status: "NOVO" }, "ACEITO");
  confere("Anota AI: nem o aceite", [s.acoes, chamadas.length], [[], 0]);
  s = await sincronizarAnotaAi({ openDeliveryOrderId: `anotaai_${VITIMA}_pedido000000000000001`, franchiseeId: "loja-v", status: "NOVO" }, "ACEITO");
  confere("Anota AI: a loja dona aceita normalmente", [s.ok, s.acoes, chamadas.filter((c) => c.caminho.includes("/order/accept/")).map((c) => c.pagina)], [true, ["accept"], [VITIMA]]);

  // ── Status do aiqfome ──────────────────────────────────────────────────────
  s = await sincronizarAiqfome({ openDeliveryOrderId: "aiqfome_53852_9001_recovered", franchiseeId: "loja-x", status: "ACEITO" }, "ENTREGUE");
  confere("aiqfome: pedido de outra loja com o storeId da vítima — nada vai", [s.ok, s.acoes, chamadasAQ], [false, [], []]);
  s = await sincronizarAiqfome({ openDeliveryOrderId: "aiqfome_53852_9001", franchiseeId: "loja-v", status: "NOVO", deliveryBy: "MERCHANT" }, "ACEITO");
  confere("aiqfome: a loja dona marca como lido normalmente", [s.ok, s.acoes, chamadasAQ], [true, ["mark-as-read"], ["get 9001", "mark-as-read 9001"]]);

  confere("nenhuma chamada fora do Anota AI falso", barradas, []);
  console.log(falhas === 0 ? `\n🎉 Tudo certo (${total} conferências).` : `\n💥 ${falhas} de ${total} falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
