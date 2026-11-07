/**
 * GET /api/store/relatorios/historico-de-contagens — as contagens fechadas do
 * período (pelo dia que cada uma fecha) com a diferença em R$, e os insumos
 * que mais somem (lib/relatorios/historico-de-contagens.ts).
 *
 * R$ da contagem é dado sensível, como na tela da contagem
 * (api/store/estoque/contagens): o funcionário só vê com "Dados sensíveis".
 *   formato=xlsx   a planilha
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { historicoDeContagens } from "@/lib/relatorios/historico-de-contagens";
import { PERMISSAO_DADOS_SENSIVEIS, temPermissao } from "@/lib/cmv/acesso";
import { fmtDia } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  if (ctx.papel === "STAFF") {
    const u = await prisma.user.findUnique({ where: { id: ctx.usuarioId }, select: { permissions: true } });
    if (!temPermissao(u?.permissions, PERMISSAO_DADOS_SENSIVEIS)) {
      return NextResponse.json({ error: "O valor das contagens é dado sensível: peça ao dono da loja para marcar \"Dados sensíveis\" no seu cadastro em Equipe." }, { status: 403 });
    }
  }

  const fechadas = await prisma.contagemDeEstoque.findMany({
    where: { franchiseeId: { in: ctx.lojaIds }, status: "FECHADA", dia: { gte: ctx.filtros.de, lte: ctx.filtros.ate } },
    select: {
      id: true, dia: true, tipo: true, valorTotal: true,
      itens: { select: { stockItemId: true, nome: true, unidade: true, contado: true, quantidade: true, origem: true, saldoSistema: true, custoUnitario: true } },
    },
    orderBy: { dia: "desc" },
    take: 120,
  });
  const resultado = historicoDeContagens(fechadas);
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Histórico das contagens — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Contagens fechadas de ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)}. Diferença = contado − o que o sistema dizia, × o custo da contagem. Negativo = faltou.`, estilo: "suave" }] },
    { celulas: [] },
  ];
  const buffer = montarPlanilha([
    {
      nome: "Contagens",
      congelarLinhas: topo.length + 1,
      larguras: [14, 12, 16, 12, 14, 14, 14, 12],
      linhas: [
        ...topo,
        { celulas: ["Dia", "Tipo", "Valor contado", "Itens contados", "Faltou (R$)", "Sobrou (R$)", "Diferença (R$)", "Sem custo"], estilo: "cabecalho" },
        ...resultado.contagens.map((c) => ({
          celulas: [fmtDia(c.dia), c.tipo === "RAPIDA" ? "Rápida" : "Completa", { v: c.valorTotal, estilo: "reais" as const }, { v: c.contados, estilo: "qtd" as const },
            { v: c.faltou, estilo: "reais" as const }, { v: c.sobrou, estilo: "reais" as const }, { v: c.liquido, estilo: "reaisNegrito" as const }, { v: c.semCusto, estilo: "qtd" as const }],
        })),
      ],
    },
    {
      nome: "Diferenças",
      congelarLinhas: topo.length + 1,
      larguras: [14, 34, 8, 14, 14, 14, 14],
      linhas: [
        ...topo,
        { celulas: ["Dia", "Insumo", "Unid.", "Sistema", "Contado", "Diferença", "R$"], estilo: "cabecalho" },
        ...resultado.contagens.flatMap((c) => c.diferencas.map((d) => ({
          celulas: [fmtDia(c.dia), d.nome, d.unidade, { v: d.sistema, estilo: "qtd" as const }, { v: d.contado, estilo: "qtd" as const }, { v: d.diferenca, estilo: "qtdNegrito" as const },
            d.valor == null ? { v: "sem custo", estilo: "suave" as const } : { v: d.valor, estilo: "reais" as const }],
        }))),
      ],
    },
    {
      nome: "Insumos que somem",
      congelarLinhas: topo.length + 1,
      larguras: [34, 8, 12, 14, 14],
      linhas: [
        ...topo,
        { celulas: ["Insumo", "Unid.", "Contagens", "Faltou (qtd)", "Faltou (R$)"], estilo: "cabecalho" },
        ...resultado.queSomem.map((q) => ({
          celulas: [q.nome, q.unidade, { v: q.contagens, estilo: "qtd" as const }, { v: q.diferenca, estilo: "qtd" as const }, q.valor == null ? { v: "sem custo", estilo: "suave" as const } : { v: q.valor, estilo: "reais" as const }],
        })),
      ],
    },
  ]);
  return respostaDePlanilha(buffer, `historico-de-contagens_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
