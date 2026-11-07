/**
 * GET /api/store/relatorios/giro-de-mesas — mesa a mesa: contas (giro), giro
 * por dia, faturamento, ticket por conta e por pessoa, P.A., permanência e
 * R$ por hora ocupada, com o resumo do salão no topo.
 *
 * Filtros: período, faixa de horário (pela hora em que a conta FECHOU, como
 * toda mesa fechada — lib/relatorios/mesas-do-periodo.ts) e lojas da conta.
 * Tipo, canal e marca não se aplicam: é tudo mesa.
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/giro-de-mesas.ts (testada em
 * scripts/teste-giro-de-mesas.ts). O que se busca, e só isso: as contas
 * FECHADAS na janela, com a mesa, as pessoas e (status, total, desconto,
 * quantidade e preço dos itens) de TODOS os pedidos da conta — o consumo é o
 * da conta inteira, como no Histórico de mesas; e as mesas ativas, para a mesa
 * que não abriu nenhuma vez aparecer como parada.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, filtrarPedidos } from "@/lib/relatorios/servidor";
import { mesaComoPedido } from "@/lib/relatorios/mesas-do-periodo";
import { fmtDia, fmtReais } from "@/lib/relatorios/base";
import { fmtPermanencia, giroDeMesas, nomeDaLinha, type ContaDoGiro, type MesaDoSalao } from "@/lib/relatorios/giro-de-mesas";
import { ehComanda } from "@/lib/comanda";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/**
 * TableSession.pessoas é coluna nova, garantida no boot
 * (src/lib/garantir-colunas.ts). Vai num objeto à parte para o select
 * compilar também com um client do Prisma gerado antes dela; a leitura
 * passa por `pessoasDe`.
 */
const COM_PESSOAS = { pessoas: true } as const;
const pessoasDe = (s: object) => (s as { pessoas?: number | null }).pessoas ?? null;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const [sessoes, mesasAtivas] = await Promise.all([
    prisma.tableSession.findMany({
      where: { franchiseeId: { in: ctx.lojaIds }, status: "CLOSED", closedAt: { gte: ctx.inicio, lt: ctx.fim } },
      select: {
        ...COM_PESSOAS,
        id: true, franchiseeId: true, tableId: true, openedAt: true, closedAt: true,
        _count: { select: { guests: true } },
        table: { select: { id: true, number: true, label: true, tipo: true, franchiseeId: true } },
        // TODOS os pedidos da conta (de qualquer dia): o consumo é o da conta inteira.
        orders: { select: { status: true, totalAmount: true, discountTotal: true, items: { select: { quantity: true, price: true } } } },
      },
    }),
    prisma.table.findMany({
      where: { franchiseeId: { in: ctx.lojaIds }, isActive: true },
      select: { id: true, number: true, label: true, tipo: true, franchiseeId: true },
    }),
  ]);

  // A faixa de horário pela hora do fechamento — a régua de toda mesa fechada.
  // Tipo, canal e marca ficam de fora: a tela não os mostra, e o link vindo de
  // outro relatório com "Entrega" marcado zeraria o giro sem dizer por quê.
  const soHorario = { ...ctx, filtros: { ...f, tipos: [], canais: [], marcas: [] } };
  const passam = new Set(filtrarPedidos(
    sessoes.filter((s) => s.closedAt).map((s) => mesaComoPedido({ id: s.id, franchiseeId: s.franchiseeId, closedAt: s.closedAt as Date })),
    soHorario,
  ).map((p) => p.id));

  const variasLojas = ctx.lojaIds.length > 1;
  const nomeDaLoja = (id: string) => (variasLojas ? ctx.lojasDaConta.find((l) => l.id === id)?.nome || null : null);
  const mesas = new Map<string, MesaDoSalao>();
  const guardarMesa = (t: { id: string; number: number; label: string | null; tipo: string | null; franchiseeId: string }) => {
    mesas.set(t.id, { id: t.id, numero: t.number, nome: t.label, loja: nomeDaLoja(t.franchiseeId), comanda: ehComanda(t) });
  };
  for (const t of mesasAtivas) guardarMesa(t);
  const contas: ContaDoGiro[] = [];
  for (const s of sessoes) {
    if (!s.closedAt || !passam.has(s.id)) continue;
    guardarMesa(s.table); // a mesa desativada depois ainda aparece com o giro dela
    contas.push({
      id: s.id, mesaId: s.tableId, abertaEm: s.openedAt, fechadaEm: s.closedAt,
      pessoas: pessoasDe(s), convidados: s._count.guests, pedidos: s.orders,
    });
  }

  const resultado = giroDeMesas({ mesas: [...mesas.values()], contas, tz: ctx.tz, de: f.de, ate: f.ate, hoje: ctx.hoje });
  const cabecalho = cabecalhoDoRelatorio(ctx);
  if (sp.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number | null | undefined): Celula => ({ v: v === null || v === undefined ? null : v / 100, estilo: "pct" });
  const semPessoas = "sem nº de pessoas";
  const res = resultado.resumo;

  const COLUNAS = [
    "Mesa", "Destaque", "Contas (giro)", "Giro por dia", "Faturamento", "% do salão", "Ticket por conta", "Pessoas", "Ticket por pessoa",
    "Itens", "P.A.", "Permanência média", "Horas ocupada", "R$ por hora ocupada",
  ];
  const linhas: Array<LinhaDaPlanilha | Celula[]> = [
    { celulas: [{ v: `Giro de mesas — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h) · contas fechadas no período${f.horaDe || f.horaAte ? ` · fechadas entre ${f.horaDe || "00:00"} e ${f.horaAte || "24:00"}` : ""}`, estilo: "suave" }] },
    { celulas: [{ v: `Salão: ${res.contas} contas em ${res.mesas} mesas, ${res.diasAbertos} dia(s) de salão aberto · giro médio ${res.giroMedioPorMesa ?? "—"} por mesa por dia · permanência média ${fmtPermanencia(res.permanenciaMediaMin)} · ticket por pessoa ${res.ticketPorPessoa === null ? semPessoas : fmtReais(res.ticketPorPessoa)} · P.A. ${res.pa ?? "—"}`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: COLUNAS, estilo: "cabecalho" },
    ...resultado.mesas.map((l): LinhaDaPlanilha => ({
      celulas: [
        nomeDaLinha(l),
        l.destaque === "rende" ? `▲ ${l.motivo}` : l.destaque === "parada" ? `▼ parada: ${l.motivo}` : "",
        Q(l.contas), Q(l.giroPorDia), R(l.faturamento), P(l.participacao), R(l.ticketPorConta),
        l.contasComPessoas ? Q(l.pessoas) : "", l.ticketPorPessoa === null ? (l.contas ? semPessoas : "") : R(l.ticketPorPessoa),
        Q(l.itens), Q(l.pa), fmtPermanencia(l.permanenciaMediaMin), Q(l.horasOcupada), R(l.reaisPorHora),
      ],
    })),
    {
      celulas: [
        { v: "SALÃO", estilo: "negrito" }, "",
        Q(res.contas, true), Q(res.giroPorDia, true), R(res.faturamento, true), P(res.faturamento > 0 ? 100 : null), R(res.ticketPorConta, true),
        res.contasComPessoas ? Q(res.pessoas, true) : "", res.ticketPorPessoa === null ? semPessoas : R(res.ticketPorPessoa, true),
        Q(res.itens, true), Q(res.pa, true), fmtPermanencia(res.permanenciaMediaMin), Q(res.horasOcupada, true), R(res.reaisPorHora, true),
      ],
    },
    { celulas: [] },
    { celulas: [{ v: "Faturamento: o consumo das contas fechadas (o lançado, sem taxa de serviço, gorjeta e troco) — o mesmo do Histórico de mesas e do Relatório de Mesas.", estilo: "suave" }] },
    { celulas: [{ v: `Ticket por pessoa: só as contas com o nº de pessoas (${res.contasComPessoas} de ${res.contas}). P.A.: itens por conta. Giro por dia: contas ÷ dias de salão aberto.`, estilo: "suave" }] },
  ];
  if (res.liberadasSemConsumo || res.contasDeComanda) {
    linhas.push({ celulas: [{ v: `Fora do giro: ${res.liberadasSemConsumo} conta(s) liberada(s) sem consumo e ${res.contasDeComanda} conta(s) de comanda numerada.`, estilo: "suave" }] });
  }

  const buffer = montarPlanilha([{
    nome: "Giro de mesas",
    congelarLinhas: 5,
    larguras: [26, 30, 12, 11, 15, 10, 15, 9, 17, 9, 8, 16, 12, 17],
    linhas,
  }]);
  return respostaDePlanilha(buffer, `giro-de-mesas_${f.de}_a_${f.ate}.xlsx`);
}
