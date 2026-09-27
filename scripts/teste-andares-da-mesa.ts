/**
 * Andares do salão e a impressora de cada andar (lib/andares-da-mesa.ts).
 *
 *   npx tsx scripts/teste-andares-da-mesa.ts
 *
 * O exemplo do dono (27/09/2026): térreo com as mesas 1 a 30 imprimindo na
 * impressora B; segundo andar com 31 a 60 na C. A cozinha (sem andar) segue
 * recebendo de todos.
 */
import { andarDaMesa, impressorasDoAndar, lerAndares, numerosDaFaixa } from "../src/lib/andares-da-mesa";
import { destinosDoPedido } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— Faixa de mesas como o dono escreve —");
confere("1-30", numerosDaFaixa("1-30").size, 30);
confere("1 a 5, 9", [...numerosDaFaixa("1 a 5, 9")], [1, 2, 3, 4, 5, 9]);
confere("30-28 (invertido)", [...numerosDaFaixa("30-28")], [28, 29, 30]);
confere("31 até 33", [...numerosDaFaixa("31 até 33")], [31, 32, 33]);
confere("lixo é ignorado", [...numerosDaFaixa("abc, 7, x-y")], [7]);

const cfg = {
  printers: [
    { id: "cozinha", name: "COZINHA", categories: ["Burgers", "Pizzas"], modulos: ["salao", "delivery"] },
    { id: "B", name: "IMPRESSORA B", categories: [], modulos: ["salao"], contaDaMesa: true },
    { id: "C", name: "IMPRESSORA C", categories: [], modulos: ["salao"], contaDaMesa: true },
  ],
  andares: [
    { id: "t", nome: "Térreo", mesas: "1-30", impressoras: ["B"] },
    { id: "s", nome: "Piso 2", mesas: "31-60", impressoras: ["C"] },
    { id: "", nome: "sem id é descartado", mesas: "70", impressoras: [] },
  ],
};
const andares = lerAndares(cfg);

console.log("\n— Leitura e andar da mesa —");
confere("andar sem id é descartado", andares.map((a) => a.nome), ["Térreo", "Piso 2"]);
confere("mesa 12 é do Térreo", andarDaMesa(andares, 12)?.nome, "Térreo");
confere("mesa 45 é do Piso 2", andarDaMesa(andares, "45")?.nome, "Piso 2");
confere("mesa 80 não tem andar", andarDaMesa(andares, 80), null);

const nomes = (lista: { name?: string | null }[]) => lista.map((p) => p.name);

console.log("\n— Quem pode imprimir a mesa —");
confere("mesa 12 → cozinha e B", nomes(impressorasDoAndar(cfg.printers, andares, 12)), ["COZINHA", "IMPRESSORA B"]);
confere("mesa 45 → cozinha e C", nomes(impressorasDoAndar(cfg.printers, andares, 45)), ["COZINHA", "IMPRESSORA C"]);
confere("mesa 80 (sem andar) → só a cozinha", nomes(impressorasDoAndar(cfg.printers, andares, 80)), ["COZINHA"]);
confere("pedido que não é de mesa → todas", nomes(impressorasDoAndar(cfg.printers, andares, "")), ["COZINHA", "IMPRESSORA B", "IMPRESSORA C"]);
confere("loja sem andares → todas", nomes(impressorasDoAndar(cfg.printers, [], 12)), ["COZINHA", "IMPRESSORA B", "IMPRESSORA C"]);

console.log("\n— O roteamento completo (o mesmo da fila e do painel) —");
const pedidoDaMesa = (mesa: number) => ({
  source: "PRESENCIAL",
  items: [
    { name: "Thor", category: "Burgers" },
    { name: "Coca", category: "Bebidas" },
  ],
  _mesa: mesa,
});
const rotas = (mesa: number) =>
  destinosDoPedido(cfg.printers as any, pedidoDaMesa(mesa), { andares, mesa }).map(
    (d) => `${d.impressora.name}: ${d.itens.map((i: any) => i.name).join("+")}`
  );
confere("mesa 12: burger na cozinha, o pedido inteiro na B, nada na C", rotas(12), ["COZINHA: Thor", "IMPRESSORA B: Thor+Coca"]);
confere("mesa 45: burger na cozinha, o pedido inteiro na C, nada na B", rotas(45), ["COZINHA: Thor", "IMPRESSORA C: Thor+Coca"]);
confere(
  "delivery não passa pelo andar",
  destinosDoPedido(cfg.printers as any, { source: "SITE", items: [{ name: "Thor", category: "Burgers" }] }, { andares }).map((d) => d.impressora.name),
  ["COZINHA"]
);

console.log("\n— A conta da mesa (entre as marcadas para a conta) —");
const marcadas = cfg.printers.filter((p) => p.contaDaMesa);
confere("conta da mesa 12 sai só na B", nomes(impressorasDoAndar(marcadas, andares, 12)), ["IMPRESSORA B"]);
confere("conta da mesa 45 sai só na C", nomes(impressorasDoAndar(marcadas, andares, 45)), ["IMPRESSORA C"]);
confere("conta da mesa 80: nenhuma do andar → quem chama volta às de sempre", impressorasDoAndar(marcadas, andares, 80).length, 0);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
