/**
 * A contagem de estoque no banco: abrir, fechar e reabrir.
 *
 * A conta do fechamento mora em lib/cmv/contagem.ts (pura, testada). Aqui é
 * buscar o que ela precisa e gravar o resultado:
 *   - todos os insumos ativos da loja ganham linha no fechamento (o contado, o
 *     carregado da contagem anterior ou o saldo do sistema);
 *   - o CONTADO vira o saldo do sistema por um movimento "AJUSTE" com chave
 *     `contagem:<id>:<insumo>` (única: fechar duas vezes não ajusta duas);
 *   - reabrir desfaz os ajustes, e só vale para a ÚLTIMA contagem fechada.
 */
import { prisma } from "@/lib/prisma";
import { custosNoDia, type EntradaComCusto, type InsumoParaCusto } from "@/lib/cmv/custo-do-insumo";
import { entraNoCarregado, fecharContagem, type Fechamento } from "@/lib/cmv/contagem";
import { naLoja } from "@/lib/relatorios/base";

export class ContagemRecusadaError extends Error {
  constructor(m: string) { super(m); this.name = "ContagemRecusadaError"; }
}

const ativo = { NOT: { active: false } } as const;

/** Os insumos da loja no formato da conta de custo. */
export async function insumosParaCusto(lojaId: string): Promise<(InsumoParaCusto & { quantidade: number; local: string | null; contagemDiaria: boolean; entraNoCmv: boolean })[]> {
  const itens = await prisma.stockItem.findMany({
    where: { franchiseeId: lojaId, ...ativo },
    select: {
      id: true, name: true, unit: true, quantity: true, unitCost: true, tipo: true, rendimento: true, local: true,
      contagemDiaria: true, entraNoCmv: true,
      componentes: { select: { insumoId: true, quantidade: true } },
    },
    orderBy: { name: "asc" },
  });
  return itens.map((i) => ({
    id: i.id, nome: i.name, unidade: i.unit, tipo: i.tipo, rendimento: i.rendimento, unitCost: i.unitCost,
    componentes: i.componentes, quantidade: i.quantity, local: i.local, contagemDiaria: Boolean(i.contagemDiaria),
    entraNoCmv: i.entraNoCmv !== false,
  }));
}

/**
 * As entradas de compra com custo (para o custo no dia). A compra desfeita não
 * vale; a compra antiga (sem `dia`) entra pelo dia em que foi criada. Vêm
 * TODAS as datas: a compra depois do dia diz qual era o custo no dia.
 */
export async function entradasComCusto(lojaId: string, tz: string): Promise<EntradaComCusto[]> {
  const ts = await prisma.stockTransaction.findMany({
    where: { franchiseeId: lojaId, type: "INPUT", unitCost: { not: null }, stockInvoiceId: { not: null } },
    select: { stockItemId: true, unitCost: true, createdAt: true, stockInvoiceId: true },
  });
  const ids = Array.from(new Set(ts.map((t) => t.stockInvoiceId as string)));
  const compras = ids.length
    ? await prisma.stockInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, dia: true, createdAt: true, canceladaEm: true, processedData: true } })
    : [];
  const porId = new Map(compras.map((c) => [c.id, c]));
  const saida: EntradaComCusto[] = [];
  for (const t of ts) {
    const c = porId.get(t.stockInvoiceId as string);
    if (!c || c.canceladaEm) continue;
    const dia = c.dia || naLoja(c.createdAt, tz).dia;
    const anteriores = ((c.processedData as any)?.custosAnteriores || {}) as Record<string, number | null>;
    saida.push({
      stockItemId: t.stockItemId, dia, em: t.createdAt.getTime(), unitCost: Number(t.unitCost),
      custoAnterior: t.stockItemId in anteriores ? anteriores[t.stockItemId] : undefined,
    });
  }
  return saida;
}

/** Abre a contagem do dia (ou devolve a que já está aberta). */
export async function abrirContagem(e: { lojaId: string; usuarioId: string; dia: string; tipo: "COMPLETA" | "RAPIDA" }) {
  const existente = await prisma.contagemDeEstoque.findUnique({ where: { franchiseeId_dia: { franchiseeId: e.lojaId, dia: e.dia } } });
  if (existente) {
    if (existente.status === "FECHADA") throw new ContagemRecusadaError("A contagem deste dia já foi fechada. Para mudar, reabra a contagem.");
    return existente;
  }

  const itens = await prisma.stockItem.findMany({
    where: { franchiseeId: e.lojaId, ...ativo, ...(e.tipo === "RAPIDA" ? { contagemDiaria: true } : {}) },
    select: { id: true, name: true, unit: true },
    orderBy: { name: "asc" },
  });
  if (itens.length === 0) {
    throw new ContagemRecusadaError(
      e.tipo === "RAPIDA"
        ? "Nenhum item está marcado para a contagem do dia. Marque os principais (queijo, carne, farinha...) no cadastro do insumo."
        : "A loja ainda não tem insumos cadastrados no estoque.",
    );
  }

  return prisma.contagemDeEstoque.create({
    data: {
      franchiseeId: e.lojaId,
      dia: e.dia,
      tipo: e.tipo,
      criadoPor: e.usuarioId,
      itens: { create: itens.map((i) => ({ stockItemId: i.id, nome: i.name, unidade: i.unit })) },
    },
  });
}

/** Fecha a contagem: congela quantidade e custo, ajusta o saldo do contado. */
export async function fecharContagemNoBanco(e: { lojaId: string; usuarioId: string; contagemId: string; tz: string }): Promise<{ fechamento: Fechamento; dia: string }> {
  const contagem = await prisma.contagemDeEstoque.findFirst({ where: { id: e.contagemId, franchiseeId: e.lojaId }, include: { itens: true } });
  if (!contagem) throw new ContagemRecusadaError("Contagem não encontrada.");
  if (contagem.status === "FECHADA") throw new ContagemRecusadaError("Esta contagem já está fechada.");
  if (!contagem.itens.some((i) => i.contado != null)) throw new ContagemRecusadaError("Nenhum item foi contado ainda.");

  const depois = await prisma.contagemDeEstoque.findFirst({ where: { franchiseeId: e.lojaId, status: "FECHADA", dia: { gt: contagem.dia } }, select: { dia: true } });
  if (depois) throw new ContagemRecusadaError(`Já existe contagem fechada depois deste dia (${depois.dia}). Feche as contagens na ordem dos dias.`);

  const anterior = await prisma.contagemDeEstoque.findFirst({
    where: { franchiseeId: e.lojaId, status: "FECHADA", dia: { lt: contagem.dia } },
    orderBy: { dia: "desc" },
    include: { itens: { select: { stockItemId: true, quantidade: true } } },
  });

  const insumos = await insumosParaCusto(e.lojaId);
  const entradas = await entradasComCusto(e.lojaId, e.tz);
  const custos = custosNoDia(insumos, entradas, contagem.dia);

  const movimentoDesde = new Map<string, number>();
  if (anterior?.fechadaEm) {
    const ts = await prisma.stockTransaction.findMany({
      where: { franchiseeId: e.lojaId, createdAt: { gt: anterior.fechadaEm } },
      select: { stockItemId: true, quantity: true, type: true, notes: true },
    });
    for (const t of ts) if (entraNoCarregado(t)) movimentoDesde.set(t.stockItemId, (movimentoDesde.get(t.stockItemId) || 0) + t.quantity);
  }

  const contados = new Map(contagem.itens.map((i) => [i.stockItemId, i.contado]));
  const fechamento = fecharContagem({
    itens: insumos.map((i) => ({ stockItemId: i.id, nome: i.nome, unidade: i.unidade, contado: contados.get(i.id) ?? null, saldoSistema: i.quantidade })),
    anterior: anterior ? new Map(anterior.itens.filter((i) => i.quantidade != null).map((i) => [i.stockItemId, Number(i.quantidade)])) : null,
    movimentoDesde,
    custos,
    foraDoCmv: new Set(insumos.filter((i) => !i.entraNoCmv).map((i) => i.id)),
  });

  await prisma.$transaction(async (tx) => {
    for (const l of fechamento.linhas) {
      const dados = {
        contado: l.contado, quantidade: l.quantidade, origem: l.origem, nome: l.nome, unidade: l.unidade,
        custoUnitario: l.custoUnitario, valor: l.valor, saldoSistema: l.saldoSistema,
      };
      await tx.contagemItem.upsert({
        where: { contagemId_stockItemId: { contagemId: contagem.id, stockItemId: l.stockItemId } },
        create: { contagemId: contagem.id, stockItemId: l.stockItemId, ...dados },
        update: dados,
      });
      if (l.origem === "CONTADO" && Math.abs(l.ajuste) > 1e-9) {
        await tx.stockTransaction.create({
          data: {
            stockItemId: l.stockItemId,
            franchiseeId: e.lojaId,
            userId: e.usuarioId,
            quantity: l.ajuste,
            type: "AJUSTE",
            unitCost: l.custoUnitario,
            sourceRef: `contagem:${contagem.id}:${l.stockItemId}`,
            notes: `Contagem de ${contagem.dia.split("-").reverse().join("/")}: contado ${l.quantidade} ${l.unidade}, sistema dizia ${l.saldoSistema}`,
          },
        });
        await tx.stockItem.updateMany({ where: { id: l.stockItemId, franchiseeId: e.lojaId }, data: { quantity: { increment: l.ajuste } } });
      }
    }
    await tx.contagemDeEstoque.update({
      where: { id: contagem.id },
      data: { status: "FECHADA", valorTotal: fechamento.valorTotal, fechadaEm: new Date(), fechadaPor: e.usuarioId },
    });
  }, { timeout: 60000, maxWait: 15000 });

  return { fechamento, dia: contagem.dia };
}

/** Reabre a ÚLTIMA contagem fechada, desfazendo os ajustes de saldo dela. */
export async function reabrirContagem(e: { lojaId: string; contagemId: string }) {
  const contagem = await prisma.contagemDeEstoque.findFirst({ where: { id: e.contagemId, franchiseeId: e.lojaId } });
  if (!contagem) throw new ContagemRecusadaError("Contagem não encontrada.");
  if (contagem.status !== "FECHADA") throw new ContagemRecusadaError("Esta contagem já está aberta.");
  const depois = await prisma.contagemDeEstoque.findFirst({ where: { franchiseeId: e.lojaId, dia: { gt: contagem.dia } }, select: { dia: true } });
  if (depois) throw new ContagemRecusadaError(`Só dá para reabrir a última contagem. Existe outra depois (${depois.dia}).`);

  await prisma.$transaction(async (tx) => {
    const ajustes = await tx.stockTransaction.findMany({ where: { franchiseeId: e.lojaId, type: "AJUSTE", sourceRef: { startsWith: `contagem:${contagem.id}:` } } });
    for (const a of ajustes) {
      await tx.stockItem.updateMany({ where: { id: a.stockItemId, franchiseeId: e.lojaId }, data: { quantity: { decrement: a.quantity } } });
      await tx.stockTransaction.delete({ where: { id: a.id } });
    }
    // Volta ao estado de "contando". O fechamento pôs linha para TODO insumo;
    // na rápida, sai de novo o que não é da contagem do dia e não foi contado.
    if (contagem.tipo === "RAPIDA") {
      await tx.contagemItem.deleteMany({ where: { contagemId: contagem.id, contado: null, stockItem: { NOT: { contagemDiaria: true } } } });
    }
    await tx.contagemItem.updateMany({ where: { contagemId: contagem.id }, data: { quantidade: null, origem: null, custoUnitario: null, valor: null, saldoSistema: null } });
    await tx.contagemDeEstoque.update({ where: { id: contagem.id }, data: { status: "ABERTA", valorTotal: null, fechadaEm: null, fechadaPor: null } });
  }, { timeout: 60000, maxWait: 15000 });
}
