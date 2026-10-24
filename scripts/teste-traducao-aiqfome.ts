/**
 * scripts/teste-traducao-aiqfome.ts
 *
 * Trava o tradutor do aiqfome (src/lib/aiqfome/traducao.ts) e o id do pedido
 * (src/lib/aiqfome/id-do-pedido.ts). Puro: sem banco, sem rede.
 *
 *   npx tsx scripts/teste-traducao-aiqfome.ts
 *
 * Os quatro pedidos são os EXEMPLOS DA DOC do aiqfome (developer.aiqfome.com →
 * API V2 → Pedidos → "Payload detalhes completos do pedido…"), copiados como
 * estão em scripts/fixtures/aiqfome/ — inclusive o cupom de R$ 4,50 que não
 * entra no total e a taxa de serviço de R$ 1 sem dono. Doc é promessa: o
 * primeiro pedido real da loja de teste (Tupiratins-TO) entra aqui também.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

import { readFileSync } from "fs";
import { join } from "path";
import { traduzirPedidoAiqfome, filtroDoPedidoAQ, statusDoFireHubPara, formaDoTexto, instanteLocal, type PedidoAQ } from "../src/lib/aiqfome/traducao";
import { idDoPedidoAQ, lerIdDoPedidoAQ } from "../src/lib/aiqfome/id-do-pedido";
import { chavesDeLojaDoPedido, impressoraAtendeLoja } from "../src/lib/loja-de-origem";
import { chaveDoCanal, canalDoPedido } from "../src/lib/canal-do-pedido";
import { ehProdutoDeIntegracao } from "../src/lib/cardapio-interno";

let falhas = 0;
let total = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  total++;
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) console.log(`✅ ${nome}`);
  else {
    falhas++;
    console.log(`❌ ${nome}\n   esperado: ${b}\n   obtido:   ${a}`);
  }
}

const doc = (nome: string): PedidoAQ => JSON.parse(readFileSync(join(__dirname, "fixtures", "aiqfome", nome), "utf8")).data;
const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const agora = new Date("2026-01-20T18:30:00Z");
const ctx = (storeId: string, extra: Record<string, unknown> = {}) => ({ lojaId: "loja-teste", fuso: "America/Sao_Paulo", autoAcceptOrders: false, storeId, agora, ...extra });
const opcoes = (t: any, i = 0) => JSON.parse(t.items[i].comboSelections || "[]").map((o: any) => [o.name, o.quantity, o.price]);
const notas = (t: any) => String(t.dados.notes || "");
const iso = (d: unknown) => new Date(d as any).toISOString();

// ── 1. Pedido de cardápio: retirada, 3 pizzas com opções, dinheiro com troco ──
console.log("\n── Doc: pedido de cardápio (retirada, 3x pizza, dinheiro) ──");
{
  const p = doc("pedido-cardapio.json");
  const t = traduzirPedidoAiqfome(p, ctx("53852"));
  confere("id no banco com a loja do aiqfome; número = id do pedido", [t.dados.openDeliveryOrderId, t.dados.openDeliveryReference, t.dados.source, t.dados.openDeliveryChannel], ["aiqfome_53852_24340321", "24340321", "AIQFOME", "AIQFOME"]);
  confere("retirada é RETIRADA, entrega da loja", [t.dados.deliveryType, t.dados.deliveryBy, t.dados.customerAddress], ["RETIRADA", "MERCHANT", ""]);
  confere("total = o do aiqfome", t.dados.totalAmount, 286.44);
  confere("conta fecha: (50 + 8 + 2×17,49 + 2) × 3 + embalagem 1,50 = 286,44 → sem aviso de total", t.avisos.some((a) => a.startsWith("total ") || a.startsWith("subtotal")), false);
  confere("1 item, 3 unidades, preço UNITÁRIO com as opções (94,98)", [t.items.length, t.items[0].quantity, t.items[0].price], [1, 3, 94.98]);
  confere(
    "opções: obrigatórias + adicional; a Coca escolhida duas vezes vira 2x (mesmo SKU); preço unitário",
    opcoes(t),
    [["Borda de Queijo (+8)", 1, 8], ["Coca-Cola 600ml updated", 2, 17.49], ["Molho de Tomate Tradicional", 1, 0], ["Maionese Artesanal", 1, 0], ["Azeitona Extra", 1, 2]],
  );
  confere("nome com o tamanho; espelho com a loja do aiqfome no id e nome BASE", [t.items[0].productName.split(" | ")[0], t.espelhos[0]], ["Pizza do Chef (Em Oferta) (G)", { id: "aiqfome-loja-teste-53852-PZ0001G", nome: "Pizza do Chef (Em Oferta) (G)" }]);
  confere("dinheiro na retirada, troco para 300", [t.dados.paymentMethod, t.dados.changeAmount], ["Dinheiro (Cobrar na Entrega)", 300]);
  confere("embalagem é taxa da LOJA (na nota da comanda)", notas(t).includes("💳 Embalagem: R$1.50 (fica com a loja)"), true);
  confere(
    "cupom incoerente da doc (coupon_value 0 × 450 centavos): vale o coupon_value, sem desconto inventado, com aviso",
    [t.dados.discountTotal, t.avisos.some((a) => a.startsWith("cupom incoerente"))],
    [null, true],
  );
  confere("cliente: nome + sobrenome, telefone só dígitos", [t.dados.customerName, t.dados.customerPhone], ["Henrique Teste", "31999887777"]);
  confere("hora local do timeline.timezone (Fortaleza): retirar às 15:40 = 18:40Z", iso(t.dados.scheduledDatetime), "2025-12-16T18:40:00.000Z");
  confere("loja que aceita na mão: NOVO, com o aviso dos 10 min", [t.dados.status, notas(t).includes("⏰ Aceite em até 10 min")], ["NOVO", true]);
  const auto = traduzirPedidoAiqfome(p, ctx("53852", { autoAcceptOrders: true }));
  confere("loja que aceita sozinha: ACEITO, sem o aviso dos 10 min", [auto.dados.status, notas(auto).includes("⏰")], ["ACEITO", false]);
  const lido = traduzirPedidoAiqfome(p, ctx("53852", { statusInicial: "ACEITO" }));
  confere("já lido lá (filtro): entra ACEITO mesmo com aceite manual", lido.dados.status, "ACEITO");
}

// ── 2. Múltiplos sabores: crédito, bordas e sachês ──
console.log("\n── Doc: pizza com múltiplos sabores (crédito) ──");
{
  const p = doc("pedido-multiplos-sabores.json");
  const t = traduzirPedidoAiqfome(p, ctx("96236"));
  confere("total 66,50 = (10 + 20 + 30 + 1,50) + embalagem 5 — sem aviso", [t.dados.totalAmount, t.items[0].price, t.avisos.filter((a) => /total|subtotal/.test(a))], [66.5, 61.5, []]);
  confere(
    "sabores sem preço (1/3 cada) antes das opções pagas",
    opcoes(t),
    [["1/3 pizza flamengo", 1, 0], ["1/3 pizza frangon", 1, 0], ["1/3 pizza milho com bancon", 1, 0], ["borda prato", 1, 20], ["borda catupiry", 1, 30], ["Sachê de Ketchup", 1, 0], ["Sachê de Maionese", 1, 0], ["Sachê de Mostarda", 1, 1.5]],
  );
  confere("crédito com a bandeira; não pago online (pre_paid false)", t.dados.paymentMethod, "Crédito Mastercard (Cobrar na Entrega)");
  confere("observação do pedido e do item na comanda", [notas(t).includes("📝 OBS: obs do pedido, buzinar 3 vezes"), t.items[0].notes], [true, "obs do item faz a boa"]);
  confere("sem SKU nem id: espelho pelo nome (com o tamanho)", t.espelhos[0].id, "aiqfome-loja-teste-96236-nome-pizza-flamengo-pizza-frangon-pizza-milho");
  const pago = copia(p);
  pago.payment_method!.pre_paid = true;
  confere("pre_paid: pago online", traduzirPedidoAiqfome(pago, ctx("96236")).dados.paymentMethod, "Crédito Mastercard (Pago Online)");
}

// ── 3. Entrega com logística: Pix na entrega, cupom, taxa de serviço sem dono, fuso null ──
console.log("\n── Doc: entrega (Pix, cupom, taxa de serviço) ──");
{
  const p = doc("pedido-entrega.json");
  const t = traduzirPedidoAiqfome(p, ctx("96236"));
  confere("total 26 = 25 + entrega 5 + serviço 1 − cupom 5 — conta fecha", [t.dados.totalAmount, t.avisos.some((a) => a.startsWith("total "))], [26, false]);
  confere("5x guaraná a 5", [t.items[0].quantity, t.items[0].price, t.items[0].notes], [5, 5, "Gelado pls!"]);
  confere("entrega da loja, taxa de entrega 5", [t.dados.deliveryType, t.dados.deliveryBy, t.dados.deliveryFee], ["DELIVERY", "MERCHANT", 5]);
  confere("Pix na porta", t.dados.paymentMethod, "Pix (Cobrar na Entrega)");
  confere("cupom sem origem: da loja, com aviso", [t.dados.discountTotal, t.dados.discountMerchant, t.dados.discountIfood, t.avisos.some((a) => a.startsWith("cupom sem origem"))], [5, 5, null, true]);
  confere(
    "taxa de serviço com total 1 e store/aiq 0: entra o total, a diferença fica com o aiqfome (aviso)",
    [notas(t).includes("💳 Taxa de serviço aiqfome: R$1.00 (fica com a plataforma)"), t.avisos.some((a) => a.startsWith("taxa de serviço"))],
    [true, true],
  );
  confere(
    "endereço no formato dos relatórios",
    t.dados.customerAddress,
    "rua do teste hmo, 5242-5 - Comp: Apto 45 - Ref: Próximo ao shopping - CENTRO SUL - BARRA DE SAO FRANCISCO",
  );
  confere("timezone null → fuso da loja (SP): 17:10:52 + 90 min = 21:40:52Z", iso(t.dados.scheduledDatetime), "2026-01-07T21:40:52.000Z");

  const ag = copia(p);
  ag.is_scheduled = true;
  ag.scheduled_dates = { start_date: "2026-01-08 19:00:00", end_date: "2026-01-08 19:30:00" };
  const ta = traduzirPedidoAiqfome(ag, ctx("96236"));
  confere("agendado: prazo = início da janela (hora local) e a nota do agendamento", [iso(ta.dados.scheduledDatetime), notas(ta).includes("📅 AGENDADO")], ["2026-01-08T22:00:00.000Z", true]);

  const cupomAiq = copia(p);
  cupomAiq.coupon = { totalDiscountInCents: 500, origin: "AIQFOME" };
  cupomAiq.coupon_hash = "BEMVINDO";
  const tc = traduzirPedidoAiqfome(cupomAiq, ctx("96236"));
  confere("cupom do aiqfome: desconto da plataforma, com o código", [tc.dados.discountIfood, tc.dados.discountMerchant, notas(tc).includes("Cupom BEMVINDO")], [5, null, true]);
  const cupomLoja = copia(p);
  cupomLoja.coupon = { totalDiscountInCents: 500, origin: "SELLER" };
  confere("cupom da loja (SELLER): desconto da loja", traduzirPedidoAiqfome(cupomLoja, ctx("96236")).dados.discountMerchant, 5);
  const soCentavos = copia(p);
  soCentavos.payment_method!.coupon_value = null;
  soCentavos.coupon = { totalDiscountInCents: 500, origin: "AIQFOME" };
  confere("sem coupon_value: vale totalDiscountInCents/100", traduzirPedidoAiqfome(soCentavos, ctx("96236")).dados.discountTotal, 5);

  const promo = copia(p);
  promo.items![0].promotional_value = 4;
  promo.payment_method!.subtotal = "20.00";
  promo.payment_method!.total = 21;
  const tp = traduzirPedidoAiqfome(promo, ctx("96236"));
  confere("promotional_value que fecha o subtotal: vale o promocional (com aviso)", [tp.items[0].price, tp.avisos.some((a) => a.includes("valeu o promocional")), tp.avisos.some((a) => a.startsWith("total "))], [4, true, false]);

  const errado = copia(p);
  errado.payment_method!.total = 30;
  confere("total que não bate com as partes: aviso, e o total do aiqfome fica (nada inventado)", [traduzirPedidoAiqfome(errado, ctx("96236")).avisos.some((a) => a.startsWith("total 30.00 ≠ partes 26.00")), traduzirPedidoAiqfome(errado, ctx("96236")).dados.totalAmount], [true, 30]);

  const vale = copia(p);
  vale.payment_method!.name = "Ticket";
  const tv = traduzirPedidoAiqfome(vale, ctx("96236"));
  confere("forma desconhecida: \"Não informado\" (nunca Cartão), aviso e a forma escrita na comanda", [tv.dados.paymentMethod, tv.avisos.some((a) => a.includes('desconhecida: "Ticket"')), notas(tv).includes("Forma de pagamento no aiqfome: Ticket")], ["Não informado", true, true]);
  const valePago = copia(vale);
  valePago.payment_method!.pre_paid = true;
  confere("forma desconhecida paga no app: \"aiqfome App (Pago Online)\"", traduzirPedidoAiqfome(valePago, ctx("96236")).dados.paymentMethod, "aiqfome App (Pago Online)");
  const cpf = copia(p);
  cpf.user!.document_receipt = "708.872.670-09";
  confere("CPF na nota vai para o pedido (só dígitos)", traduzirPedidoAiqfome(cpf, ctx("96236")).dados.customerCpfCnpj, "70887267009");
}

// ── 4. aiqentrega: o motoboy é do aiqfome ──
console.log("\n── Doc: aiqentrega ──");
{
  const p = doc("pedido-aiqentrega.json");
  const t = traduzirPedidoAiqfome(p, ctx("96225"));
  confere("entrega do aiqfome: LOGISTICS + nota para não mandar o motoboy da loja", [t.dados.deliveryBy, notas(t).includes("aiqentrega (motoboy do aiqfome): Gianluca Bine")], ["LOGISTICS", true]);
  confere("total 18 = 10 + entrega 7 + serviço do aiqfome 1", [t.dados.totalAmount, t.dados.deliveryFee, t.avisos.some((a) => a.startsWith("total "))], [18, 7, false]);
  confere("débito com a bandeira", t.dados.paymentMethod, "Débito Visa (Cobrar na Entrega)");
  confere("tamanho \"Unidade\" não vai para o nome", t.items[0].productName, "esponja multiuso brilhus leve 4 pague 3");
  confere("coordenadas do cliente", t.dados.customerLatLng !== undefined, true);
}

// ── Filtro ──
console.log("\n── Filtros (o que não entra) ──");
{
  const base = doc("pedido-entrega.json");
  const f = (mudar: Partial<PedidoAQ>, importarDesde: Date | null = null) => {
    const d = filtroDoPedidoAQ({ ...copia(base), ...mudar }, { importarDesde, fuso: "America/Sao_Paulo" });
    return d.importar ? `entra${d.statusInicial ? `:${d.statusInicial}` : ""}` : `${d.motivo}${d.alertar ? "!" : ""}`;
  };
  confere("novo (não lido) entra", f({}), "entra");
  confere("já lido lá entra ACEITO; em separação também", [f({ is_read: true }), f({ is_in_separation: true })], ["entra:ACEITO", "entra:ACEITO"]);
  confere("cancelado não entra", f({ is_cancelled: true }), "cancelado");
  confere("já pronto/entregue lá: não entra (não fazer de novo) e avisa", [f({ is_ready: true }), f({ is_delivered: true })], ["passou-da-cozinha!", "passou-da-cozinha!"]);
  confere("o pedido da doc com aiqentrega (já pronto) não entra", filtroDoPedidoAQ(doc("pedido-aiqentrega.json"), { fuso: "America/Sao_Paulo" }).importar, false);
  confere(
    "pedido de antes da conexão não entra (17:10:52 de SP = 20:10:52Z)",
    [f({}, new Date("2026-01-07T20:11:00Z")), f({}, new Date("2026-01-07T20:10:00Z"))],
    ["antes-da-conexao", "entra"],
  );
  confere("criado no MESMO segundo da conexão entra (a hora do aiqfome não tem milissegundos)", f({}, new Date("2026-01-07T20:10:52.700Z")), "entra");
  confere("sem id: não entra e avisa", f({ id: null }), "sem-id!");
  confere("sem os sinais de status (formato desconhecido): não entra e avisa", f({ is_read: undefined as any, is_cancelled: undefined as any }), "status-desconhecido!");
}

// ── Status, formas, datas ──
console.log("\n── Status de lá → FireHub, formas, datas ──");
confere(
  "mapa de status pelos sinais",
  [{}, { is_read: true }, { is_read: true, is_ready: true }, { is_read: true, is_ready: true, is_delivered: true }, { is_read: true, is_cancelled: true }, { is_in_separation: true }].map((s) => statusDoFireHubPara(s)),
  [null, "ACEITO", "PRONTO", "ENTREGUE", "CANCELADO", "ACEITO"],
);
confere(
  "forma pelo texto do aiqfome",
  ["Dinheiro", "Mastercard Crédito", "Visa Débito", "PIX - Perto de Você", "Elo Credito", "Vale Refeição", "Vale Alimentação", "Ticket", ""].map((n) => formaDoTexto(n)),
  [
    { method: "CASH", brand: null },
    { method: "CREDIT", brand: "Mastercard" },
    { method: "DEBIT", brand: "Visa" },
    { method: "PIX", brand: null },
    { method: "CREDIT", brand: "Elo" },
    { method: "MEAL_VOUCHER", brand: null },
    { method: "FOOD_VOUCHER", brand: null },
    { method: "", brand: null },
    { method: "", brand: null },
  ],
);
confere(
  "data sem fuso no relógio do fuso; ISO com fuso vale o texto; fuso inválido cai em SP",
  [instanteLocal("2026-01-07 17:10:52", "America/Fortaleza")?.toISOString(), instanteLocal("2026-01-07 17:10:52", "America/Manaus")?.toISOString(), instanteLocal("2007-01-03T21:38:56-03:00", "America/Manaus")?.toISOString(), instanteLocal("2026-01-07 17:10:52", "Fuso/Inexistente")?.toISOString(), instanteLocal("", "America/Sao_Paulo")],
  ["2026-01-07T20:10:52.000Z", "2026-01-07T21:10:52.000Z", "2007-01-04T00:38:56.000Z", "2026-01-07T20:10:52.000Z", null],
);

// ── Id, canal, loja de origem, espelho ──
console.log("\n── O id do pedido carrega a loja do aiqfome ──");
confere("id e leitura de volta", [idDoPedidoAQ(53852, 24340321), lerIdDoPedidoAQ("aiqfome_53852_24340321"), lerIdDoPedidoAQ("aiqfome_53852_24340321_recovered")], ["aiqfome_53852_24340321", { storeId: "53852", orderId: "24340321" }, { storeId: "53852", orderId: "24340321" }]);
confere("id de outro canal não é do aiqfome", [lerIdDoPedidoAQ("cardapioweb_1_2"), lerIdDoPedidoAQ("keeta_1"), lerIdDoPedidoAQ("aiqfome_"), lerIdDoPedidoAQ(null)], [null, null, null, null]);
let lancou = false;
try {
  idDoPedidoAQ("12_3", 1);
} catch {
  lancou = true;
}
confere("loja com '_' é recusada (quebraria a leitura de volta)", lancou, true);
const pedidoAQ = { source: "AIQFOME", openDeliveryChannel: "AIQFOME", openDeliveryOrderId: "aiqfome_53852_24340321", openDeliveryReference: "24340321", franchiseeId: "loja-teste" };
confere(
  "canal: aiqfome, antes do 'todo openDeliveryOrderId é JotaJá' (também só pelo id)",
  [chaveDoCanal(pedidoAQ), chaveDoCanal({ openDeliveryOrderId: "aiqfome_1_2" }), chaveDoCanal({ openDeliveryOrderId: "uuid-do-jotaja" }), chaveDoCanal({ openDeliveryOrderId: "cardapioweb_1_2" })],
  ["AIQFOME", "AIQFOME", "JOTAJA", "CARDAPIOWEB"],
);
confere("selo: aiqfome, marketplace, número", [canalDoPedido(pedidoAQ).nome, canalDoPedido(pedidoAQ).ehMarketplace, canalDoPedido(pedidoAQ).referencia, canalDoPedido(pedidoAQ).emoji], ["aiqfome", true, "24340321", "🟣"]);
confere("loja de origem = a loja do aiqfome; sem o id, sem chave", [chavesDeLojaDoPedido(pedidoAQ), chavesDeLojaDoPedido({ source: "AIQFOME", franchiseeId: "loja-teste" })], [["aiqfome:53852"], []]);
confere(
  "impressora de uma loja do aiqfome recebe só a sua",
  [impressoraAtendeLoja({ lojas: ["aiqfome:53852"] }, pedidoAQ), impressoraAtendeLoja({ lojas: ["aiqfome:96236"] }, pedidoAQ), impressoraAtendeLoja({ lojas: ["loja:loja-teste"] }, pedidoAQ)],
  [true, false, false],
);
confere("espelho do aiqfome é de integração (categoria e prefixo)", [ehProdutoDeIntegracao("aiqfome"), ehProdutoDeIntegracao(null, "aiqfome-loja-1-PZ0001G", false)], [true, true]);

console.log(falhas === 0 ? `\nTudo certo (${total} conferências).` : `\n${falhas} falha(s) de ${total}.`);
process.exit(falhas === 0 ? 0 : 1);
