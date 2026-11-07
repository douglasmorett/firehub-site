/**
 * GET /api/store/relatorios/previsao-de-insumos — a Previsão de insumos da
 * semana: quanto de cada insumo vai sair em cada um dos próximos 7 dias (a
 * partir de amanhã), pela média do mesmo dia da semana nas últimas semanas ×
 * a ficha técnica de hoje (lib/relatorios/previsao-de-insumos.ts).
 *
 *   semanas=2|4|8   quantas semanas de vendas entram na média (padrão 4, terminando ontem)
 *   formato=xlsx    a planilha (média, −10% e +10%)
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { consumoDasLojas } from "@/lib/relatorios/consumo-pela-ficha-no-banco";
import { separarPreparos } from "@/lib/relatorios/consumo-pela-ficha";
import { FAIXAS, previsaoDeInsumos, proximosDias, type ResultadoDaPrevisao } from "@/lib/relatorios/previsao-de-insumos";
import { fmtDia, somarDias } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const SEMANAS = [2, 4, 8];

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const semanas = SEMANAS.includes(Number(sp.get("semanas"))) ? Number(sp.get("semanas")) : 4;
  const de = somarDias(ctx.hoje, -semanas * 7);
  const ate = somarDias(ctx.hoje, -1);
  const { insumos, consumo, primeiroDiaComVenda, temFicha } = await consumoDasLojas(ctx, janelaDoPeriodo(de, ate, ctx.tz));

  // Os dias antes da primeira venda (loja nova no FireHub) não entram: seriam zeros que não aconteceram.
  const inicioReal = primeiroDiaComVenda && primeiroDiaComVenda > de ? primeiroDiaComVenda : de;
  const diasDaBase: string[] = [];
  for (let d = inicioReal; d <= ate; d = somarDias(d, 1)) diasDaBase.push(d);

  // Cada dia separado em comprados (com o preparo descido) e preparos.
  const comprados = new Map<string, Map<string, number>>();
  const preparos = new Map<string, Map<string, number>>();
  for (const [dia, direto] of consumo.porDia) {
    const s = separarPreparos(direto, insumos);
    comprados.set(dia, s.comprados);
    preparos.set(dia, s.preparos);
  }
  const dias = proximosDias(somarDias(ctx.hoje, 1), 7);
  const paraPrevisao = (i: (typeof insumos)[number]) => ({ id: i.id, nome: i.nome, unidade: i.unidade, custo: i.custoHoje });
  const insumosDaPrevisao = previsaoDeInsumos({ consumoPorDia: comprados, diasDaBase, dias, insumos: insumos.filter((i) => !i.preparo).map(paraPrevisao) });
  const preparosDaPrevisao = previsaoDeInsumos({ consumoPorDia: preparos, diasDaBase, dias, insumos: insumos.filter((i) => i.preparo).map(paraPrevisao) });
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const semFicha = [...consumo.semFicha].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({
      ...cabecalho,
      base: { de: inicioReal, ate, dias: diasDaBase.length, semanas },
      temFicha, insumos: insumosDaPrevisao, preparos: preparosDaPrevisao,
      semFicha: { produtos: semFicha.slice(0, 15), total: semFicha.length }, incompletos: consumo.incompletos,
    });
  }

  // ── A PLANILHA: uma aba por faixa (média, −10%, +10%) ──
  const loja = cabecalho.lojas.join(" / ");
  const aba = (nome: string, fator: number, p: ResultadoDaPrevisao, titulo: string): AbaDaPlanilha => {
    const topo: LinhaDaPlanilha[] = [
      { celulas: [{ v: `${titulo} — ${loja}`, estilo: "titulo" }] },
      { celulas: [{ v: `${nome}: média do mesmo dia da semana de ${fmtDia(inicioReal)} a ${fmtDia(ate)} × a ficha técnica de hoje${fator !== 1 ? ` × ${String(fator).replace(".", ",")}` : ""}. Custo = o de hoje do insumo.`, estilo: "suave" }] },
      { celulas: [] },
    ];
    return {
      nome,
      congelarLinhas: topo.length + 1,
      larguras: [34, 8, ...p.dias.map(() => 12), 12, 14],
      linhas: [
        ...topo,
        { celulas: ["Insumo", "Unid.", ...p.dias.map((d) => d.rotulo), "Semana", "Custo previsto"], estilo: "cabecalho" as const },
        ...p.linhas.map((l): LinhaDaPlanilha => ({
          celulas: [
            l.nome, l.unidade, ...l.porDia.map((q) => ({ v: Math.round(q * fator * 1000) / 1000, estilo: "qtd" as const })),
            { v: Math.round(l.total * fator * 1000) / 1000, estilo: "qtdNegrito" },
            l.custoTotal == null ? { v: "sem custo", estilo: "suave" } : { v: Math.round(l.custoTotal * fator * 100) / 100, estilo: "reais" },
          ],
        })),
        { celulas: [{ v: "CUSTO DO DIA", estilo: "negrito" as const }, "", ...p.dias.map((d) => ({ v: Math.round(d.custo * fator * 100) / 100, estilo: "reaisNegrito" as const })), "", { v: Math.round(p.totais.custo * fator * 100) / 100, estilo: "reaisNegrito" as const }] },
      ],
    };
  };
  const buffer = montarPlanilha([
    aba("Média", FAIXAS.media, insumosDaPrevisao, "Previsão de insumos"),
    aba("Menos 10%", FAIXAS.menos10, insumosDaPrevisao, "Previsão de insumos"),
    aba("Mais 10%", FAIXAS.mais10, insumosDaPrevisao, "Previsão de insumos"),
    ...(preparosDaPrevisao.linhas.length ? [aba("Preparos", FAIXAS.media, preparosDaPrevisao, "Previsão de preparos (produzir)")] : []),
  ]);
  return respostaDePlanilha(buffer, `previsao-de-insumos_${dias[0]}_a_${dias[6]}.xlsx`);
}
