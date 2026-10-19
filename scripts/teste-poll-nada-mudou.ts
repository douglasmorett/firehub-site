/**
 * scripts/teste-poll-nada-mudou.ts — o "nada mudou" do feed do painel
 * (GET /api/customer-order/poll com `desde`) responde vazio SEM a consulta
 * pesada, e o pedido novo SEMPRE aparece.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-poll-nada-mudou.ts
 *
 * Roda a ROTA de verdade contra um banco falso em memória (o `globalThis.prisma`
 * que lib/prisma usa), que avalia o `where` do Prisma sobre uma lista de
 * pedidos. Duas provas:
 *   1. ROTA: rodada sem mudança não faz a consulta do feed e devolve vazio;
 *      pedido novo, status mudado e a encomenda agendada há mais de 7 dias
 *      aparecem na rodada seguinte.
 *   2. RECORTE: para centenas de pedidos sorteados e vários `desde`, todo
 *      pedido que a consulta de "só o que mudou" traria está entre os ids de
 *      `idsQueMudaram` — é isso que torna o atalho seguro.
 */
import Module from "module";

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "segredo-so-do-teste";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

// ── Sessão falsa: o lojista logado ──────────────────────────────────────────
const EMAIL = "loja@teste.com";
const LOJA = "loja_feed_teste";
const carregar = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  const real = carregar.apply(this, [req, parent, isMain]);
  if (req === "next-auth/next" || req === "next-auth") {
    return new Proxy(real, { get: (t, k) => (k === "getServerSession" ? async () => ({ user: { email: EMAIL } }) : (t as any)[k]) });
  }
  return real;
};
(globalThis as any).fetch = async () => { throw new Error("sem rede no teste"); };

// ── Avaliador do `where` do Prisma (o que o feed usa) ──────────────────────
const vale = (v: unknown) => (v instanceof Date ? v.getTime() : v);
function campo(valor: unknown, cond: any): boolean {
  if (cond === null) return valor == null;
  if (cond instanceof Date || typeof cond !== "object") return valor != null && vale(valor) === vale(cond);
  return Object.entries(cond).every(([op, alvo]: [string, any]) => {
    if (op === "mode") return true;
    if (op === "not") return alvo === null ? valor != null : alvo !== null && typeof alvo === "object" && !(alvo instanceof Date) ? !campo(valor, alvo) : valor != null && vale(valor) !== vale(alvo);
    if (valor == null) return false;
    const v = vale(valor) as any, a = vale(alvo) as any;
    switch (op) {
      case "equals": return v === a;
      case "in": return (alvo as any[]).map(vale).includes(v);
      case "notIn": return !(alvo as any[]).map(vale).includes(v);
      case "gt": return v > a;
      case "gte": return v >= a;
      case "lt": return v < a;
      case "lte": return v <= a;
      case "startsWith": return String(v).startsWith(String(a));
      case "contains": return String(v).includes(String(a));
      default: throw new Error(`operador não previsto no teste: ${op}`);
    }
  });
}
function casa(linha: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === "AND") return (Array.isArray(cond) ? cond : [cond]).every((w) => casa(linha, w));
    if (k === "OR") return (cond as any[]).some((w) => casa(linha, w));
    if (k === "NOT") return !(Array.isArray(cond) ? cond : [cond]).some((w) => casa(linha, w));
    return campo(linha[k], cond);
  });
}

// ── Banco falso ──────────────────────────────────────────────────────────────
const agora = Date.now();
const min = 60_000, dia = 24 * 60 * min;
let pedidos: any[] = [];
const pedido = (id: string, p: Partial<any>) => ({
  id, franchiseeId: LOJA, status: "NOVO", source: "SITE", createdAt: new Date(agora - 60 * min), updatedAt: new Date(agora - 60 * min),
  scheduledDatetime: null, agendado: false, paymentPaidAt: null, gatewayProvider: null, totalAmount: 30, deliveryFee: 0, discountTotal: 0,
  fiscalStatus: null, tableSession: null, motoboy: null, items: [], dailyOrderNumber: 1, ...p,
});
let consultasDoFeed = 0;
const vazio = (metodo: string) => async () =>
  metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
(globalThis as any).prisma = new Proxy(
  {
    user: tabela({
      findUnique: async ({ where }: any) =>
        where?.email === EMAIL || where?.id === LOJA ? { id: LOJA, ownerId: null, role: "FRANCHISEE", storeTimezone: "America/Sao_Paulo", email: EMAIL } : null,
    }),
    customerOrder: tabela({
      findMany: async ({ where, select, take }: any) => {
        if (select?.items) consultasDoFeed++; // a consulta pesada do feed (a de "quem mudou" seleciona só o id)
        const achados = pedidos.filter((p) => casa(p, where)).sort((a, b) => b.createdAt - a.createdAt);
        return JSON.parse(JSON.stringify(take ? achados.slice(0, take) : achados), (k, v) => (/At$|Datetime$/.test(k) && typeof v === "string" ? new Date(v) : v));
      },
    }),
  },
  { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
);

async function main() {
  const { GET } = await import("../src/app/api/customer-order/poll/route");
  const { NextRequest } = await import("next/server");
  const { idsQueMudaram, filtroDoFeed, soOQueMudou, DIAS_ATIVO_SEM_PERIODO } = await import("../src/lib/filtro-do-feed");

  const rodada = async (desde: Date) => {
    consultasDoFeed = 0;
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/customer-order/poll?t=${Date.now()}&desde=${encodeURIComponent(desde.toISOString())}`));
    const corpo = await res.json();
    return { status: res.status, corpo, consultasDoFeed };
  };
  const ids = (r: any) => (r.corpo?.pedidos || []).map((p: any) => p.id).sort().join(",");

  console.log("\n[1] Rodada sem mudança");
  pedidos = [pedido("p_antigo", { status: "ACEITO" }), pedido("p_entregue", { status: "ENTREGUE" })];
  const quieta = await rodada(new Date(Date.now() - 30_000));
  confere(quieta.status === 200, "responde 200");
  confere(Array.isArray(quieta.corpo?.pedidos) && quieta.corpo.pedidos.length === 0 && Array.isArray(quieta.corpo?.removidos) && quieta.corpo.removidos.length === 0, "devolve { pedidos: [], removidos: [] }");
  confere(typeof quieta.corpo?.agora === "string", "traz o `agora` para a próxima rodada");
  confere(quieta.consultasDoFeed === 0, `não faz a consulta pesada do feed (${quieta.consultasDoFeed})`);

  console.log("\n[2] Pedido novo SEMPRE aparece");
  pedidos.push(pedido("p_novo", { status: "NOVO", createdAt: new Date(), updatedAt: new Date() }));
  const comNovo = await rodada(new Date(Date.now() - 30_000));
  confere(ids(comNovo) === "p_novo", `o pedido novo vem na rodada (${ids(comNovo)})`);
  confere(comNovo.consultasDoFeed === 1, "a consulta do feed roda quando há mudança");

  console.log("\n[3] Status mudado aparece");
  pedidos.find((p) => p.id === "p_antigo")!.status = "PRONTO";
  pedidos.find((p) => p.id === "p_antigo")!.updatedAt = new Date();
  const comStatus = await rodada(new Date(Date.now() - 10_000));
  confere(ids(comStatus).includes("p_antigo"), `o pedido com status novo vem (${ids(comStatus)})`);

  console.log("\n[4] Encomenda agendada há mais de 7 dias, para hoje, mudou agora");
  pedidos = [pedido("p_encomenda", { status: "ACEITO", agendado: true, createdAt: new Date(agora - 10 * dia), scheduledDatetime: new Date(agora + 2 * 60 * min), updatedAt: new Date() })];
  const encomenda = await rodada(new Date(Date.now() - 30_000));
  confere(ids(encomenda) === "p_encomenda", `a encomenda vem na rodada, não só na lista completa de 60 s (${ids(encomenda)})`);

  console.log("\n[5] Recorte: todo pedido do 'só o que mudou' está em idsQueMudaram");
  let semente = 42;
  const sorteio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const STATUS = ["NOVO", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA", "ENTREGUE", "CANCELADO", "ENCERRADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"];
  pedidos = Array.from({ length: 600 }, (_, i) => {
    const criado = agora - sorteio() * 30 * dia;
    const atualizado = criado + sorteio() * (agora - criado);
    const agendado = sorteio() < 0.25;
    return pedido(`r${i}`, {
      franchiseeId: sorteio() < 0.9 ? LOJA : "outra_loja",
      status: STATUS[Math.floor(sorteio() * STATUS.length)],
      source: sorteio() < 0.1 ? "TOTEM" : "SITE",
      createdAt: new Date(criado), updatedAt: new Date(atualizado),
      agendado, scheduledDatetime: agendado || sorteio() < 0.05 ? new Date(agora + (sorteio() - 0.5) * 40 * dia) : null,
      paymentPaidAt: sorteio() < 0.5 ? new Date(criado) : null, gatewayProvider: sorteio() < 0.3 ? "asaas" : null,
    });
  });
  const db = (globalThis as any).prisma;
  let casos = 0, furos = 0;
  for (const desdeAtras of [10_000, 30_000, 5 * min, 60 * min, dia, 3 * dia]) {
    for (const [fromAtras, toFrente] of [[dia, dia], [12 * 60 * min, 12 * 60 * min], [10 * dia, 0], [2 * dia, 5 * dia]]) {
      const desde = new Date(agora - desdeAtras), from = new Date(agora - fromAtras), to = new Date(agora + toFrente);
      const ATIVO_SEM_PERIODO_DESDE = new Date(agora - DIAS_ATIVO_SEM_PERIODO * dia);
      const validFranchiseeIds = [LOJA];
      const mudados = await idsQueMudaram(db, { validFranchiseeIds, from, ATIVO_SEM_PERIODO_DESDE, desde });
      if (mudados === null) continue; // mudou demais: a rota devolve a lista completa
      const delta = pedidos.filter((p) => casa(p, soOQueMudou(filtroDoFeed({ validFranchiseeIds, from, to, ATIVO_SEM_PERIODO_DESDE }), desde)));
      casos++;
      const fora = delta.filter((p) => !mudados.includes(p.id));
      if (fora.length) { furos++; console.log("    fora de idsQueMudaram:", fora.map((p) => p.id).join(",")); }
    }
  }
  confere(casos > 10 && furos === 0, `${casos} recortes, nenhum pedido do delta fora de idsQueMudaram`);

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
