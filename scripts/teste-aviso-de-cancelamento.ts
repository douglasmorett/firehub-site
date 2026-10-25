/**
 * "PEDIDO CANCELADO" na impressora marcada (lib/aviso-de-cancelamento.ts,
 * opção `avisoDeCancelamento` da impressora). Ragnar, 24/10/2026.
 *
 *   npx tsx scripts/teste-aviso-de-cancelamento.ts
 *
 * Confere:
 *   1. a regra: só o pedido que chegou na cozinha e foi cancelado até 60 min depois;
 *   2. o papel desenhado pelo código do Assistente (tarja, motivo, itens, sem R$);
 *   3. a ROTA (GET /api/store/print-queue) com banco falso: cria uma vez, sai só
 *      na impressora marcada, e a segunda consulta não cria de novo.
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

async function main() {
  const A = await import("../src/lib/aviso-de-cancelamento");
  const { comandaDoAssistente } = await import("../src/lib/gerado/comanda-do-assistente");
  const { lerPapel } = await import("../src/lib/papel-da-impressora");
  const textoDe = (l: any) => l.trechos.map((t: any) => t.texto).join("").trim();

  // ── 1. A REGRA ──────────────────────────────────────────────────────────
  console.log("\n[1] Regra");
  const t0 = new Date("2026-10-24T23:00:00Z");
  const min = (m: number) => new Date(t0.getTime() + m * 60_000);
  confere("impresso e cancelado 20 min depois: avisa", A.pedidoPedeAvisoDeCancelamento({ createdAt: t0, cancelledAt: min(20), printedAt: min(1) }));
  confere("no KDS (Ragnar, imprime só no fim): avisa", A.pedidoPedeAvisoDeCancelamento({ createdAt: t0, cancelledAt: min(25), kdsStage: "PRODUCTION" }));
  confere("nunca chegou na cozinha: não avisa", !A.pedidoPedeAvisoDeCancelamento({ createdAt: t0, cancelledAt: min(5), printedAt: null, kdsStage: null }));
  confere("cancelado 1h30 depois (limpeza do quadro): não avisa", !A.pedidoPedeAvisoDeCancelamento({ createdAt: t0, cancelledAt: min(90), printedAt: min(1), kdsStage: "PRODUCTION" }));
  confere("sem hora de cancelamento: não avisa", !A.pedidoPedeAvisoDeCancelamento({ createdAt: t0, cancelledAt: null, printedAt: min(1) }));
  const imps = A.impressorasDoAvisoDeCancelamento([
    { name: "COZINHA", avisoDeCancelamento: true }, { name: "BAR" }, { name: "COZINHA", avisoDeCancelamento: true }, { name: "", avisoDeCancelamento: true },
  ] as any);
  confere("só as marcadas, uma vez por nome", imps.map((p) => p.name).join(",") === "COZINHA", imps);

  // ── 2. O PAPEL ──────────────────────────────────────────────────────────
  console.log("\n[2] Papel");
  const ORDEM: any = {
    id: "cancelamento_cm1", dailyOrderNumber: "13", customerName: "Ana", customerPhone: "21999990000", customerAddress: "Rua A, 1 - Centro",
    deliveryType: "DELIVERY", paymentMethod: "PIX", source: "IFOOD", items: [{ name: "X-Bacon", qty: 2, price: 30 }],
    totalAmount: 60, createdAt: t0.toISOString(), cancelledAt: min(20).toISOString(), cancelReason: "Cliente desistiu",
  };
  const papel = lerPapel(comandaDoAssistente({ ...ORDEM, semValores: true, blocos: A.blocosDoAvisoDeCancelamento(ORDEM) }, "Ragnar", 48, "safe"));
  const t = papel.map(textoDe).filter(Boolean);
  for (const x of t) console.log(`      |${x}`);
  const i = t.indexOf("*** PEDIDO CANCELADO ***");
  confere("começa com a tarja, invertida", i === 0 && !!papel.find((l: any) => textoDe(l) === t[0])?.trechos.some((x: any) => x.invertido), t[0]);
  confere("NAO PREPARAR / hora / motivo", t[1] === "NAO PREPARAR / NAO ENVIAR" && t[2] === "Cancelado as 20:20" && t[3] === "Motivo: Cliente desistiu", t.slice(1, 4));
  confere("leva o número e o item", t.some((x) => /13/.test(x)) && t.some((x) => /2x X-Bacon/.test(x)));
  confere("termina com a tarja de novo", t[t.length - 1] === "Cancelado as 20:20" || t.lastIndexOf("*** PEDIDO CANCELADO ***") > i, t.slice(-4));
  confere("sem R$", !t.some((x) => /R\$/.test(x)));

  // ── 3. A FILA DA NUVEM ──────────────────────────────────────────────────
  console.log("\n[3] Fila da nuvem");
  const LOJA = "loja_ragnar_teste";
  const dono = {
    id: LOJA, storeName: "Ragnar", name: "Ragnar", slug: "ragnar", storeLoyalty: null, city: "Rio das Ostras",
    printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.46" },
    printerConfig: { autoprint: true, printers: [
      { id: "p", name: "COZINHA PIZZA", categories: ["Pizzas"], avisoDeCancelamento: true },
      { id: "a", name: "COZINHA ENTREGA", categories: ["Burgers"], avisoDeCancelamento: true },
      { id: "b", name: "BAR", categories: ["Bebidas"] },
    ] },
  };
  const agora = Date.now();
  const cancelado = {
    id: "cm_cancel1", franchiseeId: LOJA, dailyOrderNumber: 13, source: "IFOOD", status: "CANCELADO",
    createdAt: new Date(agora - 20 * 60_000), cancelledAt: new Date(agora - 30_000), cancelReason: null,
    printedAt: null, printedNaChegadaAt: null, kdsStage: "PRODUCTION", parentOrderId: null, deliveryType: "DELIVERY",
    customerName: "Ana", customerPhone: "21999990000", customerAddress: "Rua A, 1 - Centro", paymentMethod: "Pix", totalAmount: 60,
    tableSession: null,
    items: [{ id: "i1", orderId: "cm_cancel1", menuProduct: { id: "mp1", active: true, name: "X-Bacon", category: "Burgers" }, category: "Burgers", quantity: 2, price: 30, productName: "X-Bacon", comboSelections: null }],
  };
  const guardados: any[] = [];
  let criacoes = 0;
  const vazio = (metodo: string) => async () =>
    metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
  const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
  (globalThis as any).prisma = new Proxy(
    {
      user: tabela({ findUnique: async ({ where }: any) => (where?.id === LOJA ? dono : null), update: async () => dono }),
      customerOrder: tabela({
        findMany: async ({ where }: any) => {
          if (where?.status?.in?.includes("CANCELADO")) return [cancelado];
          if (where?.id?.in) return where.id.in.includes(cancelado.id) ? [cancelado] : [];
          return [];
        },
      }),
      printRequest: tabela({
        findMany: async ({ where }: any) =>
          where?.id?.in ? guardados.filter((g) => where.id.in.includes(g.id)) : guardados.filter((g) => !g.printedAt),
        createMany: async ({ data }: any) => {
          criacoes++;
          for (const d of data) if (!guardados.some((g) => g.id === d.id)) guardados.push({ ...d, createdAt: new Date(), printedAt: null });
          return { count: data.length };
        },
      }),
    },
    { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
  );
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const consultar = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.46&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
    return ((await res.json()) as { jobs: any[] }).jobs || [];
  };
  const jobs = await consultar();
  const job = jobs.find((j) => j?.id === "job_cancelamento_cm_cancel1");
  confere("o papel nasceu em PrintRequest com id fixo", guardados.length === 1 && guardados[0].id === "cancelamento_cm_cancel1" && guardados[0].kind === "CANCELAMENTO", guardados.map((g) => g.id));
  confere("burger cancelado: o aviso sai só na cozinha do burger (a da pizza também está marcada)", job?.destinos?.map((d: any) => d.printer).join(",") === "COZINHA ENTREGA", job?.destinos?.map((d: any) => d.printer));
  confere("…com a tarja no destino e sem valores", job?.destinos?.[0]?.blocos?.[0]?.linhas?.[0]?.partes?.[0]?.texto === "*** PEDIDO CANCELADO ***" && job?.destinos?.[0]?.semValores === true);
  confere("…e id próprio no pedido (não o do pedido original)", job?.order?.id === "cancelamento_cm_cancel1", job?.order?.id);
  confere("o pedido cancelado não vira comanda normal", !jobs.some((j) => j?.id === "job_cm_cancel1"));
  await consultar();
  confere("segunda consulta não cria outro papel", criacoes === 1 && guardados.length === 1, { criacoes, n: guardados.length });

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
