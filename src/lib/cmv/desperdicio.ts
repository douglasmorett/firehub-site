/**
 * DESPERDÍCIO NO ESTOQUE — a perda de PRODUTO e de INSUMO, num lugar só.
 *
 * Victor (Pizzaria 17, 14/10/2026): "caiu no chão" tem de entrar no CMV. O
 * Estoque só tinha a Perda por insumo (Movimentar › Perda); a pizza que caiu
 * é um PRODUTO do cardápio, e ninguém sabe de cabeça quantos gramas de queijo
 * ela leva.
 *
 * Mesma mecânica do descarte do FireCheck (lib/cmv/firecheck.ts), que já
 * fazia "produto vira perda pela ficha": uma linha em DescarteDoFirecheck (a
 * tabela dos descartes; os do FireHub têm `idExterno` "firehub:…") e, junto,
 * a baixa WASTE de cada insumo, com o custo do dia em `unitCost`. Sem tabela
 * nova: a linha guarda o que a movimentação não tem (produto, quantidade de
 * produto, motivo, quem, valor) e o produto sem ficha — que não mexe em
 * insumo nenhum — também fica registrado.
 *
 *   - produto com ficha → baixa (WASTE) de cada insumo da ficha × quantidade;
 *   - produto sem ficha com custo digitado → só a linha, pelo custo × quantidade;
 *   - produto sem nada → a linha sem valor (a tela avisa que não dá para calcular);
 *   - insumo → baixa dele, na unidade dele.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { custosDoDiaNaLoja } from "@/lib/cmv/contagem-no-banco";
import {
  ROTULO_DA_ETAPA, etapaAntesDoCancelamento, pedidoDaMarca, type EtapaDoDesperdicio,
} from "@/lib/desperdicio-do-cancelado";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type BaixaDaPerda = { stockItemId: string; quantidade: number };
type Custos = Map<string, { custo: number | null }>;

/** Quanto sai de cada insumo: a ficha do produto × a quantidade perdida. */
export function baixasDaFicha(ficha: { stockItemId: string; quantidade: number }[], quantidade: number): BaixaDaPerda[] {
  const porInsumo = new Map<string, number>();
  for (const f of ficha) {
    const q = (Number(f.quantidade) || 0) * quantidade;
    if (q > 0) porInsumo.set(f.stockItemId, (porInsumo.get(f.stockItemId) || 0) + q);
  }
  return [...porInsumo].map(([stockItemId, q]) => ({ stockItemId, quantidade: q }));
}

/** R$ das baixas pelo custo do dia; null se algum insumo está sem custo (sem custo não há valor). */
export function valorDasBaixas(baixas: BaixaDaPerda[], custos: Custos): number | null {
  if (baixas.length === 0) return null;
  let total = 0;
  for (const b of baixas) {
    const c = custos.get(b.stockItemId)?.custo;
    if (c == null) return null;
    total += b.quantidade * c;
  }
  return r2(total);
}

export type LinhaDaPerda = {
  idExterno: string; item: string; quantidade: number | null; unidade: string | null; valorEstimado: number | null;
  motivo: string | null; funcionario: string | null; foto: string | null; registradoEm: Date;
  situacao: string; casouCom: string | null; valor: number | null;
};

/**
 * Grava a linha do descarte e as baixas WASTE na MESMA transação. A linha vai
 * primeiro: duas chegadas do mesmo descarte batem no unique (loja, idExterno)
 * antes de qualquer baixa. Cada baixa tem `sourceRef` `<prefixo>:<linha>:<insumo>`.
 */
export async function gravarPerda(e: {
  lojaId: string; linha: LinhaDaPerda; baixas: BaixaDaPerda[]; custos: Custos; nota: string;
  prefixo: "firecheck" | "descarte"; userId?: string | null;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const linha = await tx.descarteDoFirecheck.create({ data: { franchiseeId: e.lojaId, ...e.linha }, select: { id: true } });
    for (const b of e.baixas) {
      await tx.stockTransaction.create({
        data: {
          stockItemId: b.stockItemId,
          franchiseeId: e.lojaId,
          userId: e.userId ?? null,
          quantity: -b.quantidade,
          type: "WASTE",
          notes: e.nota,
          unitCost: e.custos.get(b.stockItemId)?.custo ?? null,
          sourceRef: `${e.prefixo}:${linha.id}:${b.stockItemId}`,
        },
      });
      // O franchiseeId no where da escrita: insumo de outra loja derruba tudo.
      await tx.stockItem.update({ where: { id: b.stockItemId, franchiseeId: e.lojaId }, data: { quantity: { decrement: b.quantidade } } });
    }
    return linha;
  });
}

// ── Lançar no Estoque ─────────────────────────────────────────────────────

export const PREFIXO_DO_FIREHUB = "firehub:";

export type PedidoDeDesperdicio =
  | { tipo: "PRODUTO"; produtoId: string; quantidade: number; motivo: string }
  | { tipo: "INSUMO"; insumoId: string; quantidade: number; motivo: string };

export type ResultadoDoDesperdicio = {
  item: string;
  /** "PRODUTO" (pela ficha), "CUSTO_DO_PRODUTO" (custo digitado), "SEM_CUSTO", "INSUMO". */
  situacao: string;
  valor: number | null;
  baixas: number;
  /** Por que o valor ficou de fora, para a tela dizer. */
  aviso: string | null;
};

export class DesperdicioRecusado extends Error {}

export async function lancarDesperdicio(
  loja: { id: string; tz: string },
  quem: { id: string; nome: string },
  p: PedidoDeDesperdicio,
): Promise<ResultadoDoDesperdicio> {
  if (!(p.quantidade > 0) || !Number.isFinite(p.quantidade)) throw new DesperdicioRecusado("Quantidade inválida.");
  const motivo = String(p.motivo || "").trim().slice(0, 300);
  if (motivo.length < 3) throw new DesperdicioRecusado("Escreva o motivo (ex.: caiu no chão, queimou, saiu errado).");

  const custos = await custosDoDiaNaLoja(loja.id, loja.tz);
  const idExterno = `${PREFIXO_DO_FIREHUB}${crypto.randomUUID()}`;
  const base = { idExterno, motivo, funcionario: quem.nome.slice(0, 120), foto: null, registradoEm: new Date(), valorEstimado: null };

  if (p.tipo === "INSUMO") {
    const insumo = await prisma.stockItem.findFirst({ where: { id: p.insumoId, franchiseeId: loja.id }, select: { id: true, name: true, unit: true } });
    if (!insumo) throw new DesperdicioRecusado("Insumo não encontrado nesta loja.");
    const baixas = [{ stockItemId: insumo.id, quantidade: p.quantidade }];
    const valor = valorDasBaixas(baixas, custos);
    await gravarPerda({
      lojaId: loja.id, userId: quem.id, custos, baixas, prefixo: "descarte",
      nota: `Desperdício: ${p.quantidade} ${insumo.unit} de ${insumo.name} · motivo: ${motivo} · por ${quem.nome}`.slice(0, 500),
      linha: { ...base, item: insumo.name, quantidade: p.quantidade, unidade: insumo.unit, situacao: "INSUMO", casouCom: insumo.name, valor },
    });
    return { item: insumo.name, situacao: "INSUMO", valor, baixas: 1, aviso: valor == null ? `${insumo.name} está sem custo: lance a compra dele para o desperdício ter valor.` : null };
  }

  const produto = await prisma.menuProduct.findFirst({
    where: { id: p.produtoId, franchiseeId: loja.id },
    select: { id: true, name: true, cost: true, recipeItems: { select: { stockItemId: true, quantityConsumed: true } } },
  });
  if (!produto) throw new DesperdicioRecusado("Produto não encontrado no cardápio desta loja.");
  const ficha = produto.recipeItems.map((r) => ({ stockItemId: r.stockItemId, quantidade: r.quantityConsumed }));
  const baixas = baixasDaFicha(ficha, p.quantidade);
  const nota = `Desperdício: ${p.quantidade}x ${produto.name} · motivo: ${motivo} · por ${quem.nome} (produto: ${produto.id})`.slice(0, 500);

  if (baixas.length > 0) {
    const valor = valorDasBaixas(baixas, custos);
    await gravarPerda({
      lojaId: loja.id, userId: quem.id, custos, baixas, nota, prefixo: "descarte",
      linha: { ...base, item: produto.name, quantidade: p.quantidade, unidade: "un", situacao: "PRODUTO", casouCom: produto.name, valor },
    });
    return {
      item: produto.name, situacao: "PRODUTO", valor, baixas: baixas.length,
      aviso: valor == null ? "A ficha tem insumo sem custo: o estoque baixou, mas o valor fica de fora até a compra dele ser lançada." : null,
    };
  }

  // Sem ficha: não há insumo para baixar. O custo digitado no produto dá o valor.
  const custo = Number(produto.cost) > 0 ? Number(produto.cost) : null;
  const valor = custo != null ? r2(custo * p.quantidade) : null;
  const situacao = custo != null ? "CUSTO_DO_PRODUTO" : "SEM_CUSTO";
  await gravarPerda({
    lojaId: loja.id, userId: quem.id, custos, baixas: [], nota, prefixo: "descarte",
    linha: { ...base, item: produto.name, quantidade: p.quantidade, unidade: "un", situacao, casouCom: produto.name, valor },
  });
  return {
    item: produto.name, situacao, valor, baixas: 0,
    aviso: custo != null
      ? "Produto sem ficha técnica: o estoque não baixou; o valor é o custo digitado no produto."
      : "Produto sem ficha técnica e sem custo: ficou registrado, mas não dá para calcular o valor. Monte a ficha técnica (aba Fichas Técnicas) ou digite o custo no cardápio.",
  };
}

// ── O que a tela lista ────────────────────────────────────────────────────

export type DesperdicioLancado = {
  quando: string;
  item: string;
  tipo: "PRODUTO" | "INSUMO";
  quantidade: number | null;
  unidade: string | null;
  motivo: string | null;
  quem: string | null;
  /** "Estoque" (esta aba), "Perda" (Movimentar › Perda / QR), "FireCheck". */
  origem: string;
  valor: number | null;
  /** O valor é o que o funcionário estimou no FireCheck (não casou com nada). */
  estimado: boolean;
};

export type DesperdicioDeCancelado = {
  pedidoId: string;
  numero: string;
  quando: string;
  etapa: EtapaDoDesperdicio | null;
  etapaTexto: string;
  motivo: string | null;
  /** Soma das baixas que viraram desperdício; null = nada saiu do estoque (produto sem ficha). */
  valor: number | null;
  insumos: number;
};

export type DesperdicioDoPeriodo = {
  lancados: DesperdicioLancado[];
  cancelados: DesperdicioDeCancelado[];
  totais: { lancados: number; cancelados: number; total: number; semValor: number };
};

const valorDoMovimento = (t: { quantity: number; unitCost: number | null; stockItem: { unitCost: number | null } }) =>
  Math.abs(t.quantity) * (Number(t.unitCost ?? t.stockItem.unitCost) || 0);

/**
 * Os desperdícios do período (dia operacional da loja): os lançados (aqui, na
 * Perda do Movimentar e no FireCheck) e os pedidos cancelados já produzidos.
 * Os cancelados vão pelo dia do PEDIDO, como o CMV conta o consumo.
 */
export async function desperdiciosDoPeriodo(lojaId: string, tz: string, de: string, ate: string): Promise<DesperdicioDoPeriodo> {
  const { inicio, fim } = janelaDoPeriodo(de, ate, tz);

  const [linhas, movimentos, cancelados] = await Promise.all([
    prisma.descarteDoFirecheck.findMany({
      where: { franchiseeId: lojaId, registradoEm: { gte: inicio, lt: fim } },
      orderBy: { registradoEm: "desc" },
      take: 500,
    }),
    prisma.stockTransaction.findMany({
      where: { franchiseeId: lojaId, type: "WASTE", createdAt: { gte: new Date(inicio.getTime() - 2 * 86_400_000), lt: fim } },
      select: {
        quantity: true, unitCost: true, notes: true, sourceRef: true, createdAt: true, userId: true,
        stockItem: { select: { name: true, unit: true, unitCost: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.customerOrder.findMany({
      where: { franchiseeId: lojaId, createdAt: { gte: inicio, lt: fim }, status: { in: ["CANCELADO", "CANCELLED", "CANCELED"] } },
      select: {
        id: true, dailyOrderNumber: true, createdAt: true, cancelReason: true, status: true, cancelledAt: true,
        dispatchedAt: true, deliveredAt: true, readyAt: true, kdsFinishedAt: true, kdsStage: true,
        items: { select: { prontoEm: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Movimentos: os do cancelado já produzido (pela marca), os que têm linha
  // (FireCheck e esta aba — a linha já conta) e os soltos (Perda e QR).
  const valorDoPedido = new Map<string, { valor: number; insumos: number }>();
  const soltos: typeof movimentos = [];
  for (const t of movimentos) {
    const pedido = pedidoDaMarca(t.notes);
    if (pedido) {
      const atual = valorDoPedido.get(pedido) || { valor: 0, insumos: 0 };
      atual.valor += valorDoMovimento(t);
      atual.insumos++;
      valorDoPedido.set(pedido, atual);
      continue;
    }
    if (/^(firecheck|descarte):/.test(t.sourceRef || "")) continue;
    if (t.createdAt >= inicio) soltos.push(t);
  }

  const ids = [...new Set(soltos.map((t) => t.userId).filter(Boolean) as string[])];
  const pessoas = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nomeDe = new Map(pessoas.map((u) => [u.id, u.name || u.email || "—"]));

  const lancados: DesperdicioLancado[] = [
    ...linhas.map((l): DesperdicioLancado => {
      const doFirehub = l.idExterno.startsWith(PREFIXO_DO_FIREHUB);
      const estimado = l.situacao === "SEM_CORRESPONDENCIA";
      return {
        quando: l.registradoEm.toISOString(),
        item: l.casouCom || l.item,
        tipo: l.situacao === "INSUMO" ? "INSUMO" : "PRODUTO",
        quantidade: l.quantidade,
        unidade: l.unidade,
        motivo: l.motivo,
        quem: l.funcionario,
        origem: doFirehub ? "Estoque" : "FireCheck",
        valor: estimado ? l.valorEstimado : l.valor,
        estimado,
      };
    }),
    ...soltos.map((t): DesperdicioLancado => ({
      quando: t.createdAt.toISOString(),
      item: t.stockItem.name,
      tipo: "INSUMO",
      quantidade: Math.round(Math.abs(t.quantity) * 1000) / 1000,
      unidade: t.stockItem.unit,
      motivo: t.notes,
      quem: t.userId ? nomeDe.get(t.userId) || null : null,
      origem: "Perda",
      valor: (t.unitCost ?? t.stockItem.unitCost) != null ? r2(valorDoMovimento(t)) : null,
      estimado: false,
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando));

  const canceladosProduzidos: DesperdicioDeCancelado[] = [];
  for (const o of cancelados) {
    const etapa = etapaAntesDoCancelamento(o);
    if (!etapa) continue;
    const v = valorDoPedido.get(o.id);
    canceladosProduzidos.push({
      pedidoId: o.id,
      numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : `#${o.id.slice(-4).toUpperCase()}`,
      quando: o.createdAt.toISOString(),
      etapa,
      etapaTexto: ROTULO_DA_ETAPA[etapa],
      motivo: o.cancelReason,
      valor: v ? r2(v.valor) : null,
      insumos: v?.insumos ?? 0,
    });
  }

  const soma = (l: { valor: number | null }[]) => r2(l.reduce((s, x) => s + (x.valor || 0), 0));
  const tLancados = soma(lancados);
  const tCancelados = soma(canceladosProduzidos);
  return {
    lancados,
    cancelados: canceladosProduzidos,
    totais: {
      lancados: tLancados,
      cancelados: tCancelados,
      total: r2(tLancados + tCancelados),
      semValor: lancados.filter((l) => l.valor == null).length + canceladosProduzidos.filter((c) => c.valor == null).length,
    },
  };
}

