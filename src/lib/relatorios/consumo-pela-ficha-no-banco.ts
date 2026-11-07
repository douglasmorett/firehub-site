/**
 * O lado do SERVIDOR do consumo pela ficha (lib/relatorios/consumo-pela-
 * ficha.ts): os insumos das lojas do relatório com saldo, mínimo, ideal,
 * fornecedor e o custo de hoje, e o consumo de cada dia das vendas da janela.
 * Usado pela Lista de compras e pela Previsão de insumos.
 */
import { prisma } from "@/lib/prisma";
import { custosNoDia, type InsumoParaCusto } from "@/lib/cmv/custo-do-insumo";
import { entradasComCusto, insumosParaCusto } from "@/lib/cmv/contagem-no-banco";
import { idealDosInsumos } from "@/lib/cmv/ideal-no-banco";
import { carregarCatalogo } from "@/lib/financeiro/cmv-do-financeiro";
import { consumoPorDia, ehPreparoComReceita, type ConsumoPorDia } from "@/lib/relatorios/consumo-pela-ficha";
import { naLoja } from "@/lib/relatorios/base";
import { pedidosDoRelatorio, type ContextoDoRelatorio } from "@/lib/relatorios/servidor";

export type InsumoDaLoja = InsumoParaCusto & {
  lojaId: string;
  saldo: number;
  minimo: number | null;
  ideal: number | null;
  fornecedor: string | null;
  /** Custo de hoje por unidade; null = sem custo. */
  custoHoje: number | null;
  /** Preparo com receita: a cozinha produz, não se compra. */
  preparo: boolean;
};

export type ConsumoDasLojas = {
  insumos: InsumoDaLoja[];
  consumo: ConsumoPorDia;
  /** O primeiro dia da janela com venda (a loja nova no FireHub tem menos dias de base). */
  primeiroDiaComVenda: string | null;
  temFicha: boolean;
};

export async function consumoDasLojas(ctx: ContextoDoRelatorio, janela: { inicio: Date; fim: Date }): Promise<ConsumoDasLojas> {
  const [pedidos, porLoja] = await Promise.all([
    // Com as reposições: não são venda, mas a troca gasta insumo de verdade.
    pedidosDoRelatorio(ctx, {
      janela,
      comReposicoes: true,
      select: { items: { select: { quantity: true, price: true, productName: true, menuProductId: true, comboSelections: true } } },
    }),
    Promise.all(ctx.lojaIds.map(async (lojaId) => {
      const [catalogo, insumos, entradas, extras] = await Promise.all([
        carregarCatalogo(lojaId),
        insumosParaCusto(lojaId),
        entradasComCusto(lojaId, ctx.tz),
        prisma.stockItem.findMany({ where: { franchiseeId: lojaId, NOT: { active: false } }, select: { id: true, minQuantity: true, supplier: true } }),
      ]);
      return { lojaId, catalogo, insumos, entradas, extras };
    })),
  ]);

  const ideais = await idealDosInsumos(porLoja.flatMap((l) => l.insumos.map((i) => i.id)));
  const consumo: ConsumoPorDia = { porDia: new Map(), semFicha: new Map(), incompletos: 0 };
  const insumos: InsumoDaLoja[] = [];
  let temFicha = false;
  for (const l of porLoja) {
    temFicha = temFicha || l.catalogo.usaFicha;
    const custos = custosNoDia(l.insumos, l.entradas, ctx.hoje);
    const extra = new Map(l.extras.map((x) => [x.id, x]));
    for (const i of l.insumos) {
      const x = extra.get(i.id);
      insumos.push({
        ...i, lojaId: l.lojaId, saldo: i.quantidade,
        minimo: x?.minQuantity ?? null, ideal: ideais.get(i.id) ?? null, fornecedor: x?.supplier ?? null,
        custoHoje: custos.get(i.id)?.custo ?? null, preparo: ehPreparoComReceita(i),
      });
    }
    const daLoja = pedidos.filter((p) => p.franchiseeId === l.lojaId).map((p) => ({
      createdAt: p.createdAt,
      items: (p.items || []).map((it: any) => ({
        produtoId: it.menuProductId, nome: it.productName, quantidade: Number(it.quantity) || 0, preco: Number(it.price) || 0, escolhas: it.comboSelections,
      })),
    }));
    consumoPorDia(daLoja, l.catalogo, ctx.tz, consumo);
  }
  const primeiro = pedidos.length ? naLoja(pedidos[0].createdAt, ctx.tz).dia : null;
  return { insumos, consumo, primeiroDiaComVenda: primeiro, temFicha };
}
