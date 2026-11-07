/**
 * Trava o relatório "Faturamento de combos" (lib/relatorios/faturamento-combos.ts):
 * o que é combo (isCombo, o nome de um combo do cardápio, "combo" no nome ou
 * na categoria — e NÃO o "Kit Kat" nem o lanche com adicionais), a venda com
 * combo (a mesa que pediu o combo na segunda rodada é UMA venda com combo),
 * e que vendas e valor batem com o Faturamento por dia no mesmo dia.
 *
 *   npx tsx scripts/teste-faturamento-combos.ts
 *
 * Período: quinta 05/11/2026 a sábado 07/11/2026, hoje = 07/11. Horários em
 * UTC; a loja está em America/Sao_Paulo (−03).
 */
import { ehItemDeCombo, faturamentoDeCombos, type ItemParaCombo, type PedidoParaCombos } from "../src/lib/relatorios/faturamento-combos";
import { faturamentoPorDia, type PedidoParaFaturamento } from "../src/lib/relatorios/faturamento-por-dia";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const HOJE = "2026-11-07";
const NOMES_DE_COMBO = ["Combo X-Burguer", "Hakim Kids"];

const item = (productName: string, quantity: number, price: number, menuProduct: ItemParaCombo["menuProduct"] = null, extra: Record<string, unknown> = {}): ItemParaCombo =>
  ({ productName, quantity, price, menuProduct, ...extra });
let seq = 0;
const p = (createdAt: string, totalAmount: number, items: ItemParaCombo[], extra: Partial<PedidoParaCombos> = {}): PedidoParaCombos =>
  ({ id: `p${++seq}`, createdAt, status: "ENTREGUE", totalAmount, items, ...extra });

const PEDIDOS: PedidoParaCombos[] = [
  // ── 05/11 ──
  // Site: o combo marcado no cardápio + uma Coca avulsa.
  p("2026-11-05T23:00:00Z", 41, [item("Combo X-Burguer", 1, 35, { isCombo: true, name: "Combo X-Burguer", category: "Lanches" }), item("Coca lata", 1, 6)]),
  // Sem combo.
  p("2026-11-05T23:10:00Z", 25, [item("X-Salada", 1, 25)]),
  // Mesa: batata na 1ª rodada, o combo do iFood ("Hakim Kids", espelho sem a
  // marca de combo, casa pelo nome do cardápio) na 2ª. UMA venda, com combo.
  p("2026-11-05T22:00:00Z", 20, [item("Batata frita", 1, 20)], { tableSessionId: "m1" }),
  p("2026-11-05T23:30:00Z", 30, [item("Hakim Kids", 1, 30)], { tableSessionId: "m1" }),

  // ── 06/11 ──
  // "Kit Kat" não é combo.
  p("2026-11-06T22:00:00Z", 18, [item("Milkshake de Kit Kat", 1, 18)]),
  // Categoria "Combos" (entrega de R$ 8 no total do pedido, fora do valor do combo).
  p("2026-11-06T22:10:00Z", 48, [item("Promo Dupla", 1, 40, { isCombo: false, name: "Promo Dupla", category: "Combos" })], { deliveryFee: 8 } as Partial<PedidoParaCombos>),
  // Lanche com adicionais (comboSelections) NÃO é combo.
  p("2026-11-06T22:20:00Z", 30, [item("X-Bacon", 1, 30, null, { comboSelections: [{ name: "Bacon extra", price: 4 }] })]),
  // O combo tirado na edição (quantidade 0) não conta.
  p("2026-11-06T22:30:00Z", 22, [item("Combo X-Burguer", 0, 35, { isCombo: true, name: "Combo X-Burguer" }), item("Suco", 1, 22)]),
  // Cancelado com combo: fora de tudo.
  p("2026-11-06T22:40:00Z", 35, [item("Combo X-Burguer", 1, 35, { isCombo: true, name: "Combo X-Burguer" })], { status: "CANCELADO" }),
];

// ── O que é combo ──
const nomes = new Set(["combo x burguer", "hakim kids"]);
confere("isCombo, nome do cardápio, 'combo' na categoria e no nome", [
  ehItemDeCombo(item("Qualquer", 1, 1, { isCombo: true }), nomes),
  ehItemDeCombo(item("Hakim Kids", 1, 1), nomes),
  ehItemDeCombo(item("Promo", 1, 1, { category: "Combos" }), nomes),
  ehItemDeCombo(item("COMBO Casal", 1, 1), nomes),
], [true, true, true, true]);
confere("Kit Kat, lanche com adicionais e 'Combinado' de sushi não são combo", [
  ehItemDeCombo(item("Milkshake de Kit Kat", 1, 1), nomes),
  ehItemDeCombo(item("X-Bacon", 1, 1, { isCombo: false, name: "X-Bacon", category: "Lanches" }), nomes),
  ehItemDeCombo(item("Combinado 20 peças", 1, 1), nomes),
], [false, false, false]);

const r = faturamentoDeCombos({ de: "2026-11-05", ate: "2026-11-07", tz: TZ, hoje: HOJE, pedidos: PEDIDOS, nomesDeCombo: NOMES_DE_COMBO });
const [d5, d6, d7] = r.dias;

confere("05/11: 3 vendas (a mesa é uma), 2 com combo (o site e a mesa da 2ª rodada)",
  [d5.vendas, d5.vendasComCombo, d5.pctComCombo], [3, 2, 0.6667]);
confere("05/11: valor 116 = 91 com combo + 25 sem; 2 combos, R$ 65 (só o preço do combo, sem a Coca)",
  [d5.valor, d5.valorComCombo, d5.valorSemCombo, d5.combos, d5.valorDosCombos], [116, 91, 25, 2, 65]);
confere("05/11: ticket com combo 45,50 × sem combo 25,00", [d5.ticketComCombo, d5.ticketSemCombo], [45.5, 25]);
confere("06/11: 4 vendas, 1 com combo (pela categoria), combo de R$ 40 num pedido de R$ 48",
  [d6.vendas, d6.vendasComCombo, d6.valor, d6.valorComCombo, d6.combos, d6.valorDosCombos, d6.ticketComCombo, d6.ticketSemCombo], [4, 1, 118, 48, 1, 40, 48, 23.33]);
confere("07/11 (hoje, sem venda): zerado, sem ticket", [d7.estado, d7.vendas, d7.pctComCombo, d7.ticketComCombo], ["hoje", 0, null, null]);

confere("total: 7 vendas, 3 com combo (42,86%)", [r.total.vendas, r.total.vendasComCombo, r.total.pctComCombo], [7, 3, 0.4286]);
confere("total: R$ 105 em 3 combos = 44,87% do faturamento de R$ 234",
  [r.total.combos, r.total.valorDosCombos, r.total.valor, r.total.pctDoValor], [3, 105, 234, 0.4487]);
confere("quem leva combo gasta R$ 22,58 a mais (46,33 × 23,75, +95,07%)",
  [r.total.ticketComCombo, r.total.ticketSemCombo, r.diferencaDoTicket], [46.33, 23.75, { reais: 22.58, pct: 0.9507 }]);
confere("ranking por valor", r.ranking.map((c) => [c.nome, c.quantidade, c.valor, c.vendas]),
  [["Promo Dupla", 1, 40, 1], ["Combo X-Burguer", 1, 35, 1], ["Hakim Kids", 1, 30, 1]]);

// ── Bate com o Faturamento por dia ──
const fpd = faturamentoPorDia({ de: "2026-11-05", ate: "2026-11-07", tz: TZ, hoje: HOJE, pedidos: PEDIDOS as unknown as PedidoParaFaturamento[] });
confere("vendas e valor de cada dia = Faturamento por dia",
  r.dias.map((d) => [d.vendas, d.valor]), fpd.dias.map((d) => [d.vendas, d.valor]));
confere("com combo + sem combo = o total", [r.total.valorComCombo + r.total.valorSemCombo], [fpd.total.valor]);

confere("sem combo no período: nada inventado", (() => {
  const s = faturamentoDeCombos({ de: "2026-11-05", ate: "2026-11-05", tz: TZ, hoje: HOJE, pedidos: [p("2026-11-05T23:00:00Z", 25, [item("X-Salada", 1, 25)])], nomesDeCombo: [] });
  return [s.total.vendasComCombo, s.total.pctComCombo, s.total.ticketComCombo, s.total.ticketSemCombo, s.diferencaDoTicket, s.ranking.length];
})(), [0, 0, null, 25, null, 0]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
