/**
 * scripts/teste-novidade-na-fila-de-verdade.ts — a ROTA da fila do Assistente
 * (GET /api/store/print-queue) com o lib/prisma.ts de verdade num Postgres
 * descartável: fila vazia vem da memória, e o pedido gravado aparece na
 * PRÓXIMA consulta (não 15 s depois). O mesmo para o painel (customer-order/poll
 * não entra aqui: precisa de sessão — coberto por scripts/teste-poll-nada-mudou.ts).
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55491/novidade" NEXTAUTH_SECRET=x npx tsx scripts/teste-novidade-na-fila-de-verdade.ts
 * Recusa qualquer banco que não seja local.
 */
export {};

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Só roda em banco local descartável.");
  process.exit(2);
}

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");

  // Conta as pré-consultas da fila (o único SQL que roda com a fila vazia).
  let preConsultas = 0;
  const queryRaw = prisma.$queryRaw.bind(prisma);
  (prisma as any).$queryRaw = (...a: any[]) => {
    const s = a[0];
    if (/FROM "PrintRequest"/.test(s?.text || s?.sql || "")) preConsultas++;
    return (queryRaw as any)(...a);
  };

  const LOJA = `loja_fila_${Date.now().toString(36)}`;
  await prisma.user.create({
    data: {
      id: LOJA, email: `${LOJA}@teste.invalid`, name: "Loja", password: "x", storeName: "Loja da Fila", slug: LOJA,
      printerConfig: { autoprint: true, printers: [{ id: "1", name: "ELGIN i9", label: "Cozinha", copies: 1, modulos: ["salao", "delivery", "balcao"], categories: [], paperWidth: "80mm" }] },
    } as any,
  });
  const consultar = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.36&pendentes=0&abertoHaSeg=7200`, { headers: { "x-forwarded-for": "10.9.9.9" } }));
    return (await res.json()) as { jobs: any[] };
  };

  const a = await consultar();
  const b = await consultar();
  const c = await consultar();
  confere(a.jobs.length === 0 && b.jobs.length === 0 && c.jobs.length === 0, "fila vazia nas três consultas");
  confere(preConsultas === 1, `só a primeira foi ao banco (pré-consultas: ${preConsultas})`);

  const pedido = await prisma.customerOrder.create({
    data: { franchiseeId: LOJA, customerName: "Cliente", customerPhone: "22999999999", totalAmount: 30, status: "NOVO", deliveryType: "DELIVERY",
      items: { create: [{ productName: "X-Burger", quantity: 1, price: 30 }] } } as any,
  });
  const t0 = Date.now();
  const d = await consultar();
  confere(d.jobs.some((j) => String(j?.order?.id) === pedido.id), `pedido novo sai na consulta seguinte (${Date.now() - t0} ms)`);

  await prisma.customerOrder.update({ where: { id: pedido.id }, data: { printedAt: new Date() } });
  const e = await consultar();
  confere(e.jobs.length === 0, "impresso (ack): some da fila");

  await prisma.customerOrderItem.deleteMany({ where: { orderId: pedido.id } });
  await prisma.customerOrder.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.printRequest.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.user.deleteMany({ where: { id: LOJA } });
  await prisma.$disconnect();
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
