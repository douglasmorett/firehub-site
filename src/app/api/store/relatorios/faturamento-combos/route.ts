/**
 * GET /api/store/relatorios/faturamento-combos — por dia: vendas com combo,
 * % das vendas com combo, quanto os combos venderam e o ticket da venda com
 * combo contra a sem combo; e os combos que mais venderam.
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/faturamento-combos.ts (testada em
 * scripts/teste-faturamento-combos.ts), com a régua única de
 * lib/relatorios/regua-da-venda.ts — vendas e valor batem com o Faturamento
 * por dia.
 *
 * O que se busca: os pedidos da janela com as colunas dos filtros, o
 * `parentOrderId` (a régua) e, dos itens, quantidade, preço, nome e as três
 * colunas do produto que dizem se é combo; e os NOMES dos produtos marcados
 * como combo no cardápio (o item do iFood chega com produto espelho, sem a
 * marca — casa pelo nome).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { NOMES_DOS_DIAS, ROTULO_DO_TIPO, fmtDia } from "@/lib/relatorios/base";
import { faturamentoDeCombos, type DiaDeCombos, type PedidoParaCombos, type SomaDeCombos } from "@/lib/relatorios/faturamento-combos";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const [pedidos, combosDoCardapio] = await Promise.all([
    pedidosDoRelatorio(ctx, {
      select: {
        parentOrderId: true,
        items: { select: { quantity: true, price: true, productName: true, menuProduct: { select: { isCombo: true, name: true, category: true } } } },
      },
    }),
    prisma.menuProduct.findMany({ where: { franchiseeId: { in: ctx.lojaIds }, isCombo: true }, select: { name: true } }),
  ]);

  const resultado = faturamentoDeCombos({
    de: f.de, ate: f.ate, tz: ctx.tz, hoje: ctx.hoje,
    pedidos: pedidos as unknown as PedidoParaCombos[],
    nomesDeCombo: combosDoCardapio.map((p) => p.name),
  });

  const cabecalho = cabecalhoDoRelatorio(ctx);
  const corpo = { ...cabecalho, ...resultado, combosNoCardapio: combosDoCardapio.length };

  if (sp.get("formato") !== "xlsx") return NextResponse.json(corpo);

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const filtrosEmTexto = [
    f.horaDe || f.horaAte ? `Horário ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    f.marcas.length ? `Marcas: ${f.marcas.map((m) => cabecalho.marcas.find((x) => x.chave === m)?.rotulo || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const R = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "pctNegrito" : "pct" });

  const colunas = (s: SomaDeCombos, negrito = false): Celula[] => [
    Q(s.vendas, negrito), Q(s.vendasComCombo, negrito), P(s.pctComCombo, negrito), Q(s.combos, negrito), R(s.valorDosCombos, negrito),
    R(s.valor, negrito), P(s.pctDoValor, negrito), R(s.ticketComCombo, negrito), R(s.ticketSemCombo, negrito),
  ];
  const linhaDoDia = (d: DiaDeCombos): LinhaDaPlanilha => ({
    celulas: [fmtDia(d.dia), `${NOMES_DOS_DIAS[d.diaSemana]}${d.estado === "hoje" ? " (hoje, ainda aberto)" : ""}`, ...(d.estado === "futuro" ? [] : colunas(d))],
  });
  const dif = resultado.diferencaDoTicket;

  const linhas: Array<LinhaDaPlanilha | Celula[]> = [
    { celulas: [{ v: `Faturamento de combos — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: "Venda com combo: algum pedido dela tem combo (a mesa conta uma vez). Valor dos combos: preço × quantidade dos combos, sem a entrega. Faturamento e vendas são os do Faturamento por dia.", estilo: "suave" }] },
    { celulas: [] },
    {
      celulas: ["Data", "Dia", "Vendas", "Com combo", "% com combo", "Combos vendidos", "Valor dos combos", "Faturamento", "% do faturamento", "Ticket com combo", "Ticket sem combo"],
      estilo: "cabecalho",
    },
    ...resultado.dias.map(linhaDoDia),
    { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", ...colunas(resultado.total, true)] },
    { celulas: [] },
  ];
  if (dif) {
    linhas.push({ celulas: [`Quem leva combo gasta ${dif.reais >= 0 ? "a mais" : "a menos"} por venda`, "", "", "", "", "", R(Math.abs(dif.reais)), "", P(dif.pct === null ? null : Math.abs(dif.pct))] });
    linhas.push({ celulas: [] });
  }
  linhas.push(
    { celulas: [{ v: "Combos que mais venderam", estilo: "negrito" }] },
    { celulas: ["Combo", "", "Quantidade", "Vendas", "", "", "Valor"], estilo: "cabecalho" },
    ...resultado.ranking.map((c) => ({ celulas: [c.nome, "", Q(c.quantidade), Q(c.vendas), "", "", R(c.valor)] })),
    { celulas: [] },
    { celulas: [{ v: "Combo é o produto marcado como combo no cardápio, o item com o nome de um combo do cardápio (o do iFood/99) ou com \"combo\" no nome ou na categoria.", estilo: "suave" }] },
  );

  const buffer = montarPlanilha([{
    nome: "Faturamento de combos",
    congelarLinhas: 6,
    larguras: [26, 26, 9, 11, 12, 14, 16, 15, 14, 15, 15],
    linhas,
  }]);
  return respostaDePlanilha(buffer, `faturamento-combos_${f.de}_a_${f.ate}.xlsx`);
}
