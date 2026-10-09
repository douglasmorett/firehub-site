/**
 * "Só pedidos de mesa" na impressora (lib/roteamento-de-impressao.ts →
 * impressorasPeloTipoDoPedido, lib/modulo-do-pedido.ts → ehPedidoDeMesa).
 *
 *   npx tsx scripts/teste-impressora-so-mesa.ts
 *
 * O caso da Pizzaria 17 (Antonio, 09/10/2026): "os pedidos de mesa estão
 * imprimindo só a bebida no caixa, tá certinho, mas retirada e delivery
 * também". O caixa tira a COMANDA DE BEBIDAS ("Imprimir só bebida"); o #4
 * RETIRADA e o #5 DELIVERY foram lançados no PDV, que o módulo chama de salão
 * — desmarcar "Delivery e retirada" na impressora não mudava nada.
 *
 * Duas provas, sem banco: a fila da nuvem (destinosDoPedido, o que o servidor
 * manda em `destinos`) e o PAINEL (lib/print.ts) com um Assistente falso —
 * os dois trilhos automáticos têm de decidir igual, senão o papel sai dobrado
 * ou some conforme haja aba aberta.
 */
import {
  destinosDoPedido,
  impressoraDaViaDoEntregador,
  impressorasPeloTipoDoPedido,
  umaPorImpressora,
  type ImpressoraConfigurada,
} from "../src/lib/roteamento-de-impressao";
import { ehPedidoDeMesa } from "../src/lib/modulo-do-pedido";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O cadastro da loja: a cozinha recebe tudo; o caixa tira só a bebida.
const COZINHA: ImpressoraConfigurada = { id: "coz", name: "COZINHA", categories: [] };
const CAIXA: ImpressoraConfigurada = { id: "cx", name: "CAIXA", categories: [], somenteBebidas: true };
const ANTES = [COZINHA, CAIXA];
const DEPOIS = [COZINHA, { ...CAIXA, soPedidoDeMesa: true }];

const itens = [
  { name: "Pizza Calabresa G", category: "Pizzas", quantity: 1, qty: 1, price: 59.9 },
  { name: "Coca-Cola 2L", category: "Bebidas", quantity: 1, qty: 1, price: 14 },
];
const base = { franchiseeId: "loja17", items: itens, totalAmount: 73.9, createdAt: "2026-10-09T21:00:00.000Z" };

const MESA = { ...base, id: "p-mesa", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "sess_mesa_4" };
const MESA_DO_PDV = { ...base, id: "p-mesa-pdv", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: null };
const RETIRADA_PDV = { ...base, id: "p-4", source: "PDV", deliveryType: "RETIRADA", tableSessionId: null };
const DELIVERY_PDV = { ...base, id: "p-5", source: "PRESENCIAL", deliveryType: "DELIVERY", tableSessionId: null, customerAddress: "Rua A, 10" };
const IFOOD = { ...base, id: "p-ifood", source: "IFOOD", deliveryType: "DELIVERY", deliveryBy: "IFOOD" };

const onde = (impressoras: ImpressoraConfigurada[], pedido: any) =>
  destinosDoPedido(impressoras, pedido).map((d) => d.impressora.name);

console.log("\n— O que é pedido de mesa —");
confere("conta de mesa aberta", ehPedidoDeMesa(MESA), true);
confere("aba Mesa do PDV, sem conta aberta", ehPedidoDeMesa(MESA_DO_PDV), true);
confere("retirada do PDV", ehPedidoDeMesa(RETIRADA_PDV), false);
confere("delivery do PDV", ehPedidoDeMesa(DELIVERY_PDV), false);
confere("iFood", ehPedidoDeMesa(IFOOD), false);
confere("tableSessionId em branco não é mesa", ehPedidoDeMesa({ tableSessionId: "  ", deliveryType: "RETIRADA" }), false);

console.log("\n— Fila da nuvem: opção desligada (nenhuma loja muda sem marcar) —");
confere("mesa: cozinha e caixa", onde(ANTES, MESA), ["COZINHA", "CAIXA"]);
confere("#4 retirada do PDV: cozinha e caixa (o que o Antonio viu)", onde(ANTES, RETIRADA_PDV), ["COZINHA", "CAIXA"]);
confere("#5 delivery do PDV: cozinha e caixa", onde(ANTES, DELIVERY_PDV), ["COZINHA", "CAIXA"]);
confere("iFood: cozinha e caixa", onde(ANTES, IFOOD), ["COZINHA", "CAIXA"]);
confere("sem a chave, a lista volta intocada", impressorasPeloTipoDoPedido(ANTES, RETIRADA_PDV), ANTES);

console.log("\n— Fila da nuvem: caixa marcado \"Só pedidos de mesa\" —");
confere("mesa: cozinha e caixa", onde(DEPOIS, MESA), ["COZINHA", "CAIXA"]);
confere("aba Mesa do PDV: cozinha e caixa", onde(DEPOIS, MESA_DO_PDV), ["COZINHA", "CAIXA"]);
confere("#4 retirada do PDV: só a cozinha", onde(DEPOIS, RETIRADA_PDV), ["COZINHA"]);
confere("#5 delivery do PDV: só a cozinha", onde(DEPOIS, DELIVERY_PDV), ["COZINHA"]);
confere("iFood: só a cozinha", onde(DEPOIS, IFOOD), ["COZINHA"]);
confere(
  "a cozinha continua com o pedido inteiro na retirada",
  destinosDoPedido(DEPOIS, RETIRADA_PDV)[0]?.itens.map((i) => i.name),
  ["Pizza Calabresa G", "Coca-Cola 2L"]
);

console.log("\n— O resgate do módulo não traz a linha de volta —");
const COM_MODULO = [
  { ...COZINHA, modulos: ["delivery" as const] },
  { ...CAIXA, modulos: ["salao" as const], soPedidoDeMesa: true },
];
confere("retirada do PDV (salão): nenhuma do salão sobra → todas as que restam, sem o caixa", onde(COM_MODULO, RETIRADA_PDV), ["COZINHA"]);
confere("mesa: o caixa do salão", onde(COM_MODULO, MESA), ["CAIXA"]);

console.log("\n— Loja com uma impressora só, marcada por engano —");
const SO_UMA = [{ ...COZINHA, soPedidoDeMesa: true }];
confere("delivery não some: sai nela", onde(SO_UMA, IFOOD), ["COZINHA"]);

console.log("\n— A mesma impressora em duas linhas —");
// Linha 1: a de sempre (comanda inteira do balcão e do delivery).
// Linha 2: a mesma CAIXA, só bebida, só mesa.
const DUAS_LINHAS = [
  COZINHA,
  { id: "cx1", name: "CAIXA", categories: ["Pizzas"], modulos: ["delivery" as const] },
  { id: "cx2", name: "CAIXA", categories: [], somenteBebidas: true, soPedidoDeMesa: true },
];
const caixaDe = (pedido: any) => destinosDoPedido(DUAS_LINHAS, pedido).find((d) => d.impressora.name === "CAIXA")?.impressora.id ?? null;
confere("mesa: vale a linha de só mesa (mesmo vindo depois)", caixaDe(MESA), "cx2");
confere("iFood: vale a linha de sempre", caixaDe(IFOOD), "cx1");
confere("umaPorImpressora sem a linha de mesa fica com a primeira", umaPorImpressora(DUAS_LINHAS.slice(0, 2)).map((p) => p.id), ["coz", "cx1"]);

console.log("\n— Via do entregador —");
const VIA_NO_CAIXA = [COZINHA, { ...CAIXA, somenteBebidas: false, viaDoEntregador: true, soPedidoDeMesa: true }];
confere("delivery do site: a linha só de mesa não tira a via", impressoraDaViaDoEntregador(VIA_NO_CAIXA, { ...DELIVERY_PDV, source: "ONLINE" } as any)?.name ?? null, null);

// ── O PAINEL (lib/print.ts) com um Assistente falso ─────────────────────────
async function painel() {
  console.log("\n— Painel (GlobalPrintListener / tela de pedidos): o que chega ao Assistente —");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.33" }), { status: 200 });
    if (u.endsWith("/print")) {
      enviados.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const { printOrder, TODAS_AS_IMPRESSORAS } = await import("../src/lib/print");
  const papel = (b: any) => `${b.printer}${b.order.somenteBebidas ? " (só bebidas)" : ""}`;
  const imprimir = async (printers: ImpressoraConfigurada[], pedido: any, ...resto: any[]) => {
    enviados.length = 0;
    await (printOrder as any)(pedido, "PIZZARIA 17", { autoprint: true, printers }, {}, ...(resto.length ? resto : [false]));
    return enviados.map(papel);
  };

  confere("desligada, #4 retirada do PDV: cozinha e caixa", await imprimir(ANTES, RETIRADA_PDV), ["COZINHA", "CAIXA (só bebidas)"]);
  confere("ligada, mesa: cozinha e a comanda de bebidas no caixa", await imprimir(DEPOIS, MESA), ["COZINHA", "CAIXA (só bebidas)"]);
  confere("ligada, aba Mesa do PDV: idem", await imprimir(DEPOIS, MESA_DO_PDV), ["COZINHA", "CAIXA (só bebidas)"]);
  confere("ligada, #4 retirada do PDV: só a cozinha", await imprimir(DEPOIS, RETIRADA_PDV), ["COZINHA"]);
  confere("ligada, #5 delivery do PDV: só a cozinha", await imprimir(DEPOIS, DELIVERY_PDV), ["COZINHA"]);
  confere("ligada, iFood: só a cozinha", await imprimir(DEPOIS, IFOOD), ["COZINHA"]);
  confere("duas linhas da CAIXA, mesa: a de só mesa", await imprimir(DUAS_LINHAS, MESA), ["COZINHA", "CAIXA (só bebidas)"]);
  confere("duas linhas da CAIXA, iFood: a de sempre", await imprimir(DUAS_LINHAS, IFOOD), ["COZINHA", "CAIXA"]);

  // Reimpressão escolhida no modal (impressora ou Todas): sai onde a pessoa
  // mandou, opção ou não.
  confere(
    "reimpressão no CAIXA pelo modal, retirada: sai no caixa",
    await imprimir(DEPOIS, RETIRADA_PDV, true, false, false, "CAIXA"),
    ["CAIXA"]
  );
  confere(
    "reimpressão em Todas, retirada: cozinha e caixa",
    await imprimir(DEPOIS, RETIRADA_PDV, true, false, false, TODAS_AS_IMPRESSORAS),
    ["COZINHA", "CAIXA"]
  );
}

painel()
  .catch((e) => { falhas++; console.error("❌ painel:", e); })
  .finally(() => {
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
    process.exit(falhas ? 1 : 0);
  });
