// As regras W16/W17 da NF-e: o cabeçalho tem que ser a SOMA dos itens.
// Um centavo de diferença aqui não é arredondamento tolerado — é rejeição.
import { ratearEmCentavos } from "../src/lib/rateio.ts";

let falhas = 0;
const t = (nome, fn) => { try { fn(); console.log("  ok  " + nome); } catch (e) { falhas++; console.log("FALHOU " + nome + "\n       " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ""} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
const c = (v) => Math.round(v * 100);
const somaC = (arr) => arr.reduce((s, v) => s + c(v), 0);

// Reproduz a montagem da nota, como em fiscal-emissao.
function montarTotais(itens, descontoBruto, taxaBruta) {
  const somaDosItens = Number(itens.reduce((s, v) => s + Number(v.toFixed(2)), 0).toFixed(2));
  let desconto = Math.max(0, Number((descontoBruto || 0).toFixed(2)));
  let outras = Math.max(0, Number((taxaBruta || 0).toFixed(2)));
  if (desconto > somaDosItens) {
    const excedente = Number((desconto - somaDosItens).toFixed(2));
    desconto = somaDosItens;
    outras = Math.max(0, Number((outras - excedente).toFixed(2)));
  }
  const total = Number((somaDosItens - desconto + outras).toFixed(2));
  const pesos = itens.map((v) => c(v));
  return {
    somaDosItens, desconto, outras, total,
    descontoPorItem: desconto > 0 ? ratearEmCentavos(desconto, pesos) : null,
    despesaPorItem: outras > 0 ? ratearEmCentavos(outras, pesos) : null,
  };
}

// A conferência que a SEFAZ faz.
function conferir(n, itens) {
  if (n.descontoPorItem && somaC(n.descontoPorItem) !== c(n.desconto))
    throw new Error(`W17: soma dos vDesc dos itens (${somaC(n.descontoPorItem)}) != vDesc do total (${c(n.desconto)})`);
  if (n.despesaPorItem && somaC(n.despesaPorItem) !== c(n.outras))
    throw new Error(`W17: soma dos vOutro dos itens (${somaC(n.despesaPorItem)}) != vOutro do total (${c(n.outras)})`);
  if (somaC(itens) !== c(n.somaDosItens))
    throw new Error("W16: vProd do total != somatório dos itens");
  if (c(n.total) !== c(n.somaDosItens) - c(n.desconto) + c(n.outras))
    throw new Error("vNF não fecha com vProd - vDesc + vOutro");
  // Nenhum item pode ter desconto maior que o próprio valor.
  if (n.descontoPorItem) n.descontoPorItem.forEach((d, i) => {
    if (c(d) > c(itens[i])) throw new Error(`item ${i}: vDesc ${d} > vProd ${itens[i]}`);
  });
  if (n.total <= 0) throw new Error("total <= 0");
}

console.log("\n— casos reais de delivery —");
t("pedido comum com taxa de entrega", () => {
  const itens = [25.9, 12.5, 8];
  conferir(montarTotais(itens, 0, 7.9), itens);
});
t("pedido com cupom e taxa juntos", () => {
  const itens = [25.9, 12.5, 8];
  conferir(montarTotais(itens, 10, 7.9), itens);
});
t("valor que gera dízima na divisão (10 entre 3 itens iguais)", () => {
  const itens = [10, 10, 10];
  const n = montarTotais(itens, 10, 0);
  conferir(n, itens);
  eq(somaC(n.descontoPorItem), 1000, "os centavos não podem sumir");
});
t("taxa de 5,99 rateada em 7 itens quebrados", () => {
  const itens = [3.33, 7.77, 1.11, 22.22, 9.99, 4.44, 0.55];
  conferir(montarTotais(itens, 0, 5.99), itens);
});
t("um item só", () => {
  const itens = [30];
  conferir(montarTotais(itens, 5, 8), itens);
});
t("centavo indivisível: 0,01 entre 3 itens", () => {
  const itens = [10, 10, 10];
  const n = montarTotais(itens, 0.01, 0);
  conferir(n, itens);
  eq(somaC(n.despesaPorItem ?? []), 0);
});

console.log("\n— o caso que quebraria a nota —");
t("cupom de frete grátis maior que os produtos vira desconto da ENTREGA", () => {
  // Itens R$ 20, desconto R$ 25 (produto + frete), taxa R$ 10.
  // Sem tratamento, algum item receberia vDesc > vProd e a SEFAZ rejeitaria.
  const itens = [12, 8];
  const n = montarTotais(itens, 25, 10);
  conferir(n, itens);
  eq(n.desconto, 20, "desconto limitado aos produtos");
  eq(n.outras, 5, "excedente abatido da taxa");
  eq(n.total, 5, "o total que o cliente pagou não muda: 20 - 25 + 10 = 5");
});
t("desconto exatamente igual aos produtos", () => {
  const itens = [12, 8];
  const n = montarTotais(itens, 20, 10);
  conferir(n, itens);
  eq(n.total, 10);
});

console.log("\n— sem desconto e sem taxa nada é enviado —");
t("pedido de balcão limpo não ganha campo nenhum", () => {
  const n = montarTotais([15, 5], 0, 0);
  eq(n.descontoPorItem, null);
  eq(n.despesaPorItem, null);
  eq(n.total, 20);
});

console.log("\n— varredura: 2000 combinações aleatórias —");
t("nenhuma combinação quebra as regras W16/W17", () => {
  let rng = 12345;
  const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 2000; k++) {
    const qtd = 1 + Math.floor(rnd() * 8);
    const itens = Array.from({ length: qtd }, () => Number((0.5 + rnd() * 80).toFixed(2)));
    const soma = itens.reduce((s, v) => s + v, 0);
    const desconto = Number((rnd() * soma * 1.2).toFixed(2)); // às vezes maior que os itens
    const taxa = Number((rnd() * 25).toFixed(2));
    const n = montarTotais(itens, desconto, taxa);
    if (n.total <= 0) continue; // nota assim já é recusada antes, com mensagem
    conferir(n, itens);
  }
});

console.log(falhas === 0 ? "\nTUDO PASSOU\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
