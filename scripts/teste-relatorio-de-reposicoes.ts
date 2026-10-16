/**
 * Trava o relatório "Reposições (faltou item e troca)" (lib/relatorios/reposicoes.ts):
 * quantas, quanto representam nas vendas e quanto custou refazer e entregar.
 *
 *   npx tsx scripts/teste-relatorio-de-reposicoes.ts
 *
 * O custo sai da régua do DRE de verdade (lib/financeiro/custo-pela-ficha.ts,
 * montarCatalogo + custoDoItem), com um cardápio de esfiharia: esfiha de
 * carne com custo digitado, esfiha de Nevada com ficha técnica, o combo de 11
 * (com um custo digitado que NÃO pode ir para a opção reposta sozinha) e um
 * refrigerante sem custo nenhum. A entrega, pela conta do acerto
 * (lib/ganho-do-entregador.ts). Os pedidos imitam o que a rota
 * api/store/orders/[id]/reposicao grava.
 */
import {
  custoDaEntrega, itemParaCusto, montarReposicoes, relatorioDeReposicoes, valorDeVendaDoItem, vendasSemReposicoes,
  type ItemGravado, type PedidoDeReposicao, type PedidoOriginal,
} from "../src/lib/relatorios/reposicoes";
import { custoDoItem, montarCatalogo, type CustoDoInsumo, type ProdutoParaCusto } from "../src/lib/financeiro/custo-pela-ficha";
import { lerAcerto } from "../src/lib/ganho-do-entregador";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const L = "loja1";
const TZ = "America/Sao_Paulo";

// ── O cardápio (a régua do DRE) ──────────────────────────────────────────────

const produtos: ProdutoParaCusto[] = [
  { id: "carne", nome: "Esfiha de Carne", ativo: true, custo: 2, combo: false, ficha: [], grupos: [] },
  { id: "nevada", nome: "Esfiha de Nevada", ativo: true, custo: null, combo: false, ficha: [{ insumoId: "choc", nome: "Chocolate", quantidade: 0.05 }], grupos: [] },
  {
    id: "combo", nome: "Combo 11 Esfihas", ativo: true, custo: 30, combo: true, ficha: [],
    grupos: [{ id: "g1", opcoes: [{ id: "o1", produtoId: "carne" }, { id: "o2", produtoId: "nevada" }] }],
  },
  { id: "refri", nome: "Refrigerante", ativo: true, custo: null, combo: false, ficha: [], grupos: [] },
];
const catalogo = montarCatalogo(produtos);
// Chocolate a R$ 40,00 o kg: 0,05 kg = R$ 2,00 a esfiha de Nevada.
const insumo: CustoDoInsumo = (id, nome) => (id === "choc" ? { custo: 40, faltando: [], foraDoCmv: false } : { custo: null, faltando: [nome], foraDoCmv: false });
const diasPedidos: string[] = [];
const custo = (_loja: string, item: Parameters<typeof custoDoItem>[0], dia: string) => { diasPedidos.push(dia); return custoDoItem(item, catalogo, insumo); };

const preco: Record<string, { name: string; price: number | null }> = {
  carne: { name: "Esfiha de Carne", price: 5 },
  nevada: { name: "Esfiha de Nevada", price: 7 },
  combo: { name: "Combo 11 Esfihas", price: 50 },
  refri: { name: "Refrigerante", price: 6 },
};
const item = (id: string, quantity: number, extra: Partial<ItemGravado> = {}): ItemGravado => ({
  menuProductId: id, productName: preco[id].name, quantity, notes: null, comboSelections: null, menuProduct: preco[id], ...extra,
});

// ── 1. O item ────────────────────────────────────────────────────────────────

// A opção "Esfiha de Calabresa Especial" do combo não existe no cardápio: a
// rota gravou o produto do COMBO (a nota "do Combo 11 Esfihas").
const CALABRESA: ItemGravado = item("combo", 1, { productName: "Esfiha de Calabresa Especial", notes: "do Combo 11 Esfihas" });
const NEVADA_DO_COMBO: ItemGravado = item("nevada", 1, { notes: "do Combo 11 Esfihas" });
const COMBO_INTEIRO: ItemGravado = item("combo", 1, { comboSelections: [{ name: "Esfiha de Carne", quantity: 10 }, { name: "Esfiha de Nevada", quantity: 1 }] });

confere("opção sem produto no cardápio: o id do combo sai (e o custo é procurado pelo nome)",
  [itemParaCusto(CALABRESA).item.produtoId, itemParaCusto(CALABRESA).opcaoSemProduto], [null, true]);
confere("a armadilha: com o id do combo, a régua daria o custo do COMBO inteiro (R$ 30,00) a uma esfiha",
  custoDoItem({ produtoId: "combo", nome: "Esfiha de Calabresa Especial", quantidade: 1, preco: 0, escolhas: null }, catalogo, insumo).custo, 30);
confere("…e pelo itemParaCusto ela fica SEM custo, porque o nome não está no cardápio",
  [custoDoItem(itemParaCusto(CALABRESA).item, catalogo, insumo).custo, custoDoItem(itemParaCusto(CALABRESA).item, catalogo, insumo).faltas[0].motivo], [null, "NOME_NAO_CASA"]);
confere("opção que casou pelo nome (Nevada do combo): fica com o produto dela",
  [itemParaCusto(NEVADA_DO_COMBO).item.produtoId, itemParaCusto(NEVADA_DO_COMBO).opcaoSemProduto], ["nevada", false]);
confere("combo inteiro com as escolhas: fica com o produto do combo", itemParaCusto(COMBO_INTEIRO).item.produtoId, "combo");
confere("combo inteiro: custo pelas opções (10 × R$ 2,00 + 1 Nevada pela ficha R$ 2,00), não os R$ 30 digitados",
  custoDoItem(itemParaCusto(COMBO_INTEIRO).item, catalogo, insumo).custo, 22);
confere("valor de venda: preço do cardápio × quantidade", valorDeVendaDoItem(item("carne", 3)), 15);
confere("valor de venda: opção sem produto não leva o preço do combo", valorDeVendaDoItem(CALABRESA), null);
confere("valor de venda: produto sem preço fica nulo", valorDeVendaDoItem(item("refri", 1, { menuProduct: { name: "Refrigerante", price: 0 } })), null);

// ── 2. A entrega ─────────────────────────────────────────────────────────────

const ACERTO_PELA_TAXA = lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 0 });
const ACERTO_FIXO_5 = lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 5 });
const ACERTO_SO_DIARIA = lerAcerto({ paymentType: "DAILY_RATE", dailyRate: 60 });
const O_TAXA_6 = { id: "o2", deliveryFee: 6 };

confere("reposição nova (com entregaGratis), sem motoboy: a taxa gravada, não estimada",
  custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0, entregaGratis: { valor: 7, motivo: "Reposição do #12" } }, original: { deliveryFee: 9 } }),
  { valor: 7, origem: "TAXA_DA_CORRIDA", estimado: false, detalhe: "sem motoboy marcado: taxa da corrida" });
confere("reposição antiga (sem entregaGratis), motoboy pago pela taxa: a taxa do original, ESTIMADA",
  [custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0 }, original: O_TAXA_6, acerto: ACERTO_PELA_TAXA })].map((e) => [e.valor, e.origem, e.estimado])[0],
  [6, "ACERTO", true]);
confere("reposição antiga, motoboy de valor fixo R$ 5: R$ 5, sem estimativa (a taxa não entra na conta dele)",
  [custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0 }, original: O_TAXA_6, acerto: ACERTO_FIXO_5 })].map((e) => [e.valor, e.origem, e.estimado])[0],
  [5, "ACERTO", false]);
confere("motoboy só de diária: a corrida a mais não custa nada além da diária",
  [custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0, entregaGratis: { valor: 8, motivo: "Reposição do #3" } }, original: null, acerto: ACERTO_SO_DIARIA })].map((e) => [e.valor, e.origem])[0],
  [0, "ACERTO"]);
confere("motoboy com valor GRAVADO na reposição (motoboyFee): vale o gravado",
  custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0, motoboyFee: 4.5 }, original: O_TAXA_6, acerto: ACERTO_PELA_TAXA }).valor, 4.5);
confere("retirada: sem entrega, R$ 0,00",
  [custoDaEntrega({ reposicao: { deliveryType: "RETIRADA", deliveryFee: 0 }, original: O_TAXA_6, acerto: ACERTO_PELA_TAXA })].map((e) => [e.valor, e.origem])[0],
  [0, "SEM_ENTREGA"]);
confere("entrega sem taxa nenhuma (nem na reposição, nem no original): R$ 0,00 e nada estimado",
  [custoDaEntrega({ reposicao: { deliveryType: "DELIVERY", deliveryFee: 0 }, original: { deliveryFee: 0 } })].map((e) => [e.valor, e.origem, e.estimado])[0],
  [0, "SEM_TAXA", false]);

// ── 3. A montagem e o relatório ──────────────────────────────────────────────

let seq = 0;
const rep = (x: Partial<PedidoDeReposicao> & { motivo: "FALTOU" | "TROCA"; original: string; createdAt: string; items: ItemGravado[] }): PedidoDeReposicao => {
  const { motivo, original, ...resto } = x as any;
  seq++;
  return {
    id: `r${seq}`, franchiseeId: L, status: "ACEITO", dailyOrderNumber: 100 + seq, customerName: `Cliente ${seq}`,
    deliveryType: "DELIVERY", deliveryFee: 0, motoboyId: null,
    reposicao: { pedidoId: original, numero: original.replace("o", "") + "0", motivo },
    ...resto,
  };
};
const REPOSICOES: PedidoDeReposicao[] = [
  // 14/10, 20h30 em SP.
  rep({ motivo: "FALTOU", original: "o1", createdAt: "2026-10-14T23:30:00.000Z", items: [NEVADA_DO_COMBO], entregaGratis: { valor: 7, motivo: "Reposição do #10" } }),
  rep({ motivo: "TROCA", original: "o1", createdAt: "2026-10-14T23:50:00.000Z", items: [item("carne", 2)], entregaGratis: { valor: 7, motivo: "Reposição do #10" }, motoboyId: "lucas" }),
  // Antiga (sem entregaGratis): a taxa do o2 entra estimada. 01h30 do dia 15 = expediente do dia 14.
  rep({ motivo: "FALTOU", original: "o2", createdAt: "2026-10-15T04:30:00.000Z", items: [CALABRESA, item("refri", 1)], motoboyId: "lucas" }),
  rep({ motivo: "TROCA", original: "o3", createdAt: "2026-10-15T15:00:00.000Z", items: [COMBO_INTEIRO], deliveryType: "RETIRADA" }),
  rep({ motivo: "FALTOU", original: "o2", createdAt: "2026-10-15T16:00:00.000Z", items: [item("carne", 1)], motoboyId: "ze" }),
  rep({ motivo: "TROCA", original: "o4", createdAt: "2026-10-15T17:00:00.000Z", items: [item("carne", 1), item("carne", 0)], entregaGratis: { valor: 8, motivo: "Reposição do #40" }, motoboyId: "diarista" }),
  // Sem `reposicao` válida: fica de fora.
  { ...rep({ motivo: "FALTOU", original: "o9", createdAt: "2026-10-15T18:00:00.000Z", items: [item("carne", 1)] }), reposicao: null },
];
const originais = new Map<string, PedidoOriginal>([
  ["o1", { id: "o1", dailyOrderNumber: 10, deliveryFee: 7 }],
  ["o2", { id: "o2", dailyOrderNumber: 20, deliveryFee: 6 }],
  ["o3", { id: "o3", dailyOrderNumber: 30, deliveryFee: 0 }],
  ["o4", { id: "o4", dailyOrderNumber: 40, deliveryFee: 8 }],
]);
const motoboys = new Map([
  ["lucas", { nome: "Lucas", acerto: ACERTO_PELA_TAXA }],
  ["ze", { nome: "Zé", acerto: ACERTO_FIXO_5 }],
  ["diarista", { nome: "Marcos", acerto: ACERTO_SO_DIARIA }],
]);
const montadas = montarReposicoes(REPOSICOES, { tz: TZ, custoDoItem: custo, originais, motoboys });

confere("6 reposições montadas (a sem `reposicao` fica de fora)", montadas.length, 6);
confere("o item com quantidade 0 (tirado) não entra", montadas.find((m) => m.id === "r6")!.itens.length, 1);
confere("01h30 do dia 15 é do expediente do dia 14 (o dia vira às 5h), 01:30 na hora",
  [montadas[2].dia, montadas[2].hora], ["2026-10-14", "01:30"]);
confere("o custo de cada item é pedido no DIA da reposição (o custo do insumo no dia)", diasPedidos.slice(0, 3), ["2026-10-14", "2026-10-14", "2026-10-14"]);
confere("número da reposição e do original", [montadas[0].numero, montadas[0].original.numero], ["101", "10"]);
confere("motoboy pelo nome", montadas.map((m) => m.motoboy), [null, "Lucas", "Lucas", null, "Zé", "Marcos"]);
confere("entrega de cada uma: 7 gravada, 7 pelo acerto, 6 estimada, retirada 0, fixo 5, diária 0",
  montadas.map((m) => [m.entrega.valor, m.entrega.estimado]), [[7, false], [7, false], [6, true], [0, false], [5, false], [0, false]]);

const res = relatorioDeReposicoes(montadas, { vendas: 200, valorVendido: 10000 });
const s = res.resumo;
confere("resumo: 6 reposições, 4 pedidos diferentes, 8 unidades", [s.reposicoes, s.pedidosAfetados, s.itens], [6, 4, 8]);
confere("custo de refazer R$ 32,00 (2 + 4 + 22 + 2 + 2); 2 unidades sem custo, FORA da soma (nada inventado)",
  [s.custoRefazer, s.itensSemCusto], [32, 2]);
confere("valor de venda R$ 83,00; 1 unidade sem preço (a opção sem produto)", [s.valorDeVenda, s.itensSemPreco], [83, 1]);
confere("entrega: 5 corridas, R$ 25,00; 1 estimada de R$ 6,00", [s.entregas, s.custoEntrega, s.entregasEstimadas, s.valorEstimado], [5, 25, 1, 6]);
confere("custo total R$ 57,00 = refazer + entrega; médio R$ 9,50", [s.custoTotal, s.custoMedio], [57, 9.5]);
confere("% das vendas: 4 pedidos ÷ 200 vendas = 2%; % do faturamento: 57 ÷ 10.000 = 0,57%", [s.pctDasVendas, s.pctDoFaturamento], [2, 0.57]);
confere("sem venda no período: os percentuais são nulos (tela mostra —), não 0%",
  [relatorioDeReposicoes(montadas, { vendas: 0, valorVendido: 0 }).resumo.pctDasVendas, relatorioDeReposicoes(montadas, { vendas: 0, valorVendido: 0 }).resumo.pctDoFaturamento], [null, null]);

const faltou = res.porMotivo.find((m) => m.motivo === "FALTOU")!, troca = res.porMotivo.find((m) => m.motivo === "TROCA")!;
confere("Faltou item: 3 reposições, 4 un., refazer R$ 4,00 (+2 sem custo), entrega R$ 18,00, total R$ 22,00",
  [faltou.rotulo, faltou.reposicoes, faltou.itens, faltou.custoRefazer, faltou.itensSemCusto, faltou.custoEntrega, faltou.custoTotal], ["Faltou item", 3, 4, 4, 2, 18, 22]);
confere("Veio errado (troca): 3 reposições, 4 un., refazer R$ 28,00, entrega R$ 7,00, total R$ 35,00",
  [troca.rotulo, troca.reposicoes, troca.itens, troca.custoRefazer, troca.custoEntrega, troca.custoTotal], ["Veio errado (troca)", 3, 4, 28, 7, 35]);
confere("os dois motivos somam o total", [faltou.custoTotal + troca.custoTotal, faltou.reposicoes + troca.reposicoes], [s.custoTotal, s.reposicoes]);

confere("ranking: Esfiha de Carne na frente (3 reposições), depois por custo, e os sem custo no fim",
  res.porProduto.map((p) => [p.nome, p.vezes, p.quantidade, p.custo]),
  [["Esfiha de Carne", 3, 4, 8], ["Combo 11 Esfihas", 1, 1, 22], ["Esfiha de Nevada", 1, 1, 2], ["Esfiha de Calabresa Especial", 1, 1, null], ["Refrigerante", 1, 1, null]]);
const carne = res.porProduto[0];
confere("Esfiha de Carne: 1 un. faltou, 3 un. troca", [carne.faltou, carne.troca], [1, 3]);
confere("sem custo: o que falta, em português de lojista",
  res.semCusto.map((x) => [x.nome, x.porque]),
  [["Esfiha de Calabresa Especial", "o nome não está no cardápio"], ["Refrigerante", "sem ficha técnica e sem custo no produto"]]);

const l3 = res.lista.find((l) => l.id === "r3")!;
confere("lista: mais recentes primeiro", res.lista.map((l) => l.id), ["r6", "r5", "r4", "r3", "r2", "r1"]);
confere("lista: a reposição só com itens sem custo mostra 'sem custo' (nulo), não R$ 0,00",
  [l3.custoRefazer, l3.itensSemCusto, l3.custoEntrega, l3.entregaEstimada, l3.custoTotal], [null, 2, 6, true, 6]);
confere("lista: itens em texto e motivo", [l3.itens, l3.rotulo, l3.original], ["1x Esfiha de Calabresa Especial, 1x Refrigerante", "Faltou item", "20"]);
confere("por dia: 14/10 (3, R$ 26,00 = 9 + 11 + 6) e 15/10 (3, R$ 31,00 = 22 + 7 + 2)", res.porDia, [{ dia: "2026-10-14", reposicoes: 3, custoTotal: 26 }, { dia: "2026-10-15", reposicoes: 3, custoTotal: 31 }]);
const somaDaLista = Math.round(res.lista.reduce((t, l) => t + l.custoTotal, 0) * 100) / 100;
confere("a lista soma o custo total do resumo", somaDaLista, s.custoTotal);

// ── 4. A base das vendas ─────────────────────────────────────────────────────

const v = vendasSemReposicoes([
  { id: "a", createdAt: "2026-10-14T20:00:00Z", status: "ENTREGUE", totalAmount: 50 },
  { id: "b", createdAt: "2026-10-14T21:00:00Z", status: "ENTREGUE", totalAmount: 40 },
  { id: "c", createdAt: "2026-10-14T22:00:00Z", status: "CANCELADO", totalAmount: 100 },
  // Mesa: dois lançamentos, uma venda.
  { id: "m1", createdAt: "2026-10-14T22:10:00Z", status: "ENTREGUE", totalAmount: 20, tableSessionId: "s1" },
  { id: "m2", createdAt: "2026-10-14T22:40:00Z", status: "ENTREGUE", totalAmount: 25, tableSessionId: "s1" },
  // Acréscimo do "a": soma no valor, não abre venda.
  { id: "x", createdAt: "2026-10-14T20:10:00Z", status: "ENTREGUE", totalAmount: 6, parentOrderId: "a" },
  // As próprias reposições (R$ 0,00): não são venda.
  { id: "r1", createdAt: "2026-10-14T23:30:00Z", status: "ACEITO", totalAmount: 0, reposicao: { pedidoId: "a", numero: "1", motivo: "FALTOU" } },
  { id: "r2", createdAt: "2026-10-14T23:40:00Z", status: "ACEITO", totalAmount: 0, reposicao: { pedidoId: "b", numero: "2", motivo: "TROCA" } },
]);
confere("vendas pela régua única sem as reposições: 3 vendas (a, b, a mesa), R$ 141,00", [v.vendas, v.valorVendido], [3, 141]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
