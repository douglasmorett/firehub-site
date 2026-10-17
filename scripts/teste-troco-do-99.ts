/**
 * Trava o "TROCO PARA" do pedido do 99Food em dinheiro (lib/food99-pedido.ts,
 * `trocoPara99`) e que ele chega à comanda.
 *
 *   npx tsx scripts/teste-troco-do-99.ts
 *
 * ── O que estava errado (Showrrascão, 17/10/2026 ~20h) ──────────────────────
 *
 * Pedido do 99 em dinheiro, total R$ 72,23, troco para R$ 100. A comanda saiu
 * com "COBRAR DO CLIENTE NA ENTREGA: R$ 72,23" e sem linha de troco: o
 * tradutor do 99 não tinha campo de troco e o webhook nunca gravava
 * `changeAmount` — que é de onde a comanda, o painel e o WhatsApp do motoboy
 * tiram "Troco para R$ X (levar R$ Y)" em todos os outros canais.
 *
 * O swagger do 99 não documenta o campo, então o nome `change_for` abaixo é
 * SUPOSIÇÃO: o teste trava a regra (só dinheiro, só acima do total, sem pegar
 * timestamp), não o nome. O `price` é o do pedido da foto (só números).
 */
import { trocoPara99, traduzirPedido99Food } from "../src/lib/food99-pedido";
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { lerPapel } from "../src/lib/papel-da-impressora";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O tradutor avisa no log quando falta coordenada, código de coleta ou troco —
// aqui o aviso só polui a saída. Guardamos para conferir o do troco.
const avisoOriginal = console.warn;
let avisos: string[] = [];
const traduzir = (order: Record<string, unknown>) => {
  avisos = [];
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  try { return traduzirPedido99Food(order); } finally { console.warn = avisoOriginal; }
};

/** O pedido da foto: X-Tudo 3x 104,40, descontos 19,94 + 21,00, entrega 5,00, serviço 3,77 = 72,23. */
const SHOWRRASCAO = {
  order_id: "showrrascao-1710", order_index: 1, delivery_type: 2, pay_type: 2,
  price: {
    order_price: 10440, items_discount: 4094, delivery_discount: 0,
    store_charged_delivery_price: 500, others_fees: { service_price: 377 },
    real_pay_price: 7223, customer_need_paying_money: 7223,
  },
  order_items: [{ name: "X-Tudo", amount: 3, sku_price: 3480, total_price: 10440 }],
};

// ── 1. O troco do pedido da foto ─────────────────────────────────────────────
console.log("\n1) Showrrascão 17/10: dinheiro, total 72,23, troco para 100");
{
  const p = traduzir({ ...SHOWRRASCAO, change_for: 10000 });
  confere("total do pedido continua 72,23", p.total, 72.23);
  confere("troco para R$ 100,00", p.trocoPara, 100);
  confere("sem aviso de troco no log quando achou", avisos.some((a) => a.includes("troco")), false);
}

// ── 2. Os nomes prováveis e a varredura ──────────────────────────────────────
console.log("\n2) Onde o 99 pode mandar o troco");
confere("dentro do price (price.change_for)", trocoPara99({ pay_type: 2, price: { change_for: 5000 } }, 42.5), 50);
confere("dentro do pay_info (pay_info.cash_amount)", trocoPara99({ pay_type: 2, pay_info: { cash_amount: "10000" } }, 72.23), 100);
confere("nome desconhecido com 'change' (varredura): cash_change_money", trocoPara99({ pay_type: 2, cash_change_money: 20000 }, 150.9), 200);
confere("pay_type como texto \"2\" também é dinheiro", trocoPara99({ pay_type: "2", change_for: 10000 }, 72.23), 100);

// ── 3. O que NÃO pode virar troco ────────────────────────────────────────────
console.log("\n3) O que não é troco");
confere("pago online (pay_type 1): nunca tem troco", trocoPara99({ pay_type: 1, change_for: 10000 }, 72.23), null);
confere("maquininha (pay_type 3): nunca tem troco", trocoPara99({ pay_type: 3, change_for: 10000 }, 72.23), null);
confere("valor igual ao total (o que cobrar, não a nota): fora", trocoPara99({ pay_type: 2, cash_amount: 7223 }, 72.23), null);
confere("valor abaixo do total (o troco a devolver, não a nota): fora", trocoPara99({ pay_type: 2, change_for: 2777 }, 72.23), null);
confere("timestamp com 'change' no nome não vira troco", trocoPara99({ pay_type: 2, last_change_time: 1792281600 }, 72.23), null);
confere("id com 'change' no nome não vira troco", trocoPara99({ pay_type: 2, change_order_id: 99999 }, 72.23), null);
confere("mais de R$ 500 acima do total: fora (trava contra lixo)", trocoPara99({ pay_type: 2, change_for: 100000 }, 72.23), null);
confere("cliente não pediu troco (sem campo): null", trocoPara99({ pay_type: 2 }, 72.23), null);
{
  const p = traduzir({ ...SHOWRRASCAO });
  confere("dinheiro sem troco reconhecido: trocoPara null", p.trocoPara, null);
  confere("…e o log lista as chaves do pedido (para achar o nome do campo)",
    avisos.some((a) => a.includes("DINHEIRO") && a.includes("chaves do pedido") && a.includes("pay_type")), true);
}

// ── 4. A comanda imprime o troco gravado ─────────────────────────────────────
console.log("\n4) A comanda do Assistente com o changeAmount do 99");
{
  const p = traduzir({ ...SHOWRRASCAO, change_for: 10000 });
  const pedido = {
    id: "x", dailyOrderNumber: 1, source: "99FOOD", deliveryType: "DELIVERY", status: "ACEITO",
    customerName: p.cliente.nome, customerPhone: "", customerAddress: "Rua A, 1 - Centro, Rio das Ostras",
    paymentMethod: p.pagamento.texto, totalAmount: p.total, deliveryFee: p.taxaEntrega,
    changeAmount: p.trocoPara, createdAt: new Date().toISOString(),
    items: [{ quantity: 3, price: 34.8, productName: "X-Tudo", menuProduct: { name: "X-Tudo" } }],
  };
  const texto = lerPapel(comandaDoAssistente(pedido, "Showrrascão", 48, "safe"))
    .map((l: any) => l.trechos.map((t: any) => t.texto).join(""))
    .join("\n")
    .replace(/\s+/g, " ");
  confere("papel diz \"Troco para: R$ 100,00\"", texto.includes("Troco para: R$ 100,00"), true);
  confere("papel diz \"Levar R$ 27,77 de troco\"", texto.includes("Levar R$ 27,77 de troco"), true);
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
