/**
 * GET /api/store/relatorios/sangrias-e-suprimentos — cada sangria, retirada e
 * suprimento lançado no período (CashMovement), com o total por tipo, por quem
 * lançou, por motivo e por dia. A conta mora em
 * lib/relatorios/sangrias-e-suprimentos.ts (testada em
 * scripts/teste-sangrias-e-suprimentos.ts).
 *
 *   de, ate        o período (pelo dia operacional do lançamento, virando às 5h)
 *   formato=xlsx   baixa a planilha
 *
 * `criadoPor` é o e-mail de quem lançou; aparece o NOME só de quem é da loja
 * (o dono ou a equipe), como no Histórico de caixas (lib/movimentacoes-do-caixa.ts).
 *
 * Só para quem tem "Financeiro" (lib/permissao-da-tela.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { fmtDia } from "@/lib/relatorios/base";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { lancadoDepoisDoFechamento } from "@/lib/lancamento-tardio-do-caixa";
import { lerQuemAbriu } from "@/lib/resumo-do-caixa-aberto";
import { operadorDoCaixa } from "@/lib/relatorios/diferencas-de-caixa";
import { sangriasESuprimentos, type MovimentoParaRelatorio } from "@/lib/relatorios/sangrias-e-suprimentos";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/relatorios/sangrias-e-suprimentos");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  if (!(await temEstruturaDeCaixa())) {
    return NextResponse.json({ error: "As movimentações do caixa não puderam ser lidas agora. Tente de novo em alguns minutos." }, { status: 503 });
  }

  const movs = await prisma.cashMovement.findMany({
    where: { franchiseeId: { in: ctx.lojaIds }, createdAt: { gte: ctx.inicio, lt: ctx.fim } },
    select: { id: true, cashSessionId: true, tipo: true, valor: true, descricao: true, criadoPor: true, createdAt: true, cashSession: { select: { closedAt: true, closedBy: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Nomes de quem lançou (só da loja) e de quem abriu cada caixa.
  const emails = [...new Set(movs.map((m) => m.criadoPor).filter((e): e is string => !!e))];
  const nomes = new Map<string, string>();
  if (emails.length) {
    const gente = await prisma.user.findMany({
      where: { email: { in: emails }, OR: [{ id: { in: ctx.lojaIds } }, { ownerId: { in: ctx.lojaIds } }] },
      select: { email: true, name: true },
    });
    for (const g of gente) if (g.email && g.name?.trim()) nomes.set(g.email, g.name.trim());
  }
  const abriu = new Map<string, string>();
  const idsDosCaixas = [...new Set(movs.map((m) => m.cashSessionId))];
  if (idsDosCaixas.length) {
    try {
      const linhas = await prisma.$queryRaw<{ id: string; abertoPor: unknown }[]>`SELECT "id", "abertoPor" FROM "CashSession" WHERE "id" = ANY(${idsDosCaixas})`;
      for (const l of linhas) { const q = lerQuemAbriu(l.abertoPor); if (q?.nome) abriu.set(l.id, q.nome); }
    } catch (e: any) {
      console.warn("[Relatórios] Quem abriu o caixa não carregado:", e?.message);
    }
  }

  const lista: MovimentoParaRelatorio[] = movs.map((m) => ({
    id: m.id, tipo: m.tipo, valor: Number(m.valor) || 0, descricao: m.descricao?.trim() || null,
    quem: m.criadoPor ? nomes.get(m.criadoPor) || m.criadoPor : null, em: m.createdAt, caixaId: m.cashSessionId,
    operadorDoCaixa: operadorDoCaixa({ abertoPorNome: abriu.get(m.cashSessionId), closedBy: m.cashSession?.closedBy }),
    depoisDoFechamento: lancadoDepoisDoFechamento(m.createdAt, m.cashSession?.closedAt),
  }));
  const resultado = sangriasESuprimentos(lista, ctx.tz);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number, negrito = false) => ({ v, estilo: negrito ? ("reaisNegrito" as const) : ("reais" as const) });
  const linhas: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Sangrias, retiradas e suprimentos — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: ["Data", "Hora", "Tipo", "Valor", "Motivo", "Lançado por", "Caixa de", "Observação"], estilo: "cabecalho" },
  ];
  for (const m of resultado.lista) {
    linhas.push({ celulas: [
      fmtDia(m.dia), m.hora, m.tipo === "ENTRADA" ? "Suprimento" : "Sangria / retirada", R(m.tipo === "ENTRADA" ? m.valor : -m.valor),
      m.descricao || "(sem motivo)", m.quem || "—", m.operadorDoCaixa, m.depoisDoFechamento ? "lançado depois de o caixa fechar" : "",
    ] });
  }
  linhas.push(
    { celulas: [] },
    { celulas: [{ v: "Suprimentos", estilo: "negrito" }, "", { v: resultado.total.suprimentos.quantidade, estilo: "qtd" }, R(resultado.total.suprimentos.valor, true)] },
    { celulas: [{ v: "Sangrias / retiradas", estilo: "negrito" }, "", { v: resultado.total.retiradas.quantidade, estilo: "qtd" }, R(-resultado.total.retiradas.valor, true)] },
  );
  const motivos: LinhaDaPlanilha[] = [
    { celulas: [{ v: "Por motivo", estilo: "titulo" }] },
    { celulas: [] },
    { celulas: ["Motivo", "Tipo", "Lançamentos", "Valor"], estilo: "cabecalho" },
    ...resultado.porMotivo.map((x) => ({ celulas: [x.motivo, x.tipo === "ENTRADA" ? "Suprimento" : "Sangria / retirada", { v: x.quantidade, estilo: "qtd" as const }, R(x.valor)] })),
  ];
  const buffer = montarPlanilha([
    { nome: "Lançamentos", congelarLinhas: 4, larguras: [12, 7, 18, 14, 34, 24, 22, 30], linhas },
    { nome: "Por motivo", congelarLinhas: 3, larguras: [34, 18, 12, 14], linhas: motivos },
  ]);
  return respostaDePlanilha(buffer, `sangrias-e-suprimentos_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
