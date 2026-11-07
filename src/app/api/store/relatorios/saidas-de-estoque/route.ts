/**
 * GET /api/store/relatorios/saidas-de-estoque — tudo o que saiu do estoque
 * sem ser venda, por motivo, com o custo (lib/relatorios/saidas-de-estoque.ts):
 * as perdas e descartes (lib/cmv/desperdicio.ts, `desperdiciosDoPeriodo`), o
 * cancelado já produzido e a saída manual (OUTPUT).
 *
 * Período no dia operacional da loja (vira às 5h). formato=xlsx: a planilha.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { desperdiciosDoPeriodo } from "@/lib/cmv/desperdicio";
import { MOTIVOS_DE_SAIDA, saidasPorMotivo, type SaidaLancada } from "@/lib/relatorios/saidas-de-estoque";
import { fmtDia, naLoja } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;

  const [perdas, saidasManuais] = await Promise.all([
    Promise.all(ctx.lojaIds.map((id) => desperdiciosDoPeriodo(id, ctx.tz, ctx.filtros.de, ctx.filtros.ate))),
    prisma.stockTransaction.findMany({
      where: { type: "OUTPUT", createdAt: { gte: ctx.inicio, lt: ctx.fim }, stockItem: { franchiseeId: { in: ctx.lojaIds } } },
      select: { quantity: true, unitCost: true, notes: true, createdAt: true, userId: true, stockItem: { select: { name: true, unit: true, unitCost: true } } },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
  ]);
  const ids = [...new Set(saidasManuais.map((t) => t.userId).filter(Boolean) as string[])];
  const pessoas = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nomeDe = new Map(pessoas.map((u) => [u.id, u.name || u.email || "—"]));

  const saidas: SaidaLancada[] = [];
  for (const p of perdas) {
    for (const l of p.lancados) {
      saidas.push({ quando: l.quando, item: l.item, tipo: l.tipo, quantidade: l.quantidade, unidade: l.unidade, motivoTexto: l.motivo, quem: l.quem, origem: l.origem === "Estoque" ? "Perdas e descarte" : l.origem, valor: l.valor });
    }
    for (const c of p.cancelados) {
      saidas.push({ quando: c.quando, item: `Pedido ${c.numero} (${c.etapaTexto})`, tipo: "PRODUTO", quantidade: null, unidade: null, motivoTexto: c.motivo, quem: null, origem: "Cancelado", valor: c.valor, motivo: "cancelado" });
    }
  }
  for (const t of saidasManuais) {
    const custo = t.unitCost ?? t.stockItem.unitCost;
    saidas.push({
      quando: t.createdAt.toISOString(), item: t.stockItem.name, tipo: "INSUMO",
      quantidade: Math.round(Math.abs(t.quantity) * 1000) / 1000, unidade: t.stockItem.unit, motivoTexto: t.notes,
      quem: t.userId ? nomeDe.get(t.userId) || null : null, origem: "Saída manual",
      valor: custo != null ? r2(Math.abs(t.quantity) * custo) : null,
    });
  }
  const resultado = saidasPorMotivo(saidas);
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  const rotulo = new Map(MOTIVOS_DE_SAIDA.map((m) => [m.chave, m.rotulo]));
  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Saídas de estoque — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h). Tudo o que saiu sem ser venda: perdas, descartes, cancelado já feito e saída manual.`, estilo: "suave" }] },
    { celulas: [] },
  ];
  const buffer = montarPlanilha([
    {
      nome: "Por motivo",
      congelarLinhas: topo.length + 1,
      larguras: [30, 14, 16, 14],
      linhas: [
        ...topo,
        { celulas: ["Motivo", "Lançamentos", "Custo", "Sem valor"], estilo: "cabecalho" },
        ...resultado.porMotivo.map((m) => ({ celulas: [m.rotulo, { v: m.lancamentos, estilo: "qtd" as const }, { v: m.valor, estilo: "reais" as const }, { v: m.semValor, estilo: "qtd" as const }] })),
        { celulas: [{ v: "TOTAL", estilo: "negrito" }, { v: resultado.totais.lancamentos, estilo: "qtdNegrito" }, { v: resultado.totais.valor, estilo: "reaisNegrito" }, { v: resultado.totais.semValor, estilo: "qtdNegrito" }] },
      ],
    },
    {
      nome: "Lançamentos",
      congelarLinhas: topo.length + 1,
      larguras: [17, 34, 12, 8, 26, 40, 20, 20, 14],
      linhas: [
        ...topo,
        { celulas: ["Quando", "Item", "Qtde", "Unid.", "Motivo", "O que foi escrito", "Origem", "Quem", "Custo"], estilo: "cabecalho" },
        ...resultado.linhas.map((l) => {
          const q = naLoja(l.quando, ctx.tz);
          return {
            celulas: [`${fmtDia(q.dia)} ${String(Math.floor(q.minutos / 60)).padStart(2, "0")}:${String(q.minutos % 60).padStart(2, "0")}`, l.item, { v: l.quantidade, estilo: "qtd" as const }, l.unidade || "",
              rotulo.get(l.motivo) || "", l.motivoTexto || "", l.origem, l.quem || "", l.valor == null ? { v: "sem valor", estilo: "suave" as const } : { v: l.valor, estilo: "reais" as const }],
          };
        }),
      ],
    },
  ]);
  return respostaDePlanilha(buffer, `saidas-de-estoque_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
