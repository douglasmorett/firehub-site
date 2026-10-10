/**
 * O "pedido recebido" de qualquer canal é a comanda inteira (lib/order-notifications.ts).
 *
 *   npx tsx scripts/teste-pedido-recebido.ts
 *
 * Só monta a mensagem: nada é enviado e o banco não é tocado.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://ninguem@127.0.0.1:1/nada";
import { comandaDoPedidoRecebido, formaDePagamentoParaOCliente } from "../src/lib/order-notifications";

let ok = 0;
let falhou = 0;
function confere(nome: string, cond: boolean, detalhe = "") {
  if (cond) ok++;
  else { falhou++; console.log(`❌ ${nome}${detalhe ? `\n${detalhe}` : ""}`); }
}

// O pedido do site da China pow (Alzira, 09/10/2026), como está gravado.
const site = {
  status: "NOVO", customerName: "Alzira da Cunha", deliveryType: "DELIVERY", deliveryFee: 8, totalAmount: 58,
  paymentMethod: "PIX_ENTREGA", customerAddress: "Beco do Puca, 115 - Ogiva 3", createdAt: new Date(),
  tempoEntregaMin: 40, franchisee: { storeTimezone: "America/Sao_Paulo" },
  items: [
    { quantity: 1, productName: "Yakisoba tradicional carne e frango padrão", price: 40, comboSelections: null, notes: null },
    { quantity: 1, productName: "Rolinho primavera vegetariano", price: 10, comboSelections: { g1: { "Molho agridoce": 1 } }, notes: "bem quente" },
  ],
};
const m = comandaDoPedidoRecebido(site, 3);
confere("título de pedido que a loja ainda vai aceitar", m.startsWith("✅ Recebemos seu pedido!"), m);
for (const trecho of ["🧾 *Pedido nº 3*", "👤 *Cliente:* Alzira da Cunha", "➡️ 1x Yakisoba tradicional carne e frango padrão — R$ 40,00", "↳ Molho agridoce", "↳ Obs: bem quente", "💳 *Pagamento:* Pix na entrega", "🛵 *Delivery* (taxa de entrega: R$ 8,00)", "🏠 Beco do Puca, 115 - Ogiva 3", "⏰ Previsão de entrega: até", "Subtotal: R$ 50,00", "Taxa de entrega: R$ 8,00", "*Total: R$ 58,00*"]) {
  confere(`tem "${trecho}"`, m.includes(trecho), m);
}

// Aceito direto (balcão, aceite automático) e retirada.
const balcao = { ...site, status: "ACEITO", deliveryType: "RETIRADA", deliveryFee: 0, totalAmount: 50, paymentMethod: "Cartão Débito", tempoEntregaMin: null };
const b = comandaDoPedidoRecebido(balcao, 35);
confere("aceito diz EM PRODUÇÃO", b.startsWith("Oba! Seu pedido está *EM PRODUÇÃO*!"), b);
confere("retirada sem endereço nem taxa", b.includes("🏪 *Retirada na loja*") && !b.includes("Taxa de entrega") && !b.includes("🏠"), b);

// Desconto do site: Subtotal + taxa − desconto fecha com o total.
const desc = comandaDoPedidoRecebido({ ...site, discountTotal: 10, totalAmount: 48 }, 4);
confere("desconto aparece e a conta fecha", desc.includes("🎟️ Desconto: -R$ 10,00") && desc.includes("*Total: R$ 48,00*"), desc);
// Cashback é parte do discountTotal: não aparece duas vezes.
const cb = comandaDoPedidoRecebido({ ...site, discountTotal: 6.46, cashbackUsed: 6.46, totalAmount: 51.54 }, 5);
confere("cashback não vira desconto em dobro", cb.includes("💰 Cashback (desconto): -R$ 6,46") && !cb.includes("🎟️ Desconto"), cb);

// Forma de pagamento.
confere("CARTAO_CREDITO", formaDePagamentoParaOCliente({ paymentMethod: "CARTAO_CREDITO" }) === "Cartão Crédito");
confere("DINHEIRO", formaDePagamentoParaOCliente({ paymentMethod: "DINHEIRO" }) === "Dinheiro");
confere("Pix pago no site", formaDePagamentoParaOCliente({ paymentMethod: "PIX", gatewayProvider: "ASAAS" }) === "Pix (pago online)");
confere("forma desconhecida fica como veio", formaDePagamentoParaOCliente({ paymentMethod: "Ticket" }) === "Ticket");

console.log(`\n${falhou === 0 ? "✅" : "❌"} pedido recebido: ${ok} ok, ${falhou} falha(s)`);
process.exit(falhou === 0 ? 0 : 1);
