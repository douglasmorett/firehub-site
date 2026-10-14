/**
 * O FIADO DO MOTOBOY — pedido da Delícia de Casa (14/10/2026).
 *
 * A conta funcionário (fiado) mora em StoreEmployee; o motoboy, em Motoboy.
 * Para o motoboy aparecer na escolha do fiado sem ninguém cadastrar de novo,
 * cada motoboy ativo ganha um cadastro "Motoboy" no fiado
 * (`trazerMotoboysParaOFiado`, chamado pela lista do fiado). A ligação entre
 * os dois é pelo nome ou pelo telefone, na mesma loja — sem coluna nova.
 *
 * O relatório do motoboy (lib/relatorio-do-entregador.ts) mostra o que ele
 * pegou no fiado no período e o saldo em aberto. NÃO desconta do acerto: a
 * baixa continua na tela Fiado, senão a dívida seria cobrada duas vezes.
 */
import { prisma } from "@/lib/prisma";

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const soDigitos = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
const nomeLimpo = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

type Pessoa = { franchiseeId: string; name: string | null; phone: string | null };

/** O cadastro do fiado é desta pessoa? Mesma loja e mesmo nome ou telefone. */
export function ehAMesmaPessoa(a: Pessoa, b: Pessoa): boolean {
  if (a.franchiseeId !== b.franchiseeId) return false;
  if (nomeLimpo(a.name) && nomeLimpo(a.name) === nomeLimpo(b.name)) return true;
  const fone = soDigitos(a.phone);
  return fone.length >= 8 && fone === soDigitos(b.phone);
}

/**
 * Cada motoboy ativo da loja ganha um cadastro "Motoboy" no fiado. Casa
 * também com cadastro desativado, para quem a loja tirou da lista não voltar.
 */
export async function trazerMotoboysParaOFiado(franchiseeIds: string[]) {
  try {
    const motoboys = await prisma.motoboy.findMany({
      where: { franchiseeId: { in: franchiseeIds }, active: true },
      select: { franchiseeId: true, name: true, phone: true },
    });
    if (motoboys.length === 0) return;

    const jaCadastrados: Pessoa[] = await prisma.storeEmployee.findMany({
      where: { franchiseeId: { in: franchiseeIds } },
      select: { franchiseeId: true, name: true, phone: true },
    });

    const novos: { franchiseeId: string; name: string; role: string; phone: string | null; active: boolean }[] = [];
    for (const m of motoboys) {
      const nome = m.name?.trim();
      if (!nome) continue;
      if ([...jaCadastrados, ...novos].some((e) => ehAMesmaPessoa(m, e))) continue;
      novos.push({ franchiseeId: m.franchiseeId, name: nome, role: "Motoboy", phone: m.phone?.trim() || null, active: true });
    }
    if (novos.length > 0) await prisma.storeEmployee.createMany({ data: novos });
  } catch (err) {
    console.error("[fiado] não trouxe os motoboys para o fiado:", err);
  }
}

export type FiadoDoMotoboy = {
  /** Soma do que ele pegou no fiado no período. */
  totalNoPeriodo: number;
  /** Tudo o que ele deve hoje (todos os fiados menos as baixas). */
  saldoEmAberto: number;
  lancamentos: { id: string; em: string; numero: number | null; valor: number; descricao: string }[];
};

/** O fiado de cada motoboy no período, por id do motoboy. */
export async function fiadoDosMotoboys(opts: {
  lojaId: string;
  motoboys: (Pessoa & { id: string })[];
  de: Date;
  ate: Date;
}): Promise<Map<string, FiadoDoMotoboy>> {
  const resultado = new Map<string, FiadoDoMotoboy>();
  if (opts.motoboys.length === 0) return resultado;
  try {
    const cadastros = await prisma.storeEmployee.findMany({
      where: { franchiseeId: opts.lojaId },
      select: { id: true, franchiseeId: true, name: true, phone: true },
    });

    for (const mb of opts.motoboys) {
      const ids = cadastros.filter((c) => ehAMesmaPessoa(mb, c)).map((c) => c.id);
      if (ids.length === 0) continue;

      const [pedidos, tudo, baixas] = await Promise.all([
        prisma.customerOrder.findMany({
          where: { employeeId: { in: ids }, status: { not: "CANCELADO" }, createdAt: { gte: opts.de, lte: opts.ate } },
          select: {
            id: true, createdAt: true, dailyOrderNumber: true, totalAmount: true, notes: true,
            items: { select: { quantity: true, productName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.customerOrder.aggregate({
          where: { employeeId: { in: ids }, status: { not: "CANCELADO" } },
          _sum: { totalAmount: true },
        }),
        prisma.employeePayment.aggregate({ where: { employeeId: { in: ids } }, _sum: { amount: true } }),
      ]);

      const saldoEmAberto = centavos(Math.max(0, (tudo._sum.totalAmount || 0) - (baixas._sum.amount || 0)));
      if (pedidos.length === 0 && saldoEmAberto < 0.005) continue;

      resultado.set(mb.id, {
        totalNoPeriodo: centavos(pedidos.reduce((t, p) => t + (p.totalAmount || 0), 0)),
        saldoEmAberto,
        lancamentos: pedidos.map((p) => ({
          id: p.id,
          em: p.createdAt.toISOString(),
          numero: p.dailyOrderNumber ?? null,
          valor: centavos(p.totalAmount || 0),
          descricao: p.items.length
            ? p.items.map((i) => `${Number(i.quantity) || 1}× ${i.productName || "Item"}`).join(", ")
            : p.notes || "Lançamento no fiado",
        })),
      });
    }
  } catch (err) {
    console.error("[fiado] não montou o fiado dos motoboys:", err);
  }
  return resultado;
}
