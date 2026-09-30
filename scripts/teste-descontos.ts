/**
 * Trava o relatório "Cupons e descontos" (lib/relatorios/descontos.ts): quem
 * pagou cada real de desconto, de onde ele veio e o que fica de fora.
 *
 *   npx tsx scripts/teste-descontos.ts
 *
 * Os pedidos imitam os de produção (semana de 17 a 23/09/2026): benefícios do
 * iFood com o `sponsorshipValues` já separado, pedido do 99Food novo (com as
 * colunas) e antigo (só com `promocoes`), cupom do site na observação, cupom
 * da Wabiz no texto que a integração grava, desconto do balcão com motivo e a
 * conta de mesa fechada com desconto.
 *
 * Desde 24/09/2026 o relatório segue a régua única
 * (lib/relatorios/regua-da-venda.ts): o desconto da mesa entra pelo
 * FECHAMENTO e a base do percentual é o valor vendido. A seção 13 confere
 * contra o resumo do Vendas por período (lib/relatorios/vendas.ts) nos mesmos
 * pedidos e mesas. As seções 14 a 16 são da revisão de 24/09/2026: o "% dos
 * pedidos" sem a conta de mesa no numerador, o nome da mesa igual ao do Vendas
 * e a base do percentual líquida de todo desconto.
 */
import { cupomDoMarketplace } from "../src/lib/cupom-do-parceiro";
import { lerCupons } from "../src/lib/cupons";
import {
  cupomDasNotas, descontoDaMesa, descontoDoPedido, descontosDoPeriodo, detalheDosPedidosComDesconto, motivoDoDescontoManual, paginar,
  rotuloDaMesa, type ConfigDosDescontos, type ContaDeMesa, type CupomCadastrado, type PedidoParaDescontos,
} from "../src/lib/relatorios/descontos";
import { descontoNoFechamento } from "../src/lib/relatorios/regua-da-venda";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const L = "nik";
const TZ = "America/Sao_Paulo";
// 20h de 18/09/2026 em São Paulo = 23h UTC.
const noite = (dia: string, hora = "23:00") => `${dia}T${hora}:00.000Z`;
let seq = 0;
const pedido = (x: Partial<PedidoParaDescontos>): PedidoParaDescontos => ({
  id: `p${++seq}`, franchiseeId: L, createdAt: noite("2026-09-18"), status: "ENTREGUE", totalAmount: 50, dailyOrderNumber: seq, ...x,
});

// ── Os pedidos ───────────────────────────────────────────────────────────────

// iFood #8119: R$ 8,98 no item (loja 5, iFood 3,98) + entrega R$ 6,99 da loja.
const IFOOD_DIVIDIDO = pedido({
  source: "IFOOD", ifoodOrderId: "if1", ifoodReference: "8119", deliveryType: "DELIVERY", totalAmount: 51.94,
  discountTotal: 15.97, discountMerchant: 11.99, discountIfood: 3.98,
  discountDetails: [
    { ifood: 3.98, value: 8.98, target: "ITEM", merchant: 5, description: "FD_DESPIT_AADEF15_c1d_009" },
    { ifood: 0, value: 6.99, target: "DELIVERY_FEE", merchant: 6.99, description: "ATV_FD_DESPENT_E05AF" },
  ],
});
// iFood #4238: R$ 5 no item da loja + entrega paga pelo iFood.
const IFOOD_ENTREGA_DO_IFOOD = pedido({
  source: "IFOOD", ifoodOrderId: "if2", ifoodReference: "4238", deliveryType: "DELIVERY", totalAmount: 30.79,
  discountTotal: 11.99, discountMerchant: 5, discountIfood: 6.99,
  discountDetails: [
    { ifood: 0, value: 5, target: "ITEM", merchant: 5, description: "FD_DESITEM_03AC2" },
    { ifood: 6.99, value: 6.99, target: "DELIVERY_FEE", merchant: 0, description: "FD_DESPENT_50F30" },
  ],
});
// iFood com diferença: total 10, mas só 7 com dono → 3 não identificados.
const IFOOD_SEM_DONO = pedido({
  source: "IFOOD", ifoodOrderId: "if3", deliveryType: "DELIVERY", totalAmount: 40,
  discountTotal: 10, discountMerchant: 7, discountIfood: null,
  discountDetails: [{ value: 7, target: "CART", merchant: 7, ifood: 0, description: "PROMO_LOJA" }],
});
// 99Food NOVO (desde 18/09): colunas + promoções — o mesmo dinheiro em dois lugares.
const NOVENTA_E_NOVE_NOVO = pedido({
  source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "7", deliveryType: "DELIVERY", totalAmount: 37.7,
  discountTotal: 20, discountMerchant: 10, discountIfood: 10,
  discountDetails: { total: 20, itens: 10, entrega: 10, cupom: 0, loja: 10, plataforma: 10,
    promocoes: [{ promo_type: 3, promo_discount: 1000, shop_subside_price: 1000 }, { promo_type: 11, promo_discount: 1000, shop_subside_price: 0 }] },
});
// 99Food ANTIGO, o #266009 de 12/09/2026: sem colunas, só as promoções.
const NOVENTA_E_NOVE_ANTIGO = pedido({
  source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY", totalAmount: 40,
  discountTotal: 25,
  discountDetails: { total: 25, promocoes: [
    { promo_type: 2, promo_discount: 900, shop_subside_price: 900 },
    { promo_type: 3, promo_discount: 1000, shop_subside_price: 1000 },
    { promo_type: 11, promo_discount: 500, shop_subside_price: 0 },
    { promo_type: 12, promo_discount: 100, shop_subside_price: 0 },
  ] },
});
// 99Food do app antigo: nem colunas nem promoções.
const NOVENTA_E_NOVE_CEGO = pedido({
  source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY", totalAmount: 30,
  discountTotal: 8, discountDetails: { total: 8, itens: 8, entrega: 0, cupom: 0 },
});
// Site: cupom de 10% com a marca do checkout.
const SITE_CUPOM = pedido({
  source: "ONLINE", deliveryType: "DELIVERY", totalAmount: 32.35, discountTotal: 3.04, discountMerchant: 3.04,
  notes: "[Cupom: HAKIM10] Caprichar no recheio",
});
const SITE_CUPOM_2 = pedido({
  source: "ONLINE", deliveryType: "PICKUP", totalAmount: 27.65, discountTotal: 2.96, discountMerchant: 2.96, notes: "[Cupom: hakim10]",
});
// Site: cupom de frete grátis — o checkout grava a taxa como desconto e a entrega grátis com o motivo.
const SITE_FRETE = pedido({
  source: "ONLINE", deliveryType: "DELIVERY", totalAmount: 45, discountTotal: 6, discountMerchant: 6,
  notes: "[Cupom: FRETEGRATIS]", entregaGratis: { valor: 6, motivo: "Cupom FRETEGRATIS" },
});
// Site: entrega grátis por valor mínimo — NÃO é desconto no pedido.
const SITE_FRETE_POR_REGRA = pedido({
  source: "ONLINE", deliveryType: "DELIVERY", totalAmount: 90, entregaGratis: { valor: 7, motivo: "Pedido acima de R$ 80,00" },
  cashbackEarned: 4.5,
});
// Wabiz: o mesmo cupom escrito de dois jeitos.
const WABIZ_1 = pedido({
  source: "WABIZ", openDeliveryChannel: "WABIZ", openDeliveryReference: "3691", deliveryType: "DELIVERY", totalAmount: 48.42,
  discountTotal: 7.48, discountMerchant: 7.48, notes: "Pedido Wabiz #3691\n🏷️ Cupom bemvindo15: -R$7.48",
});
const WABIZ_2 = pedido({
  source: "WABIZ", openDeliveryChannel: "WABIZ", openDeliveryReference: "3683", deliveryType: "DELIVERY", totalAmount: 143.48,
  discountTotal: 25.32, discountMerchant: 25.32, notes: "Pedido Wabiz #3683\n🏷️ Cupom BEMVINDO15: -R$25.32\n📝 OBS: Comer no local",
});
// Balcão: desconto manual com e sem motivo.
const BALCAO_MOTIVO = pedido({
  source: "PRESENCIAL", deliveryType: "PICKUP", totalAmount: 25.47, discountTotal: 2.83, discountMerchant: 2.83,
  notes: "[Desconto: 10% (R$ 2,83) — Cliente fiel]", cashbackUsed: 2,
});
const BALCAO_SEM_MOTIVO = pedido({
  source: "PRESENCIAL", deliveryType: "PICKUP", totalAmount: 7.2, discountTotal: 0.8, discountMerchant: 0.8, notes: "[Desconto: 10% (R$ 0,80)]",
});
// Cancelado com desconto: o cliente não levou.
const CANCELADO = pedido({
  source: "ONLINE", status: "CANCELADO", deliveryType: "DELIVERY", totalAmount: 41.63, discountTotal: 27.75, discountMerchant: 27.75,
  notes: "[Cupom: PRIMEIROPEDIDO]",
});
// Madrugada: 01h30 de 19/09 em São Paulo (04h30 UTC) é do expediente de 18/09.
const MADRUGADA = pedido({
  source: "PRESENCIAL", deliveryType: "PICKUP", createdAt: "2026-09-19T04:30:00.000Z", totalAmount: 18, discountTotal: 2, discountMerchant: 2,
  notes: "[Desconto: R$ 2,00 — Pedido atrasado]",
});
// Sem desconto nenhum — entra na base do percentual.
const SEM_DESCONTO = pedido({ source: "PRESENCIAL", deliveryType: "PICKUP", totalAmount: 100 });

console.log("\n1) Quem pagou, pedido a pedido");
const d1 = descontoDoPedido(IFOOD_DIVIDIDO);
confere("iFood dividido: loja 11,99 + iFood 3,98 = 15,97", [d1.total, d1.loja, d1.plataforma, d1.naoIdentificado], [15.97, 11.99, 3.98, 0]);
confere("iFood: uma fatia por benefício, com alvo e dono",
  d1.fatias.map((f) => [f.nome, f.alvo, f.valor, f.loja, f.plataforma]),
  [["FD_DESPIT_AADEF15_c1d_009", "ITENS", 8.98, 5, 3.98], ["ATV_FD_DESPENT_E05AF", "ENTREGA", 6.99, 6.99, 0]]);
const d3 = descontoDoPedido(IFOOD_SEM_DONO);
confere("iFood: o que não tem dono é 'não identificado', não vai para a loja", [d3.loja, d3.plataforma, d3.naoIdentificado], [7, 0, 3]);
confere("iFood: a diferença vira a fatia 'Sem detalhe'", d3.fatias.map((f) => [f.nome, f.valor, f.naoIdentificado]), [["PROMO_LOJA", 7, 0], ["Sem detalhe", 3, 3]]);
// O pedido #4 da NIK (18/09/2026): a mesma campanha em 3 itens + a entrega do iFood.
const IFOOD_POR_ITEM = pedido({
  source: "IFOOD", ifoodOrderId: "if4", ifoodReference: "8834", deliveryType: "DELIVERY", totalAmount: 109.85,
  discountTotal: 36.99, discountMerchant: 30, discountIfood: 6.99,
  discountDetails: [
    { value: 10, target: "ITEM", merchant: 10, ifood: 0, description: "FD_DESITEM_21AA7" },
    { value: 10, target: "ITEM", merchant: 10, ifood: 0, description: "FD_DESITEM_21AA7" },
    { value: 10, target: "ITEM", merchant: 10, ifood: 0, description: "FD_DESITEM_21AA7" },
    { value: 6.99, target: "DELIVERY_FEE", merchant: 0, ifood: 6.99, description: "FD_DESPENT_50F30" },
  ],
});
confere("iFood: a mesma campanha em 3 itens vira uma fatia só, com a contagem",
  descontoDoPedido(IFOOD_POR_ITEM).fatias.map((f) => [f.nome, f.valor, f.vezes]), [["FD_DESITEM_21AA7", 30, 3], ["FD_DESPENT_50F30", 6.99, 1]]);
confere("…e o texto da lista diz '3×' em vez de repetir o nome",
  descontosDoPeriodo([IFOOD_POR_ITEM], [], { tz: TZ, de: "2026-09-18", ate: "2026-09-18", hoje: "2026-09-24", cupons: [], mostrarCuponsSemUso: false }).lista[0]?.origem,
  "FD_DESITEM_21AA7 (itens, 3×) + FD_DESPENT_50F30 (entrega)");

const d99 = descontoDoPedido(NOVENTA_E_NOVE_NOVO);
confere("99 novo: loja 10 + 99Food 10 (colunas), sem contar o cupom do 99 duas vezes", [d99.total, d99.loja, d99.plataforma], [20, 10, 10]);
confere("…que é o erro de somar cupomDoMarketplace neste pedido (daria 20 de plataforma)", cupomDoMarketplace(NOVENTA_E_NOVE_NOVO as any).total, 20);
confere("99 novo: as promoções viram campanhas com a parte da loja",
  d99.fatias.map((f) => [f.nome, f.valor, f.loja, f.plataforma]),
  [["Promoção 99Food (tipo 3)", 10, 10, 0], ["Promoção 99Food (tipo 11)", 10, 0, 10]]);
const d99a = descontoDoPedido(NOVENTA_E_NOVE_ANTIGO);
confere("99 antigo #266009: R$ 25, dos quais R$ 6 do 99Food (régua de lib/desconto-99food.ts)", [d99a.total, d99a.loja, d99a.plataforma], [25, 19, 6]);
const d99c = descontoDoPedido(NOVENTA_E_NOVE_CEGO);
confere("99 sem promoções: não identificado (o recibo põe na loja; o relatório não sabe)", [d99c.loja, d99c.plataforma, d99c.naoIdentificado], [0, 0, 8]);
confere("…e a fatia diz onde caiu (itens)", d99c.fatias.map((f) => [f.nome, f.alvo, f.valor]), [["Desconto 99Food (sem detalhe)", "ITENS", 8]]);

console.log("\n2) De onde veio: cupom, balcão, Wabiz");
confere("site: [Cupom: X] da observação", cupomDasNotas(SITE_CUPOM.notes, "SITE"), { codigo: "HAKIM10", sistema: "SITE" });
confere("Wabiz: '🏷️ Cupom bemvindo15: -R$7.48' vira BEMVINDO15", cupomDasNotas(WABIZ_1.notes, "WABIZ"), { codigo: "BEMVINDO15", sistema: "WABIZ" });
confere("Brendi: 'Cupom Brendi (-31%)' NÃO é código de cupom", cupomDasNotas("🏷️ Cupom Brendi (-31%): -R$19.57", "BRENDI"), null);
confere("balcão: motivo depois do travessão", motivoDoDescontoManual(BALCAO_MOTIVO.notes), "Cliente fiel");
confere("balcão: sem motivo = texto vazio (e não null)", motivoDoDescontoManual(BALCAO_SEM_MOTIVO.notes), "");
confere("frete grátis de cupom cai na ENTREGA", descontoDoPedido(SITE_FRETE).fatias.map((f) => [f.tipo, f.nome, f.alvo]), [["cupom", "FRETEGRATIS", "ENTREGA"]]);
confere("canal próprio sem colunas ainda é da loja",
  (({ loja, naoIdentificado }) => [loja, naoIdentificado])(descontoDoPedido({ id: "x", createdAt: noite("2026-09-18"), totalAmount: 10, source: "PRESENCIAL", discountTotal: 2 })), [2, 0]);

console.log("\n3) A conta da mesa");
const mesa = (x: Partial<ContaDeMesa>): ContaDeMesa => ({
  id: `m${++seq}`, franchiseeId: L, fechadaEm: noite("2026-09-18", "22:00"), mesa: 5, pago: 99, taxaServico: 9, gorjeta: 0,
  pedidos: [{ totalAmount: 60, status: "ENTREGUE" }, { totalAmount: 40, status: "ENTREGUE" }, { totalAmount: 30, status: "CANCELADO" }], ...x,
});
// Consumo 100 (o cancelado não conta), 10% de desconto = 90, taxa 10% sobre 90 = 9, pago 99.
confere("mesa: consumo 100 − (pago 99 − taxa 9) = R$ 10 de desconto", descontoDaMesa(mesa({})), 10);
confere("mesa antes de 13/09/2026: diferença não é desconto", descontoDaMesa(mesa({ fechadaEm: "2026-09-10T23:00:00.000Z" })), 0);
confere("mesa que pagou a mais: sem desconto", descontoDaMesa(mesa({ pago: 115, taxaServico: 10 })), 0);
confere("mesa com 1 centavo de arredondamento: sem desconto", descontoDaMesa(mesa({ pago: 109.99, taxaServico: 10 })), 0);
confere("mesa cujo pedido já traz o desconto: não conta duas vezes",
  descontoDaMesa(mesa({ pedidos: [{ totalAmount: 90, status: "ENTREGUE", discountTotal: 10 }] })), 0);
const MESA_COM_DESCONTO = mesa({ mesa: 7 });
// Pedido de mesa no período: entra no valor vendido pelo que foi lançado (o desconto da conta não sai dele).
const PEDIDO_DA_MESA = pedido({ source: "PRESENCIAL", tableSessionId: MESA_COM_DESCONTO.id, deliveryType: "DINE_IN", totalAmount: 100 });

console.log("\n4) O relatório do período");
const cadastro: CupomCadastrado[] = [
  ...lerCupons([
    { code: "HAKIM10", type: "percent", discount: 10, minOrderValue: 30, active: true },
    { code: "FRETEGRATIS", type: "free_shipping", discount: 0, active: true, validade: "2026-09-20" },
    { code: "NATAL", type: "fixed", discount: 15, active: false },
  ]).map((c) => ({ ...c, lojaId: L })),
];
const cfg = (x: Partial<ConfigDosDescontos> = {}): ConfigDosDescontos => ({
  tz: TZ, de: "2026-09-17", ate: "2026-09-23", hoje: "2026-09-24", cupons: cadastro, mostrarCuponsSemUso: true, ...x,
});
const TODOS = [
  IFOOD_DIVIDIDO, IFOOD_ENTREGA_DO_IFOOD, IFOOD_SEM_DONO, NOVENTA_E_NOVE_NOVO, NOVENTA_E_NOVE_ANTIGO, NOVENTA_E_NOVE_CEGO,
  SITE_CUPOM, SITE_CUPOM_2, SITE_FRETE, SITE_FRETE_POR_REGRA, WABIZ_1, WABIZ_2, BALCAO_MOTIVO, BALCAO_SEM_MOTIVO,
  CANCELADO, MADRUGADA, SEM_DESCONTO, PEDIDO_DA_MESA,
];
const r = descontosDoPeriodo(TODOS, [MESA_COM_DESCONTO, mesa({ pago: 115, taxaServico: 10 })], cfg());

// Total: 15,97 + 11,99 + 10 + 20 + 25 + 8 + 3,04 + 2,96 + 6 + 7,48 + 25,32 + 2,83 + 0,8 + 2 + mesa 10 = 151,39
confere("cancelado fora: 17 pedidos de venda (o cancelado não conta)", r.resumo.pedidos, 17);
confere("total de desconto, com a mesa e sem o cancelado", r.resumo.desconto, 151.39);
confere("pedidos com desconto: 14 pedidos + 1 conta de mesa", [r.resumo.pedidosComDesconto, r.resumo.mesasComDesconto], [15, 1]);
const pagos = Math.round(TODOS.filter((p) => p.status !== "CANCELADO").reduce((s, p) => s + (p.totalAmount || 0) * 100, 0)) / 100;
confere("vendas = valor vendido da régua: Σ totalAmount dos pedidos de venda (o desconto da mesa NÃO sai dele)", r.resumo.vendas, pagos);
confere("% sobre as vendas é sobre o valor vendido (antes: sobre o 'preço cheio', um número que nenhum outro relatório mostra)",
  r.resumo.pctSobreVendas, Math.round((151.39 / pagos) * 100000) / 1000);
confere("desconto médio por pedido com desconto", r.resumo.descontoMedio, Math.round((151.39 / 15) * 100) / 100);
// Loja: 11,99 + 5 + 7 + 10 + 19 + 3,04 + 2,96 + 6 + 7,48 + 25,32 + 2,83 + 0,8 + 2 + 10 = 113,42
// Plataforma: 3,98 + 6,99 + 10 + 6 = 26,97. Não identificado: 3 + 8 = 11.
// Pedidos com parte da loja: 13 pedidos (todos menos o 99 "cego") + a mesa = 14.
confere("quem bancou: loja / plataforma / não identificado",
  r.quemBancou.map((q) => [q.chave, q.valor, q.pedidos]), [["LOJA", 113.42, 14], ["PLATAFORMA", 26.97, 4], ["NAO_IDENTIFICADO", 11, 2]]);
confere("loja + plataforma + não identificado = total", Math.round((r.resumo.loja + r.resumo.plataforma + r.resumo.naoIdentificado) * 100) / 100, r.resumo.desconto);

const canal = (c: string) => r.porCanal.find((x) => x.canal === c);
confere("por canal — iFood: 3 pedidos, loja 23,99 + iFood 10,97 + 3 sem dono",
  [canal("IFOOD")?.pedidos, canal("IFOOD")?.desconto, canal("IFOOD")?.loja, canal("IFOOD")?.plataforma, canal("IFOOD")?.naoIdentificado], [3, 37.96, 23.99, 10.97, 3]);
confere("por canal — Mesa: a conta da mesa, bancada pela loja", [canal("MESA")?.pedidos, canal("MESA")?.pedidosComDesconto, canal("MESA")?.desconto], [1, 1, 10]);
confere("por canal — a soma bate com o total", Math.round(r.porCanal.reduce((s, c) => s + c.desconto, 0) * 100) / 100, r.resumo.desconto);
confere("por alvo — soma bate com o total", Math.round(r.porAlvo.reduce((s, a) => s + a.valor, 0) * 100) / 100, r.resumo.desconto);
confere("por alvo — na entrega: 6,99 + 6,99 + 6 (cupom de frete)", r.porAlvo.find((a) => a.chave === "ENTREGA")?.valor, 19.98);

const dia18 = r.porDia.find((d) => d.dia === "2026-09-18");
const dia19 = r.porDia.find((d) => d.dia === "2026-09-19");
confere("madrugada antes das 5h é do dia anterior (e todo o resto — a mesa fechou às 19h de 18/09 — é de 18/09)", [dia18?.desconto, dia19?.desconto], [151.39, 0]);
confere("a série tem os 7 dias do período, mesmo sem desconto", r.porDia.length, 7);

console.log("\n5) Cupons");
const cupom = (codigo: string, canalDoCupom = "SITE") => r.cupons.find((c) => c.codigo === codigo && c.canal === canalDoCupom);
confere("HAKIM10 e hakim10 são o mesmo cupom: 2 usos, R$ 6 de desconto, R$ 60 faturados",
  [cupom("HAKIM10")?.usos, cupom("HAKIM10")?.desconto, cupom("HAKIM10")?.faturamento, cupom("HAKIM10")?.ticketMedio], [2, 6, 60, 30]);
confere("HAKIM10 cruzado com o cadastro", cupom("HAKIM10")?.cadastro, { beneficio: "10% de desconto", situacao: "Ativo", ativo: true, regras: ["pedido a partir de R$ 30,00"] });
confere("FRETEGRATIS venceu em 20/09", cupom("FRETEGRATIS")?.cadastro?.situacao, "Venceu em 20/09/2026");
confere("BEMVINDO15 da Wabiz: 2 usos, sem cadastro no FireHub",
  [cupom("BEMVINDO15", "WABIZ")?.usos, cupom("BEMVINDO15", "WABIZ")?.desconto, cupom("BEMVINDO15", "WABIZ")?.cadastro], [2, 32.8, null]);
confere("cupom do pedido cancelado não aparece", cupom("PRIMEIROPEDIDO"), undefined);
confere("cupom cadastrado sem uso aparece no fim, com 0 usos", [cupom("NATAL")?.usos, cupom("NATAL")?.cadastro?.situacao], [0, "Desativado"]);
confere("…e some quando pedido", descontosDoPeriodo(TODOS, [], cfg({ mostrarCuponsSemUso: false })).cupons.some((c) => c.codigo === "NATAL"), false);

console.log("\n6) Campanhas e motivos");
const origem = (nome: string) => r.origens.find((o) => o.nome === nome);
confere("campanha do iFood com dono dividido", [origem("FD_DESPIT_AADEF15_c1d_009")?.loja, origem("FD_DESPIT_AADEF15_c1d_009")?.plataforma], [5, 3.98]);
confere("promoção do 99 tipo 11 soma o novo e o antigo (10 + 5)", r.origens.filter((o) => o.nome === "Promoção 99Food (tipo 11)").map((o) => [o.usos, o.valor, o.plataforma]), [[2, 15, 15]]);
confere("balcão agrupa por motivo", [origem("Cliente fiel")?.tipo, origem("Sem motivo informado")?.valor, origem("Pedido atrasado")?.valor], ["manual", 0.8, 2]);
confere("a mesa aparece como origem própria", [origem("Desconto na conta da mesa")?.tipo, origem("Desconto na conta da mesa")?.valor], ["mesa", 10]);
confere("origens somam o total", Math.round(r.origens.reduce((s, o) => s + o.valor, 0) * 100) / 100, r.resumo.desconto);

console.log("\n7) À parte: cashback e entrega grátis por regra");
confere("cashback somado à parte, fora do desconto", r.cashback, { gerado: 4.5, usado: 2, pedidosQueGeraram: 1, pedidosQueUsaram: 1 });
confere("entrega grátis por valor mínimo fica fora do desconto (a de cupom não entra aqui)", r.entregaGratisForaDoDesconto, { valor: 7, pedidos: 1 });

console.log("\n8) A lista de pedidos");
confere("a lista tem uma linha por pedido com desconto + a mesa", r.lista.length, 15);
const linhaMesa = r.lista.find((l) => l.tipoDeLinha === "mesa");
confere("a linha da mesa: 'Mesa 7', o consumo cobrado (100 − 10 de desconto; a taxa é do garçom) e a loja",
  [linhaMesa?.numero, linhaMesa?.total, linhaMesa?.quem, linhaMesa?.desconto], ["Mesa 7", 90, "Loja", 10]);
confere("…na hora em que a mesa fechou (19h de 18/09), dizendo que é o fechamento",
  [linhaMesa?.dia, linhaMesa?.hora, linhaMesa?.referencia], ["2026-09-18", "19:00", "no fechamento da conta"]);
const linhaIfood = r.lista.find((l) => l.id === IFOOD_DIVIDIDO.id);
confere("a linha do iFood: referência, origem e quem bancou",
  [linhaIfood?.referencia, linhaIfood?.origem, linhaIfood?.quem],
  ["iFood #8119", "FD_DESPIT_AADEF15_c1d_009 (itens) + ATV_FD_DESPENT_E05AF (entrega)", "Loja + iFood"]);
const linhaMadrugada = r.lista.find((l) => l.id === MADRUGADA.id);
confere("madrugada na lista: dia 18/09, 01:30", [linhaMadrugada?.dia, linhaMadrugada?.hora], ["2026-09-18", "01:30"]);
confere("a mais recente primeiro", r.lista[0]?.id, MADRUGADA.id);
const soPlataforma = descontosDoPeriodo(TODOS, [], cfg({ lista: { quem: "PLATAFORMA" } }));
confere("filtro 'plataforma' deixa só os pedidos em que a plataforma pagou", soPlataforma.lista.map((l) => l.id).sort(),
  [IFOOD_DIVIDIDO.id, IFOOD_ENTREGA_DO_IFOOD.id, NOVENTA_E_NOVE_NOVO.id, NOVENTA_E_NOVE_ANTIGO.id].sort());
confere("…sem mexer nos totais", soPlataforma.resumo.desconto, 141.39);
const doCupom = descontosDoPeriodo(TODOS, [], cfg({ lista: { origem: "cupom:WABIZ:BEMVINDO15", ordem: "maior" } }));
confere("filtro por origem (o cupom) e ordem pelo maior desconto", doCupom.lista.map((l) => l.desconto), [25.32, 7.48]);

const cento = Array.from({ length: 120 }, (_, i) => i);
confere("paginação: 120 linhas = 3 páginas de 50, a última com 20", (({ paginas, itens }) => [paginas, itens.length])(paginar(cento, 3)), [3, 20]);
confere("página além do fim cai na última", paginar(cento, 99).pagina, 3);
confere("lista vazia = 1 página vazia", (({ paginas, itens }) => [paginas, itens.length])(paginar([], 1)), [1, 0]);

console.log("\n9) Período sem desconto");
const vazio = descontosDoPeriodo([SEM_DESCONTO], [], cfg({ cupons: [] }));
confere("sem desconto: tudo zero, sem dividir por zero", [vazio.resumo.desconto, vazio.resumo.pctSobreVendas, vazio.resumo.descontoMedio, vazio.quemBancou.map((q) => q.pct)], [0, 0, 0, [0, 0, 0]]);

console.log("\n10) Brendi e Jotajá: o cupom do app é cupom, não campanha");
// Frangoso - Trindade (Brendi), 26/07 a 23/09/2026: a integração grava
// "Cupom Brendi (-N%)" com o percentual calculado em CADA pedido (desconto ÷
// itens). O mesmo cupom de R$ 8 saía picado em 14 linhas de "campanha da
// plataforma", de "(-8%)" a "(-19%)", embora a loja pague tudo.
const brendi = (pctTxt: string, valor: number, total: number) => pedido({
  source: "BRENDI", openDeliveryChannel: "BRENDI", deliveryType: "DELIVERY", totalAmount: total,
  discountTotal: valor, discountMerchant: valor,
  discountDetails: [{ value: valor, target: "CART", merchant: valor, platform: 0, description: `Cupom Brendi${pctTxt}` }],
  notes: `Pedido Brendi #2003\n🏷️ Cupom Brendi${pctTxt}: -R$${valor.toFixed(2)}`,
});
const B1 = brendi(" (-10%)", 8, 72), B2 = brendi(" (-14%)", 8, 49), B3 = brendi(" (-19%)", 8, 34);
// Jotajá com o código no payload: "Cupom DESC10 (-12%)" (processJotajaEvent.ts).
const jotaja = (descricao: string, valor: number, total: number) => pedido({
  source: "JOTAJA", openDeliveryChannel: "JOTAJA", deliveryType: "DELIVERY", totalAmount: total, discountTotal: valor, discountMerchant: valor,
  discountDetails: [{ value: valor, target: "CART", merchant: valor, platform: 0, description: descricao }],
});
const J1 = jotaja("Cupom DESC10 (-12%)", 5, 40), J2 = jotaja("Cupom DESC10 (-9%)", 5, 50), J3 = jotaja("Cupom JotaJá (-20%)", 6, 24);
const rb = descontosDoPeriodo([B1, B2, B3, J1, J2, J3], [], cfg({ cupons: [], mostrarCuponsSemUso: false }));
confere("o percentual de cada pedido não pica o cupom: uma linha só para a Brendi, como cupom da loja",
  rb.origens.filter((o) => o.canal === "BRENDI").map((o) => [o.tipo, o.nome, o.usos, o.valor, o.loja, o.plataforma]), [["cupom", "Brendi (sem código)", 3, 24, 24, 0]]);
const cupomBrendi = rb.cupons.find((c) => c.canal === "BRENDI");
confere("…e entra no ranking de cupons, com faturamento e ticket",
  [cupomBrendi?.codigo, cupomBrendi?.canalNome, cupomBrendi?.usos, cupomBrendi?.desconto, cupomBrendi?.faturamento, cupomBrendi?.ticketMedio],
  ["(sem código)", "Brendi", 3, 24, 155, 51.67]);
confere("Jotajá com código: o código vira o cupom, sem o percentual",
  rb.cupons.filter((c) => c.canal === "JOTAJA").map((c) => [c.codigo, c.usos, c.desconto]), [["DESC10", 2, 10], ["(sem código)", 1, 6]]);
confere("nenhum cupom de app sai como campanha da plataforma", rb.origens.some((o) => o.tipo === "campanha"), false);
confere("na lista: 'Cupom Brendi (sem código)'", rb.lista.find((l) => l.id === B1.id)?.origem, "Cupom Brendi (sem código)");
confere("cupom de verdade chamado BRENDI (em maiúsculas) é código, não o nome do app",
  descontoDoPedido(jotaja("Cupom BRENDI", 3, 30)).fatias.map((f) => f.codigo), ["BRENDI"]);

console.log("\n11) Mesa: a taxa de serviço negativa também é desconto");
// Pastel da Paulista, Mesa 23, fechada às 23h45 de 04/09/2026: antes de o
// fechamento recusar taxa fora de 0–100%, o desconto na mesa se dava assim.
const MESA_23 = mesa({
  id: "m23", fechadaEm: "2026-09-05T02:45:01.545Z", mesa: 23, pago: 76.49, taxaServico: -48.906, gorjeta: null,
  pedidos: [{ totalAmount: 125.4, status: "ENTREGUE" }, { totalAmount: 61.6, status: "CANCELADO" }, { totalAmount: 18, status: "CANCELADO" }],
});
confere("taxa de −R$ 48,91 é desconto, mesmo antes de 13/09 (a leitura de lib/relatorios/vendas.ts)", descontoDaMesa(MESA_23), 48.91);
// Mesa 55 da mesma loja: aberta em 11/09, fechada às 18h43 de 13/09 com R$ 0 pagos.
const MESA_55 = mesa({
  id: "m55", fechadaEm: "2026-09-13T21:43:50.480Z", mesa: 55, pago: 0, taxaServico: 0, gorjeta: null, pedidos: [{ totalAmount: 125.4, status: "ENTREGUE" }],
});
confere("Mesa 55: consumo de R$ 125,40 e nada pago = 100% de desconto", descontoDaMesa(MESA_55), 125.4);

console.log("\n12) Mesa: o desconto entra pelo FECHAMENTO (a régua única)");
// Até 24/09/2026 o desconto da mesa "andava com os pedidos dela": dividido
// entre os pedidos da mesa que estavam no período e abatido do "vendas". Dava
// outro número que os outros relatórios para a mesma semana (Pastel da
// Paulista, 09–16/09/2026: 34.535,14 × 34.660,54). Agora: `mesas` são as
// contas FECHADAS no período (a rota usa mesasFechadasDoPeriodo), o desconto
// vai inteiro para a hora do fechamento, e o valor vendido não é abatido.
//
// Faixa das 22h às 02h: o pedido da mesa foi às 20h (fora da faixa), a mesa
// fechou às 22h30 com 10% e houve um balcão de R$ 5 à 01h40. O desconto foi
// dado DENTRO da faixa — é dela, como no Vendas por período. O valor vendido
// não fica negativo (nada é abatido dele); o percentual passa de 100%, que é a
// verdade desse recorte: R$ 10 de desconto dados ali para R$ 5 vendidos ali.
const MESA_DAS_20H = mesa({ id: "m20h", fechadaEm: "2026-09-19T01:30:00.000Z", pago: 99, taxaServico: 9, pedidos: [{ totalAmount: 100, status: "ENTREGUE" }] });
const BALCAO_0140 = pedido({ source: "PRESENCIAL", deliveryType: "PICKUP", createdAt: "2026-09-19T04:40:00.000Z", totalAmount: 5 });
const rf = descontosDoPeriodo([BALCAO_0140], [MESA_DAS_20H], cfg({ cupons: [] }));
confere("mesa fechada na faixa: o desconto entra; o valor vendido não é abatido (nunca negativo)",
  [rf.resumo.vendas, rf.resumo.desconto, rf.resumo.pctSobreVendas, rf.resumo.pedidosComDesconto, rf.resumo.mesasComDesconto], [5, 10, 200, 1, 1]);
// Só um dos dois pedidos da mesa no período: o desconto é da CONTA, inteiro.
const MESA_DOIS = mesa({ id: "mdois", pago: 99, taxaServico: 9, pedidos: [{ totalAmount: 60, status: "ENTREGUE" }, { totalAmount: 40, status: "ENTREGUE" }] });
const PEDIDO_DE_60 = pedido({ source: "PRESENCIAL", tableSessionId: "mdois", deliveryType: "DINE_IN", totalAmount: 60 });
const rm = descontosDoPeriodo([PEDIDO_DE_60], [MESA_DOIS], cfg({ cupons: [] }));
confere("um pedido de R$ 60 de uma mesa de R$ 100 com 10%: o desconto da conta é R$ 10, e o valor vendido é o lançado (R$ 60)",
  [rm.resumo.desconto, rm.resumo.vendas, rm.resumo.pedidos, rm.resumo.pedidosComDesconto, rm.resumo.mesasComDesconto], [10, 60, 1, 1, 1]);
confere("…e a linha da mesa é a conta inteira: consumo 100 − 10 de desconto", [rm.lista[0]?.numero, rm.lista[0]?.desconto, rm.lista[0]?.total], ["Mesa 5", 10, 90]);
// Mesa 55 da Pastel: o pedido é do dia 11/09 e a mesa fechou em 13/09 às 18h43.
const PEDIDO_DA_55 = pedido({ source: "PRESENCIAL", tableSessionId: "m55", deliveryType: "DINE_IN", createdAt: "2026-09-12T02:09:28.562Z", totalAmount: 125.4 });
const r13 = descontosDoPeriodo([], [MESA_55], cfg({ de: "2026-09-13", ate: "2026-09-13", cupons: [] }));
confere("período só de 13/09: o desconto de R$ 125,40 é do dia 13 (o do fechamento), sem venda — e sem percentual",
  [r13.resumo.vendas, r13.resumo.desconto, r13.resumo.pctSobreVendas, r13.porDia[0]?.desconto], [0, 125.4, 0, 125.4]);
confere("…a linha da mesa no dia e na hora do fechamento", [r13.lista[0]?.dia, r13.lista[0]?.hora, r13.lista[0]?.referencia], ["2026-09-13", "18:43", "no fechamento da conta"]);
// A rota não manda a Mesa 55 no dia 11: ela não FECHOU no dia 11.
const r11 = descontosDoPeriodo([PEDIDO_DA_55], [], cfg({ de: "2026-09-11", ate: "2026-09-11", cupons: [] }));
confere("período de 11/09: os R$ 125,40 lançados são valor vendido, sem desconto nenhum (antes: 125,40 de desconto no dia 11)",
  [r11.resumo.vendas, r11.resumo.desconto, r11.resumo.pedidos], [125.4, 0, 1]);
confere("a fórmula da mesa é a da régua única (descontoNoFechamento), mesa a mesa",
  [MESA_23, MESA_55, MESA_DAS_20H, MESA_DOIS, mesa({ pago: null })].map(descontoDaMesa),
  [MESA_23, MESA_55, MESA_DAS_20H, MESA_DOIS, mesa({ pago: null })].map((m) => descontoNoFechamento({
    id: m.id, fechadaEm: m.fechadaEm, pago: m.pago, serviceFee: m.taxaServico, waiterTip: m.gorjeta, pedidos: m.pedidos,
  })));
confere("sem o pago gravado não há o que deduzir (antes, aqui, virava 100% de desconto)", descontoDaMesa(mesa({ pago: null })), 0);

console.log("\n13) O mesmo número do Vendas por período (a régua única)");
// Os mesmos pedidos e as mesmas mesas nos dois relatórios: o valor vendido, os
// lançamentos e o total de desconto (dos pedidos + do fechamento da mesa) têm
// de ser os mesmos. scripts/conferir-relatorios-batem.mjs faz o mesmo contra
// o banco de verdade.
const comoMesaFechada = (m: ContaDeMesa) => ({
  id: m.id, fechadaEm: m.fechadaEm, pago: m.pago, serviceFee: m.taxaServico, waiterTip: m.gorjeta, pedidos: m.pedidos,
});
// Três mesas fechadas em 18/09 (dentro de 17–23/09): uma com desconto e um
// pedido no período, uma sem desconto, e a das 20h, cujo pedido não está aqui.
const MESAS_DO_PERIODO = [MESA_COM_DESCONTO, mesa({ pago: 115, taxaServico: 10 }), MESA_DAS_20H];
const rd = descontosDoPeriodo(TODOS, MESAS_DO_PERIODO, cfg());
const rv = resumoDeVendas(TODOS as unknown as PedidoParaVendas[], MESAS_DO_PERIODO.map(comoMesaFechada));
confere("valor vendido: Descontos = Vendas por período", rd.resumo.vendas, rv.totalPedidos);
confere("lançamentos: Descontos = Vendas por período", rd.resumo.pedidos, rv.pedidos);
confere("total de desconto: Descontos = descontos dos pedidos + desconto no fechamento do Vendas por período",
  rd.resumo.desconto, Math.round((rv.descontos.total + rv.servico.descontoNaMesa) * 100) / 100);
confere("pedidos com desconto: Descontos = pedidos com desconto + mesas com desconto do Vendas por período",
  rd.resumo.pedidosComDesconto, rv.descontos.pedidos + rv.servico.mesasComDesconto);
confere("…e o valor vendido de cada canal também", rd.porCanal.map((c) => [c.canal, c.vendas]).sort(),
  rv.porCanal.map((c) => [c.canal, c.valor]).sort());

console.log("\n14) '% dos pedidos': pedidos ÷ pedidos, a conta de mesa à parte");
// Revisão de 24/09/2026. A conta de mesa entrava no numerador do "% dos
// pedidos" e não no denominador (que são lançamentos). Pastel da Paulista,
// 13/09/2026, só Mesa, das 18h40 às 18h50: três rodadas sem desconto e a Mesa
// 55 fechada ali — a tela dizia "33,33% dos 3 pedidos", e nenhum dos três teve
// desconto. Das 18h43 às 18h44 (só o fechamento): "0,00% dos 0 pedidos" ao
// lado de "—" no % sobre as vendas.
const RODADAS_SEM_DESCONTO = [1, 2, 3].map((i) => pedido({
  source: "PRESENCIAL", tableSessionId: `outra${i}`, deliveryType: "DINE_IN", createdAt: "2026-09-13T21:45:00.000Z", totalAmount: 28.23,
}));
const r18h40 = descontosDoPeriodo(RODADAS_SEM_DESCONTO, [MESA_55], cfg({ de: "2026-09-13", ate: "2026-09-13", cupons: [] }));
confere("3 rodadas sem desconto + a Mesa 55: 1 linha com desconto, mas 0% dos 3 pedidos",
  [r18h40.resumo.pedidos, r18h40.resumo.pedidosComDesconto, r18h40.resumo.mesasComDesconto, r18h40.resumo.pctDosPedidos], [3, 1, 1, 0]);
confere("…e o cartão diz isso: '0 dos 3 pedidos (0,0%) + 1 conta de mesa'",
  detalheDosPedidosComDesconto(r18h40.resumo), "0 dos 3 pedidos (0,0%) + 1 conta de mesa");
confere("só o fechamento no recorte (sem lançamento): sem percentual de pedidos",
  detalheDosPedidosComDesconto(r13.resumo), "1 conta de mesa, sem pedido lançado no recorte");
confere("…e sem base para o % da loja (a tela mostra '—', não '0%')", [r13.resumo.vendas, r13.resumo.pctLojaSobreVendas, r13.resumo.loja], [0, 0, 125.4]);
confere("com mesa e pedidos com desconto: pedidos ÷ pedidos (14 dos 17), a mesa somada à parte",
  [r.resumo.pctDosPedidos, detalheDosPedidosComDesconto(r.resumo)], [Math.round((14 / 17) * 100000) / 1000, "14 dos 17 pedidos (82,4%) + 1 conta de mesa"]);
confere("sem mesa: o texto de sempre", detalheDosPedidosComDesconto(rb.resumo), "100,0% dos 6 pedidos");
confere("recorte vazio", detalheDosPedidosComDesconto(descontosDoPeriodo([], [], cfg({ cupons: [] })).resumo), "nenhum pedido no recorte");

console.log("\n15) O nome da mesa na lista é o do Vendas por período");
// O Vendas por período usa o label da mesa como está (`label?.trim() || "Mesa N"`);
// aqui se prefixava "Mesa " e a mesa "Mesa 7" saía "Mesa Mesa 7".
confere("sem label: 'Mesa 5'", rotuloDaMesa({ mesa: 5, nome: null }), "Mesa 5");
confere("label 'Mesa 7': como está, sem 'Mesa Mesa 7'", rotuloDaMesa({ mesa: 7, nome: "Mesa 7" }), "Mesa 7");
confere("label 'Varanda': como está, sem 'Mesa Varanda'", rotuloDaMesa({ mesa: 12, nome: " Varanda " }), "Varanda");
confere("label em branco: volta ao número", rotuloDaMesa({ mesa: 3, nome: "   " }), "Mesa 3");
confere("sem número e sem label: 'Mesa'", rotuloDaMesa({ mesa: null, nome: null }), "Mesa");
const rVaranda = descontosDoPeriodo([], [mesa({ id: "mvar", mesa: 12, nome: "Varanda" })], cfg({ cupons: [] }));
confere("…e é o que a linha da lista mostra", rVaranda.lista[0]?.numero, "Varanda");

console.log("\n16) A base do percentual é líquida de todo desconto (decisão do dono)");
// O valor vendido é o que o cliente pagou: sai sem o desconto da loja E sem o
// da plataforma. O desconto do iFood entra no numerador e não na base; o
// pedido 100% subsidiado (total R$ 0) põe desconto sem pôr base. Na NIK,
// 09–16/09/2026: 26,0% sobre o valor vendido × 20,6% sobre o preço cheio.
const SUBSIDIADO = pedido({
  source: "IFOOD", ifoodOrderId: "if-sub", deliveryType: "DELIVERY", totalAmount: 0,
  discountTotal: 30, discountMerchant: 0, discountIfood: 30,
  discountDetails: [{ value: 30, target: "CART", merchant: 0, ifood: 30, description: "CUPOM_IFOOD_100" }],
});
const CHEIO = pedido({ source: "IFOOD", ifoodOrderId: "if-cheio", deliveryType: "DELIVERY", totalAmount: 70 });
const rs = descontosDoPeriodo([SUBSIDIADO, CHEIO], [], cfg({ cupons: [] }));
confere("pedido 100% pago pelo iFood: R$ 30 de desconto sobre R$ 70 vendidos = 42,857% (sobre o preço cheio seriam 30%)",
  [rs.resumo.vendas, rs.resumo.desconto, rs.resumo.plataforma, rs.resumo.pctSobreVendas, rs.resumo.pctLojaSobreVendas], [70, 30, 30, 42.857, 0]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
