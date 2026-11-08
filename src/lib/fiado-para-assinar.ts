/**
 * /src/lib/fiado-para-assinar.ts
 *
 * A assinatura do fiado (feita na tela) e o que o comprovante precisa ler do
 * banco. O papel em si é montado em lib/comprovante-do-fiado.ts (puro).
 *
 * ── A tabela fica fora do schema.prisma ─────────────────────────────────────
 * Como FiadoDaMesa e SenhaDoGerente: SQL cru, `CREATE TABLE IF NOT EXISTS` no
 * boot (src/instrumentation.ts) e de novo no primeiro uso.
 *
 *   AssinaturaDoFiado  id · lojaId · employeeId · alvo ("PEDIDO" | "MESA")
 *                      · alvoId (CustomerOrder.id ou FiadoDaMesa.id — ÚNICO)
 *                      · nome (o nome legível digitado) · imagem (PNG base64)
 *                      · criadoPor · createdAt
 *
 * Por que não uma coluna em CustomerOrder: o pedido é lido em findMany sem
 * `select` em muito lugar, e 5–20 KB de imagem em cada linha iam junto em toda
 * consulta (tráfego do Neon); e a mesa no fiado nem é CustomerOrder. Aqui a
 * imagem só sai quando alguém abre o extrato ou imprime.
 *
 * Uma assinatura por lançamento, sem troca: assinatura que se substitui
 * calada não prova nada. Assinou errado, o papel continua valendo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import { horaEmUtc } from "@/lib/cashback-no-banco";
import { totalDasMesasNoFiado, garantirTabelaDoFiadoDaMesa } from "@/lib/fiado-da-mesa";
import { saldoDoFiado } from "@/lib/fiado-da-mesa-regras";
import { itensDoPedido, type LancamentoDoFiado } from "@/lib/comprovante-do-fiado";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export type AlvoDoFiado = "PEDIDO" | "MESA";
export const lerAlvo = (v: unknown): AlvoDoFiado | null => (v === "PEDIDO" || v === "MESA" ? v : null);

let tabelaOk = false;

/** A tabela existe? Uma vez por processo — e só marca DEPOIS de conseguir. Nunca lança. */
export async function garantirTabelaDaAssinaturaDoFiado(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("assinatura-do-fiado", [
      `CREATE TABLE IF NOT EXISTS "AssinaturaDoFiado" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "employeeId" TEXT NOT NULL,
      "alvo" TEXT NOT NULL,
      "alvoId" TEXT NOT NULL,
      "nome" TEXT NOT NULL,
      "imagem" TEXT NOT NULL,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AssinaturaDoFiado_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "AssinaturaDoFiado_alvoId_key" ON "AssinaturaDoFiado"("alvoId")`,
      `CREATE INDEX IF NOT EXISTS "AssinaturaDoFiado_employeeId_idx" ON "AssinaturaDoFiado"("employeeId")`,
    ]);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Assinatura do fiado] 🛑 Tabela AssinaturaDoFiado falhou: ${err?.message}`);
    return false;
  }
}

export type AssinaturaDoFiado = { alvoId: string; nome: string; imagem: string | null; createdAt: Date };

/** As assinaturas destes lançamentos. `comImagem: false` traz só nome e hora (o papel térmico não usa o desenho). */
export async function assinaturasDosLancamentos(alvoIds: string[], comImagem = true): Promise<Map<string, AssinaturaDoFiado>> {
  const saida = new Map<string, AssinaturaDoFiado>();
  if (!alvoIds.length || !(await garantirTabelaDaAssinaturaDoFiado())) return saida;
  try {
    const linhas = await prisma.$queryRaw<{ alvoId: string; nome: string; imagem: string | null; createdAt: Date }[]>(Prisma.sql`
      SELECT "alvoId", "nome", ${comImagem ? Prisma.sql`"imagem"` : Prisma.sql`NULL AS "imagem"`}, "createdAt" FROM "AssinaturaDoFiado"
      WHERE "alvoId" IN (${Prisma.join(alvoIds)})`);
    for (const l of linhas) saida.set(l.alvoId, { ...l, createdAt: new Date(l.createdAt) });
  } catch (err: any) {
    console.error("[Assinatura do fiado] leitura falhou:", err?.message);
  }
  return saida;
}

/** Grava a assinatura. `false` = este lançamento já tinha uma (fica a primeira). */
export async function gravarAssinaturaDoFiado(o: {
  lojaId: string; employeeId: string; alvo: AlvoDoFiado; alvoId: string; nome: string; imagem: string; quem: string;
}): Promise<boolean> {
  if (!(await garantirTabelaDaAssinaturaDoFiado())) throw new Error("tabela AssinaturaDoFiado indisponível");
  const id = `asf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const n = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AssinaturaDoFiado" ("id", "lojaId", "employeeId", "alvo", "alvoId", "nome", "imagem", "criadoPor", "createdAt")
    VALUES (${id}, ${o.lojaId}, ${o.employeeId}, ${o.alvo}, ${o.alvoId}, ${o.nome.trim().slice(0, 80)}, ${o.imagem},
            ${o.quem.slice(0, 120)}, ${horaEmUtc(new Date())})
    ON CONFLICT ("alvoId") DO NOTHING`);
  return n > 0;
}

/**
 * O lançamento do fiado como o papel precisa: pedido ou mesa, DESTE cliente
 * (os ids vêm do navegador). O cliente já foi conferido como da loja ou do
 * grupo dela (`acessoAoFiado`) — como no extrato, o que está no nome dele é
 * dele, em qualquer loja do grupo. `null` = não achou.
 */
export async function lancamentoDoFiado(employeeId: string, alvo: AlvoDoFiado, alvoId: string): Promise<LancamentoDoFiado | null> {
  if (alvo === "PEDIDO") {
    const o = await prisma.customerOrder.findFirst({
      where: { id: alvoId, employeeId, status: { not: "CANCELADO" } },
      select: {
        id: true, dailyOrderNumber: true, ifoodReference: true, totalAmount: true, createdAt: true, notes: true,
        items: { select: { quantity: true, price: true, productName: true, menuProduct: { select: { name: true } } } },
      },
    });
    if (!o) return null;
    return {
      tipo: "PEDIDO",
      id: o.id,
      // O número que a loja vê no painel; dívida à mão não tem número do dia.
      numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : `#${o.ifoodReference || o.id.slice(-4).toUpperCase()}`,
      quando: o.createdAt,
      itens: itensDoPedido(o.items),
      valorNoFiado: Number(o.totalAmount) || 0,
      obs: o.notes,
    };
  }
  if (!(await garantirTabelaDoFiadoDaMesa())) return null;
  const [m] = await prisma.$queryRaw<{ id: string; lojaId: string; tableSessionId: string; mesaNumero: number | null; valor: number; createdAt: Date }[]>(Prisma.sql`
    SELECT "id", "lojaId", "tableSessionId", "mesaNumero", "valor", "createdAt" FROM "FiadoDaMesa"
    WHERE "id" = ${alvoId} AND "employeeId" = ${employeeId} LIMIT 1`);
  if (!m) return null;
  // O consumo da mesa sai dos pedidos dela (a régua), não da descrição gravada:
  // a descrição não tem valor por item.
  const pedidos = await prisma.customerOrder.findMany({
    where: { tableSessionId: m.tableSessionId, franchiseeId: m.lojaId, status: { not: "CANCELADO" } },
    select: { items: { select: { quantity: true, price: true, productName: true, menuProduct: { select: { name: true } } } } },
  });
  return {
    tipo: "MESA",
    id: m.id,
    numero: m.mesaNumero != null ? `Mesa ${Number(m.mesaNumero)}` : "Mesa",
    quando: new Date(m.createdAt),
    itens: itensDoPedido(pedidos.flatMap((p) => p.items)),
    valorNoFiado: Number(m.valor) || 0,
  };
}

/** O saldo devedor de hoje — a mesma conta do extrato (api/store/employees/[id]/statement). */
export async function saldoDoClienteDoFiado(employeeId: string): Promise<number> {
  const [pedidos, baixas, mesas] = await Promise.all([
    prisma.customerOrder.aggregate({ where: { employeeId, status: { not: "CANCELADO" } }, _sum: { totalAmount: true } }),
    prisma.employeePayment.aggregate({ where: { employeeId }, _sum: { amount: true } }),
    totalDasMesasNoFiado([employeeId]),
  ]);
  return saldoDoFiado({ pedidos: pedidos._sum.totalAmount || 0, mesas, baixas: baixas._sum.amount || 0 });
}

/**
 * Quem pode imprimir e colher assinatura do fiado: a loja dona do cadastro (ou
 * do mesmo grupo de lojas — a lista do fiado é do grupo, api/store/employees),
 * e o funcionário só se abre uma das telas que lançam ou mostram o fiado
 * (Balcão, Mesas, Fiado — lib/permissao-da-tela.ts). O id vem do navegador.
 * `lojaId` é a loja de QUEM imprime: o papel sai na impressora dela.
 */
export async function acessoAoFiado(email: string, employeeId: string): Promise<
  | { ok: true; lojaId: string; quem: string; cliente: { id: string; name: string; role: string | null } }
  | { ok: false; status: number; erro: string }
> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, accountGroupId: true, role: true, permissions: true, name: true } });
  if (!user) return { ok: false, status: 404, erro: "Usuário não encontrado" };
  if (String(user.role || "").toUpperCase() === "STAFF"
    && !["/store/venda-presencial", "/store/mesas", "/store/funcionarios"].some((t) => funcionarioAbre(t, user.permissions))) {
    return { ok: false, status: 403, erro: "Sua conta não tem acesso ao fiado." };
  }
  const lojaId = user.ownerId || user.id;
  const grupo = user.accountGroupId || lojaId;
  const lojasDoGrupo = await prisma.user.findMany({ where: { OR: [{ id: grupo }, { accountGroupId: grupo }] }, select: { id: true } });
  const cliente = await prisma.storeEmployee.findFirst({
    where: { id: employeeId, franchiseeId: { in: [lojaId, ...lojasDoGrupo.map((l) => l.id)] } },
    select: { id: true, name: true, role: true },
  });
  if (!cliente) return { ok: false, status: 404, erro: "Cliente do fiado não encontrado." };
  return { ok: true, lojaId, quem: (user.name || email).trim(), cliente };
}
