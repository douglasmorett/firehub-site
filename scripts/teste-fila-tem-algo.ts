/**
 * scripts/teste-fila-tem-algo.ts — a fila do Assistente (GET
 * /api/store/print-queue) pula as consultas quando a pré-consulta diz "nada
 * novo" (lib/fila-tem-algo.ts), e o pedido novo SEMPRE sai.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-fila-tem-algo.ts
 *
 * Roda a ROTA de verdade contra um banco falso em memória. A pré-consulta do
 * banco falso responde com o MESMO recorte do SQL (loja, sem printedAt, sem
 * acréscimo, status, janela).
 *
 * Com PROVA_NO_BANCO=1 e um DATABASE_URL de verdade (de preferência numa
 * sessão só de leitura), confere também o SQL no Postgres: para as lojas com
 * Assistente ativo e várias janelas, a resposta do SQL é IGUAL à contagem do
 * Prisma com o mesmo recorte, e nunca "não" quando a consulta da rota acharia
 * pedido. Só LÊ o banco.
 */
export {};

const PROVA_NO_BANCO = process.env.PROVA_NO_BANCO === "1";
if (!PROVA_NO_BANCO) process.env.DATABASE_URL = "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "segredo-so-do-teste-da-fila";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

const LOJA = "loja_fila_teste";
const NAO_ENTRAM = ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO", "CANCELADO", "CANCELLED", "CANCELED"];
const dono = () => ({
  id: LOJA,
  printerConfig: { printers: [{ id: "1", name: "ELGIN i9", label: "Cozinha", copies: 1, modulos: ["salao", "delivery"], categories: [], paperWidth: "80mm" }], autoprint: true },
  storeName: "Loja da Fila", name: "Dono", slug: "loja-da-fila", storeLoyalty: null, city: "MACAE",
  printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.34" },
});
const pedido = (id: string, p: Partial<any> = {}) => ({
  id, franchiseeId: LOJA, dailyOrderNumber: 7, source: "SITE", status: "NOVO",
  createdAt: new Date(), printedAt: null, parentOrderId: null, kdsFinishedAt: null, deliveryType: "DELIVERY",
  customerName: "Cliente", customerPhone: "22999999999", customerAddress: "Rua A, 1 - Centro - Macaé",
  paymentMethod: "Pix", totalAmount: 40, deliveryFee: 5, discountTotal: 0, notes: null,
  franchisee: { storeName: "Loja da Fila", name: "Dono" }, tableSession: null,
  items: [{ id: `${id}_i1`, orderId: id, menuProductId: null, menuProduct: null, notes: null, quantity: 1, price: 35, productName: "X-Burger", comboSelections: null }],
  ...p,
});

let pedidos: any[] = [];
let avulsas: any[] = [];
let preConsultaQuebrada = false;
const chamadas = { preConsulta: 0, pedidos: 0, avulsas: 0 };

/** A pré-consulta do banco falso: o mesmo recorte do SQL de lib/fila-tem-algo.ts. */
function responderPreConsulta(sql: any) {
  chamadas.preConsulta++;
  if (preConsultaQuebrada) throw new Error("banco falso: pré-consulta quebrada de propósito");
  const v: any[] = sql.values;
  // Ordem dos parâmetros no SQL: loja, status, janela (1 ou 2×), loja, início da avulsa.
  const [loja, status, desde] = [v[0], v[1] as string[], new Date(v[2])];
  const peloFimDoKds = /kdsFinishedAt/.test(sql.text);
  const desdeDaAvulsa = new Date(v[v.length - 1]);
  const temPedido = pedidos.some((p) =>
    p.franchiseeId === loja && p.parentOrderId == null && p.printedAt == null && !status.includes(p.status) &&
    (p.createdAt > desde || (peloFimDoKds && p.kdsFinishedAt && p.kdsFinishedAt > desde)));
  const temAvulsa = avulsas.some((a) => a.franchiseeId === loja && a.createdAt > desdeDaAvulsa && a.printedAt == null);
  return [{ pedidos: temPedido, avulsas: temAvulsa }];
}

if (!PROVA_NO_BANCO) {
  const vazio = (metodo: string) => async () =>
    metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
  const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
  (globalThis as any).prisma = new Proxy(
    {
      user: tabela({ findUnique: async ({ where }: any) => (where?.id === LOJA ? dono() : null), update: async () => dono() }),
      customerOrder: tabela({
        findMany: async ({ where, include }: any) => {
          if (!include?.items) return [];
          chamadas.pedidos++;
          const desde = where?.OR?.[0]?.createdAt?.gt as Date;
          return pedidos.filter((p) => p.franchiseeId === where.franchiseeId && p.printedAt == null && p.createdAt > desde && !NAO_ENTRAM.includes(p.status));
        },
      }),
      printRequest: tabela({
        findMany: async ({ where }: any) => { chamadas.avulsas++; return avulsas.filter((a) => a.franchiseeId === where.franchiseeId && a.printedAt == null); },
      }),
      $queryRaw: async (sql: any) => (/FROM "PrintRequest"/.test(sql?.text || "") ? responderPreConsulta(sql) : []),
    },
    { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
  );
}

async function semBanco() {
  const { sqlDaFila, filaTemAlgo } = await import("../src/lib/fila-tem-algo");
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const { esquecerTudo } = await import("../src/lib/cache-curto");

  console.log("\n[1] A pré-consulta");
  const base = { franchiseeId: LOJA, desde: new Date(Date.now() - 60_000), desdeDaAvulsa: new Date(Date.now() - 60_000), statusQueNaoEntram: NAO_ENTRAM };
  confere(!/kdsFinishedAt/.test(sqlDaFila({ ...base, tambemPeloFimDoKds: false }).text), "janela só pela criação quando a loja não imprime no fim do KDS");
  confere(/kdsFinishedAt/.test(sqlDaFila({ ...base, tambemPeloFimDoKds: true }).text), "janela também pela finalização quando imprime no fim do KDS");
  confere(/"printedAt" IS NULL/.test(sqlDaFila({ ...base, tambemPeloFimDoKds: false }).text) && /"parentOrderId" IS NULL/.test(sqlDaFila({ ...base, tambemPeloFimDoKds: false }).text), "mesmo recorte de impresso e de acréscimo da rota");
  confere((await filaTemAlgo({ $queryRaw: async () => { throw new Error("x"); } } as any, { ...base, tambemPeloFimDoKds: false })) === null, "erro na pré-consulta = null (caminho de sempre)");
  confere((await filaTemAlgo({ $queryRaw: async () => [] } as any, { ...base, tambemPeloFimDoKds: false })) === null, "resposta estranha = null (caminho de sempre)");
  const r = await filaTemAlgo({ $queryRaw: async () => [{ pedidos: false, avulsas: true }] } as any, { ...base, tambemPeloFimDoKds: false });
  confere(r?.pedidos === false && r?.avulsas === true, "lê as duas respostas");

  const consultar = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.34&pendentes=0&abertoHaSeg=7200`, { headers: { "x-forwarded-for": "10.7.7.7" } }));
    return (await res.json()) as { jobs: any[] };
  };
  // O banco falso não passa pelo lib/prisma.ts: cada troca de cenário avisa a
  // novidade como a gravação de verdade avisaria (lib/novidade-da-loja.ts).
  const { marcarNovidade } = await import("../src/lib/novidade-da-loja");
  const zerar = () => { chamadas.preConsulta = 0; chamadas.pedidos = 0; chamadas.avulsas = 0; esquecerTudo(); marcarNovidade(LOJA); };

  console.log("\n[2] Fila vazia: uma pré-consulta e nada mais");
  pedidos = [pedido("ja_impresso", { printedAt: new Date() }), pedido("rascunho", { status: "CRIANDO_IA" }), pedido("acrescimo", { parentOrderId: "x" })];
  avulsas = [];
  zerar();
  const vazia = await consultar();
  confere(Array.isArray(vazia.jobs) && vazia.jobs.length === 0, "nenhum trabalho");
  confere(chamadas.preConsulta === 1 && chamadas.pedidos === 0 && chamadas.avulsas === 0, `pulou as duas consultas (pré ${chamadas.preConsulta}, pedidos ${chamadas.pedidos}, avulsas ${chamadas.avulsas})`);

  console.log("\n[3] Pedido novo SEMPRE sai");
  pedidos.push(pedido("pedido_novo"));
  zerar();
  const comNovo = await consultar();
  confere(comNovo.jobs.some((j) => String(j?.order?.id) === "pedido_novo"), "a fila entrega o pedido novo");
  confere(chamadas.pedidos === 1, "a consulta de pedidos rodou");

  console.log("\n[4] Pré-consulta quebrada: o caminho de sempre");
  preConsultaQuebrada = true;
  zerar();
  const semPre = await consultar();
  confere(semPre.jobs.some((j) => String(j?.order?.id) === "pedido_novo") && chamadas.pedidos === 1 && chamadas.avulsas === 1, "entrega o pedido pelas consultas de sempre");
  preConsultaQuebrada = false;

  console.log("\n[5] Impressão avulsa pendente: a consulta das avulsas roda");
  pedidos = [];
  avulsas = [{ id: "conta_1", franchiseeId: LOJA, createdAt: new Date(), printedAt: null, kind: "CONTA_MESA", payload: { linhas: [] } }];
  zerar();
  await consultar();
  confere(chamadas.avulsas === 1 && chamadas.pedidos === 0, `avulsas consultadas, pedidos pulados (pedidos ${chamadas.pedidos}, avulsas ${chamadas.avulsas})`);
}

async function noBanco() {
  const { prisma } = await import("../src/lib/prisma");
  const { filaTemAlgo } = await import("../src/lib/fila-tem-algo");
  const lojas: { id: string }[] = await prisma.$queryRawUnsafe(`SELECT id FROM "User" WHERE "printQueuePolledAt" > now() - interval '1 day'`);
  console.log(`\n[banco] ${lojas.length} lojas com Assistente nas últimas 24 h`);
  let casos = 0, diferentes = 0, furos = 0;
  for (const { id } of lojas) {
    for (const atras of [30 * 60_000, 3 * 3600_000, 24 * 3600_000, 7 * 24 * 3600_000]) {
      for (const kds of [false, true]) {
        const desde = new Date(Date.now() - atras);
        const r = await filaTemAlgo(prisma as any, { franchiseeId: id, desde, desdeDaAvulsa: desde, statusQueNaoEntram: NAO_ENTRAM, tambemPeloFimDoKds: kds });
        const recorte: any = {
          franchiseeId: id, parentOrderId: null, printedAt: null, status: { notIn: NAO_ENTRAM },
          OR: kds ? [{ createdAt: { gt: desde } }, { kdsFinishedAt: { gt: desde } }] : [{ createdAt: { gt: desde } }],
        };
        const [nPedidos, nAvulsas, nDaRota] = await Promise.all([
          prisma.customerOrder.count({ where: recorte }),
          prisma.printRequest.count({ where: { franchiseeId: id, createdAt: { gt: desde }, printedAt: null } }),
          prisma.customerOrder.count({ where: { franchiseeId: id, parentOrderId: null, printedAt: null, status: { notIn: NAO_ENTRAM }, OR: [{ createdAt: { gt: desde } }] } }),
        ]);
        casos++;
        if (!r || r.pedidos !== nPedidos > 0 || r.avulsas !== nAvulsas > 0) { diferentes++; console.log("    diferente:", id, atras, kds, r, nPedidos, nAvulsas); }
        if (nDaRota > 0 && !r?.pedidos) furos++;
      }
    }
  }
  confere(casos > 0 && diferentes === 0, `${casos} casos: o SQL responde igual à contagem do Prisma`);
  confere(furos === 0, "nenhum caso em que a consulta da rota acharia pedido e a pré-consulta diria 'não'");
  await prisma.$disconnect();
}

(PROVA_NO_BANCO ? noBanco() : semBanco())
  .then(() => { console.log(`\n${ok} ok, ${falhas} falha(s)`); process.exit(falhas ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
