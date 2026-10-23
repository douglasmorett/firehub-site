/**
 * scripts/teste-novidade-no-kds.ts — a TV do KDS (GET /api/kds) com o
 * lib/prisma.ts de verdade num Postgres descartável: sem gravação a resposta
 * vem da memória; pedido novo, mudança de status e item pronto aparecem na
 * consulta SEGUINTE; erro de banco não é guardado.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55491/novidade" NEXTAUTH_SECRET=x npx tsx scripts/teste-novidade-no-kds.ts
 * Recusa qualquer banco que não seja local.
 */
import Module from "module";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Só roda em banco local descartável.");
  process.exit(2);
}

const sufixo = Date.now().toString(36);
const LOJA = `loja_kds_${sufixo}`;
const EMAIL = `${LOJA}@teste.invalid`;
const carregar = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  const real = carregar.apply(this, [req, parent, isMain]);
  if (req === "next-auth/next" || req === "next-auth") {
    return new Proxy(real, { get: (t, k) => (k === "getServerSession" ? async () => ({ user: { email: EMAIL } }) : (t as any)[k]) });
  }
  return real;
};

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { GET } = await import("../src/app/api/kds/route");
  const { NextRequest } = await import("next/server");

  let leituras = 0;
  const findMany = prisma.customerOrder.findMany.bind(prisma.customerOrder);
  (prisma.customerOrder as any).findMany = (...a: any[]) => { leituras++; return (findMany as any)(...a); };

  await prisma.user.create({ data: { id: LOJA, email: EMAIL, name: "Loja", password: "x", storeName: "Loja KDS" } as any });
  const tv = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/kds?stage=production&t=${Date.now()}`));
    return { status: res.status, corpo: (await res.json()) as any[] };
  };
  const ids = (r: { corpo: any[] }) => (Array.isArray(r.corpo) ? r.corpo.map((p) => p.id).sort().join(",") : "?");

  const p1 = await prisma.customerOrder.create({
    data: { franchiseeId: LOJA, customerName: "A", customerPhone: "1", totalAmount: 10, status: "ACEITO", kdsStage: "PRODUCTION",
      items: { create: [{ productName: "X", quantity: 1, price: 10 }] } } as any,
  });
  const a = await tv();
  confere(a.status === 200 && ids(a) === p1.id, `a TV mostra o pedido (${ids(a)})`);
  leituras = 0;
  const b = await tv();
  const c = await tv();
  confere(leituras === 0 && ids(b) === p1.id && ids(c) === p1.id, `sem gravação: mesma resposta sem ler o banco (leituras ${leituras})`);

  const p2 = await prisma.customerOrder.create({
    data: { franchiseeId: LOJA, customerName: "B", customerPhone: "2", totalAmount: 20, status: "ACEITO", kdsStage: "PRODUCTION",
      items: { create: [{ productName: "Y", quantity: 1, price: 20 }] } } as any,
  });
  const d = await tv();
  confere(ids(d) === [p1.id, p2.id].sort().join(","), "pedido novo aparece na consulta seguinte");

  await prisma.customerOrder.update({ where: { id: p1.id }, data: { kdsStage: "FINISHED" } as any });
  const e = await tv();
  confere(ids(e) === p2.id, "pedido finalizado sai na consulta seguinte");

  const item = await prisma.customerOrderItem.findFirst({ where: { orderId: p2.id } });
  await prisma.customerOrderItem.update({ where: { id: item!.id }, data: { quantity: 3 } });
  const f = await tv();
  const q = f.corpo.find((p) => p.id === p2.id)?.items?.[0]?.quantity;
  confere(q === 3, `item alterado aparece na consulta seguinte (quantidade ${q})`);

  await prisma.customerOrderItem.deleteMany({ where: { orderId: { in: [p1.id, p2.id] } } });
  await prisma.customerOrder.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.user.deleteMany({ where: { id: LOJA } });
  await prisma.$disconnect();
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
