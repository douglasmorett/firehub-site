/**
 * Andares do salão: onde sai a CONTA de cada mesa (lib/andares-da-mesa.ts).
 *
 *   npx tsx scripts/teste-andares-da-mesa.ts
 *
 * O caso da Ragnar (27/09/2026): Térreo (1-50) com a conta no BALCÃO, Piso
 * Superior (51-100) com a conta no BAR. A comanda da cozinha NÃO olha o andar:
 * o burger da mesa 1 sai só na cozinha do burger ("deveria imprimir só no
 * burger", Fabiano) — a versão que mandava a mesa inteira para a impressora do
 * andar durou uma tarde.
 */
import { andarDaMesa, impressorasDoAndar, impressorasDaContaNoAndar, lerAndares, numerosDaFaixa } from "../src/lib/andares-da-mesa";
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
const nomes = (lista: { name?: string | null }[]) => lista.map((p) => p.name);

console.log("\n— Leitura e andar da mesa —");
confere("andar sem id é descartado", andares.map((a) => a.nome), ["Térreo", "Piso 2"]);
confere("mesa 12 é do Térreo", andarDaMesa(andares, 12)?.nome, "Térreo");
confere("mesa 45 é do Piso 2", andarDaMesa(andares, "45")?.nome, "Piso 2");
confere("mesa 80 não tem andar", andarDaMesa(andares, 80), null);

console.log("\n— Quem pode receber a conta da mesa —");
confere("mesa 12 → cozinha e B", nomes(impressorasDoAndar(cfg.printers, andares, 12)), ["COZINHA", "IMPRESSORA B"]);
confere("mesa 45 → cozinha e C", nomes(impressorasDoAndar(cfg.printers, andares, 45)), ["COZINHA", "IMPRESSORA C"]);
confere("mesa 80 (sem andar) → só a cozinha", nomes(impressorasDoAndar(cfg.printers, andares, 80)), ["COZINHA"]);
confere("pedido que não é de mesa → todas", nomes(impressorasDoAndar(cfg.printers, andares, "")), ["COZINHA", "IMPRESSORA B", "IMPRESSORA C"]);
confere("loja sem andares → todas", nomes(impressorasDoAndar(cfg.printers, [], 12)), ["COZINHA", "IMPRESSORA B", "IMPRESSORA C"]);

console.log("\n— A conta da mesa vai para a impressora do andar (Ragnar) —");
const ragnar = {
  printers: [
    { id: "balcao", name: "BALCÃO RAGNA", categories: ["Cerveja", "Entretenimento e Presentes"], modulos: ["salao"], contaDaMesa: true },
    { id: "pizza", name: "COZINHA PIZZA", categories: ["Pizzas Tradicionais", "Refrigerantes"], modulos: ["delivery", "salao"] },
    { id: "burger", name: "COZINHA ENTREGA RAGNA", categories: ["Burgers", "Entradas", "Refrigerantes"], modulos: ["delivery", "salao"] },
    { id: "bar", name: "BAR", categories: ["Drinks", "Refrigerantes"], modulos: ["salao", "delivery"] },
  ],
  andares: [
    { id: "t", nome: "Térreo", mesas: "1-50", impressoras: ["balcao"] },
    { id: "s", nome: "Piso Superior", mesas: "51-100", impressoras: ["bar"] },
  ],
};
const andaresRagnar = lerAndares(ragnar);
const marcadasRagnar = ragnar.printers.filter((p: any) => p.contaDaMesa);
confere("conta da mesa 60: no BAR (impressora do andar), embora só o BALCÃO esteja marcado para a conta",
  nomes(impressorasDaContaNoAndar(ragnar.printers, marcadasRagnar, andaresRagnar, 60)), ["BAR"]);
confere("conta da mesa 12: no BALCÃO", nomes(impressorasDaContaNoAndar(ragnar.printers, marcadasRagnar, andaresRagnar, 12)), ["BALCÃO RAGNA"]);
confere("mesa 150 (sem andar): as marcadas que não são de outro andar → nenhuma, quem chama volta às de sempre",
  impressorasDaContaNoAndar(ragnar.printers, marcadasRagnar, andaresRagnar, 150).length, 0);
confere("loja sem andares: as marcadas", nomes(impressorasDaContaNoAndar(ragnar.printers, marcadasRagnar, [], 12)), ["BALCÃO RAGNA"]);

console.log("\n— A comanda da cozinha NÃO olha o andar —");
const rotas = (itens: [string, string][]) =>
  destinosDoPedido(ragnar.printers as any, { source: "PRESENCIAL", items: itens.map(([name, category]) => ({ name, category })) }).map(
    (d) => `${d.impressora.name}: ${d.itens.map((i: any) => i.name).join("+")}`
  );
confere("mesa 1 (pedido #16 do Fabiano), anéis de cebola: SÓ na cozinha do burger — nada no BALCÃO", rotas([["Anéis de Cebola", "Entradas"]]), [
  "COZINHA ENTREGA RAGNA: Anéis de Cebola",
]);
confere("burger + caipirinha: cozinha do burger e BAR, mesmo a mesa sendo do térreo", rotas([["Thor", "Burgers"], ["Caipirinha", "Drinks"]]), [
  "COZINHA ENTREGA RAGNA: Thor",
  "BAR: Caipirinha",
]);
confere("só cerveja: BALCÃO, de qualquer andar", rotas([["Heineken", "Cerveja"]]), ["BALCÃO RAGNA: Heineken"]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
