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
  escolhasDoItemComGrupo, itensVendidos, type ConfigDosItens, type ContextoDaConta, type GrupoDoCadastro, type NoDoRelatorio,
} from "../src/lib/relatorios/itens-vendidos";

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

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
