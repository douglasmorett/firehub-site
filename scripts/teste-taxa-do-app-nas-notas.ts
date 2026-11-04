/**
 * A taxa de serviço e a gorjeta do app na conta do pedido (lib/taxa-do-app-nas-notas.ts).
 *
 *   npx tsx scripts/teste-taxa-do-app-nas-notas.ts
 *
 * O caso é o da Keeta #3843 (04/11/2026): Pepperoni R$ 66 + entrega R$ 1 com
 * Total R$ 69,99 — R$ 0,99 de taxa de serviço e R$ 2 de gorjeta que a conta
 * não mostrava. A comanda sai pelo MESMO código do Assistente.
 */
import { linhaDaTaxaDoApp, linhaDaGorjeta, taxasDoAppNasNotas, camposDaTaxaDoAppParaImpressao } from "../src/lib/taxa-do-app-nas-notas";
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// As observações como o pedido da Keeta entrou em produção.
const notasKeeta = "Pedido Keeta #3843\n💳 Taxa de serviço Keeta: R$0.99 (fica com a plataforma)\n💝 Gorjeta: R$2.00\n📝 Pepperoni: Enviar talheres";

console.log("\n— As linhas —");
confere("a taxa sai no texto de sempre", linhaDaTaxaDoApp("Keeta", 0.99), "💳 Taxa de serviço Keeta: R$0.99 (fica com a plataforma)");
confere("a gorjeta sai no texto de sempre", linhaDaGorjeta(2), "💝 Gorjeta: R$2.00");
confere("lê o pedido que já entrou", taxasDoAppNasNotas({ notes: notasKeeta }), { canal: "Keeta", taxaServico: 0.99, gorjeta: 2 });
confere("ida e volta com canal acentuado", taxasDoAppNasNotas({ notes: linhaDaTaxaDoApp("CardápioWeb", 1.5) }), { canal: "CardápioWeb", taxaServico: 1.5, gorjeta: 0 });
confere("só gorjeta", taxasDoAppNasNotas({ notes: linhaDaGorjeta(3) }), { canal: "", taxaServico: 0, gorjeta: 3 });
confere("taxa que fica com a LOJA não é a do app", taxasDoAppNasNotas({ notes: "💳 Taxa do cartão: R$1.00 (fica com a loja)" }), null);
confere("pedido sem as linhas", taxasDoAppNasNotas({ notes: "Sem cebola" }), null);
confere("sem notes", taxasDoAppNasNotas({ notes: null }), null);

console.log("\n— Campos da comanda —");
confere("taxa + gorjeta numa linha do Assistente", camposDaTaxaDoAppParaImpressao({ notes: notasKeeta }), { serviceFee: 2.99, serviceFeeLabel: "Taxa e gorjeta (Keeta):" });
confere("só a taxa, sem acento no rótulo", camposDaTaxaDoAppParaImpressao({ notes: linhaDaTaxaDoApp("CardápioWeb", 1.5) }), { serviceFee: 1.5, serviceFeeLabel: "Taxa de servico (CardapioWeb):" });
confere("pedido sem as linhas não mexe na comanda", camposDaTaxaDoAppParaImpressao({ notes: "Sem cebola" }), {});

console.log("\n— O papel (código do Assistente) —");
const pedido = {
  id: "k1", status: "ACEITO", deliveryType: "DELIVERY", customerName: "Andy", customerPhone: "18666456645",
  customerAddress: "Rua de teste, 1", paymentMethod: "Pago online", source: "KEETA", openDeliveryChannel: "KEETA",
  totalAmount: 69.99, deliveryFee: 1, notes: notasKeeta,
  items: [{ quantity: 1, price: 66, productName: "Pepperoni", notes: "" }],
};
const antes = comandaDoAssistente(pedido, "Loja", 48);
const depois = comandaDoAssistente({ ...pedido, ...camposDaTaxaDoAppParaImpressao(pedido) }, "Loja", 48);
confere("antes: a diferença saía sem nome", /Outros valores do pedido/.test(antes), true);
confere("agora: linha com nome e valor", /Taxa e gorjeta \(Keeta\):\s+R\$ 2,99/.test(depois), true);
confere("agora: nada de 'Outros valores'", /Outros valores do pedido/.test(depois), false);
confere("o total continua o do app", /R\$ 69,99/.test(depois), true);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
