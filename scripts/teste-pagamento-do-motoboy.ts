/**
 * O pagamento no WhatsApp que o motoboy recebe ao ser atribuído ao pedido
 * (lib/pagamento-no-whatsapp-do-motoboy.ts).
 *
 *   npx tsx scripts/teste-pagamento-do-motoboy.ts
 *
 * O caso é o de 27/09/2026: a mensagem dizia o troco ("Levar R$ 18.00 de
 * troco") mas não quanto cobrar do cliente, e o que ela não reconhecia virava
 * "Pago Online" — o app do motoboy, na dúvida, manda cobrar.
 */
import { linhasDePagamentoParaOMotoboy as linhas } from "../src/lib/pagamento-no-whatsapp-do-motoboy";
import { cobrancaNaEntrega } from "../src/lib/pagamento-na-entrega";

let falhas = 0;
const confere = (oQue: string, obtido: string, deveTer: string[], naoPodeTer: string[] = []) => {
  const faltou = deveTer.filter((t) => !obtido.includes(t));
  const sobrou = naoPodeTer.filter((t) => obtido.includes(t));
  const ok = faltou.length === 0 && sobrou.length === 0;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   obtido: ${JSON.stringify(obtido)}\n   faltou: ${JSON.stringify(faltou)} sobrou: ${JSON.stringify(sobrou)}`}`);
};

// ── Os dois pedidos da foto ──
confere(
  "cartão na entrega: diz o total e manda levar a maquininha",
  linhas({ paymentMethod: "Cartão (Levar Maquininha)", totalAmount: 45.9 }),
  ["Cobrar do cliente:* R$ 45,90", "levar a maquininha"],
);
confere(
  "dinheiro com nota de 50 num pedido de 32: total e troco de 18",
  linhas({ paymentMethod: "Dinheiro", totalAmount: 32, changeAmount: 50 }),
  ["Cobrar do cliente:* R$ 32,00", "Dinheiro", "paga com R$ 50,00", "levar *R$ 18,00* de troco"],
);

// ── Não cobrar ──
confere("pago online: não cobrar e sem valor", linhas({ paymentMethod: "Crédito (Pago Online)", totalAmount: 80 }), ["Pago online", "NÃO cobrar"], ["Cobrar do cliente"]);
confere("pago no gateway: não cobrar", linhas({ paymentMethod: "Pix", gatewayPaymentId: "mp_123", totalAmount: 50 }), ["NÃO cobrar"], ["Cobrar do cliente"]);
confere("fiado: não cobrar, a loja acerta", linhas({ paymentMethod: "Fiado", totalAmount: 40 }), ["Fiado", "NÃO cobrar"], ["Cobrar do cliente"]);

// ── Na dúvida, cobra (a mensagem antiga dizia "Pago Online") ──
confere("forma desconhecida (OTHER): cobra e leva maquininha", linhas({ paymentMethod: "OTHER", totalAmount: 55 }), ["Cobrar do cliente:* R$ 55,00", "maquininha"], ["Pago online"]);
confere("sem forma nenhuma: cobra", linhas({ paymentMethod: "", totalAmount: 30 }), ["Cobrar do cliente:* R$ 30,00"], ["Pago online"]);
confere("pix na entrega", linhas({ paymentMethod: "PIX (Cobrar na Entrega)", totalAmount: 27.5 }), ["Cobrar do cliente:* R$ 27,50", "Pix na entrega"]);

// ── Troco ──
confere("dinheiro sem troco pedido", linhas({ paymentMethod: "Dinheiro", totalAmount: 32 }), ["Cobrar do cliente:* R$ 32,00", "não pediu troco"]);
confere("nota igual ao pedido: não precisa de troco", linhas({ paymentMethod: "Dinheiro", totalAmount: 50, changeAmount: 50 }), ["não precisa de troco"]);
confere("campo com o próprio troco (menor que o pedido): levar esse valor", linhas({ paymentMethod: "Dinheiro", totalAmount: 32, changeAmount: 18 }), ["levar *R$ 18,00*"], ["paga com"]);

// ── Observação só fala sem forma gravada ──
confere("sem forma, observação 'troco para 100': dinheiro e troco", linhas({ paymentMethod: "", totalAmount: 65.9, notes: "Troco para 100" }), ["Dinheiro", "levar *R$ 34,10* de troco"]);
confere("sem forma, observação 'levar maquininha': cartão", linhas({ paymentMethod: null, totalAmount: 40, notes: "levar maquininha" }), ["maquininha"]);
confere("com forma Pix gravada, 'troco' na observação não vira dinheiro", linhas({ paymentMethod: "PIX (Pago Online)", totalAmount: 40, notes: "ja paguei no pix nao precisa de troco" }), ["NÃO cobrar"], ["Dinheiro"]);

// ── Mesmo número do app do motoboy ──
for (const p of [
  { paymentMethod: "Dinheiro", totalAmount: 32, changeAmount: 50 },
  { paymentMethod: "Cartão Débito", totalAmount: 71.13 },
  { paymentMethod: "Crédito (Pago Online)", totalAmount: 80 },
]) {
  const app = cobrancaNaEntrega(p);
  const msg = linhas(p);
  const valorNaMsg = app.cobrar ? msg.includes(`R$ ${app.valor.toFixed(2).replace(".", ",")}`) : !msg.includes("Cobrar do cliente");
  confere(`igual ao app: ${p.paymentMethod}`, valorNaMsg ? "ok" : msg, ["ok"]);
}

if (falhas > 0) {
  console.log(`\n❌ ${falhas} falha(s)`);
  process.exit(1);
}
console.log("\n✅ tudo certo");
