/**
 * Trava os três relatórios de estoque que andam juntos: Histórico das
 * contagens (diferença em R$ e os insumos que somem), Saídas por motivo
 * (texto livre → categoria) e Compras por fornecedor (preço médio e o alerta
 * de quem subiu de preço, contra a compra anterior de antes do período).
 *
 *   npx tsx scripts/teste-estoque-relatorios.ts
 */
import { historicoDeContagens, type ItemDaContagem } from "../src/lib/relatorios/historico-de-contagens";
import { MOTIVOS_DE_SAIDA, motivoDaSaida, saidasPorMotivo, type SaidaLancada } from "../src/lib/relatorios/saidas-de-estoque";
import { comprasPorFornecedor, type EntradaDeCompra } from "../src/lib/relatorios/compras-por-fornecedor";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n1) Histórico das contagens");
const it = (id: string, sistema: number | null, contado: number | null, custo: number | null, origem = "CONTADO"): ItemDaContagem =>
  ({ stockItemId: id, nome: id, unidade: "g", contado, quantidade: contado ?? sistema, origem: contado == null ? "CARREGADO" : origem, saldoSistema: sistema, custoUnitario: custo });
const h = historicoDeContagens([
  { id: "c1", dia: "2026-10-31", tipo: "COMPLETA", valorTotal: 900, itens: [it("queijo", 2000, 1700, 0.06), it("carne", 5000, 5100, 0.04), it("sal", 900, 800, null), it("pao", 50, null, 1.5)] },
  { id: "c2", dia: "2026-11-06", tipo: "RAPIDA", valorTotal: 800, itens: [it("queijo", 1500, 1300, 0.06), it("carne", 3000, 3000, 0.04)] },
]);
const c1 = h.contagens.find((c) => c.id === "c1")!;
confere("c1: faltou 300 g de queijo (−R$ 18), sobrou 100 g de carne (+R$ 4); o sal sem custo conta sem R$; o pão não contado fica fora",
  [c1.contados, c1.comDiferenca, c1.faltou, c1.sobrou, c1.liquido, c1.semCusto, c1.diferencas.map((d) => [d.stockItemId, d.diferenca, d.valor])],
  [3, 3, -18, 4, -14, 1, [["queijo", -300, -18], ["carne", 100, 4], ["sal", -100, null]]]);
confere("a mais recente primeiro; carne contada igual não é diferença", [h.contagens.map((c) => c.id), h.contagens[0].comDiferenca], [["c2", "c1"], 1]);
confere("os que somem: queijo −500 g (−R$ 30) em 2 contagens, depois o sal sem custo",
  h.queSomem.map((q) => [q.stockItemId, q.contagens, q.diferenca, q.valor]), [["queijo", 2, -500, -30], ["sal", 1, -100, null]]);
confere("totais do período", h.totais, { contagens: 2, faltou: -30, sobrou: 4, liquido: -26 });

console.log("\n2) Saídas por motivo");
confere("o texto livre vira categoria",
  ["Venceu na geladeira", "caiu no chão", "Lanche da equipe", "Consumo interno — motoboy", "Devolução ao fornecedor", "Desperdício: 2x Pizza · motivo: queimou", "", "sei lá"].map(motivoDaSaida),
  ["vencido", "quebra", "consumoInterno", "consumoInterno", "devolucao", "quebra", "outro", "outro"]);
const botoes = MOTIVOS_DE_SAIDA.filter((m) => m.palavras.length);
confere("o rótulo de cada botão do Movimentar (com o texto depois) cai na própria categoria",
  botoes.map((m) => motivoDaSaida(`${m.rotulo} — 2 pacotes`)), botoes.map((m) => m.chave));
const s = (motivoTexto: string | null, valor: number | null, item = "Mussarela", extra: Partial<SaidaLancada> = {}): SaidaLancada =>
  ({ quando: "2026-11-06T20:00:00Z", item, tipo: "INSUMO", quantidade: 100, unidade: "g", motivoTexto, quem: null, origem: "Perda", valor, ...extra });
const r = saidasPorMotivo([
  s("Vencido", 12), s("estragou", 8), s("caiu", 5, "Pizza Calabresa", { tipo: "PRODUTO", unidade: null, quantidade: 1 }),
  s(null, 30, "Pedido #45", { motivo: "cancelado", origem: "Cancelado", quantidade: null, unidade: null }),
  s("lanche do motoboy", null, "Pão"),
]);
confere("por motivo, o maior valor primeiro; o sem valor conta à parte",
  r.porMotivo.map((m) => [m.motivo, m.lancamentos, m.valor, m.semValor]), [["cancelado", 1, 30, 0], ["vencido", 2, 20, 0], ["quebra", 1, 5, 0], ["consumoInterno", 1, 0, 1]]);
confere("o item que mais se perde: mussarela 200 g, R$ 20", r.itens[1], { item: "Mussarela", unidade: "g", lancamentos: 2, quantidade: 200, valor: 20 });
confere("totais", r.totais, { valor: 55, lancamentos: 5, semValor: 1 });

console.log("\n3) Compras por fornecedor e o alerta de preço");
const e = (compraId: string, dia: string, fornecedor: string | null, id: string, quantidade: number, custo: number): EntradaDeCompra =>
  ({ compraId, dia, em: Date.parse(`${dia}T15:00:00Z`), fornecedor, stockItemId: id, nome: id, unidade: "g", quantidade, custoUnitario: custo });
const k = comprasPorFornecedor([
  e("n0", "2026-09-20", "Laticínios Serra", "queijo", 5000, 0.05), // antes do período: a compra anterior
  e("n1", "2026-10-05", "laticinios serra", "queijo", 4000, 0.055),
  e("n1", "2026-10-05", "laticinios serra", "manteiga", 1000, 0.04),
  e("n2", "2026-10-20", "Atacadão", "queijo", 6000, 0.06),
  e("n3", "2026-10-21", null, "carne", 10000, 0.038),
], "2026-10-01", "2026-10-31");
confere("por fornecedor: Atacadão R$ 360, Laticínios R$ 260 (2 insumos, 1 compra), sem fornecedor R$ 380",
  k.fornecedores.map((f) => [f.fornecedor, f.compras, f.insumos, f.total]), [["Sem fornecedor", 1, 1, 380], ["Atacadão", 1, 1, 360], ["laticinios serra", 1, 2, 260]]);
const q = k.insumos.find((i) => i.stockItemId === "queijo")!;
confere("queijo no período: 10 kg, R$ 580, preço médio 0,058; a última (0,06) contra a anterior (0,055) subiu 9,09%",
  [q.compras, q.quantidade, q.valor, q.precoMedio, q.ultimoPreco, q.precoAnterior, q.variacaoPct, q.subiu], [2, 10000, 580, 0.058, 0.06, 0.055, 9.09, true]);
confere("manteiga e carne só têm uma compra: sem variação", [k.insumos.find((i) => i.stockItemId === "carne")!.variacaoPct, k.alertas.map((a) => a.stockItemId)], [null, ["queijo"]]);
confere("totais", k.totais, { total: 1000, compras: 3, insumos: 3 });

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
