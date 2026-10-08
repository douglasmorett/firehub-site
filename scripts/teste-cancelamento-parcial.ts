/**
 * Prova das regras do cancelamento parcial feito pelo app (lib/cancelamento-parcial.ts).
 *
 *   npx tsx scripts/teste-cancelamento-parcial.ts
 *
 * O caso que puxou: Frangoso - Trindade, 04/10/2026 — o iFood devolveu o
 * adicional esquecido e o FireHub jogou o pedido inteiro em Cancelado.
 */
import {
  complementosGravados,
  ehDisputaParcial,
  itensDaDisputa,
  itensQueSairam,
  lerCancelamentosParciais,
  marcarCienteNosRegistros,
  registrarCorte,
  semCiente,
  valorDaDisputaParcial,
} from "../src/lib/cancelamento-parcial";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: string) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const igual = (nome: string, obtido: unknown, esperado: unknown) =>
  conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), `obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);

console.log("\n1) Que disputa é de PARTE do pedido (aceitar não cancela)");
igual("cancelamento parcial do cron (parcial: true)", ehDisputaParcial({ type: "PARTIAL_CANCELLATION", parcial: true }), true);
igual("parcial gravado pelo poll antigo (só metadata.action)", ehDisputaParcial({ type: "CANCELLATION", metadata: { action: "PARTIAL_CANCELLATION" } }), true);
igual("reembolso de item", ehDisputaParcial({ type: "REFUND_ITEMS" }), true);
igual("ação de reembolso no metadata", ehDisputaParcial({ type: "CANCELLATION", metadata: { action: "PROPOSED_AMOUNT_REFUND" } }), true);
igual("cancelamento do pedido inteiro NÃO é", ehDisputaParcial({ type: "CANCELLATION", metadata: { action: "CANCELLATION" } }), false);
igual("nova previsão NÃO é", ehDisputaParcial({ type: "DUE_DATE_CHANGE" }), false);
igual("reenvio NÃO é (aceitar = recusar o reenvio e cancelar)", ehDisputaParcial({ type: "RESEND_ITEMS" }), false);
igual("nada gravado", ehDisputaParcial(null), false);

console.log("\n2) Quanto sai e o quê");
const disputa = {
  type: "PARTIAL_CANCELLATION", parcial: true, disputeId: "d-1",
  itens: [{ index: 1, quantidade: 1, valor: 4, motivo: "Faltou o adicional", nome: "Combo Box de Frango" }],
};
igual("soma dos itens contestados", valorDaDisputaParcial(disputa), 4);
igual("proposta de reembolso aceita vale no lugar", valorDaDisputaParcial({ ...disputa, valorReembolsoProposto: 2.5 }, { usarProposta: true }), 2.5);
igual("sem proposta, segue a soma", valorDaDisputaParcial(disputa, { usarProposta: true }), 4);
igual("sem itens, usa o reembolso gravado", valorDaDisputaParcial({ valorReembolso: 7.9 }), 7.9);
igual("itens no formato do registro", itensDaDisputa(disputa), [{ nome: "Combo Box de Frango", quantidade: 1, valor: 4, motivo: "Faltou o adicional" }]);

console.log("\n3) O corte no pedido");
const agora = new Date("2026-10-04T23:50:00.000Z");
const r1 = registrarCorte([], 65.99, { id: "d-1", canal: "iFood", itens: itensDaDisputa(disputa), valor: 4 }, agora);
igual("total cai o valor", r1.totalDepois, 61.99);
igual("registro guarda antes e depois", [r1.novo?.totalAntes, r1.novo?.totalDepois, r1.novo?.valor], [65.99, 61.99, 4]);
igual("registro nasce sem ciente", r1.novo?.cienteEm, null);
const r2 = registrarCorte(r1.registros, 61.99, { id: "d-1", canal: "iFood", itens: [], valor: 4 }, agora);
igual("o mesmo corte (aceite + desfecho) não corta duas vezes", [r2.novo, r2.totalDepois, r2.registros.length], [null, 61.99, 1]);
const r3 = registrarCorte(r1.registros, 61.99, { id: "d-2", canal: "iFood", itens: [], valor: 10 }, agora);
igual("segundo corte no mesmo pedido", [r3.totalDepois, r3.registros.length], [51.99, 2]);
igual("nunca abaixo de zero", registrarCorte([], 5, { id: "x", canal: "iFood", itens: [], valor: 9 }, agora).totalDepois, 0);
const r99 = registrarCorte([], 129.99, { id: "99:1", canal: "99Food", itens: [], valor: 0, totalDepois: 104.44, itensJaSairam: true }, agora);
igual("99: o total que o app devolveu vence a conta", [r99.totalDepois, r99.novo?.valor, r99.novo?.itensJaSairam], [104.44, 25.55, true]);

console.log("\n4) O que o 99 tirou (itens de antes × order/detail)");
const antes = [
  { nome: "Combo Box de Frango G", quantidade: 1, precoUnitario: 129.99, complementos: [{ nome: "Coxinha da Asa", quantidade: 1, preco: 0 }, { nome: "Sache Maionese de Bacon 30g", quantidade: 1, preco: 3 }] },
  { nome: "Coca-Cola Lata", quantidade: 2, precoUnitario: 6, complementos: [] },
];
igual(
  "item a menos e adicional tirado",
  itensQueSairam(antes, [
    { nome: "Combo Box de Frango G", quantidade: 1, precoUnitario: 126.99, complementos: [{ nome: "Coxinha da Asa", quantidade: 1, preco: 0 }] },
    { nome: "Coca-Cola Lata", quantidade: 1, precoUnitario: 6, complementos: [] },
  ]),
  [
    { nome: "Combo Box de Frango G — sem Sache Maionese de Bacon 30g", quantidade: 1, valor: 3 },
    { nome: "Coca-Cola Lata", quantidade: 1, valor: 6 },
  ]
);
igual("item que saiu inteiro", itensQueSairam(antes, [antes[0]]), [{ nome: "Coca-Cola Lata", quantidade: 2, valor: 12 }]);
igual("nada mudou, nada saiu", itensQueSairam(antes, antes), []);
igual("observação não é adicional", itensQueSairam(
  [{ nome: "X", quantidade: 1, precoUnitario: 10, complementos: [{ nome: "Obs: sem cebola", quantidade: 1, preco: 0 }] }],
  [{ nome: "X", quantidade: 1, precoUnitario: 10, complementos: [] }]
), []);
igual("complementos do banco (texto JSON)", complementosGravados('[{"name":"Bacon","quantity":2,"price":3}]'), [{ nome: "Bacon", quantidade: 2, preco: 3 }]);
igual("complementos do banco (lista)", complementosGravados([{ name: "Bacon", quantity: 1, price: 3 }]), [{ nome: "Bacon", quantidade: 1, preco: 3 }]);
igual("complementos ilegíveis", complementosGravados("{quebrado"), []);

console.log("\n5) O aviso e o Ciente");
const lidos = lerCancelamentosParciais(r3.registros);
igual("lê a lista gravada", lidos.length, 2);
igual("lixo no banco não quebra", lerCancelamentosParciais([{ foo: 1 }, null, "x"]), []);
igual("os dois esperam ciente", semCiente(lidos).length, 2);
const c1 = marcarCienteNosRegistros(lidos, "Lucas", ["d-1"], agora);
igual("ciente só no corte pedido", [c1.marcados, semCiente(c1.registros).map((r) => r.id)], [1, ["d-2"]]);
igual("quem deu ciente fica gravado", c1.registros[0].cientePor, "Lucas");
const c2 = marcarCienteNosRegistros(c1.registros, "Ana", null, agora);
igual("sem lista = todos os que faltam", [c2.marcados, semCiente(c2.registros).length], [1, 0]);
igual("ciente dado não é sobrescrito", c2.registros[0].cientePor, "Lucas");

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
