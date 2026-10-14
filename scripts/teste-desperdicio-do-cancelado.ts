/**
 * Trava a regra do cancelado que vira desperdício (lib/desperdicio-do-cancelado.ts),
 * o estoque do cancelamento (lib/stock.ts, num Prisma em memória) e a conta da
 * perda pela ficha (lib/cmv/desperdicio.ts) — sem banco.
 *
 *   DATABASE_URL=postgres://x npx tsx scripts/teste-desperdicio-do-cancelado.ts
 *
 * Victor (Pizzaria 17, 14/10/2026): cancelado só é desperdício se foi
 * cancelado DEPOIS de sair da produção — saiu para entrega, ficou pronto
 * (finalizado no KDS ou PRONTO no painel) ou a produção do KDS deu baixa.
 */
import {
  canceladoViraDesperdicio, etapaAntesDoCancelamento, marcaDoDesperdicio, pedidoDaMarca,
} from "../src/lib/desperdicio-do-cancelado";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const CANCELOU = "2026-10-14T23:30:00.000Z";
const antes = (min: number) => new Date(new Date(CANCELOU).getTime() - min * 60_000).toISOString();
const depois = (min: number) => new Date(new Date(CANCELOU).getTime() + min * 60_000).toISOString();
const cancelado = (x: Record<string, unknown> = {}) => ({ status: "CANCELADO", cancelledAt: CANCELOU, items: [{ prontoEm: null }], ...x });

function regra() {
  console.log("\n— Não foi feito: volta para o estoque —");
  confere("aceito e cancelado na fila da produção", canceladoViraDesperdicio(cancelado({ acceptedAt: antes(10), kdsStage: "PRODUCTION" })), false);
  confere("cancelado antes do aceite", canceladoViraDesperdicio(cancelado()), false);
  confere("produção desfeita (prontoEm apagado pelo desfazer do KDS)", canceladoViraDesperdicio(cancelado({ kdsStage: "PRODUCTION", items: [{ prontoEm: null }, { prontoEm: null }] })), false);
  confere("só PREPARANDO no painel, sem KDS (ninguém deu pronto)", canceladoViraDesperdicio(cancelado({ acceptedAt: antes(20) })), false);

  console.log("\n— Foi feito: desperdício —");
  confere("saiu para entrega (dispatchedAt antes do cancelamento)", etapaAntesDoCancelamento(cancelado({ dispatchedAt: antes(5) })), "SAIU_PARA_ENTREGA");
  confere("entregue e depois cancelado", etapaAntesDoCancelamento(cancelado({ deliveredAt: antes(1) })), "SAIU_PARA_ENTREGA");
  confere("finalizado no KDS (kdsFinishedAt)", etapaAntesDoCancelamento(cancelado({ kdsStage: "FINISHED", kdsFinishedAt: antes(3), readyAt: antes(3) })), "FINALIZADO");
  confere("PRONTO pelo painel (readyAt), loja sem KDS", etapaAntesDoCancelamento(cancelado({ readyAt: antes(8) })), "FINALIZADO");
  confere("pedido antigo: FINISHED sem carimbo nenhum", etapaAntesDoCancelamento(cancelado({ kdsStage: "FINISHED" })), "FINALIZADO");
  confere("produção do KDS deu baixa (prontoEm) e está na finalização", etapaAntesDoCancelamento(cancelado({ kdsStage: "FINISHING", items: [{ prontoEm: antes(4) }, { prontoEm: null }] })), "PRODUZIDO");
  confere("duas telas de produção: uma deu baixa já conta o pedido", canceladoViraDesperdicio(cancelado({ items: [{ prontoEm: null }, { prontoEm: antes(2) }] })), true);
  confere("pedido de integração (iFood) segue os mesmos campos", canceladoViraDesperdicio(cancelado({ status: "CANCELLED", dispatchedAt: antes(15), ifoodOrderId: "x" })), true);
  confere("carimbo no mesmo segundo do cancelamento (folga de 1 min)", canceladoViraDesperdicio(cancelado({ readyAt: depois(0.5) })), true);

  console.log("\n— Ordem e status —");
  confere("carimbo DEPOIS do cancelamento não conta", canceladoViraDesperdicio(cancelado({ dispatchedAt: depois(10) })), false);
  confere("sem cancelledAt (pedido antigo), o carimbo vale", canceladoViraDesperdicio(cancelado({ cancelledAt: null, dispatchedAt: antes(10) })), true);
  confere("pedido não cancelado nunca é desperdício", canceladoViraDesperdicio({ status: "SAIU_ENTREGA", dispatchedAt: antes(10) }), false);
  confere("grafia em inglês do cancelado", canceladoViraDesperdicio(cancelado({ status: "canceled", readyAt: antes(1) })), true);

  console.log("\n— Marca na movimentação de estoque —");
  const nota = `Desperdício: pedido #45 cancelado — já tinha saído para entrega (id: abc123) (${marcaDoDesperdicio("abc123")})`;
  confere("lê o pedido da marca", pedidoDaMarca(nota), "abc123");
  confere("nota de baixa comum não tem marca", pedidoDaMarca("Baixa automática - Pedido #c123 (id: abc123)"), null);
  confere("devolução do cancelamento não tem marca", pedidoDaMarca("Devolução por cancelamento - Pedido #c123 (cancel id: abc123)"), null);
}

// ── O estoque de verdade, num Prisma em memória ─────────────────────────────
// Só as consultas que lib/stock.ts faz. Precisa existir ANTES de importar
// lib/prisma (que reaproveita `globalThis.prisma`), por isso os imports de
// lá para baixo são dinâmicos.
type Linha = Record<string, any>;
const banco = { ordem: 0, pedidos: [] as Linha[], movimentos: [] as Linha[], insumos: [] as Linha[] };
const casa = (l: Linha, where: Linha = {}): boolean => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("contains" in v) return String(l[k] ?? "").includes(v.contains);
    if ("startsWith" in v) return String(l[k] ?? "").startsWith(v.startsWith);
    if ("gt" in v) return l[k] > v.gt;
    if ("in" in v) return v.in.includes(l[k]);
  }
  return l[k] === v;
});
const aplicar = (l: Linha, data: Linha) => {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && "increment" in v) l[k] += v.increment;
    else if (v && typeof v === "object" && "decrement" in v) l[k] -= v.decrement;
    else l[k] = v;
  }
};
const falso: any = {
  customerOrder: { findUnique: async ({ where }: any) => banco.pedidos.find((p) => p.id === where.id) ?? null },
  stockTransaction: {
    findFirst: async ({ where }: any) => banco.movimentos.filter((m) => casa(m, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    findMany: async ({ where }: any) => banco.movimentos.filter((m) => casa(m, where)),
    create: async ({ data }: any) => {
      if (data.sourceRef && banco.movimentos.some((m) => m.sourceRef === data.sourceRef)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const m = { id: `t${++banco.ordem}`, createdAt: banco.ordem, ...data };
      banco.movimentos.push(m);
      return m;
    },
    update: async ({ where, data }: any) => { const m = banco.movimentos.find((x) => x.id === where.id)!; aplicar(m, data); return m; },
    updateMany: async ({ where, data }: any) => { const l = banco.movimentos.filter((m) => casa(m, where)); l.forEach((m) => aplicar(m, data)); return { count: l.length }; },
  },
  stockItem: {
    updateMany: async ({ where, data }: any) => { const l = banco.insumos.filter((i) => casa(i, where)); l.forEach((i) => aplicar(i, data)); return { count: l.length }; },
    findUnique: async ({ where }: any) => banco.insumos.find((i) => i.id === where.id) ?? null,
    // O custo do dia não é o que se testa aqui: sem ele a linha fica sem unitCost.
    findMany: async () => { throw new Error("sem custo no teste"); },
  },
  $transaction: async (fn: any) => fn(falso),
};
(globalThis as any).prisma = falso;

async function estoque() {
  console.log("\n— Estoque do cancelamento (Prisma em memória) —");
  const { deductStockForOrder, tratarEstoqueDoCancelamento } = await import("../src/lib/stock");
  banco.insumos.push({ id: "queijo", franchiseeId: "loja", name: "Queijo", unit: "g", quantity: 1000 });
  const pizza = { quantity: 1, comboSelections: null, menuProductId: "p1", productName: "Pizza", menuProduct: { name: "Pizza", recipeItems: [{ stockItemId: "queijo", quantityConsumed: 200, stockItem: { name: "Queijo", unit: "g" } }] } };
  const novo = (id: string) => {
    const p: Linha = { id, franchiseeId: "loja", dailyOrderNumber: 7, franchisee: { storeTimezone: "America/Sao_Paulo" }, status: "ACEITO", cancelledAt: null, items: [{ ...pizza, prontoEm: null }] };
    banco.pedidos.push(p);
    return p;
  };
  const saldo = () => banco.insumos[0].quantity;
  const doPedido = (id: string, tipo: string) => banco.movimentos.filter((m) => m.type === tipo && String(m.notes).includes(`id: ${id}`) && !String(m.notes).includes("cancel id:")).length;

  // Cancelado na fila da produção: o queijo volta.
  const a = novo("pa");
  await deductStockForOrder("pa");
  confere("aceito: baixou 200 g", saldo(), 800);
  Object.assign(a, { status: "CANCELADO", cancelledAt: new Date() });
  confere("cancelado antes da produção: devolve", await tratarEstoqueDoCancelamento("pa"), "DEVOLVIDO");
  confere("o queijo voltou", saldo(), 1000);
  await tratarEstoqueDoCancelamento("pa");
  confere("cancelamento repetido (painel + app) não devolve de novo", saldo(), 1000);

  // Saiu para entrega e foi cancelado: desperdício, o queijo não volta.
  const b = novo("pb");
  await deductStockForOrder("pb");
  Object.assign(b, { status: "CANCELADO", dispatchedAt: new Date(Date.now() - 60_000), cancelledAt: new Date() });
  confere("cancelado depois de sair: desperdício", await tratarEstoqueDoCancelamento("pb"), "DESPERDICIO");
  confere("o queijo não volta", saldo(), 800);
  confere("a baixa virou WASTE com a marca", [doPedido("pb", "SALE"), doPedido("pb", "WASTE"), banco.movimentos.some((m) => m.type === "WASTE" && pedidoDaMarca(m.notes) === "pb")], [0, 1, true]);
  await tratarEstoqueDoCancelamento("pb");
  confere("cancelamento repetido não mexe de novo", [saldo(), doPedido("pb", "WASTE")], [800, 1]);

  // Reaberto: o desperdício volta a ser venda, sem baixar outra vez.
  Object.assign(b, { status: "ACEITO" });
  await deductStockForOrder("pb");
  confere("reaberto: volta a SALE e não baixa de novo", [saldo(), doPedido("pb", "SALE"), doPedido("pb", "WASTE")], [800, 1, 0]);
  // E cancelado de novo, agora sem ter saído (a saída foi desfeita): devolve.
  Object.assign(b, { status: "CANCELADO", dispatchedAt: null, cancelledAt: new Date() });
  confere("cancelado de novo sem ter saído: devolve", [await tratarEstoqueDoCancelamento("pb"), saldo()], ["DEVOLVIDO", 1000]);

  // Produção do KDS deu baixa (prontoEm) e o app cancelou: desperdício.
  const c = novo("pc");
  await deductStockForOrder("pc");
  Object.assign(c, { status: "CANCELLED", cancelledAt: new Date(), items: [{ ...pizza, prontoEm: new Date(Date.now() - 120_000) }] });
  confere("integração cancelada depois da produção: desperdício", [await tratarEstoqueDoCancelamento("pc"), saldo()], ["DESPERDICIO", 800]);

  confere("pedido que não aparece cancelado não mexe (a extensão tenta de novo)", await tratarEstoqueDoCancelamento("nao-existe"), "NAO_CANCELADO");
}

async function ficha() {
  console.log("\n— Desperdício de produto pela ficha —");
  const { baixasDaFicha, valorDasBaixas } = await import("../src/lib/cmv/desperdicio");
  const f = [{ stockItemId: "massa", quantidade: 1 }, { stockItemId: "queijo", quantidade: 150 }, { stockItemId: "queijo", quantidade: 20 }];
  confere("2 pizzas: ficha × 2, insumo repetido somado", baixasDaFicha(f, 2), [{ stockItemId: "massa", quantidade: 2 }, { stockItemId: "queijo", quantidade: 340 }]);
  const custos = new Map<string, { custo: number | null }>([["massa", { custo: 3 }], ["queijo", { custo: 0.04 }]]);
  confere("valor pelo custo do dia", valorDasBaixas(baixasDaFicha(f, 2), custos), 19.6);
  confere("insumo sem custo: sem valor (não vira R$ 0)", valorDasBaixas([{ stockItemId: "massa", quantidade: 1 }, { stockItemId: "sal", quantidade: 2 }], custos), null);
  confere("sem baixa nenhuma: sem valor", valorDasBaixas([], custos), null);
}

async function main() {
  regra();
  await estoque();
  await ficha();
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
