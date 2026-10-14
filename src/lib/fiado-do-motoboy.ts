/**
 * O FIADO DA EQUIPE — pedido da Delícia de Casa (14/10/2026).
 *
 * A conta funcionário (fiado) mora em StoreEmployee; a equipe, em Motoboy e
 * Waiter (o grupo "Equipe" do menu). O cadastro da equipe é a fonte: todo
 * motoboy e garçom ativo aparece no fiado sozinho, e lá NÃO tem Excluir — para
 * tirar, exclui (ou desativa) em Motoboys/Garçons, que avisa a dívida e tira
 * do fiado (o histórico fica). "As informações conversam" (Douglas).
 *
 * A ligação é pelo nome (sem a palavra "motoboy"/"garçom", que as lojas
 * costumam pôr no fiado: "Jefinho Motoboy" = motoboy "Jefinho") ou pelo
 * telefone, na mesma loja — sem coluna nova.
 *
 * O relatório do motoboy (lib/relatorio-do-entregador.ts) mostra o que ele
 * pegou no fiado no período e o saldo em aberto. NÃO desconta do acerto: a
 * baixa continua na tela Fiado, senão a dívida seria cobrada duas vezes.
 */
import { prisma } from "@/lib/prisma";

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const soDigitos = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
const PALAVRAS_DO_CARGO = new Set(["motoboy", "moto", "entregador", "garcom", "garconete"]);
const nomeLimpo = (s: string | null | undefined) => {
  const palavras = (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const semCargo = palavras.filter((p) => !PALAVRAS_DO_CARGO.has(p));
  return (semCargo.length ? semCargo : palavras).join(" ");
};

type Pessoa = { franchiseeId: string; name: string | null; phone: string | null };
export type OrigemNaEquipe = "MOTOBOY" | "GARCOM";
type Membro = Pessoa & { id: string; origem: OrigemNaEquipe; active: boolean };

/** O cadastro do fiado é desta pessoa? Mesma loja e mesmo nome ou telefone. */
export function ehAMesmaPessoa(a: Pessoa, b: Pessoa): boolean {
  if (a.franchiseeId !== b.franchiseeId) return false;
  if (nomeLimpo(a.name) && nomeLimpo(a.name) === nomeLimpo(b.name)) return true;
  const fone = soDigitos(a.phone);
  return fone.length >= 8 && fone === soDigitos(b.phone);
}

async function membrosDaEquipe(franchiseeIds: string[]): Promise<Membro[]> {
  const [motoboys, garcons] = await Promise.all([
    prisma.motoboy.findMany({ where: { franchiseeId: { in: franchiseeIds } }, select: { id: true, franchiseeId: true, name: true, phone: true, active: true } }),
    prisma.waiter.findMany({ where: { franchiseeId: { in: franchiseeIds } }, select: { id: true, franchiseeId: true, name: true, phone: true, active: true } }),
  ]);
  return [
    ...motoboys.map((m) => ({ ...m, origem: "MOTOBOY" as const })),
    ...garcons.map((g) => ({ ...g, origem: "GARCOM" as const })),
  ].filter((m) => m.name?.trim());
}

// Mesma pessoa com mais de um cadastro no fiado (o espelho de 14/10/2026
// casava só pelo nome inteiro e criou "Jefinho" ao lado de "Jefinho
// Motoboy"; e há loja com o mesmo motoboy lançado duas vezes à mão): os
// cadastros VAZIOS (sem lançamento nem baixa) saem e ficam os que têm
// histórico — ou só o mais antigo, se todos estão vazios.
const CARGO_DO_ESPELHO: Record<OrigemNaEquipe, string> = { MOTOBOY: "Motoboy", GARCOM: "Garçom" };

/**
 * Deixa o fiado igual à equipe: todo membro tem cadastro ativo no fiado
 * (cria para quem está ativo; reativa e liga quem já tem, mesmo pausado —
 * pausar não tira do fiado). Quem sai da equipe sai do fiado na hora em que é
 * EXCLUÍDO (`tirarDoFiado`, nas rotas de Motoboys e Garçons).
 * Devolve, por id do cadastro do fiado, de que membro da equipe ele é.
 */
export async function sincronizarEquipeNoFiado(franchiseeIds: string[]): Promise<Map<string, { origem: OrigemNaEquipe; membroId: string }>> {
  const ligados = new Map<string, { origem: OrigemNaEquipe; membroId: string }>();
  try {
    const membros = await membrosDaEquipe(franchiseeIds);
    if (membros.length === 0) return ligados;

    const cadastros = await prisma.storeEmployee.findMany({
      where: { franchiseeId: { in: franchiseeIds } },
      select: { id: true, franchiseeId: true, name: true, phone: true, role: true, active: true, createdAt: true, _count: { select: { orders: true, payments: true } } },
      orderBy: { createdAt: "asc" },
    });

    const ativar: string[] = [];
    const desativar = new Set<string>();
    const novos: { franchiseeId: string; name: string; role: string; phone: string | null; active: boolean }[] = [];

    for (const m of membros) {
      const deles = cadastros.filter((c) => !desativar.has(c.id) && ehAMesmaPessoa(m, c));
      if (deles.length === 0) {
        // Pausado sem cadastro no fiado (ex-motoboy antigo) não ganha um.
        if (m.active && !novos.some((n) => ehAMesmaPessoa(m, n))) {
          novos.push({ franchiseeId: m.franchiseeId, name: m.name!.trim(), role: CARGO_DO_ESPELHO[m.origem], phone: m.phone?.trim() || null, active: true });
        }
        continue;
      }
      // Mais de um cadastro para a mesma pessoa: os vazios saem.
      let ficam = deles;
      if (deles.length > 1) {
        const vazio = (c: (typeof deles)[number]) => c._count.orders === 0 && c._count.payments === 0;
        const comHistorico = deles.filter((c) => !vazio(c));
        ficam = comHistorico.length > 0 ? comHistorico : [deles[0]]; // deles vem do mais antigo
        for (const c of deles) if (!ficam.includes(c)) desativar.add(c.id);
      }
      for (const c of ficam) {
        if (!c.active) ativar.push(c.id);
        ligados.set(c.id, { origem: m.origem, membroId: m.id });
      }
    }

    if (novos.length > 0) await prisma.storeEmployee.createMany({ data: novos });
    if (ativar.length > 0) await prisma.storeEmployee.updateMany({ where: { id: { in: ativar } }, data: { active: true } });
    if (desativar.size > 0) await prisma.storeEmployee.updateMany({ where: { id: { in: [...desativar] } }, data: { active: false } });

    if (novos.length > 0) {
      const criados = await prisma.storeEmployee.findMany({
        where: { franchiseeId: { in: franchiseeIds }, active: true, createdAt: { gte: new Date(Date.now() - 60_000) } },
        select: { id: true, franchiseeId: true, name: true, phone: true },
      });
      for (const c of criados) {
        const m = membros.find((x) => ehAMesmaPessoa(x, c));
        if (m) ligados.set(c.id, { origem: m.origem, membroId: m.id });
      }
    }
  } catch (err) {
    console.error("[fiado] não sincronizou a equipe com o fiado:", err);
  }
  return ligados;
}

/**
 * O membro saiu da equipe (excluído em Motoboys/Garçons): o cadastro dele sai
 * do fiado. Desativa, não apaga — o histórico do fiado fica.
 */
export async function tirarDoFiado(membro: Pessoa) {
  try {
    const cadastros = await prisma.storeEmployee.findMany({
      where: { franchiseeId: membro.franchiseeId, active: true },
      select: { id: true, franchiseeId: true, name: true, phone: true },
    });
    const ids = cadastros.filter((c) => ehAMesmaPessoa(membro, c)).map((c) => c.id);
    if (ids.length > 0) await prisma.storeEmployee.updateMany({ where: { id: { in: ids } }, data: { active: false } });
  } catch (err) {
    console.error("[fiado] não tirou do fiado:", err);
  }
}

/**
 * O nome mudou em Motoboys/Garçons: o cadastro do fiado acompanha, senão a
 * ligação (que é pelo nome) se perderia e nasceria um cadastro novo.
 */
export async function renomearNoFiado(antes: Pessoa, depois: { name: string | null; phone: string | null }) {
  try {
    if (!depois.name?.trim() || (nomeLimpo(antes.name) === nomeLimpo(depois.name) && soDigitos(antes.phone) === soDigitos(depois.phone))) return;
    const cadastros = await prisma.storeEmployee.findMany({
      where: { franchiseeId: antes.franchiseeId },
      select: { id: true, franchiseeId: true, name: true, phone: true },
    });
    const ids = cadastros.filter((c) => ehAMesmaPessoa(antes, c)).map((c) => c.id);
    if (ids.length > 0) {
      await prisma.storeEmployee.updateMany({ where: { id: { in: ids } }, data: { name: depois.name.trim(), phone: depois.phone?.trim() || null } });
    }
  } catch (err) {
    console.error("[fiado] não renomeou no fiado:", err);
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
