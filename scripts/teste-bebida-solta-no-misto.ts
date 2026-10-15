// NIK, 14/10/2026: pizza + Coca não deve tirar papel só com a Coca na Cozinha.
import { destinosDoPedido } from "@/lib/roteamento-de-impressao";
const cozinha = { name: "ELGIN", categories: ["Esfihas", "Bebidas"], comandaInteiraNoMisto: true };
const pizza = { name: "pizza", categories: ["Pizzas"], comandaInteiraNoMisto: true };
const P = (cat: string, name: string, bev = false) => ({ name, category: cat, isBeverage: bev });
const casos: [string, any[], string[]][] = [
  ["pizza + coca", [P("Pizzas", "Calabresa"), P("Bebidas", "Coca", true)], ["pizza:2"]],
  ["esfiha + coca", [P("Esfihas", "Carne"), P("Bebidas", "Coca", true)], ["ELGIN:2"]],
  ["só coca", [P("Bebidas", "Coca", true)], ["ELGIN:1"]],
  ["pizza + esfiha + coca", [P("Pizzas", "Calabresa"), P("Esfihas", "Carne"), P("Bebidas", "Coca", true)], ["ELGIN:3", "pizza:3"]],
];
let falhas = 0;
for (const [nome, items, esperado] of casos) {
  const r = destinosDoPedido([cozinha, pizza] as any, { source: "SITE", items } as any).map((d) => `${d.impressora.name}:${d.itens.length}`).sort();
  const ok = JSON.stringify(r) === JSON.stringify(esperado.sort());
  if (!ok) falhas++;
  console.log(ok ? "✅" : "❌", nome, r.join(" "), ok ? "" : `(esperado ${esperado.join(" ")})`);
}
if (falhas) process.exit(1); else console.log("tudo certo");

// NIK, 14/10/2026 (2): pedido só de bebida não imprime em nenhuma (vai à mão no balcão).
{
  const coz = { ...cozinha, semPedidoSoDeBebida: true };
  const r1 = destinosDoPedido([coz, pizza] as any, { source: "SITE", items: [P("Bebidas", "Coca", true)] } as any).map((d) => d.impressora.name);
  const r2 = destinosDoPedido([coz, pizza] as any, { source: "SITE", items: [P("Esfihas", "Carne"), P("Bebidas", "Coca", true)] } as any).map((d) => `${d.impressora.name}:${d.itens.length}`);
  const ok = r1.length === 0 && JSON.stringify(r2) === JSON.stringify(["ELGIN:2"]);
  console.log(ok ? "✅" : "❌", "só bebida não sai; esfiha + bebida segue na Cozinha", JSON.stringify(r1), JSON.stringify(r2));
  if (!ok) process.exit(1);
}
