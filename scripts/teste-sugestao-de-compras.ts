/**
 * Trava a Lista de compras (lib/relatorios/sugestao-de-compras.ts) e o
 * consumo pela ficha de hoje que ela usa (lib/relatorios/consumo-pela-
 * ficha.ts + `consumoDoItem` de lib/financeiro/custo-pela-ficha.ts):
 * produto com ficha, espelho do iFood pelo nome, combo pelas opções, item sem
 * ficha, preparo descido até o insumo comprado, o dia que vira às 5h, o
 * quanto comprar (ideal, sugerido, N dias, mínimo, saldo negativo,
 * arredondamento), o fornecedor e o texto do WhatsApp.
 *
 *   npx tsx scripts/teste-sugestao-de-compras.ts
 */
import { montarCatalogo, type ProdutoParaCusto } from "../src/lib/financeiro/custo-pela-ficha";
import { consumoPorDia, quantidadeLegivel, separarPreparos, totalDosDias } from "../src/lib/relatorios/consumo-pela-ficha";
import { arredondarCompra, linhaDaLista, listaDeCompras, textoDoPedido, type InsumoDaLista } from "../src/lib/relatorios/sugestao-de-compras";
import type { InsumoParaCusto } from "../src/lib/cmv/custo-do-insumo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const TZ = "America/Sao_Paulo";

// ── O cardápio da hamburgueria ──
const prod = (id: string, nome: string, ficha: [string, number][], extra: Partial<ProdutoParaCusto> = {}): ProdutoParaCusto => ({
  id, nome, ativo: true, custo: null, combo: false, grupos: [],
  ficha: ficha.map(([insumoId, quantidade]) => ({ insumoId, nome: insumoId, quantidade })), ...extra,
});
const CAT = montarCatalogo([
  prod("x-burger", "X-Burger", [["pao", 1], ["blend", 1], ["queijo", 20]]),
  prod("batata", "Batata Frita", [["batata-crua", 200]]),
  prod("coca", "Coca Lata", [["coca-lata", 1]]),
  // Combo sem ficha própria (só a embalagem): o consumo vem das opções escolhidas.
  prod("combo", "Combo Avenida", [["embalagem", 1]], { combo: true, grupos: [{ id: "g1", opcoes: [{ id: "o-x", produtoId: "x-burger" }, { id: "o-b", produtoId: "batata" }, { id: "o-c", produtoId: "coca" }] }] }),
  prod("milk", "Milk Shake", []),
  // Espelho do iFood: sem ficha, casa pelo nome com o X-Burger do cardápio.
  { ...prod("ifood-123", "X-Burger", []), ativo: false },
]);

// O blend é PREPARO: 1 lote de 10 un leva 1.200 g de carne + 20 g de sal.
const INSUMOS: InsumoParaCusto[] = [
  { id: "pao", nome: "Pão brioche", unidade: "un", tipo: null, rendimento: null, unitCost: 1.5, componentes: [] },
  { id: "blend", nome: "Blend 120 g", unidade: "un", tipo: "PREPARO", rendimento: 10, unitCost: null, componentes: [{ insumoId: "carne", quantidade: 1200 }, { insumoId: "sal", quantidade: 20 }] },
  { id: "carne", nome: "Acém moído", unidade: "g", tipo: null, rendimento: null, unitCost: 0.04, componentes: [] },
  { id: "sal", nome: "Sal", unidade: "g", tipo: null, rendimento: null, unitCost: 0.002, componentes: [] },
  { id: "queijo", nome: "Cheddar fatiado", unidade: "g", tipo: null, rendimento: null, unitCost: 0.06, componentes: [] },
  { id: "batata-crua", nome: "Batata congelada", unidade: "g", tipo: null, rendimento: null, unitCost: 0.02, componentes: [] },
  { id: "coca-lata", nome: "Coca lata", unidade: "un", tipo: null, rendimento: null, unitCost: 3, componentes: [] },
  { id: "embalagem", nome: "Caixa de hambúrguer", unidade: "un", tipo: null, rendimento: null, unitCost: 0.9, componentes: [] },
];

const item = (produtoId: string | null, nome: string, quantidade: number, escolhas: unknown = null) => ({ produtoId, nome, quantidade, preco: 30, escolhas });

console.log("\n1) Consumo pelas vendas × ficha de hoje, no dia operacional");
const c = consumoPorDia([
  // 19:00 do dia 06 (22:00 UTC): 2 X-Burger no balcão.
  { createdAt: "2026-11-06T22:00:00Z", items: [item("x-burger", "X-Burger", 2)] },
  // 01:30 do dia 07 (04:30 UTC) ainda é o expediente do dia 06.
  { createdAt: "2026-11-07T04:30:00Z", items: [item("ifood-123", "X-Burger", 1)] },
  // Combo no site, formato { grupo: { opção: qtd } }: 1 X-Burger + 1 Batata + 1 Coca.
  { createdAt: "2026-11-07T20:00:00Z", items: [item("combo", "Combo Avenida", 2, { g1: { "X-Burger": 1, "Batata Frita": 1, "Coca Lata": 1 } })] },
  // Milk Shake sem ficha e um item que não existe no cardápio.
  { createdAt: "2026-11-07T20:10:00Z", items: [item("milk", "Milk Shake", 3), item(null, "Açaí 500", 1)] },
], CAT, TZ);
confere("o dia 06 tem 3 X-Burger (o da 01:30 é do dia 06), o pão sai 3 vezes", Object.fromEntries(c.porDia.get("2026-11-06")!), { pao: 3, blend: 3, queijo: 60 });
confere("o combo × 2 baixa a embalagem e cada opção escolhida × 2", Object.fromEntries(c.porDia.get("2026-11-07")!), { embalagem: 2, pao: 2, blend: 2, queijo: 40, "batata-crua": 400, "coca-lata": 2 });
confere("sem ficha: Milk Shake (3) e o nome que não existe (1) — fora do consumo, na lista de cadastrar", Object.fromEntries(c.semFicha), { "Milk Shake": 3, "Açaí 500": 1 });

console.log("\n2) O preparo desce para o insumo comprado");
const total = totalDosDias(c.porDia);
const { comprados, preparos } = separarPreparos(total, INSUMOS);
confere("5 blends = 5 × 120 g de acém e 5 × 2 g de sal; o blend vai para 'produzir'",
  [comprados.get("carne"), comprados.get("sal"), comprados.has("blend"), preparos.get("blend")], [600, 10, false, 5]);

console.log("\n3) Quanto comprar");
const base: InsumoDaLista = { id: "queijo", nome: "Cheddar fatiado", unidade: "g", lojaId: "L", saldo: 500, minimo: 300, ideal: null, custo: 0.06, fornecedor: "Laticínios Serra" };
// 2.800 g em 28 dias = 100 g por dia.
let l = linhaDaLista(base, 2800, 28, { modo: "ideal" });
confere("sem ideal: sugere 7 dias de consumo (700 g) e compra 200 g; dura 5 dias", [l.consumoPorDia, l.idealSugerido, l.comprar, l.duraDias, l.custoDaCompra, l.situacao], [100, 700, 200, 5, 12, "comprar"]);
l = linhaDaLista({ ...base, ideal: 2000 }, 2800, 28, { modo: "ideal" });
confere("com ideal de 2 kg: compra 1.500 g (o sugerido some)", [l.idealSugerido, l.comprar], [null, 1500]);
l = linhaDaLista(base, 2800, 28, { modo: "dias", dias: 15 });
confere("para 15 dias: 1.500 g − 500 g = 1.000 g", l.comprar, 1000);
l = linhaDaLista({ ...base, saldo: -250 }, 2800, 28, { modo: "dias", dias: 3 });
confere("saldo negativo conta como zero; 3 dias (300 g) não fica abaixo do mínimo (300 g)", [l.comprar, l.situacao, l.duraDias], [300, "acabou", 0]);
l = linhaDaLista({ ...base, saldo: 250 }, 0, 28, { modo: "ideal" });
confere("sem consumo e com mínimo: compra até o mínimo; situação abaixo do mínimo", [l.comprar, l.situacao, l.duraDias], [50, "abaixoDoMinimo", null]);
l = linhaDaLista({ ...base, minimo: null }, 0, 28, { modo: "ideal" });
confere("sem consumo, mínimo nem ideal: não compra nada e diz 'sem uso'", [l.comprar, l.alvo, l.situacao], [0, null, "semUso"]);
l = linhaDaLista({ ...base, custo: null }, 2800, 28, { modo: "ideal" });
confere("sem custo: compra a quantidade, custo da compra fica null (nunca R$ 0)", [l.comprar, l.custoDaCompra], [200, null]);
confere("arredonda para pedir: 1.234 g → 1.240 g; 2,33 kg → 2,4 kg; 7,2 un → 8 un",
  [arredondarCompra(1234, "g"), arredondarCompra(2.33, "kg"), arredondarCompra(7.2, "un"), arredondarCompra(1240, "g")], [1240, 2.4, 8, 1240]);

console.log("\n4) Por fornecedor, com o pedido pronto");
const r = listaDeCompras({
  insumos: [
    base,
    { ...base, id: "coca", nome: "Coca lata", unidade: "un", saldo: 0, minimo: 24, custo: 3, fornecedor: "Distribuidora Rio" },
    { ...base, id: "pao", nome: "Pão brioche", unidade: "un", saldo: 100, minimo: 20, ideal: 120, custo: 1.5, fornecedor: " laticinios serra " },
    { ...base, id: "sal", nome: "Sal", unidade: "g", saldo: 5000, minimo: 1000, custo: 0.002, fornecedor: null },
    { ...base, id: "caixa", nome: "Caixa", unidade: "un", saldo: 10, minimo: 50, custo: null, fornecedor: null },
  ],
  consumo: new Map([["queijo", 2800], ["coca", 280], ["pao", 560]]),
  diasDaBase: 28, modo: { modo: "ideal" }, loja: "Hambúrgueria Avenida",
});
confere("'Laticínios Serra' e ' laticinios serra ' são o mesmo; o maior valor primeiro; sem fornecedor por último",
  r.fornecedores.map((f) => [f.fornecedor, f.itens.map((i) => i.id), f.total, f.itensSemCusto]),
  [["Distribuidora Rio", ["coca"], 210, 0], ["Laticínios Serra", ["queijo", "pao"], 42, 0], ["Sem fornecedor", ["caixa"], 0, 1]]);
confere("a lista começa pelo que acabou e pelo abaixo do mínimo", r.linhas.slice(0, 2).map((x) => [x.id, x.situacao]), [["coca", "acabou"], ["caixa", "abaixoDoMinimo"]]);
confere("totais: R$ 252 a comprar em 4 itens, 1 sem custo; valor do estoque = saldo × custo (sem o sem custo)",
  [r.totais.aComprar, r.totais.itens, r.totais.itensSemCusto, r.totais.valorDoEstoque, r.totais.insumosSemCusto], [252, 4, 1, 190, 1]);
confere("o texto do WhatsApp: kg quando passa de mil, um item por linha",
  textoDoPedido("Hambúrgueria Avenida", [{ nome: "Cheddar fatiado", comprar: 1500, unidade: "g" }, { nome: "Coca lata", comprar: 70, unidade: "un" }, { nome: "Nada", comprar: 0, unidade: "un" }]),
  "Olá! Pedido da *Hambúrgueria Avenida*:\n\n• 1,5 kg — Cheddar fatiado\n• 70 un — Coca lata\n\nObrigado!");
confere("quantidade legível", [quantidadeLegivel(2500, "g"), quantidadeLegivel(750, "ml"), quantidadeLegivel(3, "un"), quantidadeLegivel(1.25, "kg")], ["2,5 kg", "750 ml", "3 un", "1,25 kg"]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
