/**
 * A fila da nuvem com "Separados": o que o Assistente RECEBE e o papel que ele
 * desenha com isso.
 *
 * Frangoso, 16/10/2026: a impressora está em "Separados", e o #1 da Brendi
 * (2x "2 Burguers por 29,99" com Onion Rings e Frangoso) saiu
 * "2x 2 Burguers / - 2x Onion Rings Burguer / - 2x Frangoso". O Assistente
 * monta o pedido de cada destino sem a marca `separarItens` (server.js, o laço
 * dos `destinos`) — só a reimpressão pelo painel saía separada. Agora o
 * servidor manda os itens do destino já uma linha por unidade.
 *
 *   npx tsx scripts/teste-fila-separados.ts
 *
 * Roda a ROTA de verdade (GET /api/store/print-queue) contra um banco falso em
 * memória (o `globalThis.prisma` que lib/prisma usa) e desenha o papel com o
 * código do Assistente (lib/gerado/comanda-do-assistente). Nada vai a banco.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "segredo-so-do-teste-da-fila";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

// ── Banco falso: a Frangoso e o #1 de 16/10, como estão no banco ───────────
const LOJA = "loja_frangoso_teste";
const impressora = (separarItens: boolean) => ({
  id: "1790215697598", name: "ELGIN i7(USB)", label: "Impressora 1", copies: 1,
  modulos: ["salao", "delivery"], categories: [], paperWidth: "80mm", separarItens,
});
const dono = (separarItens: boolean) => ({
  id: LOJA,
  printerConfig: { printers: [impressora(separarItens)], autoprint: true, customBeverageKeywords: "guaramor" },
  storeName: "Frangoso - Trindade", name: "Lucas", slug: "frangoso-trindade", storeLoyalty: null, city: "SAO GONCALO",
  printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.34" },
});
const pedido1 = () => ({
  id: "cm_pedido_frangoso_1", franchiseeId: LOJA, dailyOrderNumber: 1, source: "BRENDI", status: "ACEITO",
  createdAt: new Date(Date.now() - 5_000), printedAt: null, parentOrderId: null, deliveryType: "DELIVERY",
  customerName: "Cliente", customerPhone: "21999999999", customerAddress: "Rua Antônio Gonçalves Dias, 37 - Porto Novo - São Gonçalo",
  paymentMethod: "Pix", totalAmount: 95.97, deliveryFee: 0, discountTotal: 0, notes: null,
  openDeliveryOrderId: "c319cb79-3e33-4787-aa9a-26dca18b6740", openDeliveryReference: "1001", openDeliveryChannel: "BRENDI",
  franchisee: { storeName: "Frangoso - Trindade", name: "Lucas" }, tableSession: null,
  items: [
    { id: "it1", orderId: "cm_pedido_frangoso_1", menuProductId: null, menuProduct: null, notes: null, quantity: 2, price: 35.99,
      productName: "2 Burguers por 29,99 | Onion Rings Burguer  | Frangoso",
      comboSelections: [
        { id: "5b498ccf-2380-40e1-9057-f8c3b53e2430", name: "Onion Rings Burguer ", quantity: 1, price: 3 },
        { id: "5174a0cb-d850-4140-a6b8-1cbcb345ad98", name: "Frangoso", quantity: 1, price: 3 },
      ] },
    { id: "it2", orderId: "cm_pedido_frangoso_1", menuProductId: null, menuProduct: null, notes: null, quantity: 1, price: 23.99, productName: "SalzBurg", comboSelections: null },
  ],
});

let separarNaLoja = true;
const vazio = (metodo: string) => async () =>
  metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
const tabela = (feitos: Record<string, any> = {}) =>
  new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
(globalThis as any).prisma = new Proxy(
  {
    user: tabela({
      findUnique: async ({ where }: any) => (where?.id === LOJA ? dono(separarNaLoja) : null),
      update: async () => dono(separarNaLoja),
    }),
    customerOrder: tabela({
      findMany: async ({ where }: any) => (where?.franchiseeId === LOJA ? [pedido1()] : []),
    }),
  },
  { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
);

async function main() {
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const { comandaDoAssistente } = await import("../src/lib/gerado/comanda-do-assistente");

  const texto = (b: unknown) => String(b).replace(/[\x00-\x09\x0B-\x1F]./g, "").replace(/[^\x20-\x7E\n]/g, "");
  const doResumo = (b: unknown) => texto(b).split("\n").map((l) => l.trim()).filter((x) => /^\d+x |^- /.test(x));
  const valores = (b: unknown) => texto(b).split("\n").map((l) => l.trim()).filter((x) => /(Subtotal|otal):/.test(x)).join(" | ");

  /**
   * O que o Assistente faz com cada destino (server.js, o laço dos `destinos`):
   * o pedido do job, com os itens DO destino — e sem `separarItens`, que ele
   * não copia. É exatamente o trilho que imprimiu a foto do Lucas.
   */
  const papelDoAssistente = (job: any, destino: any) =>
    comandaDoAssistente({ ...job.order, items: Array.isArray(destino.items) ? destino.items : job.order?.items, somenteBebidas: destino.somenteBebidas === true }, "Frangoso", 48);

  const consultar = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.34&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
    return (await res.json()) as { jobs: any[] };
  };

  console.log("\n[1] Frangoso com \"Separados\": o #1 pela fila da nuvem");
  separarNaLoja = true;
  const { jobs } = await consultar();
  const job = jobs.find((j) => String(j?.order?.id || j?.id || "").includes("cm_pedido_frangoso_1"));
  confere(!!job, "a fila entrega o pedido");
  const destino = job?.destinos?.[0];
  confere(destino?.printer === "ELGIN i7(USB)", "um destino: a ELGIN i7(USB)");
  const qtds = (destino?.items || []).map((i: any) => Number(i.qty || i.quantity || 1));
  confere(qtds.length === 3 && qtds.every((q: number) => q === 1), `os itens do destino já vêm um por unidade (${qtds.join(", ")})`);
  const papel = papelDoAssistente(job, destino);
  const linhas = doResumo(papel);
  console.log("  papel →", linhas.join(" | "));
  confere(linhas.filter((x) => /^1x 2 Burguers por 29,99/.test(x)).length === 2, "duas linhas '1x 2 Burguers por 29,99'");
  confere(linhas.filter((x) => /^- Onion Rings Burguer/.test(x)).length === 2 && linhas.filter((x) => /^- Frangoso/.test(x)).length === 2, "Onion Rings e Frangoso uma vez em cada combo");
  confere(!linhas.some((x) => /^[2-9]\d*x |^- \d+x /.test(x)), "nenhum '2x' no papel");
  confere(linhas.filter((x) => /^1x SalzBurg/.test(x)).length === 1, "o SalzBurg sai uma vez");
  confere(/R\$ 95,97/.test(valores(papel)), `o total continua R$ 95,97 (${valores(papel)})`);
  confere(job?.order?.items?.[0]?.quantity === 2, "o pedido inteiro do job continua com '2x' (via do entregador, conta: a mesma de sempre)");

  console.log("\n[2] A mesma loja em \"Agrupados\": nada muda");
  separarNaLoja = false;
  // A config da loja fica 10 s em memória na fila (lib/cache-curto.ts): aqui
  // é como se a troca tivesse sido feita há mais de 10 s.
  (await import("../src/lib/cache-curto")).esquecerTudo();
  const r2 = await consultar();
  const job2 = r2.jobs.find((j) => String(j?.order?.id || j?.id || "").includes("cm_pedido_frangoso_1"));
  const linhas2 = doResumo(papelDoAssistente(job2, job2?.destinos?.[0]));
  console.log("  papel →", linhas2.join(" | "));
  confere(linhas2.some((x) => /^2x 2 Burguers por 29,99/.test(x)) && linhas2.some((x) => /^- 2x Onion Rings/.test(x)), "agrupado continua '2x 2 Burguers / - 2x Onion Rings'");

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
