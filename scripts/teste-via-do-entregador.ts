/**
 * Trava a VIA DO ENTREGADOR e o resgate do módulo na fila da nuvem.
 *
 *   npx tsx scripts/teste-via-do-entregador.ts
 *
 * O caso é o da Ragnar Burger em 27/09/2026. O Fabiano: "quando a gente tira o
 * pedido pela IA só sai a comanda do motoboy, e sem o QR. Queria que saísse a
 * resumida, a ordem de serviço, e a nota do motoboy com QR code". A cozinha
 * fica com o modelo "Cozinha sem valores" e a impressora marcada imprime, além
 * dela, a via completa com o QR. O cadastro abaixo é o da loja em 24/09
 * (scripts/teste-roteamento-de-impressao.ts), com a via ligada na pizza.
 *
 * A segunda parte simula o PAINEL (lib/print.ts) com um Assistente falso e
 * confere o que chega em cada POST /print.
 */
import { destinosDoPedido, impressoraDaViaDoEntregador, SUFIXO_DA_VIA_DO_ENTREGADOR, type ImpressoraConfigurada } from "../src/lib/roteamento-de-impressao";
import { camposDoQrPuxar, ehEntregaDaLoja } from "../src/lib/qr-puxar";
import { blocosDaViaDoEntregador, ID_MODELO_COZINHA } from "../src/lib/comanda-modelo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = "cmtkosykk01jhk601arcsnu48";
const IFOOD_PIZZA = "ea2c4d55-efd2-4fa7-8aa7-fc1ecd6b8d52";
const IFOOD_BURGER = "469a9863-bf71-46ad-8c3e-2474b7cbe46b";

const RAGNAR: ImpressoraConfigurada[] = [
  { name: "BALCAO", modulos: ["salao"], categories: ["Cerveja", "Entretenimento e Presentes"] },
  { name: "COZINHA PIZZA", lojas: [`ifood:${IFOOD_PIZZA}`, `loja:${LOJA}`], modulos: ["delivery", "salao"], categories: ["Pizzas Especiais", "Pizzas Premium", "Pizzas Tradicionais", "Sucos", "Sobremesas", "Refrigerantes"], modeloId: ID_MODELO_COZINHA, viaDoEntregador: true },
  { name: "COZINHA ENTREGA RAGNA", lojas: [`ifood:${IFOOD_BURGER}`, "ifood:17ce82cb-a22b-42f4-b95e-6b912c4ad278", `loja:${LOJA}`], modulos: ["delivery", "salao"], categories: ["Burgers", "Adicionais Burger", "Combos", "Entradas", "Refrigerantes"], modeloId: ID_MODELO_COZINHA },
  { name: "BAR", lojas: [`loja:${LOJA}`], modulos: ["salao", "delivery"], categories: ["Drinks", "Refrigerantes"] },
];

// O pedido #50 da foto: pizza meio a meio e Coca 1,5 L, pelo robô, entrega.
const PEDIDO_50 = {
  id: "cmpedido50ragnar000000000",
  franchiseeId: LOJA,
  source: "WHATSAPP_IA",
  deliveryType: "DELIVERY",
  dailyOrderNumber: 50,
  createdAt: "2026-09-27T23:30:00.000Z",
  customerName: "Socorro",
  items: [
    { name: "Pizza Frango Catupiry", category: "Pizzas Tradicionais", qty: 1, price: 79.9 },
    { name: "Coca-Cola Sem Açúcar 1,5 L", category: "Refrigerantes", qty: 1, price: 15 },
  ],
  totalAmount: 103.9,
  paymentMethod: "Pix (COBRAR NA ENTREGA)",
};

const nome = (i: ImpressoraConfigurada | null) => (i ? i.name : null);

console.log("\n— Em qual impressora sai a via do entregador —");

confere("#50 do robô (entrega da loja): na COZINHA PIZZA, a marcada", nome(impressoraDaViaDoEntregador(RAGNAR, PEDIDO_50)), "COZINHA PIZZA");
confere("Pedido do site, entrega: idem", nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, source: "ONLINE" })), "COZINHA PIZZA");
confere("Retirada: sem via", nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, deliveryType: "RETIRADA" })), null);
confere("Mesa: sem via", nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, source: "PRESENCIAL", deliveryType: "MESA" })), null);
confere(
  "iFood com entregador do iFood: sem via (não é o motoboy da loja)",
  nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, source: "IFOOD", deliveryBy: "IFOOD", ifoodStoreMerchant: IFOOD_PIZZA })),
  null
);
confere(
  "iFood da pizzaria com motoboy da loja: via na COZINHA PIZZA",
  nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, source: "IFOOD", deliveryBy: "MERCHANT", ifoodStoreMerchant: IFOOD_PIZZA })),
  "COZINHA PIZZA"
);
confere(
  "iFood do burger com motoboy da loja: a pizza não atende essa marca, e nenhuma outra está marcada",
  nome(impressoraDaViaDoEntregador(RAGNAR, { ...PEDIDO_50, source: "IFOOD", deliveryBy: "MERCHANT", ifoodStoreMerchant: IFOOD_BURGER })),
  null
);

const DUAS_MARCADAS = RAGNAR.map((p) => (p.name === "COZINHA ENTREGA RAGNA" ? { ...p, viaDoEntregador: true } : p));
confere("Duas marcadas: sai numa só, a primeira da lista", nome(impressoraDaViaDoEntregador(DUAS_MARCADAS, PEDIDO_50)), "COZINHA PIZZA");
confere(
  "Duas marcadas, iFood do burger: a do burger, que atende a marca",
  nome(impressoraDaViaDoEntregador(DUAS_MARCADAS, { ...PEDIDO_50, source: "IFOOD", deliveryBy: "MERCHANT", ifoodStoreMerchant: IFOOD_BURGER })),
  "COZINHA ENTREGA RAGNA"
);
confere("Nenhuma marcada: sem via (como sempre foi)", nome(impressoraDaViaDoEntregador(RAGNAR.map(({ viaDoEntregador, ...p }) => p), PEDIDO_50)), null);

console.log("\n— A comanda de cada impressora não muda —");

const papel = (impressoras: ImpressoraConfigurada[], p: any) =>
  Object.fromEntries(destinosDoPedido(impressoras, p).map((d) => [d.impressora.name, d.itens.map((i: any) => i.name)]));

confere(
  "#50: pizza e Coca na pizza, a Coca também no burger e no bar (cadastro da loja)",
  papel(RAGNAR, PEDIDO_50),
  { "COZINHA PIZZA": ["Pizza Frango Catupiry", "Coca-Cola Sem Açúcar 1,5 L"], "COZINHA ENTREGA RAGNA": ["Coca-Cola Sem Açúcar 1,5 L"], BAR: ["Coca-Cola Sem Açúcar 1,5 L"] }
);

console.log("\n— Resgate do módulo na fila da nuvem (igual ao painel) —");

const SO_SALAO: ImpressoraConfigurada[] = [
  { name: "COZINHA", modulos: ["salao"], categories: ["Lanches"] },
  { name: "CAIXA", modulos: ["salao"], categories: [] },
];
confere(
  "Todas em \"Balcão e mesa\", delivery do robô: roteia por categoria em vez de sumir",
  papel(SO_SALAO, { source: "WHATSAPP_IA", items: [{ name: "X-Tudo", category: "Lanches" }, { name: "Coca", category: "Bebidas" }] }),
  { COZINHA: ["X-Tudo"], CAIXA: ["X-Tudo", "Coca"] }
);
confere(
  "Com uma impressora de delivery, as de salão continuam fora",
  papel([...SO_SALAO, { name: "DELIVERY", modulos: ["delivery"], categories: [] }], { source: "WHATSAPP_IA", items: [{ name: "X-Tudo", category: "Lanches" }] }),
  { DELIVERY: ["X-Tudo"] }
);

console.log("\n— QR e modelo da via —");

confere("QR do #50", camposDoQrPuxar(PEDIDO_50, "ragnar-burger"), {
  qrPuxarCodigo: "20260927-50",
  qrPuxarUrl: "https://firehubfood.com.br/loja/ragnar-burger/motoboy?p=20260927-50",
});
confere("Mesa continua sem QR", camposDoQrPuxar({ ...PEDIDO_50, source: "PRESENCIAL", deliveryType: "MESA" }, "ragnar-burger"), {});
confere("Sem número continua sem QR", camposDoQrPuxar({ ...PEDIDO_50, dailyOrderNumber: null }, "ragnar-burger"), {});
confere("ehEntregaDaLoja: robô sim, retirada não", [ehEntregaDaLoja(PEDIDO_50), ehEntregaDaLoja({ ...PEDIDO_50, deliveryType: "RETIRADA" })], [true, false]);
confere("Loja que nunca personalizou: sem blocos (layout embutido, que termina no QR)", blocosDaViaDoEntregador({}), undefined);
const semQr = { comandaModelo: { versao: 1, cozinha: [{ tipo: "itens" }], completo: [{ tipo: "itens" }, { tipo: "totais" }] } };
confere("Modelo da loja sem o bloco do QR: a via ganha o QR no fim", blocosDaViaDoEntregador(semQr)?.map((b) => b.tipo), ["itens", "totais", "avisoEntrega", "qrMotoboy"]);

// ── O PAINEL (lib/print.ts) com um Assistente falso ─────────────────────────
async function painel() {
  console.log("\n— Painel: o que chega ao Assistente —");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.27" }), { status: 200 });
    if (u.endsWith("/print")) {
      enviados.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const { printOrder } = await import("../src/lib/print");
  const config: any = { autoprint: true, printers: RAGNAR, storeSlug: "ragnar-burger" };
  await printOrder(PEDIDO_50 as any, "RAGNAR BURGER", config, {}, false);

  const resumo = enviados.map((b) => ({
    impressora: b.printer,
    id: b.order.id,
    itens: b.order.items.length,
    semValores: b.order.semValores === true || undefined,
    // O QR só sai no papel com o código E, quando há modelo, com o bloco dele.
    qr: b.order.qrPuxarCodigo && (!b.order.blocos || b.order.blocos.some((x: any) => x.tipo === "qrMotoboy"))
      ? b.order.qrPuxarCodigo
      : undefined,
  }));
  confere(
    "#50 pelo painel: três comandas da cozinha sem QR e a via do entregador completa com QR",
    resumo,
    [
      { impressora: "COZINHA PIZZA", id: PEDIDO_50.id, itens: 2, semValores: true },
      { impressora: "COZINHA ENTREGA RAGNA", id: PEDIDO_50.id, itens: 1, semValores: true },
      { impressora: "BAR", id: PEDIDO_50.id, itens: 1, qr: "20260927-50" },
      { impressora: "COZINHA PIZZA", id: PEDIDO_50.id + SUFIXO_DA_VIA_DO_ENTREGADOR, itens: 2, qr: "20260927-50" },
    ]
  );

  enviados.length = 0;
  await printOrder(PEDIDO_50 as any, "RAGNAR BURGER", config, {}, true, true);
  confere("\"Cupom da cozinha\" não imprime a via", enviados.some((b) => String(b.order.id).endsWith(SUFIXO_DA_VIA_DO_ENTREGADOR)), false);

  enviados.length = 0;
  await printOrder({ ...PEDIDO_50, source: "PRESENCIAL", deliveryType: "MESA" } as any, "RAGNAR BURGER", config, {}, false);
  confere("Mesa: nenhuma via", enviados.some((b) => String(b.order.id).endsWith(SUFIXO_DA_VIA_DO_ENTREGADOR)), false);
}

painel()
  .catch((e) => { falhas++; console.error("❌ painel:", e); })
  .finally(() => {
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
    process.exit(falhas ? 1 : 0);
  });
