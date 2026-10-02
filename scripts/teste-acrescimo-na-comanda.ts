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
confere("a cobrança à parte vai na observação, antes da do cliente",
  junto.notes, `${MARCA_DO_ACRESCIMO}: R$ 21,99 COBRAR À PARTE (Crédito)\nSem cebola`);
confere("o total do pedido não muda (é o do repasse)", junto.totalAmount, 21.99);
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
confere("Pix sem parênteses fica como está", dois.notes!.split("\n")[1], `${MARCA_DO_ACRESCIMO}: R$ 6,00 COBRAR À PARTE (Pix)`);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
