/**
 * GET /api/store/relatorios/diferencas-de-caixa — os caixas fechados do
 * período somados por operador, por dia e por forma: esperado × contado ×
 * diferença. A conta mora em lib/relatorios/diferencas-de-caixa.ts (testada
 * em scripts/teste-diferencas-de-caixa.ts), com a régua de
 * lib/conferencia-do-caixa.ts — a mesma do Histórico de caixas.
 *
 *   de, ate        o período (pelo dia da ABERTURA do caixa, virando às 5h)
 *   formato=xlsx   baixa a planilha
 *
 * Só para quem tem "Financeiro" (lib/permissao-da-tela.ts): diferença de
 * caixa por pessoa é assunto do dono.
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { fmtDia } from "@/lib/relatorios/base";
import { caixasDoPeriodo } from "@/lib/relatorios/caixas-do-periodo";
import { diferencasDeCaixa, type SomaDasDiferencas } from "@/lib/relatorios/diferencas-de-caixa";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/relatorios/diferencas-de-caixa");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const resultado = diferencasDeCaixa(await caixasDoPeriodo(ctx), ctx.tz);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number | null, negrito = false) => (v == null ? "—" : { v, estilo: negrito ? ("reaisNegrito" as const) : ("reais" as const) });
  const topo = (titulo: string, colunas: string[]): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Caixas abertos de ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} · forma em branco e caixa sem conferência ficam fora da diferença`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: colunas, estilo: "cabecalho" },
  ];
  const COLS = ["", "Caixas", "Sem conferência", "Esperado (conferido)", "Contado", "Diferença", "Faltas", "Sobras"];
  const linha = (rotulo: string, s: SomaDasDiferencas): LinhaDaPlanilha => ({
    celulas: [{ v: rotulo, estilo: "negrito" }, { v: s.caixas, estilo: "qtd" }, { v: s.semConferencia, estilo: "qtd" }, R(s.esperado), R(s.contado), R(s.diferenca, true), R(s.faltas), R(s.sobras)],
  });
  const formas = (s: SomaDasDiferencas): LinhaDaPlanilha[] => s.formas.filter((f) => f.esperado || f.contado).map((f) => ({
    nivel: 1, celulas: [{ v: `    ${f.nome}`, estilo: "suave" }, "", "", R(f.esperadoConferido), R(f.contado), R(f.diferenca), "", `esperado no turno: ${f.esperado.toFixed(2).replace(".", ",")}`],
  }));

  const porOperador: LinhaDaPlanilha[] = [...topo("Diferenças de caixa por operador", ["Operador", ...COLS.slice(1)])];
  for (const o of resultado.porOperador) porOperador.push(linha(o.operador, o), ...formas(o));
  porOperador.push(linha("TOTAL", resultado.total), ...formas(resultado.total));

  const porDia: LinhaDaPlanilha[] = [...topo("Diferenças de caixa por dia", ["Dia", ...COLS.slice(1)])];
  for (const d of resultado.porDia) porDia.push(linha(fmtDia(d.dia), d));

  const caixas: LinhaDaPlanilha[] = [...topo("Caixas do período", ["Dia", "Operador", "Fechado por", "Situação", "Esperado (conferido)", "Contado", "Diferença", "Online (fora)"])];
  const SITUACAO = { CONFERIDO: "Conferido", PARCIAL: "Parcial (forma em branco)", SEM_CONFERENCIA: "Sem conferência" } as const;
  for (const c of resultado.caixas) {
    caixas.push({ celulas: [fmtDia(c.dia), c.operador, c.fechadoPor || "—", SITUACAO[c.situacao], R(c.esperado), R(c.contado), R(c.diferenca, true), R(c.online)] });
  }

  const buffer = montarPlanilha([
    { nome: "Por operador", congelarLinhas: 4, larguras: [28, 9, 14, 18, 15, 15, 14, 14], linhas: porOperador },
    { nome: "Por dia", congelarLinhas: 4, larguras: [14, 9, 14, 18, 15, 15, 14, 14], linhas: porDia },
    { nome: "Caixas", congelarLinhas: 4, larguras: [12, 24, 24, 24, 18, 15, 15, 14], linhas: caixas },
  ]);
  return respostaDePlanilha(buffer, `diferencas-de-caixa_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
