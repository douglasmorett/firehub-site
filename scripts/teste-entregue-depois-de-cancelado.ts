/**
 * Trava o "Entregue mesmo depois de cancelado" (lib/entregue-depois-de-cancelado.ts
 * e a gravação em lib/entregue-depois-de-cancelado-no-banco.ts) — a regra, a
 * volta do pedido para a régua da venda e do acerto, e o estoque num Prisma
 * em memória — sem banco.
 *
 *   DATABASE_URL=postgres://x npx tsx scripts/teste-entregue-depois-de-cancelado.ts
 *
 * Allan (Delícias de Casa, 17/10/2026), decidido pelo Douglas: o cliente
 * cancela, o motoboy já tinha saído, entrega e recebe. O pedido volta a contar
 * como entregue (caixa, faturamento, acerto) com a forma informada — só pedido
 * da própria loja, e o insumo sai do estoque UMA vez, sem ficar desperdício.
 */
import {
  ACAO_ENTREGUE_DEPOIS_DE_CANCELADO, foiEntregueDepoisDeCancelado, lerFormaDoEntregue, lerTrocoPara,
  podeMarcarEntregueDepoisDeCancelado, registroDoEntregueDepoisDeCancelado,
} from "../src/lib/entregue-depois-de-cancelado";
import { situacaoDoPedido } from "../src/lib/relatorios/regua-da-venda";
import { canceladoComCorrida, contaComoCorrida, partesDaEntrega } from "../src/lib/resumo-do-entregador";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const pode = (p: Record<string, unknown>) => podeMarcarEntregueDepoisDeCancelado({ status: "CANCELADO", ...p }).pode;

function regra() {
  console.log("\n— Só pedido da própria loja —");
  confere("site", pode({ source: "SITE" }), true);
  confere("site antigo (source vazio)", pode({ source: null }), true);
  confere("robô do WhatsApp", pode({ source: "WHATSAPP_IA" }), true);
  confere("balcão / telefone (PRESENCIAL)", pode({ source: "PRESENCIAL" }), true);
  confere("PDV", pode({ source: "PDV" }), true);
  confere("totem", pode({ source: "TOTEM" }), true);
  confere("grafia em inglês do cancelado", pode({ status: "CANCELLED", source: "SITE" }), true);
  confere("iFood (pelo id)", pode({ source: "SITE", ifoodOrderId: "abc" }), false);
  confere("iFood (pelo source)", pode({ source: "IFOOD" }), false);
  confere("99Food", pode({ source: "OPEN_DELIVERY", openDeliveryChannel: "99FOOD", openDeliveryOrderId: "x" }), false);
  confere("Keeta", pode({ source: "KEETA", openDeliveryOrderId: "keeta_1" }), false);
  confere("Brendi", pode({ openDeliveryChannel: "BRENDI", openDeliveryOrderId: "b1" }), false);
  confere("CardápioWeb (só pelo id)", pode({ openDeliveryOrderId: "cardapioweb_1_2" }), false);
  confere("JotaJá (só openDeliveryOrderId)", pode({ openDeliveryOrderId: "od-1" }), false);
  confere("canal desconhecido", pode({ source: "OUTRA_COISA" }), false);
  const doIfood = podeMarcarEntregueDepoisDeCancelado({ status: "CANCELADO", source: "IFOOD" });
  confere("o motivo do iFood diz o canal", !doIfood.pode && /iFood/.test(doIfood.motivo), true);

  console.log("\n— O que não é venda da porta —");
  confere("pedido não cancelado", pode({ status: "SAIU_ENTREGA", source: "SITE" }), false);
  confere("mesa (conta da mesa)", pode({ source: "PRESENCIAL", tableSessionId: "m1" }), false);
  confere("lanche da equipe", pode({ source: "EQUIPE" }), false);
  confere("reposição", pode({ source: "SITE", reposicao: { de: "x" } }), false);
  confere("Pix pelo site (Asaas) — a cobrança foi estornada", pode({ source: "SITE", gatewayProvider: "asaas" }), false);
  confere("sem pedido", podeMarcarEntregueDepoisDeCancelado(null).pode, false);

  console.log("\n— Forma, troco e rastro —");
  confere("as quatro formas", ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"].map(lerFormaDoEntregue), ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"]);
  confere("vale e texto solto não valem", [lerFormaDoEntregue("Vale-refeição"), lerFormaDoEntregue("dinheiro"), lerFormaDoEntregue("")], [null, null, null]);
  confere("troco só em dinheiro e acima do total", [lerTrocoPara("Dinheiro", "50", 42.9), lerTrocoPara("Dinheiro", "40", 42.9), lerTrocoPara("Pix", "50", 42.9), lerTrocoPara("Dinheiro", "50,5", 42.9)], [50, null, null, 50.5]);
  const reg = registroDoEntregueDepoisDeCancelado({
    pedido: { status: "CANCELADO", totalAmount: 42.9, cancelledAt: "2026-10-17T23:10:00.000Z", cancelReason: "Cliente desistiu", editHistory: [{ acao: "CANCELOU", quem: "Ana (funcionário)", descricao: "x", quando: "", totalAntes: 42.9, totalDepois: 0 }] },
    forma: "Dinheiro", trocoPara: 50, quem: "Allan (dono)", agora: new Date("2026-10-17T23:40:00.000Z"),
  });
  confere("registro: ação, quem e total 0 → total", [reg.acao, reg.quem, reg.totalAntes, reg.totalDepois], [ACAO_ENTREGUE_DEPOIS_DE_CANCELADO, "Allan (dono)", 0, 42.9]);
  confere("registro: diz a forma, o troco, quando, quem cancelou e o motivo",
    reg.descricao,
    "Entregue mesmo depois de cancelado — pago em Dinheiro (troco para R$ 50,00). Tinha sido cancelado em 17/10 às 20:10 por Ana (funcionário) (motivo: Cliente desistiu).");
  confere("foi entregue depois de cancelado (entregue + registro)", foiEntregueDepoisDeCancelado({ status: "ENTREGUE", editHistory: [reg] }), true);
  confere("cancelado de novo depois disso deixa de ser", foiEntregueDepoisDeCancelado({ status: "CANCELADO", editHistory: [reg] }), false);
  confere("entregue comum não é", foiEntregueDepoisDeCancelado({ status: "ENTREGUE", editHistory: [] }), false);
}

function reguas() {
  console.log("\n— Volta a contar como entregue (régua da venda, corrida e caixa do acerto) —");
  const antes = { status: "CANCELADO", dispatchedAt: "2026-10-17T22:50:00.000Z", cancelledAt: "2026-10-17T23:10:00.000Z", paymentMethod: "Dinheiro (Cobrar na Entrega)", totalAmount: 42.9 };
  const depois = { ...antes, status: "ENTREGUE", paymentMethod: "Cartão Débito", deliveredAt: "2026-10-17T23:40:00.000Z" };
  confere("antes: cancelado, fora da venda", situacaoDoPedido(antes.status), "cancelado");
  confere("antes: corrida conta (saiu antes), dinheiro não", [canceladoComCorrida(antes), contaComoCorrida(antes)], [true, true]);
  confere("depois: venda", situacaoDoPedido(depois.status), "venda");
  confere("depois: corrida comum, não mais 'cancelado com corrida'", [canceladoComCorrida(depois), contaComoCorrida(depois)], [false, true]);
  confere("depois: o valor cai na caixa da forma informada", partesDaEntrega(depois as any).map((p) => [p.caixa, p.valor]), [["DEBITO", 42.9]]);
  const semSair = { status: "ENTREGUE", dispatchedAt: null, cancelledAt: "2026-10-17T23:10:00.000Z", paymentMethod: "Dinheiro", totalAmount: 30 };
  confere("cancelado antes de sair e depois entregue: vira corrida", contaComoCorrida(semSair), true);
}

// ── A gravação e o estoque, num Prisma em memória ───────────────────────────
// Só as consultas que lib/stock.ts e a gravação fazem. Precisa existir ANTES
// de importar lib/prisma (que reaproveita `globalThis.prisma`), por isso os
// imports de lá para baixo são dinâmicos.
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
// Um tique entre a leitura e a escrita: duas gravações em paralelo se cruzam
// como no banco, e só a escrita condicional segura.
const tique = () => new Promise((r) => setTimeout(r, 1));
const falso: any = {
  customerOrder: {
    findUnique: async ({ where }: any) => banco.pedidos.find((p) => p.id === where.id) ?? null,
    findFirst: async ({ where }: any) => { await tique(); return banco.pedidos.find((p) => casa(p, where)) ?? null; },
    updateMany: async ({ where, data }: any) => { const l = banco.pedidos.filter((p) => casa(p, where)); l.forEach((p) => aplicar(p, data)); return { count: l.length }; },
  },
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
    findMany: async () => { throw new Error("sem custo no teste"); },
  },
  $transaction: async (fn: any) => fn(falso),
};
(globalThis as any).prisma = falso;

async function gravacao() {
  console.log("\n— A gravação e o estoque (Prisma em memória) —");
  const { deductStockForOrder, tratarEstoqueDoCancelamento } = await import("../src/lib/stock");
  const { marcarEntregueDepoisDeCancelado } = await import("../src/lib/entregue-depois-de-cancelado-no-banco");
  banco.insumos.push({ id: "queijo", franchiseeId: "loja", name: "Queijo", unit: "g", quantity: 1000 });
  const pizza = { quantity: 1, comboSelections: null, menuProductId: "p1", productName: "Pizza", menuProduct: { name: "Pizza", recipeItems: [{ stockItemId: "queijo", quantityConsumed: 200, stockItem: { name: "Queijo", unit: "g" } }] } };
  const novo = (id: string, x: Linha = {}) => {
    const p: Linha = {
      id, franchiseeId: "loja", dailyOrderNumber: 7, franchisee: { storeTimezone: "America/Sao_Paulo" }, status: "ACEITO", source: "SITE",
      motoboyId: "mb1", totalAmount: 42.9, paymentMethod: "Dinheiro (Cobrar na Entrega)", paymentMethods: null, changeAmount: null,
      cancelledAt: null, cancelReason: null, cancelledBy: null, editHistory: [], items: [{ ...pizza, prontoEm: null }], ...x,
    };
    banco.pedidos.push(p);
    return p;
  };
  const saldo = () => banco.insumos[0].quantity;
  const doPedido = (id: string, tipo: string) => banco.movimentos.filter((m) => m.type === tipo && String(m.notes).includes(`id: ${id}`) && !String(m.notes).includes("cancel id:")).length;
  const marcar = (id: string, x: Record<string, unknown> = {}) =>
    marcarEntregueDepoisDeCancelado({ pedidoId: id, lojaIds: ["loja"], forma: "Dinheiro", quem: "Allan (dono)", ...x });

  // 1. Cancelado ANTES da produção: o insumo voltou. Entregue assim mesmo, sai de novo — uma vez.
  const a = novo("pa");
  await deductStockForOrder("pa");
  Object.assign(a, { status: "CANCELADO", cancelledAt: new Date(), cancelReason: "Cliente desistiu", cancelledBy: "LOJA" });
  await tratarEstoqueDoCancelamento("pa");
  confere("cancelado antes da produção: o queijo voltou", saldo(), 1000);
  const ra = await marcar("pa", { trocoPara: "50" });
  confere("gravou", ra.ok && !ra.jaEstava, true);
  confere("pedido ENTREGUE em Dinheiro com troco, deliveredAt e KDS fechado", [a.status, a.paymentMethod, a.changeAmount, a.deliveredAt instanceof Date, a.kdsStage], ["ENTREGUE", "Dinheiro", 50, true, "FINISHED"]);
  confere("o cancelamento fica gravado (cancelledAt, motivo, quem)", [a.cancelledAt instanceof Date, a.cancelReason, a.cancelledBy], [true, "Cliente desistiu", "LOJA"]);
  confere("o rastro ganhou o registro, com quem marcou", [a.editHistory.at(-1)?.acao, a.editHistory.at(-1)?.quem], [ACAO_ENTREGUE_DEPOIS_DE_CANCELADO, "Allan (dono)"]);
  confere("o queijo saiu de novo — uma vez só", saldo(), 800);
  const ra2 = await marcar("pa");
  confere("segundo toque: 'já estava', sem gravar nem baixar de novo", [ra2.ok && ra2.jaEstava, saldo(), a.editHistory.length], [true, 800, 1]);
  await deductStockForOrder("pa");
  confere("a baixa repetida (ACEITO em outro caminho) não tira de novo", saldo(), 800);

  // 2. Cancelado DEPOIS de sair: a baixa virou desperdício. Entregue: volta a ser venda.
  const b = novo("pb");
  await deductStockForOrder("pb");
  Object.assign(b, { status: "CANCELADO", dispatchedAt: new Date(Date.now() - 60_000), cancelledAt: new Date() });
  await tratarEstoqueDoCancelamento("pb");
  confere("cancelado depois de sair: desperdício, o queijo não volta", [saldo(), doPedido("pb", "WASTE")], [600, 1]);
  const rb = await marcar("pb", { forma: "Pix" });
  confere("entregue em Pix", [rb.ok, b.status, b.paymentMethod, b.changeAmount], [true, "ENTREGUE", "Pix", null]);
  confere("o desperdício voltou a ser venda, sem baixar de novo", [saldo(), doPedido("pb", "SALE"), doPedido("pb", "WASTE")], [600, 1, 0]);

  // 3. Cancelado antes de ser aceito (nunca baixou): entregue, baixa agora.
  const c = novo("pc", { status: "CANCELADO", cancelledAt: new Date() });
  void c;
  await marcar("pc", { forma: "Cartão Crédito" });
  confere("nunca tinha baixado: baixa uma vez ao entregar", [saldo(), doPedido("pc", "SALE")], [400, 1]);

  console.log("\n— O que a gravação recusa —");
  const d = novo("pd", { status: "CANCELADO", source: "IFOOD", ifoodOrderId: "if-1", cancelledAt: new Date() });
  const rd = await marcar("pd");
  confere("iFood cancelado: 409 e nada muda", [rd.ok ? 0 : rd.status, d.status, saldo()], [409, "CANCELADO", 400]);
  const e = novo("pe", { status: "CANCELADO", cancelledAt: new Date() });
  const re = await marcar("pe", { forma: "Vale-refeição" });
  confere("forma fora das quatro: 400", [re.ok ? 0 : re.status, e.status], [400, "CANCELADO"]);
  const rf = await marcar("pe", { motoboyId: "outro" });
  confere("pelo app: pedido de outro motoboy não acha (404)", [rf.ok ? 0 : rf.status, e.status], [404, "CANCELADO"]);
  const rg = await marcarEntregueDepoisDeCancelado({ pedidoId: "pe", lojaIds: ["outra-loja"], forma: "Pix", quem: "x" });
  confere("pedido de outra loja não acha (404)", rg.ok ? 0 : rg.status, 404);
  const ativo = novo("ph", { status: "SAIU_ENTREGA" });
  const rh = await marcar("ph");
  confere("pedido que não está cancelado: 409", [rh.ok ? 0 : rh.status, ativo.status], [409, "SAIU_ENTREGA"]);

  console.log("\n— Loja e motoboy ao mesmo tempo —");
  const f = novo("pf", { status: "CANCELADO", cancelledAt: new Date() });
  await deductStockForOrder("pf"); // estava aceito antes de cancelar, sem devolução (cancelado agora)
  const antesDoPar = saldo();
  const [x, y] = await Promise.all([marcar("pf", { forma: "Pix" }), marcar("pf", { forma: "Dinheiro", motoboyId: "mb1", quem: "Motoboy João" })]);
  const gravaram = [x, y].filter((r) => r.ok && !r.jaEstava).length;
  const jaEstavam = [x, y].filter((r) => r.ok && r.jaEstava).length;
  confere("uma gravação só, a outra responde 'já estava'", [gravaram, jaEstavam, f.editHistory.length], [1, 1, 1]);
  confere("e o estoque não sai duas vezes", saldo(), antesDoPar);
}

async function main() {
  regra();
  reguas();
  await gravacao();
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
