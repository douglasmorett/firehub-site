/**
 * A busca dos recebíveis (lib/relatorios/recebiveis.ts) para as rotas do
 * Contas a receber e do Fluxo de caixa: os pedidos com as colunas do
 * Plataformas e repasses, as contas de mesa FECHADAS com as baixas, e a
 * configuração da loja dona (prazos, taxa da maquininha, comissão dos apps).
 */
import { prisma } from "@/lib/prisma";
import { emLotes, janelaDoPeriodo, pedidosDoRelatorio, type ContextoDoRelatorio } from "@/lib/relatorios/servidor";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import { precisaDoDetalheDoCupom, type MesaParaFormas } from "@/lib/relatorios/formas-de-pagamento";
import { precisaDoDetalheDoDesconto } from "@/lib/relatorios/vendas";
import { COLUNAS_DO_PEDIDO, type PedidoDaPlataforma } from "@/lib/relatorios/plataformas";
import { lerComissoesDosApps, taxaDaForma, type ComissoesDosApps, type FormaComTaxa } from "@/lib/financeiro/dre";
import {
  APPS_DO_RECEBIVEL, FORMAS_DO_RECEBIVEL, lerPrazosDeRecebimento, recebiveisDasVendas,
  type PrazosDeRecebimento, type ResultadoDosRecebiveis,
} from "@/lib/relatorios/recebiveis";

export type ConfiguracaoDosRecebiveis = {
  prazos: PrazosDeRecebimento;
  paymentFees: unknown;
  comissoes: ComissoesDosApps;
  financialGoals: unknown;
};

/** A configuração da loja dona (a mesma do Financeiro). */
export async function configuracaoDosRecebiveis(donoId: string): Promise<ConfiguracaoDosRecebiveis> {
  const dono = await prisma.user.findUnique({ where: { id: donoId }, select: { financialGoals: true, paymentFees: true } });
  return {
    prazos: lerPrazosDeRecebimento(dono?.financialGoals),
    paymentFees: dono?.paymentFees ?? null,
    comissoes: lerComissoesDosApps(dono?.financialGoals),
    financialGoals: dono?.financialGoals ?? null,
  };
}

/** O maior prazo cadastrado: até quantos dias antes a venda ainda cai no período (+2 do fim de semana). */
export const maiorPrazo = (p: PrazosDeRecebimento) => Math.max(0, ...Object.values(p.dias)) + 2;

/** Os recebíveis das vendas feitas de `de` a `ate` (dias operacionais). */
export async function recebiveisDasVendasDoPeriodo(
  ctx: ContextoDoRelatorio, de: string, ate: string, cfg: ConfiguracaoDosRecebiveis,
): Promise<ResultadoDosRecebiveis> {
  if (de > ate) return { recebiveis: [], fora: [], semComissao: [], semTaxa: [] };
  const janela = janelaDoPeriodo(de, ate, ctx.tz);
  const [pedidos, mesasDoPeriodo] = await Promise.all([
    pedidosDoRelatorio(ctx, { janela, select: COLUNAS_DO_PEDIDO }),
    mesasFechadasDoPeriodo(ctx, janela, { comPagamentos: true }),
  ]);
  // Observação e detalhe do desconto (campos pesados) só de quem precisa — a
  // mesma economia do Plataformas e repasses.
  const precisam = pedidos.filter((p) => precisaDoDetalheDoCupom(p as any) || precisaDoDetalheDoDesconto(p as any)).map((p) => p.id);
  const detalhes = await emLotes(precisam, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote } }, select: { id: true, notes: true, discountDetails: true },
  }));
  const doDetalhe = new Map(detalhes.map((d) => [d.id, d]));
  const completos = pedidos.map((p) => {
    const d = doDetalhe.get(p.id);
    return (d ? { ...p, notes: d.notes, discountDetails: d.discountDetails } : p) as PedidoDaPlataforma;
  });
  const mesas: MesaParaFormas[] = mesasDoPeriodo.map((s) => ({
    id: s.id, fechadaEm: s.fechadaEm, totalPago: s.pago ?? null, taxaDeServico: s.serviceFee ?? null, gorjeta: s.waiterTip ?? null,
    pagamentos: s.pagamentos, pedidos: s.pedidos.map((o) => ({ id: o.id, totalAmount: o.totalAmount, status: o.status, discountTotal: o.discountTotal })),
  }));
  return recebiveisDasVendas(completos, mesas, { tz: ctx.tz, prazos: cfg.prazos, paymentFees: cfg.paymentFees, comissoes: cfg.comissoes });
}

export type PrazoNaTela = { chave: string; rotulo: string; tipo: "LOJA" | "APP"; dias: number; padrao: boolean; taxa: string };

/**
 * Os prazos para o quadro "Prazos de recebimento" da tela: as formas da loja
 * sempre; os apps que venderam ou que têm prazo ou comissão cadastrados.
 */
export function prazosParaTela(cfg: ConfiguracaoDosRecebiveis, appsComVenda: Set<string>): PrazoNaTela[] {
  const formas: PrazoNaTela[] = FORMAS_DO_RECEBIVEL.map((f) => {
    let taxa = "sem taxa (a do gateway não está cadastrada)";
    if (f.chave !== "SITE") {
      const t = taxaDaForma(cfg.paymentFees, f.chave as FormaComTaxa);
      taxa = !t.configurada ? "taxa não cadastrada" : t.pct > 0 ? `taxa ${t.pct.toLocaleString("pt-BR")}% (${t.comoFoi})` : t.comoFoi;
    }
    return { chave: f.chave, rotulo: f.rotulo, tipo: "LOJA", dias: cfg.prazos.dias[f.chave], padrao: !cfg.prazos.cadastradas.includes(f.chave), taxa };
  });
  const apps: PrazoNaTela[] = APPS_DO_RECEBIVEL
    .filter((a) => appsComVenda.has(a.chave) || cfg.prazos.cadastradas.includes(a.chave) || typeof cfg.comissoes[a.chave] === "number")
    .map((a) => {
      const c = cfg.comissoes[a.chave];
      return {
        chave: a.chave, rotulo: a.rotulo, tipo: "APP", dias: cfg.prazos.dias[a.chave], padrao: !cfg.prazos.cadastradas.includes(a.chave),
        taxa: typeof c === "number" ? `comissão ${c.toLocaleString("pt-BR")}%` : "comissão não cadastrada",
      };
    });
  return [...formas, ...apps];
}
