/**
 * Rota 100% automatizada, Fase 3 — o empurrão sem esperar o cron e o chip do
 * card do painel:
 *
 *   [1] empurrarRoteirizacao (lib/roteirizacao-automatica/empurrao.ts): loja
 *       fora da liberação não agenda nada nem lê o banco; liberada, o ciclo
 *       vai para o after() e só roda (gravando) com a regra ligada; ciclo que
 *       falha e after() fora de requisição não lançam;
 *   [2] carimbarChegadaNaLoja devolve `chegouAgora` só quando ESTA posição
 *       carimbou a chegada (é o que dispara o empurrão no GPS);
 *   [3] chipsDasRotasAutomaticas: "2/3 prontos", "chamada", "saiu", o
 *       cancelado fora da conta e a rota manual sem chip.
 *
 *   npx tsx scripts/teste-empurrao-da-rota-automatica.ts
 *
 * Sem banco: o Prisma é falso (globalThis.prisma, que lib/prisma.ts
 * reaproveita fora de produção) e o executar é trocado por um que só anota.
 */
export {};

Object.assign(process.env, { NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

const HAKIM = "cmpx96phr0000ujf0sb0qk5vr";
const OUTRA = "loja-qualquer";

// ── Banco falso ──────────────────────────────────────────────────────────────
const consultas: string[] = [];
let regraAtiva = true;
let contagemDoCarimbo = 1;
const gravacoesDoMotoboy: any[] = [];
(globalThis as any).prisma = {
  user: {
    findUnique: async (a: any) => {
      consultas.push(`user:${a.where.id}`);
      return { deliveryConfig: { roteirizacaoAutomatica: { ativo: regraAtiva } }, storeLatLng: { lat: -22.5, lng: -41.9 } };
    },
  },
  motoboy: {
    updateMany: async (a: any) => {
      gravacoesDoMotoboy.push(a);
      return { count: a.data.naLojaDesde ? contagemDoCarimbo : 1 };
    },
  },
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};

const agendados: (() => Promise<unknown>)[] = [];
let afterLanca = false;
stub("next/server", {
  ...require("next/server"),
  after: (fn: () => Promise<unknown>) => {
    if (afterLanca) throw new Error("`after` was called outside a request scope");
    agendados.push(fn);
  },
});
const ciclos: { lojaId: string; gravar: boolean }[] = [];
let cicloLanca = false;
stub("../src/lib/roteirizacao-automatica/executar", {
  rodarRoteirizacaoDaLoja: async (lojaId: string, opcoes: { gravar: boolean }) => {
    ciclos.push({ lojaId, gravar: opcoes.gravar });
    if (cicloLanca) throw new Error("banco caiu");
    return { aplicadas: [] };
  },
});

async function main() {
  const { empurrarRoteirizacao } = await import("../src/lib/roteirizacao-automatica/empurrao");
  const { carimbarChegadaNaLoja } = await import("../src/lib/roteirizacao-automatica/motoboy-na-loja");
  const { chipsDasRotasAutomaticas } = await import("../src/lib/roteirizacao-automatica/chip-da-rota");

  const rodarAgendados = async () => { while (agendados.length) await (agendados.shift() as () => Promise<unknown>)(); };
  const limpar = () => { consultas.length = 0; ciclos.length = 0; agendados.length = 0; };

  console.log("\n[1] empurrão");
  empurrarRoteirizacao(OUTRA, "teste");
  empurrarRoteirizacao(null, "teste");
  conferir("loja fora da liberação: nada agendado, nenhuma consulta", agendados.length === 0 && consultas.length === 0);

  limpar();
  regraAtiva = false;
  empurrarRoteirizacao(HAKIM, "teste");
  conferir("liberada: um after() agendado e nada lido ANTES da resposta", agendados.length === 1 && consultas.length === 0);
  await rodarAgendados();
  conferir("regra desligada: lê a regra e não roda o ciclo", consultas.length === 1 && ciclos.length === 0, { consultas, ciclos });

  limpar();
  regraAtiva = true;
  empurrarRoteirizacao(HAKIM, "teste");
  await rodarAgendados();
  conferir("regra ligada: um ciclo gravando da Hakim", ciclos.length === 1 && ciclos[0].lojaId === HAKIM && ciclos[0].gravar === true, ciclos);

  limpar();
  cicloLanca = true;
  empurrarRoteirizacao(HAKIM, "teste");
  let lancou = false;
  try { await rodarAgendados(); } catch { lancou = true; }
  conferir("ciclo que falha não lança", !lancou && ciclos.length === 1);
  cicloLanca = false;

  limpar();
  afterLanca = true;
  lancou = false;
  try { empurrarRoteirizacao(HAKIM, "teste"); } catch { lancou = true; }
  conferir("after() fora de requisição não lança", !lancou && agendados.length === 0);
  afterLanca = false;

  console.log("\n[2] chegouAgora");
  // Pino da loja em (-22.5, -41.9); raio padrão 150 m.
  contagemDoCarimbo = 1;
  conferir("dentro do raio e o banco carimbou → chegouAgora", (await carimbarChegadaNaLoja("m1", HAKIM, -22.5003, -41.9002)).chegouAgora === true);
  contagemDoCarimbo = 0;
  conferir("dentro do raio, já carimbado (count 0) → não", (await carimbarChegadaNaLoja("m1", HAKIM, -22.5003, -41.9002)).chegouAgora === false);
  contagemDoCarimbo = 1;
  const antes = gravacoesDoMotoboy.length;
  conferir("fora do raio → não (e apaga o carimbo)", (await carimbarChegadaNaLoja("m1", HAKIM, -22.6, -41.9)).chegouAgora === false
    && gravacoesDoMotoboy.length === antes + 1 && gravacoesDoMotoboy[antes].data.naLojaDesde === null);
  conferir("loja fora da liberação → não", (await carimbarChegadaNaLoja("m1", OUTRA, -22.5, -41.9)).chegouAgora === false);

  console.log("\n[3] chip do card");
  const rota = (numero: string, extra: Record<string, unknown> = {}) => ({ numero, chamadaEm: null, saiu: false, ...extra });
  const chips = chipsDasRotasAutomaticas([
    { id: "a1", routeId: "A", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #7") },
    { id: "a2", routeId: "A", status: "PREPARANDO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #7") },
    // Carga inicial da página: sem `rotaAuto`, mas da mesma rota — conta.
    { id: "a3", routeId: "A", status: "PREPARANDO", deliveryType: "DELIVERY", kdsStage: "PRODUCTION" },
    { id: "a4", routeId: "A", status: "CANCELADO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #7") },
    { id: "b1", routeId: "B", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #8") },
    { id: "b2", routeId: "B", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #8", { chamadaEm: "2026-10-22T22:00:00Z" }) },
    { id: "c1", routeId: "C", status: "SAIU_ENTREGA", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #9", { chamadaEm: "2026-10-22T22:00:00Z" }) },
    { id: "d1", routeId: "D", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #10", { saiu: true }) },
    { id: "e1", routeId: "E", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED", rotaAuto: rota("Rota #11") },
    // Rota manual: o poll não manda `rotaAuto`.
    { id: "m1", routeId: "M", status: "PRONTO", deliveryType: "DELIVERY", kdsStage: "FINISHED" },
  ]);
  conferir("Rota #7 · 2/3 prontos (cancelado fora)", chips.get("A") === "🤖 Rota #7 · 2/3 prontos", chips.get("A"));
  conferir("chamada por um pedido vale para a rota", chips.get("B") === "🤖 Rota #8 · chamada", chips.get("B"));
  conferir("pedido na rua: saiu", chips.get("C") === "🤖 Rota #9 · saiu", chips.get("C"));
  conferir("rota despachada: saiu", chips.get("D") === "🤖 Rota #10 · saiu", chips.get("D"));
  conferir("1 pedido: 1/1 pronto", chips.get("E") === "🤖 Rota #11 · 1/1 pronto", chips.get("E"));
  conferir("rota manual sem chip", !chips.has("M"));

  console.log(`\n${ok} ok, ${falhou} falharam`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
