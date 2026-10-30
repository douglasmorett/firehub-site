/**
 * Prova da comanda do acréscimo de marketplace (lib/acrescimo-na-comanda.ts):
 * um papel só, com o pedido inteiro.
 *
 *   npx tsx scripts/teste-acrescimo-na-comanda.ts
 *
 * O caso é o da Frangoso: Brendi #3002 (pedido 11, uma batata) e o acréscimo
 * de mais uma batata no crédito, que saía como "pedido 13" em papel próprio.
 */
import { acrescimosDoPedido, pedidoComAcrescimos, MARCA_DO_ACRESCIMO } from "../src/lib/acrescimo-na-comanda";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const batata = { id: "i1", quantity: 1, price: 21.99, productName: "Porção de Batata-Frita", notes: "" };
const pai = {
  id: "p11", status: "PREPARANDO", totalAmount: 21.99, paymentMethod: "Crédito (Cobrar na Entrega)",
  notes: "Sem cebola", items: [batata],
};
const filho = {
  id: "p13", parentOrderId: "p11", status: "ACEITO", totalAmount: 21.99, paymentMethod: "Crédito (Cobrar na Entrega)",
  notes: "Acréscimo do pedido 3002", items: [{ ...batata, id: "i2", notes: "bem passada" }],
};
const outro = { id: "p12", status: "ACEITO", totalAmount: 10, items: [{ id: "i3", quantity: 1, price: 10, productName: "Coca" }] };
const cancelado = { ...filho, id: "p14", status: "CANCELADO", items: [{ id: "i4", quantity: 1, price: 5, productName: "Sachê" }] };

console.log("\n— Um papel só, com o pedido inteiro —");
const junto = pedidoComAcrescimos(pai, [pai, outro, filho, cancelado]);
confere("os itens do acréscimo entram depois dos do pedido", junto.items!.map((i: any) => i.id), ["i1", "i2"]);
confere("o nome do item não muda (é ele que acha a impressora)", junto.items![1].productName, "Porção de Batata-Frita");
confere("o item do acréscimo vem marcado, com a observação dele", junto.items![1].notes, `${MARCA_DO_ACRESCIMO} - bem passada`);
confere("o item original não ganha marca", junto.items![0].notes, "");
confere("a linha do acréscimo vai na observação, antes da do cliente",
  junto.notes, `${MARCA_DO_ACRESCIMO}: R$ 21,99 (Crédito) JÁ SOMADO NO TOTAL A COBRAR\nSem cebola`);
confere("pago na entrega: o total do papel é o que se cobra na porta", junto.totalAmount, 43.98);
confere("o pedido da lista não é mexido (no banco o total é o do parceiro)", pai.totalAmount, 21.99);
confere("acréscimo cancelado fica de fora", acrescimosDoPedido(pai, [filho, cancelado]).map((o) => o.id), ["p13"]);
confere("pedido de outro cliente não entra", acrescimosDoPedido(pai, [outro]).length, 0);

console.log("\n— Sem duplicar —");
confere("sem acréscimo devolve o mesmo pedido", pedidoComAcrescimos(outro, [outro, filho]) === outro, true);
confere("juntar duas vezes não duplica (lista nova + lista atrasada da tela)",
  pedidoComAcrescimos(junto, [pai, filho]).items!.length, 2);

console.log("\n— Dois acréscimos —");
const filho2 = { ...filho, id: "p15", totalAmount: 6, paymentMethod: "Pix", items: [{ id: "i5", quantity: 2, price: 3, productName: "Sachê Maionese" }] };
const dois = pedidoComAcrescimos(pai, [pai, filho, filho2]);
confere("os dois entram", dois.items!.map((i: any) => i.id), ["i1", "i2", "i5"]);
confere("uma linha de cobrança por acréscimo", dois.notes!.split("\n").length, 3);
confere("Pix sem parênteses fica como está", dois.notes!.split("\n")[1], `${MARCA_DO_ACRESCIMO}: R$ 6,00 (Pix) JÁ SOMADO NO TOTAL A COBRAR`);
confere("os dois somam no total a cobrar", dois.totalAmount, 49.98);

console.log("\n— Pedido principal já pago no app —");
const paiPago = { ...pai, paymentMethod: "Pago Online (iFood)", totalAmount: 50 };
const pago = pedidoComAcrescimos(paiPago, [paiPago, filho]);
confere("diz que o resto já está pago e que só cobra o acréscimo",
  pago.notes, `${MARCA_DO_ACRESCIMO}: R$ 21,99 COBRAR À PARTE (Crédito)\nRESTO DO PEDIDO JÁ PAGO (R$ 50,00): COBRAR SÓ O ACRÉSCIMO\nSem cebola`);
confere("pago na entrega não ganha essa linha", junto.notes!.includes("JÁ PAGO"), false);
confere("pago no app: o total do papel continua o do parceiro", pago.totalAmount, 50);

console.log("\n— Troca de lanche num pedido da Brendi com cupom (Lucas/Frangoso, 29/10/2026) —");
// Pedido 23: 3 Guaramor (R$ 9) + 2 Burguers (R$ 32,99) − cupom R$ 8 = R$ 33,99. O
// funcionário tirou o lanche e acrescentou o mesmo com 2 sachês (R$ 36,98):
// o principal ficou em R$ 1,00 e o papel mandava cobrar R$ 1,00.
const brendi = {
  id: "b23", status: "ENTREGUE", totalAmount: 1, paymentMethod: "Dinheiro (Cobrar na Entrega)", notes: "",
  items: [{ id: "g", quantity: 3, price: 3, productName: "Guaramor 290ml" }],
};
const lanche = {
  id: "b23a", parentOrderId: "b23", status: "ACEITO", totalAmount: 36.98, paymentMethod: "Dinheiro",
  items: [{ id: "l", quantity: 1, price: 36.98, productName: "2 Burguers por R$32,99" }],
};
const papel = pedidoComAcrescimos(brendi, [brendi, lanche]);
const subtotal = papel.items!.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
confere("cobra R$ 37,98 na porta (R$ 1,00 + R$ 36,98)", papel.totalAmount, 37.98);
confere("o desconto que o Assistente fecha volta a ser o cupom de R$ 8", Math.round((subtotal - papel.totalAmount!) * 100) / 100, 8);
confere("a linha diz que o acréscimo já está no total", papel.notes, `${MARCA_DO_ACRESCIMO}: R$ 36,98 (Dinheiro) JÁ SOMADO NO TOTAL A COBRAR`);
const naMaquininha = { ...lanche, id: "b23b", gatewayPaymentId: "pos-1", paymentMethod: "Crédito" };
const comPago = pedidoComAcrescimos(brendi, [brendi, naMaquininha]);
confere("acréscimo já pago na maquininha não soma de novo", comPago.totalAmount, 1);
confere("e diz que está pago", comPago.notes, `${MARCA_DO_ACRESCIMO}: R$ 36,98 JÁ PAGO (Crédito)`);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
