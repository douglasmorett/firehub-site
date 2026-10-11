/**
 * Trava o relatório "Itens vendidos" (lib/relatorios/itens-vendidos.ts) nas
 * regras da Saipos que o lojista conhece e nas que o FireHub faz melhor.
 *
 *   npx tsx scripts/teste-itens-vendidos.ts
 *
 * O cadastro imita a NIK (24/09/2026): pizza com grupo de sabores de preço
 * pelo mais caro, sabores e bordas como complementos, Coca vendida sozinha e
 * dentro do combo.
 */
import { montarMapasDoRelatorio } from "../src/lib/itens-do-relatorio";
import { chaveDoNome } from "../src/lib/categoria-do-item";
import {
  escolhasDoItemComGrupo, grupoDeSaborDePizza, itensVendidos, produtoDePizza,
  type ConfigDosItens, type ContextoDaConta, type GrupoDoCadastro, type NoDoRelatorio,
} from "../src/lib/relatorios/itens-vendidos";
import { montarCatalogo, type ProdutoDoCatalogo } from "../src/lib/relatorios/catalogo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const L = "nik";
const complemento = (id: string, name: string, category: string) =>
  ({ id, franchiseeId: L, name, category, price: 0, cost: 0, active: true, apenasEmCombo: true });
const PRODUTOS = [
  {
    id: "pg", franchiseeId: L, name: "Pizza Grande", category: "Pizzas", price: 0, cost: 0, active: true,
    comboGroups: [
      { id: "gs", title: "Sabores", priceRule: "MAIOR", items: [
        { menuProductId: "sp", additionalPrice: 57.9 }, { menuProductId: "sc", additionalPrice: 56.9 },
      ] },
      { id: "gb", title: "Bordas", priceRule: null, items: [{ menuProductId: "bc", additionalPrice: 12 }] },
    ],
  },
  complemento("sp", "Portuguesa", "Sabores de Pizza"),
  complemento("sc", "Calabresa", "Sabores de Pizza"),
  complemento("bc", "Borda de Catupiry", "Bordas"),
  { id: "coca", franchiseeId: L, name: "Coca Cola 1,5l", category: "Bebidas", price: 12, cost: 5, active: true },
  { id: "combo", franchiseeId: L, name: "Combo 1", category: "Combos", price: 45, cost: 0, active: true,
    comboGroups: [{ id: "gbeb", title: "Sua bebida", priceRule: null, items: [{ menuProductId: "coca", additionalPrice: 0 }] }] },
];
const mapas = montarMapasDoRelatorio(PRODUTOS as any);
const grupos = new Map<string, GrupoDoCadastro>();
for (const p of PRODUTOS as any[]) for (const g of p.comboGroups || []) grupos.set(g.id, { id: g.id, titulo: g.title, fracionado: Boolean(g.priceRule) });
const vendaveis = new Map([["coca cola 1 5l", { id: "coca", nome: "Coca Cola 1,5l", categoria: "Bebidas" }]]);
const conta: ContextoDaConta = { mapasDe: (id) => mapas(id), grupos, vendaveisDe: () => vendaveis };

const cfg = (x: Partial<ConfigDosItens> = {}): ConfigDosItens => ({
  porCategoria: false, opcoesPorProduto: false, apenasProdutos: false, juntarMesmoNome: true, percentualPor: "quantidade",
  categorias: new Set(), produtos: new Set(), gruposOcultos: new Set(), ...x,
});

const PIZZA = { id: "pg", name: "Pizza Grande", category: "Pizzas", active: true };
const PEDIDOS = [
  // Site: meio a meio Portuguesa/Calabresa + borda, grupo de sabores fracionado.
  { franchiseeId: L, canal: "SITE", items: [
    { quantity: 1, price: 69.9, menuProductId: "pg", menuProduct: PIZZA, comboSelections: JSON.stringify({ gs: { Portuguesa: 1, Calabresa: 1 }, gb: { "Borda de Catupiry": 1 } }) },
  ] },
  // iFood: a meia vem no nome, com o preço da metade.
  { franchiseeId: L, canal: "IFOOD", items: [
    { quantity: 1, price: 59.9, productName: "GRANDE 2 SABORES", menuProductId: "ifood-x", menuProduct: { id: "ifood-x", name: "GRANDE 2 SABORES", category: "iFood", active: false },
      comboSelections: JSON.stringify([{ name: "1/2 Portuguesa", quantity: 1, price: 29.95 }, { name: "1/2 Calabresa", quantity: 1, price: 29.95 }]) },
  ] },
  // Balcão: Coca avulsa e Combo com Coca dentro.
  { franchiseeId: L, canal: "PDV", items: [
    { quantity: 2, price: 12, menuProductId: "coca", menuProduct: { id: "coca", name: "Coca Cola 1,5l", category: "Bebidas", active: true } },
    { quantity: 1, price: 45, menuProductId: "combo", menuProduct: { id: "combo", name: "Combo 1", category: "Combos", active: true }, comboSelections: JSON.stringify([{ name: "Coca Cola 1,5l", quantity: 1 }]) },
  ] },
];

const acha = (nos: NoDoRelatorio[] | null | undefined, nome: string): NoDoRelatorio | undefined => {
  for (const n of nos || []) {
    if (n.nome === nome) return n;
    const f = acha(n.filhos, nome);
    if (f) return f;
  }
  return undefined;
};
/** A soma do valor das linhas de cima (o que a tabela mostra, linha a linha). */
const somaDe = (nos: NoDoRelatorio[] | null | undefined) => Math.round((nos || []).reduce((s, n) => s + (n.valor || 0), 0) * 100) / 100;
/** A soma da quantidade das linhas de cima. */
const qtdDe = (nos: NoDoRelatorio[] | null | undefined) => Math.round((nos || []).reduce((s, n) => s + n.quantidade, 0) * 1000) / 1000;

console.log("\n1) A fração do sabor");
confere("site, grupo de pizza: meio a meio = 0,5 de cada",
  escolhasDoItemComGrupo(PEDIDOS[0].items[0], grupos).map((e) => [e.nome, e.quantidade]),
  [["Portuguesa", 0.5], ["Calabresa", 0.5], ["Borda de Catupiry", 1]]);
confere("iFood: '1/2 Portuguesa' = 0,5, preço da metade guardado",
  escolhasDoItemComGrupo(PEDIDOS[1].items[0], grupos).map((e) => [e.nome, e.quantidade, e.precoDoCanal]),
  [["Portuguesa", 0.5, 29.95], ["Calabresa", 0.5, 29.95]]);
confere("2 pizzas iguais: a fração multiplica pelo item",
  escolhasDoItemComGrupo({ quantity: 2, comboSelections: JSON.stringify({ gs: { Portuguesa: 1, Calabresa: 1 } }) }, grupos).map((e) => e.quantidade),
  [1, 1]);

console.log("\n2) Visão padrão: Itens e Opções separados");
const padrao = itensVendidos(PEDIDOS as any, conta, cfg());
confere("total = total dos itens (produto já contém as opções)", padrao.total, { quantidade: 5, valor: 198.8 });
confere("a Portuguesa soma as duas metades (site + iFood) = 1 pizza",
  acha(padrao.opcoes, "Portuguesa")?.quantidade, 1);
confere("o valor do sabor do iFood é o que o iFood mandou; o do site sai do cadastro (57,90 × 0,5)",
  acha(padrao.opcoes, "Portuguesa")?.valor, 58.9);
confere("grupos: a categoria do complemento, igual em todo canal; a Coca do combo na categoria dela",
  padrao.opcoes?.map((g) => g.nome), ["Sabores de Pizza", "Bordas", "Bebidas"]);

console.log("\n3) Categoria → produto → opções (a tela do vídeo da NIK)");
const arvore = itensVendidos(PEDIDOS as any, conta, cfg({ porCategoria: true, opcoesPorProduto: true }));
confere("sem tabela de opções nesse modo", arvore.opcoes, null);
const pizzas = acha(arvore.itens, "Pizzas");
confere("categoria Pizzas: 1 pizza do site, R$ 69,90", [pizzas?.quantidade, pizzas?.valor], [1, 69.9]);
confere("dentro da pizza: sabores fracionados e a borda inteira (empate na quantidade: o de maior valor primeiro)",
  acha(arvore.itens, "Pizza Grande")?.filhos?.map((o) => [o.nome, o.quantidade]),
  [["Borda de Catupiry", 1], ["Portuguesa", 0.5], ["Calabresa", 0.5]]);
confere("percentual da opção é entre as opções do produto (0,5 de 2 = 25%)",
  acha(acha(arvore.itens, "Pizza Grande")?.filhos, "Portuguesa")?.pct, 25);

console.log("\n4) Agrupar apenas produtos: a Coca do combo soma na Coca avulsa");
const soProdutos = itensVendidos(PEDIDOS as any, conta, cfg({ apenasProdutos: true }));
confere("Coca = 2 avulsas + 1 do combo", acha(soProdutos.itens, "Coca Cola 1,5l")?.quantidade, 3);
confere("o valor da Coca continua o das avulsas (o do combo está no combo)", acha(soProdutos.itens, "Coca Cola 1,5l")?.valor, 24);
confere("sem tabela de opções", soProdutos.opcoes, null);

console.log("\n5) Filtragem de opções e percentual por valor");
const semBordas = itensVendidos(PEDIDOS as any, conta, cfg({ gruposOcultos: new Set([`grupo:${chaveDoNome("Bordas")}`]) }));
confere("esconder o grupo Bordas tira a borda, não mexe no total",
  [acha(semBordas.opcoes, "Borda de Catupiry"), semBordas.total.valor], [undefined, 198.8]);
const porValor = itensVendidos(PEDIDOS as any, conta, cfg({ percentualPor: "valor" }));
confere("% por valor: a pizza do site (69,90) sobre 198,80",
  acha(porValor.itens, "Pizza Grande")?.pct, 35.161);

console.log("\n6) Filtro de categoria vale para o item");
const soBebidas = itensVendidos(PEDIDOS as any, conta, cfg({ categorias: new Set(["Bebidas"]) }));
confere("só Bebidas: 2 Cocas, R$ 24", soBebidas.total, { quantidade: 2, valor: 24 });

// O iFood #0272 da Hakim Centro (10/10/2026, 23h12): "Combo do Solteiro" com
// "3x Frango c/ Catupiry" gravado a 7,44 — o TOTAL das três (2,48 cada), como
// o iFood e o 99 gravam. A Brendi grava o unitário. O relatório mostrava
// R$ 22,32 (7,44 × 3).
console.log("\n7) Valor da opção com quantidade: iFood/99 gravam o total da linha, Brendi o unitário");
const combo = (canal: string, preco: number, qtdItem = 1) => ({ franchiseeId: L, canal, items: [
  { quantity: qtdItem, price: 37.34, productName: "Combo do Solteiro", menuProductId: "ifood-solteiro",
    menuProduct: { id: "ifood-solteiro", name: "Combo do Solteiro", category: "iFood", active: false },
    comboSelections: JSON.stringify([{ name: "Frango c/ Catupiry", quantity: 3, price: preco }, { name: "Guaravita", quantity: 1, price: 0 }]) },
] });
const valorDoFrango = (pedido: any) => acha(itensVendidos([pedido], conta, cfg({ opcoesPorProduto: true })).itens, "Frango c/ Catupiry");
confere("iFood #0272: 3 Frango, R$ 7,44 (não R$ 22,32)",
  [valorDoFrango(combo("IFOOD", 7.44))?.quantidade, valorDoFrango(combo("IFOOD", 7.44))?.valor], [3, 7.44]);
confere("99Food: a mesma leitura do iFood", valorDoFrango(combo("99FOOD", 7.44))?.valor, 7.44);
confere("Brendi grava o unitário (2,48): o mesmo R$ 7,44", valorDoFrango(combo("BRENDI", 2.48))?.valor, 7.44);
confere("iFood com 2 combos: 6 Frango, R$ 14,88 (o gravado é por unidade do item)",
  [valorDoFrango(combo("IFOOD", 7.44, 2))?.quantidade, valorDoFrango(combo("IFOOD", 7.44, 2))?.valor], [6, 14.88]);
confere("o preço unitário guardado na escolha: 7,44 ÷ 3 no iFood, 2,48 na Brendi",
  [escolhasDoItemComGrupo(combo("IFOOD", 7.44).items[0], grupos, { canal: "IFOOD" })[0].precoDoCanal,
   escolhasDoItemComGrupo(combo("BRENDI", 2.48).items[0], grupos, { canal: "BRENDI" })[0].precoDoCanal],
  [2.48, 2.48]);
confere("`price: true` (Brendi até 19/09/2026) não vira R$ 1,00",
  escolhasDoItemComGrupo({ quantity: 1, comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1, price: true }]) }, grupos, { canal: "BRENDI" })[0].precoDoCanal,
  null);
const tabelaDoIfood = itensVendidos([combo("IFOOD", 7.44)] as any, conta, cfg({ percentualPor: "valor" }));
confere("tabela Opções pelo valor: o grupo vale R$ 7,44 e o total dos itens não muda (R$ 37,34)",
  [somaDe(tabelaDoIfood.opcoes), tabelaDoIfood.total.valor], [7.44, 37.34]);

// ── MEIA PIZZA SEM priceRule E SEM GRUPO GRAVADO ────────────────────────────
// Pizzaria 17 (30 dias até 11/10/2026): "COMBO 1 — Pizza G: escolha 2 sabores"
// (sem regra de preço) contava Calabresa 1 + Bacon c/ Ovos 1; no balcão e na
// mesa, que gravam [{ name, quantity }] sem o grupo, nem o grupo com regra
// fracionava. Rodízio e mini pastel são unidades inteiras.
console.log("\n8) Quando o grupo é de sabor de pizza (o critério, explícito)");
const g = (titulo: string, produto: string, categoria: string, x: { priceRule?: string; maxQty?: number } = {}) =>
  grupoDeSaborDePizza({ titulo, priceRule: x.priceRule ?? null, maxQty: x.maxQty ?? 2 }, { nome: produto, categoria });
confere("FRAÇÃO: P17 'Pizza G: escolha 2 sabores' (COMBO 1, sem regra de preço)", g("Pizza G: escolha 2 sabores", "COMBO 1", "Combos Pizzas"), true);
confere("FRAÇÃO: P17 'Pizza XGG: escolha 4 sabores'", g("Pizza XGG: escolha 4 sabores", "COMBO 3", "Combos Pizzas", { maxQty: 4 }), true);
confere("FRAÇÃO: NIK 'Escolha as 2 metades' em combo de pizza", g("Escolha as 2 metades (o mesmo sabor 2x = pizza inteira)", "Combo 2: Pizza Especial + Borda", "Combos Pizza"), true);
confere("FRAÇÃO: título genérico em produto de pizza ('ESCOLA ATE 2 SABORES', PIZZAS GRANDE PROMOCAO)", g("ESCOLA ATE 2 SABORES", "PIZZAS  GRANDE PROMOCAO", "PIZZAS"), true);
confere("FRAÇÃO: Hakim 'Escolha os sabores da pizza (1 ou 2)' no combo pizza + esfirras", g("Escolha os sabores da pizza (1 ou 2)", "Combo Pizza Grande + 4 Esfirra", "Combos"), true);
confere("FRAÇÃO: 'mini' só no nome do combo, a pizza no título (Forno Doro)", g("Escolha até 2 sabores para a pizza:", "Combo 3 - Pizza Media+mini Broto", "Promoções"), true);
confere("FRAÇÃO: com regra de preço (mais caro), sempre", g("Escolha até 2 sabores (cobra o sabor mais caro)", "Pizza G (8 Fatias)", "Pizzas", { priceRule: "MAIOR" }), true);
confere("INTEIRA: as esfirras do mesmo combo", g("Escolha os sabores das esfirras", "Combo Pizza Grande + 4 Esfirra", "Combos"), false);
confere("INTEIRA: rodízio na categoria Pizza (Showrrascão)", g("Escolha o sabor do seu Rodizio", "Rodizio em casa", "Pizza", { maxQty: 4 }), false);
confere("INTEIRA: mini rodízio de pastel (Pastel da Paulista)", g("Sabores doce", "Mini Rodízio Doce", "Mini Rodízio", { maxQty: 4 }), false);
confere("INTEIRA: sabores dos pastéis do combo infantil", g("Escolha os sabores dos pastéis", "Combo 1 + guaravita", "Menu infantil", { maxQty: 4 }), false);
confere("INTEIRA: sabores de refrigerante (Deeds)", g("Sabores", "Refrigerantes", "Bebidas", { maxQty: 10 }), false);
confere("INTEIRA: caixa de mini pizzas", g("Escolha os sabores", "Mini pizzas (caixa)", "Pizzas", { maxQty: 4 }), false);
confere("INTEIRA: mais de 4 sabores não é uma pizza", g("Pizza: escolha 8 sabores", "Kit festa", "Pizzas", { maxQty: 8 }), false);
confere("INTEIRA: pergunta que não é de sabor ('Escolha a bebida')", g("Escolha a bebida", "COMBO 1", "Combos Pizzas"), false);
confere("produto de pizza: sim para 'PIZZAS - Gigante… 2 sabores'; não para rodízio nem mini",
  [produtoDePizza("PIZZAS - Gigante (10 Fatias 35 cm) 2 sabores", "Brendi"), produtoDePizza("Rodizio em casa", "Pizza"), produtoDePizza("Mini pizza", "Lanches")],
  [true, false, false]);

console.log("\n9) Meia pizza: o grupo decide a fração, no site, no balcão, na mesa e no marketplace");
const P17 = "p17";
const sabor = (id: string, name: string) => ({ id, franchiseeId: P17, name, category: "Sabores", active: true, apenasEmCombo: true, price: 0, comboGroups: [] });
const opcoes = (...ids: string[]) => ids.map((menuProductId) => ({ menuProductId, additionalPrice: 0 }));
const SABORES = ["cal", "bac", "fra", "mil", "pdp"];
const CARDAPIO_P17: ProdutoDoCatalogo[] = [
  sabor("cal", "Calabresa"), sabor("bac", "Bacon c/ Ovos"), sabor("fra", "Frango c/ Catupiry"), sabor("mil", "Milho com Bacon"), sabor("pdp", "Peito de Peru"),
  { id: "gua", franchiseeId: P17, name: "Guaraná 1,5L", category: "Bebidas", active: true, price: 12, comboGroups: [] },
  { id: "c1", franchiseeId: P17, name: "COMBO 1", category: "Combos Pizzas", active: true, price: 79.9, comboGroups: [
    { id: "c1s", title: "Pizza G: escolha 2 sabores", priceRule: null, maxQty: 2, items: opcoes(...SABORES) },
    { id: "c1b", title: "Escolha a bebida", priceRule: null, maxQty: 1, items: opcoes("gua") },
  ] },
  { id: "c3", franchiseeId: P17, name: "COMBO 3", category: "Combos Pizzas", active: true, price: 99.9, comboGroups: [
    { id: "c3s", title: "Pizza XGG: escolha 4 sabores", priceRule: null, maxQty: 4, items: opcoes(...SABORES) },
  ] },
  { id: "c4", franchiseeId: P17, name: "COMBO 4", category: "Combos Pizzas", active: true, price: 119.9, comboGroups: [
    { id: "c4a", title: "1ª Pizza M: escolha 2 sabores", priceRule: null, maxQty: 2, items: opcoes(...SABORES) },
    { id: "c4b", title: "2ª Pizza M: escolha 2 sabores", priceRule: null, maxQty: 2, items: opcoes(...SABORES) },
  ] },
  { id: "pg", franchiseeId: P17, name: "Pizza G (8 Fatias)", category: "Pizzas", active: true, price: 0, comboGroups: [
    { id: "pgs", title: "Escolha até 2 sabores (cobra o sabor mais caro)", priceRule: "MAIOR", maxQty: 2, items: opcoes(...SABORES) },
  ] },
  { id: "rod", franchiseeId: P17, name: "Rodizio em casa", category: "Pizza", active: true, price: 89.9, comboGroups: [
    { id: "rods", title: "Escolha o sabor do seu Rodizio", priceRule: null, maxQty: 4, items: opcoes(...SABORES) },
  ] },
  { id: "ifood-pg", franchiseeId: P17, name: "Pizza G (8 Fatias)", category: "iFood", active: false, price: 0, comboGroups: [] },
];
const cat17 = montarCatalogo(CARDAPIO_P17);
const conta17: ContextoDaConta = { mapasDe: cat17.mapasDe, grupos: cat17.grupos, vendaveisDe: cat17.vendaveisDe, gruposDoItem: cat17.gruposDoItem };
const produto17 = (id: string) => { const p = CARDAPIO_P17.find((x) => x.id === id)!; return { id: p.id, name: p.name, category: p.category, active: p.active }; };
const item17 = (id: string, comboSelections: unknown, quantity = 1) => ({ quantity, price: 80, menuProductId: id, menuProduct: produto17(id), comboSelections });
const sabores = (canal: string, item: any, loja = P17) => {
  const r = itensVendidos([{ franchiseeId: loja, canal, items: [item] }] as any, conta17, cfg({ opcoesPorProduto: true }));
  return (r.itens[0]?.filhos || []).map((o) => [o.nome, o.quantidade]).sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0])));
};
confere("site: COMBO 1 com Calabresa e Bacon c/ Ovos = 0,5 + 0,5 (antes 1 + 1)",
  sabores("SITE", item17("c1", { c1s: { Calabresa: 1, "Bacon c/ Ovos": 1 }, c1b: { "Guaraná 1,5L": 1 } })),
  [["Bacon c/ Ovos", 0.5], ["Calabresa", 0.5], ["Guaraná 1,5L", 1]]);
confere("site: o mesmo sabor 2× é a pizza inteira dele (1)",
  sabores("SITE", item17("c1", { c1s: { Calabresa: 2 } })), [["Calabresa", 1]]);
confere("mesa, sem o grupo gravado: COMBO 3 com '4x Milho com Bacon' = 1 pizza (antes 4)",
  sabores("MESA", item17("c3", JSON.stringify([{ name: "Milho com Bacon", quantity: 4 }, { name: "Guaraná 1,5L", quantity: 1 }]))),
  [["Guaraná 1,5L", 1], ["Milho com Bacon", 1]]);
confere("balcão, sem o grupo gravado: pizza com regra de preço, 2 sabores = 0,5 cada (antes 1 + 1)",
  sabores("PDV", item17("pg", JSON.stringify([{ name: "Peito de Peru", quantity: 1 }, { name: "Calabresa", quantity: 1 }]))),
  [["Calabresa", 0.5], ["Peito de Peru", 0.5]]);
confere("balcão, 2 pizzas iguais: 1 + 1",
  sabores("PDV", item17("pg", JSON.stringify([{ name: "Peito de Peru", quantity: 1 }, { name: "Calabresa", quantity: 1 }]), 2)),
  [["Calabresa", 1], ["Peito de Peru", 1]]);
confere("COMBO 4 (duas pizzas com os mesmos sabores, sem grupo gravado): 4 sabores repartem 2 pizzas",
  sabores("MESA", item17("c4", JSON.stringify([{ name: "Calabresa", quantity: 1 }, { name: "Frango c/ Catupiry", quantity: 1 }, { name: "Peito de Peru", quantity: 1 }, { name: "Bacon c/ Ovos", quantity: 1 }]))),
  [["Bacon c/ Ovos", 0.5], ["Calabresa", 0.5], ["Frango c/ Catupiry", 0.5], ["Peito de Peru", 0.5]]);
confere("site com grupo que o cardápio já apagou (salvar recria os ids — Deeds): o grupo de hoje diz que é sabor; 0,5 cada",
  sabores("SITE", item17("c1", { grupoApagado: { Calabresa: 1, "Peito de Peru": 1 } })), [["Calabresa", 0.5], ["Peito de Peru", 0.5]]);
confere("grupo apagado com opção que não é sabor (a bebida): inteira",
  sabores("SITE", item17("c1", { outroApagado: { "Guaraná 1,5L": 2 } })), [["Guaraná 1,5L", 2]]);
confere("o grupo gravado na lista (groupId) também vale",
  sabores("PDV", item17("c1", JSON.stringify([{ name: "Calabresa", quantity: 1, groupId: "c1s" }, { name: "Frango c/ Catupiry", quantity: 1, groupId: "c1s" }]))),
  [["Calabresa", 0.5], ["Frango c/ Catupiry", 0.5]]);
confere("rodízio: cada sabor é unidade inteira (3 sabores = 3)",
  sabores("PDV", item17("rod", JSON.stringify([{ name: "Calabresa", quantity: 1 }, { name: "Milho com Bacon", quantity: 1 }, { name: "Peito de Peru", quantity: 1 }]))),
  [["Calabresa", 1], ["Milho com Bacon", 1], ["Peito de Peru", 1]]);
confere("iFood com '1/2' no nome: vale o nome (0,5), sem fracionar de novo",
  sabores("IFOOD", { quantity: 1, price: 60, productName: "Pizza G (8 Fatias)", menuProductId: "ifood-pg", menuProduct: produto17("ifood-pg"),
    comboSelections: JSON.stringify([{ name: "1/2 Calabresa", quantity: 1, price: 30 }, { name: "1/2 Peito de Peru", quantity: 1, price: 30 }]) }),
  [["Calabresa", 0.5], ["Peito de Peru", 0.5]]);
confere("espelho do iFood SEM '1/2': o grupo do produto do cardápio de mesmo nome decide (0,5 cada)",
  sabores("IFOOD", { quantity: 1, price: 60, productName: "Pizza G (8 Fatias)", menuProductId: "ifood-pg", menuProduct: produto17("ifood-pg"),
    comboSelections: JSON.stringify([{ name: "Calabresa", quantity: 1, price: 0 }, { name: "Frango c/ Catupiry", quantity: 1, price: 0 }]) }),
  [["Calabresa", 0.5], ["Frango c/ Catupiry", 0.5]]);
confere("Brendi (Supimpa, sem cardápio): 'Sabor - ' no nome de pizza de 2 sabores = 0,5 cada; a borda inteira",
  sabores("BRENDI", { quantity: 1, price: 72.99, productName: "PIZZAS - Gigante (10 Fatias 35 cm) 2 sabores", menuProductId: "brendi-x",
    menuProduct: { id: "brendi-x", name: "PIZZAS - Gigante (10 Fatias 35 cm) 2 sabores", category: "Brendi", active: false },
    comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1, price: 8 }, { name: "Sabor - A moda do cheff", quantity: 1, price: 31.19 }, { name: "Sabor - Peito de peru á francesa", quantity: 1, price: 33.8 }]) }, "supimpa"),
  [["Borda de Catupiry", 1], ["Sabor - A moda do cheff", 0.5], ["Sabor - Peito de peru á francesa", 0.5]]);
confere("'Sabor - ' fora de pizza não fraciona (suco de dois sabores = 2)",
  sabores("BRENDI", { quantity: 1, price: 12, productName: "Suco 500ml", menuProductId: "brendi-s",
    menuProduct: { id: "brendi-s", name: "Suco 500ml", category: "Brendi", active: false },
    comboSelections: JSON.stringify([{ name: "Sabor - Laranja", quantity: 1 }, { name: "Sabor - Uva", quantity: 1 }]) }, "supimpa"),
  [["Sabor - Laranja", 1], ["Sabor - Uva", 1]]);
const totalDoCombo1 = itensVendidos([{ franchiseeId: P17, canal: "SITE", items: [item17("c1", { c1s: { Calabresa: 1, "Bacon c/ Ovos": 1 } })] }] as any, conta17, cfg());
confere("o total dos itens não muda com a fração (1 combo, R$ 80)", totalDoCombo1.total, { quantidade: 1, valor: 80 });

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
