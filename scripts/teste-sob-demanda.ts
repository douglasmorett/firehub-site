/**
 * Teste do vínculo do entregador Sob Demanda ao pedido da loja
 * (lib/ifood-sob-demanda.ts). Só as regras puras, sem banco.
 */
import { ehPedidoSobDemanda, escolherOriginal } from "../src/lib/ifood-sob-demanda";

let falhas = 0;
const ok = (cond: boolean, nome: string) => { console.log(`${cond ? "✅" : "❌"} ${nome}`); if (!cond) falhas++; };

const candidatos = [
  { id: "a", customerPhone: "(11) 98765-4321", customerAddress: "Rua das Flores, 120 - Centro" },
  { id: "b", customerPhone: "11 91111-2222", customerAddress: "Av. Brasil, 45 - Jardim" },
  { id: "c", customerPhone: null, customerAddress: "Rua São João, 7, apto 3" },
];

ok(ehPedidoSobDemanda({ salesChannel: "POS" }), "salesChannel POS é Sob Demanda");
ok(ehPedidoSobDemanda({ salesChannel: "pos" }), "minúsculo também");
ok(!ehPedidoSobDemanda({ salesChannel: "IFOOD" }), "pedido do iFood normal não é");
ok(!ehPedidoSobDemanda({}), "sem salesChannel não é");

ok(escolherOriginal({ customer: { phone: { number: "5511987654321" } } }, candidatos) === "a", "casa pelo telefone (8 últimos dígitos)");
ok(escolherOriginal({ customer: { phone: { number: "000" } }, delivery: { deliveryAddress: { streetName: "Rua São João", streetNumber: "7" } } }, candidatos) === "c", "sem telefone que case, casa por rua e número (com acento)");
ok(escolherOriginal({ delivery: { deliveryAddress: { streetName: "Rua das Flores", streetNumber: "12" } } }, candidatos) === null, "número diferente (12 ≠ 120) não casa");
ok(escolherOriginal({ customer: { phone: { number: "11987654321" } } }, [...candidatos, { id: "d", customerPhone: "987654321", customerAddress: "x" }]) === null, "dois pedidos com o mesmo telefone: não liga (ambíguo)");
ok(escolherOriginal({ customer: { phone: { number: "11955554444" } } }, candidatos) === null, "telefone sem par e sem endereço: importa como sempre");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
