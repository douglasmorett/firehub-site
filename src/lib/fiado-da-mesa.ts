/**
 * /src/lib/fiado-da-mesa.ts
 *
 * Grava e lê as contas de mesa lançadas no fiado (a conta e o porquê estão em
 * lib/fiado-da-mesa-regras.ts).
 *
 * ── A tabela fica fora do schema.prisma ─────────────────────────────────────
 * Como MotoboyPendencia: SQL cru, `CREATE TABLE IF NOT EXISTS` no boot
 * (src/instrumentation.ts) e de novo no primeiro uso. Uma linha por mesa:
 *
 *   FiadoDaMesa  id · lojaId · employeeId (o cliente do fiado, StoreEmployee)
 *                · tableSessionId (único: a mesma conta não vai duas vezes)
 *                · mesaNumero · valor · descricao · criadoPor · createdAt
 *
 * Sem a tabela, o saldo do fiado sai só com os pedidos (como era antes) e a
 * mesa não vai para o fiado — o fechamento recusa com a mensagem.
 *
 * A hora é gravada e comparada com `horaEmUtc` (lib/cashback-no-banco.ts):
 * Date solto no SQL cru vira a hora do fuso da sessão do banco.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { horaEmUtc } from "@/lib/cashback-no-banco";

let tabelaOk = false;

/** A tabela existe? Uma vez por processo — e só marca DEPOIS de conseguir. Nunca lança. */
export async function garantirTabelaDoFiadoDaMesa(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FiadoDaMesa" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "employeeId" TEXT NOT NULL,
      "tableSessionId" TEXT NOT NULL,
      "mesaNumero" INTEGER,
      "valor" DOUBLE PRECISION NOT NULL,
      "descricao" TEXT,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FiadoDaMesa_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FiadoDaMesa_tableSessionId_key" ON "FiadoDaMesa"("tableSessionId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FiadoDaMesa_employeeId_idx" ON "FiadoDaMesa"("employeeId")`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Fiado da mesa] 🛑 Tabela FiadoDaMesa falhou: ${err?.message}`);
    return false;
  }
}

const novoId = () => `fdm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** O período do filtro da tela Fiado (dia ancorado no fuso da loja, lib/timezone). */
export type PeriodoDoFiado = { gte?: Date; lte?: Date };

const filtroDoPeriodo = (p?: PeriodoDoFiado) =>
  Prisma.sql`${p?.gte ? Prisma.sql` AND "createdAt" >= ${horaEmUtc(p.gte)}` : Prisma.empty}${p?.lte ? Prisma.sql` AND "createdAt" <= ${horaEmUtc(p.lte)}` : Prisma.empty}`;

/**
 * Grava a conta da mesa no fiado. DENTRO da transação do fechamento (o `tx`
 * dela): ou a mesa fecha com a dívida, ou nada acontece. A tabela tem de ter
 * sido garantida ANTES da transação (garantir usa o prisma global, e conexão
 * nova dentro da transação trava o pool — conexao-dentro-da-transacao-trava).
 */
export async function lancarMesaNoFiado(
  // Só o que se usa do cliente da transação: o prisma da casa é estendido, e
  // o tipo dele não casa com Prisma.TransactionClient.
  tx: { $executeRaw: (query: Prisma.Sql, ...values: any[]) => PromiseLike<number> },
  o: { lojaId: string; employeeId: string; tableSessionId: string; mesaNumero: number | null; valor: number; descricao: string; quem: string },
): Promise<string> {
  const id = novoId();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "FiadoDaMesa" ("id", "lojaId", "employeeId", "tableSessionId", "mesaNumero", "valor", "descricao", "criadoPor", "createdAt")
    VALUES (${id}, ${o.lojaId}, ${o.employeeId}, ${o.tableSessionId}, ${o.mesaNumero}, ${o.valor}, ${o.descricao.slice(0, 500)},
            ${o.quem.slice(0, 120)}, ${horaEmUtc(new Date())})`);
  return id;
}

/** Soma e quantidade das mesas no fiado por cliente. Sem a tabela, vazio (o saldo fica como era). */
export async function mesasNoFiadoPorCliente(employeeIds: string[], periodo?: PeriodoDoFiado): Promise<Map<string, { valor: number; qtd: number }>> {
  const saida = new Map<string, { valor: number; qtd: number }>();
  if (!employeeIds.length || !(await garantirTabelaDoFiadoDaMesa())) return saida;
  try {
    const linhas = await prisma.$queryRaw<{ employeeId: string; valor: number | null; qtd: bigint | number }[]>(Prisma.sql`
      SELECT "employeeId", SUM("valor") AS "valor", COUNT(*) AS "qtd" FROM "FiadoDaMesa"
      WHERE "employeeId" IN (${Prisma.join(employeeIds)})${filtroDoPeriodo(periodo)}
      GROUP BY "employeeId"`);
    for (const l of linhas) saida.set(l.employeeId, { valor: Number(l.valor) || 0, qtd: Number(l.qtd) || 0 });
  } catch (err: any) {
    console.error("[Fiado da mesa] soma falhou:", err?.message);
  }
  return saida;
}

export type MesaNoFiado = { id: string; employeeId: string; tableSessionId: string; mesaNumero: number | null; valor: number; descricao: string | null; criadoPor: string | null; createdAt: Date };

/** As mesas no fiado destes clientes (extrato), da mais nova para a mais antiga. */
export async function mesasNoFiado(employeeIds: string[], periodo?: PeriodoDoFiado): Promise<MesaNoFiado[]> {
  if (!employeeIds.length || !(await garantirTabelaDoFiadoDaMesa())) return [];
  try {
    const linhas = await prisma.$queryRaw<MesaNoFiado[]>(Prisma.sql`
      SELECT "id", "employeeId", "tableSessionId", "mesaNumero", "valor", "descricao", "criadoPor", "createdAt" FROM "FiadoDaMesa"
      WHERE "employeeId" IN (${Prisma.join(employeeIds)})${filtroDoPeriodo(periodo)}
      ORDER BY "createdAt" DESC`);
    return linhas.map((l) => ({ ...l, valor: Number(l.valor) || 0, mesaNumero: l.mesaNumero == null ? null : Number(l.mesaNumero), createdAt: new Date(l.createdAt) }));
  } catch (err: any) {
    console.error("[Fiado da mesa] extrato falhou:", err?.message);
    return [];
  }
}

/** Total de mesas no fiado de um cliente (todas as datas) — o que entra no saldo. */
export async function totalDasMesasNoFiado(employeeIds: string[]): Promise<number> {
  const m = await mesasNoFiadoPorCliente(employeeIds);
  let c = 0;
  for (const v of m.values()) c += Math.round(v.valor * 100);
  return c / 100;
}

/**
 * As lojas cujo fiado esta loja enxerga: ela e as do mesmo grupo de conta — a
 * mesma régua da tela Fiado (api/store/employees, GET).
 */
export async function lojasDoMesmoFiado(lojaId: string): Promise<string[]> {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, accountGroupId: true } });
  if (!loja) return [lojaId];
  const mestre = loja.accountGroupId || loja.id;
  const grupo = await prisma.user.findMany({ where: { OR: [{ id: mestre }, { accountGroupId: mestre }] }, select: { id: true } });
  const ids = new Set([lojaId, ...grupo.map((g) => g.id)]);
  return [...ids];
}
