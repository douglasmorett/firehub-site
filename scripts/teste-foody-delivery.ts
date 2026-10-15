/**
 * Teste da regra pura da Foody Delivery / Voe Delivery (src/lib/foody-delivery.ts):
 * o JSON que vai para a Foody, o id curto, as datas no fuso da loja, o
 * telefone, a forma de pagamento e quando cada status do FireHub vira chamada.
 * Não fala com a Foody nem com o banco. Rodar:
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-foody-delivery.ts
 */
import {
  acaoDoStatus,
  dataFoody,
  idCurtoDoPedido,
  itensEmTexto,
  lerAtualizacoes,
  lerEntregaDaResposta,
  lerGatilho,
  montarPedidoFoody,
  normalizarToken,
  pagamentoFoody,
  podeIrParaFoody,
  statusDaChamadaManual,
  statusInteressaAFoody,
  telefoneFoody,
  ufDoTexto,
  localizadorIfood,
  ehCanalDaLoja,
} from "@/lib/foody-delivery";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const SP = "America/Sao_Paulo";
const loja = { storeTimezone: SP, city: "Criciúma", storeAddress: "Rua Henrique Lage, 100 - Centro, Criciúma - SC, 88801-010" };

// ── Datas ──
confere("data em Brasília (-03:00)", dataFoody("2020-06-23T00:30:01Z", SP), "2020-06-22T21:30:01-03:00");
confere("data em Manaus (-04:00)", dataFoody("2026-10-15T23:05:09Z", "America/Manaus"), "2026-10-15T19:05:09-04:00");
confere("data em Noronha (-02:00)", dataFoody("2026-10-15T12:00:00Z", "America/Noronha"), "2026-10-15T10:00:00-02:00");
confere("data com milissegundos não arredonda o segundo", dataFoody("2026-10-15T12:00:00.999Z", SP), "2026-10-15T09:00:00-03:00");
confere("data à meia-noite no fuso", dataFoody("2026-10-16T03:00:00Z", SP), "2026-10-16T00:00:00-03:00");

// ── id curto ──
const criado = "2026-10-15T23:30:00Z"; // 20h30 em Brasília, dia 15
confere("id com número do dia", idCurtoDoPedido({ id: "ckabc", dailyOrderNumber: 123, createdAt: criado }, SP), "123-1510");
confere("id usa o DIA DA LOJA (01h30 UTC do dia 16 = 15 em SP)", idCurtoDoPedido({ id: "x", dailyOrderNumber: 7, createdAt: "2026-10-16T01:30:00Z" }, SP), "7-1510");
confere("segunda tentativa ganha letra", idCurtoDoPedido({ id: "x", dailyOrderNumber: 123, createdAt: criado }, SP, 2), "123-1510B");
const longo = idCurtoDoPedido({ id: "cmabcdefghijklmnop", dailyOrderNumber: 1234567, createdAt: criado }, SP, 3);
confere("número grande cai no fim do id e cabe em 10", [longo.length <= 10, longo.startsWith("1510"), longo.endsWith("C")], [true, true, true]);
const semNumero = idCurtoDoPedido({ id: "cmz9y8x7w6", dailyOrderNumber: null, createdAt: criado }, SP);
confere("sem número do dia: dia + fim do id", semNumero, "1510y8x7w6");
for (const n of [1, 99, 9999, 99999]) {
  for (const t of [1, 2, 26]) {
    const id = idCurtoDoPedido({ id: "cmqwertyuiop", dailyOrderNumber: n, createdAt: criado }, SP, t);
    if (id.length > 10) confere(`id ≤ 10 (${n}, tentativa ${t})`, id.length, "<=10");
  }
}
confere("ids ≤ 10 caracteres em toda combinação", true, true);

// ── Telefone ──
confere("celular com DDD", telefoneFoody("(48) 99123-4567"), "+5548991234567");
confere("já com 55", telefoneFoody("5548991234567"), "+5548991234567");
confere("com +55 e espaços", telefoneFoody("+55 48 99123 4567"), "+5548991234567");
confere("fixo com DDD", telefoneFoody("4834331234"), "+554834331234");
confere("0 na frente do DDD", telefoneFoody("048991234567"), "+5548991234567");
confere("0800 do iFood não vai", telefoneFoody("08007003050 ID: 12345678"), undefined);
confere("curto demais não vai", telefoneFoody("991234567"), undefined);
confere("localizador do iFood", localizadorIfood("08007003050 ID: 12345678"), "12345678");
confere("sem localizador", localizadorIfood("48991234567"), undefined);

// ── Pagamento ──
confere("dinheiro", pagamentoFoody({ paymentMethod: "Dinheiro" }), "money");
confere("pix na entrega", pagamentoFoody({ paymentMethod: "Pix" }), "pix");
confere("crédito na entrega", pagamentoFoody({ paymentMethod: "Crédito (Cobrar na Entrega)" }), "card");
confere("débito", pagamentoFoody({ paymentMethod: "Cartão Débito" }), "card");
confere("vale-refeição", pagamentoFoody({ paymentMethod: "Vale-refeição" }), "card");
confere("pago online pelo site", pagamentoFoody({ paymentMethod: "Crédito (Pago Online)" }), "online");
confere("pix pelo gateway", pagamentoFoody({ paymentMethod: "PIX", gatewayPaymentId: "pay_123" }), "online");
confere("fiado", pagamentoFoody({ paymentMethod: "Fiado" }), "on_credit");
confere("texto vazio cai em cartão (cobra)", pagamentoFoody({ paymentMethod: "" }), "card");

// ── UF ──
confere("UF no endereço da loja", ufDoTexto(loja.storeAddress), "SC");
confere("UF com barra", ufDoTexto("Av. Brasil 10, Rio das Ostras/RJ"), "RJ");
confere("sem UF", ufDoTexto("Rua Sem Estado, 10"), undefined);

// ── Token ──
confere("token cru", normalizarToken("  abcdef0123456789abcdef  "), "abcdef0123456789abcdef");
confere("token com Authorization:", normalizarToken("Authorization: abcdef0123456789abcdef"), "abcdef0123456789abcdef");
confere("token com aspas e quebra", normalizarToken('"abcdef01234\n56789abcdef"'), "abcdef0123456789abcdef");
confere("token curto recusado", normalizarToken("abc"), null);

// ── Itens ──
confere(
  "itens em texto",
  itensEmTexto([
    { productName: "Pizza Margherita", quantity: 2, notes: "sem manjericão", comboSelections: [{ name: "Borda de catupiry", quantity: 1 }] },
    { productName: "Coca-Cola 2L", quantity: 1 },
  ]),
  "2x Pizza Margherita\n  + Borda de catupiry\n  Obs: sem manjericão\n1x Coca-Cola 2L",
);

// ── Quem pode ir ──
confere("retirada não vai", podeIrParaFoody({ deliveryType: "RETIRADA", customerAddress: "x" }).pode, false);
confere("entrega do site vai", podeIrParaFoody({ deliveryType: "DELIVERY", source: "SITE", customerAddress: "Rua A, 1 - Centro" }).pode, true);
confere("iFood com entregador do iFood não vai", podeIrParaFoody({ deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId: "a", deliveryBy: "IFOOD", customerAddress: "Rua A, 1" }).pode, false);
confere("iFood com entrega própria vai", podeIrParaFoody({ deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId: "a", deliveryBy: "MERCHANT", customerAddress: "Rua A, 1" }).pode, true);
confere("99 com logística do 99 não vai", podeIrParaFoody({ deliveryType: "DELIVERY", source: "99FOOD", deliveryBy: "99FOOD", customerAddress: "Rua A, 1" }).pode, false);
confere("cancelado não vai", podeIrParaFoody({ deliveryType: "DELIVERY", status: "CANCELADO", customerAddress: "Rua A, 1" }).pode, false);
confere("sem endereço não vai", podeIrParaFoody({ deliveryType: "DELIVERY", customerAddress: "" }).pode, false);
confere("site é canal da loja", ehCanalDaLoja({ source: "SITE" }), true);
confere("iFood não é canal da loja", ehCanalDaLoja({ source: "IFOOD", ifoodOrderId: "a" }), false);

// ── O pedido inteiro ──
const pedidoSite = {
  id: "cmpedido000001",
  dailyOrderNumber: 42,
  createdAt: criado,
  status: "ACEITO",
  source: "SITE",
  deliveryType: "DELIVERY",
  customerName: "Maria Souza",
  customerPhone: "(48) 99123-4567",
  customerAddress: "Rua Coronel Pedro Benedet, 250 - Centro, Criciúma",
  customerLatLng: { lat: -28.6775, lng: -49.3697, origem: "gps" },
  paymentMethod: "Dinheiro",
  changeAmount: 100,
  totalAmount: 87.9,
  deliveryFee: 7,
  notes: "Interfone 12",
  tempoEntregaMin: 50,
  items: [{ productName: "Pizza Napoletana", quantity: 1 }],
};
const corpo = montarPedidoFoody(pedidoSite, loja, { status: "open" });
confere("payload: id", corpo.id, "42-1510");
confere("payload: status", corpo.status, "open");
confere("payload: total e taxa", [corpo.orderTotal, corpo.deliveryFee], [87.9, 7]);
confere("payload: pagamento", corpo.paymentMethod, "money");
confere("payload: data no fuso", corpo.date, "2026-10-15T20:30:00-03:00");
confere("payload: prazo = criado + 50 min", corpo.deliveryDueDate, "2026-10-15T21:20:00-03:00");
confere("payload: cliente", corpo.customer, { customerName: "Maria Souza", customerPhone: "+5548991234567" });
confere("payload: itens", corpo.orderDetails, "1x Pizza Napoletana");
confere("payload: endereço (logradouro, número - bairro)", corpo.deliveryPoint.address, "Rua Coronel Pedro Benedet, 250 - Centro");
confere("payload: rua/número/cidade/UF/país", [corpo.deliveryPoint.street, corpo.deliveryPoint.houseNumber, corpo.deliveryPoint.city, corpo.deliveryPoint.region, corpo.deliveryPoint.country], ["Rua Coronel Pedro Benedet", "250", "Criciúma", "SC", "BR"]);
confere("payload: coordenadas da porta vão", corpo.deliveryPoint.coordinates, { lat: -28.6775, lng: -49.3697 });
confere("payload: notas com cobrança, troco e observação", corpo.notes, "COBRAR R$ 87,90 (Dinheiro) | Troco para R$ 100,00 — levar R$ 12,10 | Interfone 12");

// Ponto de centro de bairro não vai (não é a porta do cliente).
const bairro = montarPedidoFoody({ ...pedidoSite, customerLatLng: { lat: -28.6, lng: -49.3, origem: "bairro" } }, loja, { status: "ready" });
confere("centro de bairro não manda coordenadas", bairro.deliveryPoint.coordinates, undefined);
confere("status ready", bairro.status, "ready");

// Endereço que não se separa: vai o texto original, sem coordenadas.
const solto = montarPedidoFoody({ ...pedidoSite, customerAddress: "quadra 05 lote 3 perto do mercado" }, loja, { status: "open" });
confere("endereço solto vai como veio", solto.deliveryPoint.address, "quadra 05 lote 3 perto do mercado");
confere("endereço solto sem rua inventada", [solto.deliveryPoint.street, solto.deliveryPoint.houseNumber, solto.deliveryPoint.coordinates], [undefined, undefined, undefined]);

// Pago online: não cobra.
const online = montarPedidoFoody({ ...pedidoSite, paymentMethod: "Pix (Pago Online)", changeAmount: null, notes: "" }, loja, { status: "open" });
confere("pago online: online e PAGO na nota", [online.paymentMethod, online.notes], ["online", "PAGO — não cobrar"]);

// iFood com entrega própria: localizador, sem 0800 no telefone.
const ifood = montarPedidoFoody(
  { ...pedidoSite, source: "IFOOD", ifoodOrderId: "uuid", ifoodReference: "4231", deliveryBy: "MERCHANT", customerPhone: "08007003050 ID: 87654321", paymentMethod: "Crédito (Pago Online)", notes: "" },
  loja,
  { status: "ready" },
);
confere("iFood: localizador", ifood.ifoodLocalizer, "87654321");
confere("iFood: sem telefone 0800", ifood.customer, { customerName: "Maria Souza" });
confere("iFood: nota com a referência", ifood.notes, "iFood #4231 | PAGO — não cobrar");

// Agendado: o prazo é a hora marcada.
const agendado = montarPedidoFoody({ ...pedidoSite, agendado: true, scheduledDatetime: "2026-10-16T22:00:00Z" }, loja, { status: "open" });
confere("agendado: prazo é a hora marcada", agendado.deliveryDueDate, "2026-10-16T19:00:00-03:00");

// ── Status: quando cada mudança vira chamada ──
confere("ACEITO + gatilho ACEITO → cria open", acaoDoStatus("ACEITO", "ACEITO", null), "CRIAR_OPEN");
confere("PREPARANDO + gatilho ACEITO → cria open", acaoDoStatus("PREPARANDO", "ACEITO", null), "CRIAR_OPEN");
confere("ACEITO + gatilho PRONTO → nada", acaoDoStatus("ACEITO", "PRONTO", null), null);
confere("PRONTO + gatilho PRONTO → cria ready", acaoDoStatus("PRONTO", "PRONTO", null), "CRIAR_READY");
confere("PRONTO + gatilho ACEITO sem entrega → cria ready", acaoDoStatus("PRONTO", "ACEITO", null), "CRIAR_READY");
confere("PRONTO com entrega open → marca ready", acaoDoStatus("PRONTO", "ACEITO", { status: "open" }), "MARCAR_READY");
confere("PRONTO com entrega open (manual) → marca ready", acaoDoStatus("PRONTO", "MANUAL", { status: "open" }), "MARCAR_READY");
confere("SAIU com entrega open → marca ready", acaoDoStatus("SAIU_ENTREGA", "PRONTO", { status: "open" }), "MARCAR_READY");
confere("PRONTO com entrega já aceita → nada", acaoDoStatus("PRONTO", "PRONTO", { status: "accepted" }), null);
confere("PRONTO + MANUAL sem entrega → nada", acaoDoStatus("PRONTO", "MANUAL", null), null);
confere("ACEITO + MANUAL → nada", acaoDoStatus("ACEITO", "MANUAL", null), null);
confere("entrega cancelada lá não é recriada sozinha", acaoDoStatus("PRONTO", "PRONTO", { status: "cancelled" }), null);
confere("chamada em andamento (sem status) → nada", acaoDoStatus("PRONTO", "PRONTO", { status: null }), null);
confere("CANCELADO com entrega em curso → cancela", acaoDoStatus("CANCELADO", "MANUAL", { status: "ready" }), "CANCELAR");
confere("CANCELADO sem entrega → nada", acaoDoStatus("CANCELADO", "ACEITO", null), null);
confere("CANCELADO com entrega entregue → nada", acaoDoStatus("CANCELADO", "ACEITO", { status: "delivered" }), null);
confere("ENTREGUE → nada", acaoDoStatus("ENTREGUE", "ACEITO", { status: "onGoing" }), null);
confere("manual com pedido na cozinha → open", statusDaChamadaManual("PREPARANDO"), "open");
confere("manual com pedido pronto → ready", statusDaChamadaManual("PRONTO"), "ready");
confere("status que acorda o gatilho", ["ACEITO", "PRONTO", "CANCELADO", "ENTREGUE", "NOVO"].map(statusInteressaAFoody), [true, true, true, false, false]);
confere("gatilho desconhecido vira MANUAL", [lerGatilho("pronto"), lerGatilho("x"), lerGatilho(null)], ["PRONTO", "MANUAL", "MANUAL"]);

// ── Respostas da Foody ──
confere(
  "lê a resposta do pedido",
  lerEntregaDaResposta({ uid: "u1", status: "accepted", orderTrackerUrl: "https://track.foody/x", courier: { courierName: "João", courierPhone: "+5548999990000" } }),
  { uid: "u1", status: "accepted", orderTrackerUrl: "https://track.foody/x", courierName: "João", courierPhone: "+5548999990000" },
);
confere("link de rastreio sem http é descartado", lerEntregaDaResposta({ uid: "u", orderTrackerUrl: "javascript:alert(1)" }).orderTrackerUrl, null);
confere(
  "lê o checkupdates",
  lerAtualizacoes([{ uid: "a", status: "onGoing", updateDate: "2026-10-15T20:00:00-03:00" }, { status: "x" }, null]),
  [{ uid: "a", status: "onGoing", updateDate: "2026-10-15T20:00:00-03:00" }],
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
