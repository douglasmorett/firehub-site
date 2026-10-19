/**
 * /src/lib/acerto-pago.ts
 *
 * "Acertar com o motoboy": a loja marca como PAGO o acerto que está na tela —
 * os dias do período, o valor e, se escolheu, o fiado abatido. Pedido do
 * Douglas (19/10/2026): depois de pago, qualquer filtro que alcance um daqueles
 * dias (até o dia sozinho) mostra que já foi pago.
 *
 * Tabela fora do schema.prisma, como MotoboyPendencia (lib/ajustes-do-acerto.ts):
 *   MotoboyAcertoPago — uma linha por acerto. `dias` é a lista dos dias do
 *                       expediente pagos (JSON). Desfazer marca `desfeitoEm` e
 *                       apaga a baixa do fiado que o acerto fez.
 *
 * Abater o fiado é uma baixa normal no Fiado (EmployeePayment), com a nota do
 * acerto — o saldo do fiado cai sozinho e a tela Fiado mostra a baixa.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import { horaEmUtc } from "@/lib/cashback-no-banco";

let tabelaOk = false;

export async function garantirTabelaDoAcertoPago(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("acerto-pago", [
      `CREATE TABLE IF NOT EXISTS "MotoboyAcertoPago" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "motoboyId" TEXT NOT NULL,
      "de" TEXT NOT NULL,
      "ate" TEXT NOT NULL,
      "dias" TEXT NOT NULL,
      "valorDoAcerto" DOUBLE PRECISION NOT NULL,
      "fiadoAbatido" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "valorPago" DOUBLE PRECISION NOT NULL,
      "baixaDoFiadoId" TEXT,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "desfeitoEm" TIMESTAMP(3),
      "desfeitoPor" TEXT,
      CONSTRAINT "MotoboyAcertoPago_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE INDEX IF NOT EXISTS "MotoboyAcertoPago_lojaId_motoboyId_idx" ON "MotoboyAcertoPago"("lojaId", "motoboyId", "ate")`,
    ]);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Acerto] 🛑 Tabela MotoboyAcertoPago falhou: ${err?.message}`);
    return false;
  }
}

export type AcertoPago = {
  id: string;
  motoboyId: string;
  de: string;
  ate: string;
  dias: string[];
  valorDoAcerto: number;
  fiadoAbatido: number;
  valorPago: number;
  criadoPor: string | null;
  em: string;
};

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const novoId = () => `map_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Acertos (não desfeitos) com algum dia entre `de` e `ate`, por motoboy. Sem a tabela, vazio. */
export async function acertosDoPeriodo(o: { lojaId: string; motoboyIds: string[]; de: string; ate: string }): Promise<Map<string, AcertoPago[]>> {
  const mapa = new Map<string, AcertoPago[]>();
  if (!o.motoboyIds.length || !(await garantirTabelaDoAcertoPago())) return mapa;
  const linhas = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT "id", "motoboyId", "de", "ate", "dias", "valorDoAcerto", "fiadoAbatido", "valorPago", "criadoPor", "createdAt"
    FROM "MotoboyAcertoPago"
    WHERE "lojaId" = ${o.lojaId} AND "motoboyId" IN (${Prisma.join(o.motoboyIds)})
      AND "desfeitoEm" IS NULL AND "ate" >= ${o.de} AND "de" <= ${o.ate}
    ORDER BY "createdAt" ASC`);
  for (const l of linhas) {
    let dias: string[] = [];
    try { dias = JSON.parse(l.dias); } catch { /* linha estranha: sem dias */ }
    if (!dias.some((d) => d >= o.de && d <= o.ate)) continue;
    const lista = mapa.get(l.motoboyId) || [];
    lista.push({
      id: l.id, motoboyId: l.motoboyId, de: l.de, ate: l.ate, dias,
      valorDoAcerto: Number(l.valorDoAcerto) || 0, fiadoAbatido: Number(l.fiadoAbatido) || 0, valorPago: Number(l.valorPago) || 0,
      criadoPor: l.criadoPor, em: new Date(l.createdAt).toISOString(),
    });
    mapa.set(l.motoboyId, lista);
  }
  return mapa;
}

/**
 * Grava o acerto pago. Com `fiado`, lança a baixa no Fiado do motoboy (no
 * máximo o que ele deve e o que a loja paga) e desconta do valor pago.
 */
export async function registrarAcertoPago(o: {
  lojaId: string; motoboyId: string; de: string; ate: string; dias: string[];
  valorDoAcerto: number; quem: string;
  fiado?: { cadastroId: string; saldoEmAberto: number } | null;
}): Promise<AcertoPago> {
  if (!(await garantirTabelaDoAcertoPago())) throw new Error("tabela MotoboyAcertoPago indisponível");
  const valorDoAcerto = centavos(o.valorDoAcerto);
  const fiadoAbatido = o.fiado ? centavos(Math.max(0, Math.min(o.fiado.saldoEmAberto, valorDoAcerto))) : 0;
  const valorPago = centavos(valorDoAcerto - fiadoAbatido);
  const id = novoId();
  const agora = new Date();
  const periodo = o.de === o.ate ? o.de.split("-").reverse().join("/") : `${o.de.split("-").reverse().join("/")} a ${o.ate.split("-").reverse().join("/")}`;

  await prisma.$transaction(async (tx) => {
    let baixaId: string | null = null;
    if (o.fiado && fiadoAbatido > 0) {
      const baixa = await tx.employeePayment.create({
        data: {
          franchiseeId: o.lojaId, employeeId: o.fiado.cadastroId, amount: fiadoAbatido,
          notes: `Abatido no acerto do motoboy (${periodo})`,
        },
        select: { id: true },
      });
      baixaId = baixa.id;
    }
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "MotoboyAcertoPago" ("id", "lojaId", "motoboyId", "de", "ate", "dias", "valorDoAcerto", "fiadoAbatido", "valorPago", "baixaDoFiadoId", "criadoPor", "createdAt")
      VALUES (${id}, ${o.lojaId}, ${o.motoboyId}, ${o.de}, ${o.ate}, ${JSON.stringify([...new Set(o.dias)].sort())},
        ${valorDoAcerto}, ${fiadoAbatido}, ${valorPago}, ${baixaId}, ${o.quem.slice(0, 120)}, ${horaEmUtc(agora)})`);
  });

  return {
    id, motoboyId: o.motoboyId, de: o.de, ate: o.ate, dias: o.dias, valorDoAcerto, fiadoAbatido, valorPago,
    criadoPor: o.quem, em: agora.toISOString(),
  };
}

/** Desfaz o acerto (fica no banco, marcado) e apaga a baixa do fiado que ele lançou. */
export async function desfazerAcertoPago(o: { lojaId: string; id: string; quem: string }): Promise<boolean> {
  if (!(await garantirTabelaDoAcertoPago())) throw new Error("tabela MotoboyAcertoPago indisponível");
  return prisma.$transaction(async (tx) => {
    const [linha] = await tx.$queryRaw<{ baixaDoFiadoId: string | null }[]>(Prisma.sql`
      SELECT "baixaDoFiadoId" FROM "MotoboyAcertoPago" WHERE "id" = ${o.id} AND "lojaId" = ${o.lojaId} AND "desfeitoEm" IS NULL`);
    if (!linha) return false;
    if (linha.baixaDoFiadoId) await tx.employeePayment.deleteMany({ where: { id: linha.baixaDoFiadoId, franchiseeId: o.lojaId } });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "MotoboyAcertoPago" SET "desfeitoEm" = ${horaEmUtc(new Date())}, "desfeitoPor" = ${o.quem.slice(0, 120)}
      WHERE "id" = ${o.id} AND "lojaId" = ${o.lojaId}`);
    return true;
  });
}
