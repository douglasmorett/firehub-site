/**
 * "TROCO NAO INFORMADO" na comanda (lib/troco-nao-informado.ts).
 *
 * Delícia de Casa (18/10/2026): o iFood mandou `cash.changeFor: 0` e a comanda
 * não dizia nada de troco — o motoboy chegava no cliente e ligava para a loja.
 *
 *   npx tsx scripts/teste-troco-nao-informado.ts
 *
 * Confere:
 *   1. a regra: entrega da loja em dinheiro sem nota → aviso; troco informado,
 *      Pix online, retirada, mesa, entrega parceira, fiado → nada;
 *   2. o encaixe nos blocos (logo depois do pagamento) e o papel desenhado
 *      pelo código do Assistente (lib/gerado/comanda-do-assistente.ts);
 *   3. a ROTA de verdade (GET /api/store/print-queue) com banco falso:
 *      cozinha sem valores, impressora sem modelo e a via do entregador;
 *   4. o trilho do navegador (lib/print.ts → printOrder) com Assistente falso.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "x";

let ok = 0, falhas = 0;
const confere = (oQue: string, cond: boolean, detalhe?: unknown) => {
  if (cond) ok++;
  else falhas++;
  console.log(`  ${cond ? "✓" : "✗"} ${oQue}${cond || detalhe === undefined ? "" : `\n      → ${JSON.stringify(detalhe)}`}`);
};

const AVISO = "** TROCO NAO INFORMADO **";
const RECADO = "Cliente paga em dinheiro e nao disse para quanto. Levar troco.";

async function main() {
  const T = await import("../src/lib/troco-nao-informado");
  const M = await import("../src/lib/comanda-modelo");
  const { comandaDoAssistente } = await import("../src/lib/gerado/comanda-do-assistente");
  const { lerPapel } = await import("../src/lib/papel-da-impressora");
  const textoDe = (l: any) => l.trechos.map((t: any) => t.texto).join("").trim();

  // ── 1. A REGRA ────────────────────────────────────────────────────────────
  console.log("\n[1] A regra: quando o papel avisa");
  const BASE = { deliveryType: "DELIVERY", source: "IFOOD", paymentMethod: "Dinheiro (Cobrar na Entrega)", totalAmount: 42.9, changeAmount: 0 };
  const caso = (oQue: string, extra: Record<string, unknown>, esperado: boolean) =>
    confere(`${oQue}: ${esperado ? "avisa" : "nada"}`, T.trocoNaoInformado({ ...BASE, ...extra } as any) === esperado);
  caso("iFood, dinheiro, changeFor 0", {}, true);
  caso("site, dinheiro, troco nulo", { source: "SITE", paymentMethod: "Dinheiro", changeAmount: null }, true);
  caso("robô, dinheiro, sem o campo", { source: "WHATSAPP_IA", paymentMethod: "Dinheiro", changeAmount: undefined }, true);
  caso("99Food, dinheiro", { source: "99FOOD", paymentMethod: "Dinheiro (Cobrar na Entrega)" }, true);
  caso("misto Dinheiro + Pix a cobrar", { paymentMethod: "Dinheiro + Pix (Cobrar na Entrega)" }, true);
  caso("dinheiro com troco para R$ 50", { changeAmount: 50 }, false);
  caso("Pix pago online", { paymentMethod: "Pix (Pago Online)", isPrepaid: true }, false);
  caso("cartão na entrega", { paymentMethod: "Crédito (Cobrar na Entrega)" }, false);
  caso("retirada em dinheiro", { deliveryType: "RETIRADA" }, false);
  caso("mesa em dinheiro", { deliveryType: "MESA", source: "PRESENCIAL" }, false);
  caso("entrega parceira (motoboy do iFood)", { deliveryBy: "IFOOD" }, false);
  caso("fiado", { paymentMethod: "Dinheiro (fiado)" }, false);
  caso("recado do cliente \"troco para 100\"", { notes: "Troco para 100 por favor" }, false);

  // ── 2. OS BLOCOS E O PAPEL ────────────────────────────────────────────────
  console.log("\n[2] Os blocos e o papel do Assistente");
  const PEDIDO: any = {
    id: "dc-1", dailyOrderNumber: "77", customerName: "Maria", customerPhone: "61999990000", customerAddress: "Rua B, 2 - Centro",
    deliveryType: "DELIVERY", paymentMethod: "Dinheiro (Cobrar na Entrega)", changeAmount: 0, source: "IFOOD", deliveryBy: "MERCHANT",
    items: [{ name: "Marmita Grande", qty: 1, price: 37.9 }], totalAmount: 42.9, deliveryFee: 5, createdAt: "2026-10-18T19:00:00Z",
  };
  confere("pedido sem aviso: undefined (o papel manda o que mandava)", T.blocosComAvisoDoTroco(undefined, { ...PEDIDO, changeAmount: 50 }) === undefined);
  const fabrica = T.blocosComAvisoDoTroco(undefined, PEDIDO)!;
  confere("sem modelo da loja: o de fábrica, com o aviso logo depois do pagamento",
    JSON.stringify(fabrica.map((b) => b.tipo)) === JSON.stringify(["numeroPedido", "canal", "avisoEntrega", "separador", "loja", "dataHora", "cliente", "entrega", "itens", "totais", "pagamento", "espaco", "separador", "textoRico", "separador", "qrMotoboy", "qrCliente"]),
    fabrica.map((b) => b.tipo));
  const cozinha = T.blocosComAvisoDoTroco(undefined, PEDIDO, { semValores: true })!;
  confere("cozinha sem valores (sem pagamento): o aviso no fim", cozinha.slice(-4).map((b) => b.tipo).join(",") === "espaco,separador,textoRico,separador");

  const papel = lerPapel(comandaDoAssistente({ ...PEDIDO, blocos: fabrica }, "Delicia de Casa", 48, "safe"));
  const t = papel.map(textoDe);
  const iCobrar = t.findIndex((x) => /COBRAR DO CLIENTE NA ENTREGA/.test(x));
  const iAviso = t.indexOf(AVISO);
  confere("sai a tarja depois do \"COBRAR DO CLIENTE NA ENTREGA\"", iCobrar >= 0 && iCobrar < iAviso, { iCobrar, iAviso });
  confere("…em fundo preto e negrito", papel[iAviso]?.trechos.some((x: any) => x.invertido && x.negrito), papel[iAviso]?.trechos);
  confere("…com o recado inteiro", t.slice(iAviso + 1, iAviso + 3).join(" ").includes(RECADO), t.slice(iAviso, iAviso + 4));
  confere("sem \"Troco para:\" (não há nota)", !t.some((x) => /Troco para/.test(x)));
  {
    const c = lerPapel(comandaDoAssistente({ ...PEDIDO, semValores: true, blocos: cozinha }, "Delicia de Casa", 48, "safe")).map(textoDe);
    const i = c.indexOf(AVISO);
    confere("cozinha sem valores: o aviso sai antes do \"-- COMANDA DA COZINHA --\", sem R$", i >= 0 && i < c.indexOf("-- COMANDA DA COZINHA --") && !c.some((x) => /R\$/.test(x)), c);
  }
  {
    const comTroco = lerPapel(comandaDoAssistente({ ...PEDIDO, changeAmount: 50 }, "Delicia de Casa", 48, "safe")).map(textoDe);
    confere("com troco para R$ 50: só o \"Troco para\" de sempre", comTroco.some((x) => /Troco para/.test(x)) && !comTroco.includes(AVISO));
  }
  {
    const p58 = lerPapel(comandaDoAssistente({ ...PEDIDO, blocos: fabrica }, "Delicia de Casa", 32, "safe")).map(textoDe).join(" ");
    confere("em 58 mm (32 colunas) o recado quebra mas sai inteiro", p58.includes("Cliente paga em dinheiro") && p58.includes("Levar troco."));
  }

  // ── 3. A FILA DA NUVEM ────────────────────────────────────────────────────
  console.log("\n[3] Fila da nuvem (GET /api/store/print-queue)");
  const LOJA = "loja_delicia_teste";
  const COZINHA = { id: "c", name: "ELGIN COZINHA", copies: 1, categories: ["Marmitas"], modeloId: M.ID_MODELO_COZINHA, viaDoEntregador: true };
  const BALCAO = { id: "b", name: "ELGIN BALCAO", copies: 1, categories: [] };
  const dono = {
    id: LOJA, printerConfig: { autoprint: true, printers: [COZINHA, BALCAO] }, storeName: "Delícia de Casa", name: "Delícia de Casa",
    slug: "delicia", storeLoyalty: null, city: "Brasília", printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.44" },
  };
  const agora = Date.now();
  const pedidoDoBanco = (id: string, n: number, extra: Record<string, unknown>) => ({
    id, franchiseeId: LOJA, dailyOrderNumber: n, source: "IFOOD", status: "ACEITO", createdAt: new Date(agora - 5_000 - n),
    printedAt: null, parentOrderId: null, deliveryType: "DELIVERY", deliveryBy: "MERCHANT", customerName: "Maria", customerPhone: "61999990000",
    customerAddress: "Rua B, 2 - Centro", paymentMethod: "Dinheiro (Cobrar na Entrega)", changeAmount: 0, totalAmount: 42.9, deliveryFee: 5,
    discountTotal: 0, notes: null, franchisee: { storeName: "Delícia de Casa", name: "Delícia de Casa" }, tableSession: null,
    items: [{ id: `${id}_i1`, orderId: id, menuProductId: null, menuProduct: { name: "Marmita Grande", category: "Marmitas" }, category: "Marmitas", notes: null, quantity: 1, price: 37.9, productName: "Marmita Grande", comboSelections: null }],
    ...extra,
  });
  const pedidos = [
    pedidoDoBanco("cm_sem_troco", 1, {}),
    pedidoDoBanco("cm_troco_50", 2, { changeAmount: 50 }),
    pedidoDoBanco("cm_pix", 3, { paymentMethod: "Pix (Pago Online)", isPrepaid: true }),
  ];
  const vazio = (metodo: string) => async () =>
    metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
  const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
  (globalThis as any).prisma = new Proxy(
    {
      user: tabela({ findUnique: async ({ where }: any) => (where?.id === LOJA ? dono : null), update: async () => dono }),
      customerOrder: tabela({ findMany: async ({ where }: any) => (where?.franchiseeId === LOJA ? pedidos : []) }),
      printRequest: tabela({ findMany: async () => [] }),
    },
    { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
  );
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.44&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.6" } }));
  const { jobs } = (await res.json()) as { jobs: any[] };
  const papelDoDestino = (job: any, nome: string) => {
    const d = job.destinos.find((x: any) => x.printer === nome);
    return lerPapel(comandaDoAssistente({
      ...job.order,
      items: Array.isArray(d.items) ? d.items : job.order?.items,
      blocos: Array.isArray(d.blocos) && d.blocos.length ? d.blocos : job.order?.blocos,
      semValores: d.semValores === true || job.order?.semValores === true,
    }, "Delicia de Casa", 48, "safe")).map(textoDe);
  };
  const job = (id: string) => jobs.find((j) => j?.order?.id === id);
  const sem = job("cm_sem_troco");
  confere("a fila entrega o pedido sem troco para as duas impressoras", sem?.destinos?.length === 2, sem?.destinos?.map((d: any) => d.printer));
  if (sem) {
    confere("COZINHA (sem valores): leva o aviso", papelDoDestino(sem, "ELGIN COZINHA").includes(AVISO));
    confere("BALCAO (sem modelo próprio): leva o aviso", papelDoDestino(sem, "ELGIN BALCAO").includes(AVISO));
    confere("o pedido inteiro (Assistente sem destinos) também leva", (sem.order.blocos || []).some((b: any) => b.tipo === "textoRico"));
  }
  const via = jobs.find((j) => String(j?.order?.id || "").startsWith("cm_sem_troco") && j.order.id !== "cm_sem_troco");
  confere("VIA DO ENTREGADOR: sai, e com o aviso", !!via && papelDoDestino(via, "ELGIN COZINHA").includes(AVISO), via?.order?.id);
  for (const [id, oQue] of [["cm_troco_50", "troco para R$ 50"], ["cm_pix", "Pix pago online"]] as const) {
    const j = job(id);
    confere(`${oQue}: nenhum papel com o aviso, e nada de blocos novos`,
      !!j && !j.destinos.some((d: any) => papelDoDestino(j, d.printer).includes(AVISO)) && !j.order.blocos && !j.destinos.find((d: any) => d.printer === "ELGIN BALCAO").blocos);
  }

  // ── 4. O NAVEGADOR ────────────────────────────────────────────────────────
  console.log("\n[4] Painel (lib/print.ts → printOrder)");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.44" }), { status: 200 });
    if (u.endsWith("/print")) { enviados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response("[]", { status: 200 });
  };
  const { printOrder } = await import("../src/lib/print");
  const naTela = {
    id: "dc-2", dailyOrderNumber: "78", customerName: "Maria", deliveryType: "DELIVERY", source: "IFOOD", deliveryBy: "MERCHANT",
    paymentMethod: "Dinheiro (Cobrar na Entrega)", changeAmount: 0, customerAddress: "Rua B, 2 - Centro",
    items: [{ name: "Marmita Grande", qty: 1, price: 37.9, category: "Marmitas" }], totalAmount: 42.9, deliveryFee: 5, createdAt: new Date().toISOString(),
  };
  const temAviso = (b: any) => (b?.order?.blocos || []).some((x: any) => x.tipo === "textoRico" && x.linhas?.[0]?.partes?.[0]?.texto === AVISO);
  await (printOrder as any)(naTela, "Delicia de Casa", { autoprint: true, printers: [COZINHA, BALCAO] }, {}, false);
  confere("COZINHA, BALCAO e a via do entregador: os três com o aviso",
    enviados.length === 3 && enviados.every(temAviso) && enviados.some((b) => String(b.order.id).endsWith(String(naTela.id)) === false), enviados.map((b) => [b.printer, b.order.id, temAviso(b)]));
  for (const [oQue, extra] of [
    ["troco para R$ 50", { changeAmount: 50 }],
    ["Pix pago online", { paymentMethod: "Pix (Pago Online)" }],
    ["retirada", { deliveryType: "RETIRADA" }],
    ["mesa", { deliveryType: "MESA", source: "PRESENCIAL" }],
  ] as const) {
    enviados.length = 0;
    await (printOrder as any)({ ...naTela, id: `dc-${oQue}`, ...extra }, "Delicia de Casa", { autoprint: true, printers: [COZINHA, BALCAO] }, {}, false);
    confere(`${oQue}: nenhum papel com o aviso`, enviados.length > 0 && !enviados.some(temAviso), enviados.map((b) => [b.printer, temAviso(b)]));
  }
}

main()
  .catch((e) => { falhas++; console.error("✗ erro:", e); })
  .finally(() => {
    console.log(falhas ? `\n✗ ${falhas} falha(s), ${ok} ok` : `\n✓ tudo certo (${ok})`);
    process.exit(falhas ? 1 : 0);
  });
