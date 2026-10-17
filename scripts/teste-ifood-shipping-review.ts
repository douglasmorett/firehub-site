/**
 * Teste das regras puras das abas Shipping e Avaliações da homologação do iFood
 * (lib/ifood-shipping.ts e lib/ifood-review.ts). Rodar:
 * npx tsx scripts/teste-ifood-shipping-review.ts
 */
import {
  montarPedido, distanciaEmMetros, statusPelosEventos, trocaDeEnderecoPendente, type EntradaPedido,
} from "../src/lib/ifood-shipping";
import { queryDaLista, avisoDoTexto } from "../src/lib/ifood-review";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const lanca = (nome: string, fn: () => unknown, trecho: string) => {
  try { fn(); confere(nome, "não lançou", trecho); }
  catch (e: any) { confere(nome, String(e?.message).includes(trecho), true); }
};

const base: EntradaPedido = {
  cliente: { nome: "Maria Teste", ddd: "22", numero: "99885-1680" },
  endereco: {
    postalCode: "69923-000", streetName: "Ramal Bujari", streetNumber: "150", neighborhood: "Bujari",
    city: "Bujari", state: "ac", latitude: -9.824, longitude: -67.947,
  },
  itens: [{ nome: "Produto Teste", quantidade: 2, precoUnitario: 15 }],
  pagamento: { metodo: "CASH", trocoPara: 50 },
  quoteId: "effd508b-8b48-4770-9e4e-47c2368b9a15",
  taxaEntrega: 13.99,
};

// ── pedido ──
const p = montarPedido(base);
confere("total = itens + taxa", p.total, 43.99);
confere("pagamento fecha com o total", p.payments.methods[0].value, 43.99);
confere("telefone só dígitos, tipo CUSTOMER", p.customer.phone, { countryCode: "55", areaCode: "22", number: "998851680", type: "CUSTOMER" });
confere("CEP só dígitos e UF maiúscula", [p.delivery.deliveryAddress.postalCode, p.delivery.deliveryAddress.state], ["69923000", "AC"]);
confere("taxa em merchantFee", p.delivery.merchantFee, 13.99);
confere("item: price = qtd × unitário", [p.items[0].price, p.items[0].totalPrice, p.items[0].quantity], [30, 30, 2]);
confere("preparo 0 → aloca na hora", p.delivery.preparationTime, 0);
confere("preparo em segundos", montarPedido({ ...base, preparoMin: 15 }).delivery.preparationTime, 900);
confere("cartão leva a bandeira", montarPedido({ ...base, pagamento: { metodo: "CREDIT", bandeira: "VISA" } }).payments.methods[0], { method: "CREDIT", type: "OFFLINE", value: 43.99, card: { brand: "VISA" } });
lanca("sem cotação não registra", () => montarPedido({ ...base, quoteId: "" }), "Consulte a disponibilidade");
lanca("troco menor que o total", () => montarPedido({ ...base, pagamento: { metodo: "CASH", trocoPara: 20 } }), "troco");
lanca("sem coordenada", () => montarPedido({ ...base, endereco: { ...base.endereco, latitude: NaN } }), "latitude");
lanca("DDD com 3 dígitos", () => montarPedido({ ...base, cliente: { ...base.cliente, ddd: "022" } }), "DDD");

// ── distância (limite de 500 m da troca de endereço) ──
const d = distanciaEmMetros({ latitude: -9.824, longitude: -67.947 }, { latitude: -9.8255, longitude: -67.9465 });
confere("troca do ensaio fica dentro de 500 m", d > 100 && d < 500, true);
confere("1 km fora do limite", distanciaEmMetros({ latitude: -9.824, longitude: -67.947 }, { latitude: -9.833, longitude: -67.947 }) > 500, true);

// ── eventos → status ──
const ev = (codigo: string, em: string, metadata?: any) => ({ codigo, em, metadata });
confere("só registrado", statusPelosEventos([]), "REGISTRADO");
confere("confirmado", statusPelosEventos([ev("PLACED", "2026-10-17T22:40:43Z"), ev("CONFIRMED", "2026-10-17T22:40:44Z")]), "CONFIRMADO");
confere("cancelado vence o que vem depois",
  statusPelosEventos([ev("CONFIRMED", "2026-10-17T22:40:44Z"), ev("CANCELLED", "2026-10-17T22:51:08Z"), ev("DISPATCHED", "2026-10-17T22:52:00Z")]), "CANCELADO");
confere("ordem dos eventos não importa",
  statusPelosEventos([ev("CANCELLED", "2026-10-17T22:51:08Z"), ev("CANCELLATION_REQUESTED", "2026-10-17T22:51:07Z")]), "CANCELADO");

const pedida = ev("DELIVERY_ADDRESS_CHANGE_REQUESTED", "2026-10-17T22:42:27Z", { address: { streetName: "Ramal Bujari" } });
confere("troca pendente", trocaDeEnderecoPendente([pedida])?.codigo, "DELIVERY_ADDRESS_CHANGE_REQUESTED");
confere("troca aceita não fica pendente", trocaDeEnderecoPendente([pedida, ev("DELIVERY_ADDRESS_CHANGE_ACCEPTED", "2026-10-17T22:42:31Z")]), null);
confere("troca recusada não fica pendente", trocaDeEnderecoPendente([ev("DELIVERY_ADDRESS_CHANGE_DENIED", "2026-10-17T22:42:35Z"), pedida].reverse()), null);

// ── review ──
const q = new URLSearchParams(queryDaLista({ page: 1, pageSize: 100, dateFrom: "2026-10-01T00:00:00Z", dateTo: "2026-10-17T23:59:59Z" }));
confere("pageSize 100 passa para o iFood recusar", q.get("pageSize"), "100");
confere("datas em ISO sem milissegundo", [q.get("dateFrom"), q.get("dateTo")], ["2026-10-01T00:00:00Z", "2026-10-17T23:59:59Z"]);
confere("addCount ligado", q.get("addCount"), "true");
confere("texto curto avisa", avisoDoTexto("Obrigado")?.includes("10 a 300"), true);
confere("texto de 10 a 300 não avisa", avisoDoTexto("Obrigado pelo retorno, vamos melhorar!"), null);
confere("texto longo avisa", avisoDoTexto("x".repeat(301))?.includes("300"), true);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
