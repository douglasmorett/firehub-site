/**
 * scripts/teste-novidade-no-banco.ts — o lib/prisma.ts DE VERDADE avisa a
 * novidade da loja (lib/novidade-da-loja.ts) em toda gravação de pedido, item
 * e impressão — inclusive dentro de transação e por SQL direto — e leitura
 * não avisa nada.
 *
 * Precisa de um Postgres DESCARTÁVEL com o schema (grava loja e pedidos):
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55491/novidade" npx prisma db push --skip-generate
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55491/novidade" npx tsx scripts/teste-novidade-no-banco.ts
 * Recusa qualquer banco que não seja local.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { nadaMudouDesde } from "../src/lib/novidade-da-loja";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Só roda em banco local descartável. DATABASE_URL =", url.replace(/\/\/[^@]*@/, "//***@"));
  process.exit(2);
}

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Roda `f` e diz se a loja ganhou novidade (e se a OUTRA loja também). */
async function marca(f: () => Promise<unknown>): Promise<{ loja: boolean; outra: boolean }> {
  await espera(5);
  const antes = Date.now();
  await espera(5);
  await f();
  return { loja: !nadaMudouDesde([LOJA], antes), outra: !nadaMudouDesde([OUTRA], antes) };
}

const sufixo = Date.now().toString(36);
const LOJA = `loja_nov_${sufixo}`;
const OUTRA = `outra_nov_${sufixo}`;

async function main() {
  await prisma.user.create({ data: { id: LOJA, email: `${LOJA}@teste.invalid`, name: "Loja", password: "x" } as any });
  await prisma.user.create({ data: { id: OUTRA, email: `${OUTRA}@teste.invalid`, name: "Outra", password: "x" } as any });
  const base = { franchiseeId: LOJA, customerName: "Cliente", customerPhone: "22999999999", totalAmount: 10 } as any;

  let pedidoId = "";
  let r = await marca(async () => {
    const p = await prisma.customerOrder.create({ data: { ...base, status: "ACEITO", items: { create: [{ productName: "X", quantity: 1, price: 10 }] } } as any });
    pedidoId = p.id;
  });
  confere(r.loja && !r.outra, "create (com itens aninhados) marca a loja do pedido e só ela");
  const criado = await prisma.customerOrder.findUnique({ where: { id: pedidoId } });
  confere(!!(criado as any)?.acceptedAt, "as regras antigas do lib/prisma.ts seguem valendo (carimbo do ACEITO)");

  r = await marca(() => prisma.customerOrder.findMany({ where: { franchiseeId: LOJA } }));
  confere(!r.loja && !r.outra, "findMany não marca nada");
  r = await marca(() => prisma.$queryRaw`SELECT count(*) FROM "CustomerOrder" WHERE "franchiseeId" = ${LOJA}`);
  confere(!r.loja, "SELECT por SQL não marca");
  r = await marca(() => prisma.user.update({ where: { id: LOJA }, data: { printQueuePolledAt: new Date() } as any }));
  confere(!r.loja, "carimbo do Assistente (User) não marca");

  r = await marca(() => prisma.customerOrder.update({ where: { id: pedidoId }, data: { status: "PRONTO" } }));
  confere(r.loja && !r.outra, "update por id marca a loja (pelo resultado)");
  r = await marca(() => prisma.customerOrder.update({ where: { id: pedidoId }, data: { notes: "x" }, select: { id: true } }));
  confere(r.loja && r.outra, "update com select sem a loja: marca todas (não sabe qual)");
  r = await marca(() => prisma.customerOrder.updateMany({ where: { id: pedidoId }, data: { printedAt: new Date() } }));
  confere(r.loja, "updateMany marca");
  r = await marca(() => prisma.$transaction(async (tx) => {
    await tx.customerOrder.update({ where: { id: pedidoId }, data: { printedAt: null } });
  }));
  confere(r.loja, "gravação dentro de transação interativa marca");
  r = await marca(() => prisma.$transaction([prisma.customerOrder.update({ where: { id: pedidoId }, data: { notes: "y" } })]));
  confere(r.loja, "gravação em transação em lote marca");
  r = await marca(() => prisma.$executeRaw`UPDATE "CustomerOrder" SET "notes" = NULL WHERE "id" = ${pedidoId}`);
  confere(r.loja && r.outra, "UPDATE por SQL direto marca todas");
  r = await marca(() => prisma.$executeRawUnsafe(`UPDATE "CustomerOrder" SET "notes" = 'z' WHERE "id" = $1`, pedidoId));
  confere(r.loja, "UPDATE por SQL direto (Unsafe) marca");
  r = await marca(() => prisma.$executeRaw(Prisma.sql`UPDATE "CustomerOrder" SET "notes" = 'nfce' WHERE "id" = ${pedidoId}`));
  confere(r.loja, "$executeRaw com o objeto Prisma.sql (jeito da NFC-e) marca");
  r = await marca(() => prisma.printRequest.deleteMany({ where: { franchiseeId: LOJA, createdAt: { lt: new Date(0) } } }));
  confere(!r.loja && !r.outra, "faxina que não apagou nada não marca");
  r = await marca(() => prisma.$executeRaw`UPDATE "CustomerOrder" SET "notes" = 'x' WHERE "id" = ${"nao-existe"}`);
  confere(!r.loja && !r.outra, "SQL direto que não mexeu em linha nenhuma não marca");
  r = await marca(() => prisma.$transaction(async (tx) => tx.$executeRawUnsafe(`UPDATE "CustomerOrder" SET "notes" = 'w' WHERE "id" = $1`, pedidoId)));
  confere(r.loja, "SQL direto dentro de transação (subida da contingência) marca");

  r = await marca(async () => {
    const item = await prisma.customerOrderItem.findFirst({ where: { orderId: pedidoId } });
    await prisma.customerOrderItem.update({ where: { id: item!.id }, data: { quantity: 2 } });
  });
  confere(r.loja, "update de item do pedido marca");
  r = await marca(() => prisma.printRequest.create({ data: { franchiseeId: LOJA, kind: "CONTA_MESA", payload: {} } as any }));
  confere(r.loja && !r.outra, "impressão avulsa marca a loja dela");
  r = await marca(() => prisma.customerOrder.update({ where: { id: pedidoId }, data: { franchiseeId: OUTRA } }));
  confere(r.loja && r.outra, "pedido que muda de loja marca a de antes e a de depois");
  r = await marca(() => prisma.customerOrder.deleteMany({ where: { id: pedidoId } }).catch(() => null));
  confere(r.loja, "deleteMany marca");

  await prisma.printRequest.deleteMany({ where: { franchiseeId: { in: [LOJA, OUTRA] } } });
  await prisma.customerOrderItem.deleteMany({ where: { orderId: pedidoId } }).catch(() => null);
  await prisma.customerOrder.deleteMany({ where: { franchiseeId: { in: [LOJA, OUTRA] } } });
  await prisma.user.deleteMany({ where: { id: { in: [LOJA, OUTRA] } } });
  await prisma.$disconnect();
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
