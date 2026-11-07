/**
 * GET /api/store/relatorios/ticket-medio — o ticket médio por dia e por
 * garçom: faturamento, atendimentos, pessoas, ticket por atendimento, ticket
 * por pessoa e P.A. (produtos por atendimento).
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/ticket-medio.ts (testada em
 * scripts/teste-ticket-medio.ts), pela régua única de
 * lib/relatorios/regua-da-venda.ts: valor pelo pedido, a mesa é um
 * atendimento no primeiro lançamento. O que se busca, e só isso: os pedidos
 * da janela com a quantidade e o preço dos itens; e, das mesas desses
 * pedidos, o garçom e as pessoas.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { NOMES_DOS_DIAS, ROTULO_DO_TIPO, fmtDia } from "@/lib/relatorios/base";
import { ticketMedioDoPeriodo, type ContaDoTicket, type NumerosDoTicket, type PedidoDoTicket } from "@/lib/relatorios/ticket-medio";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/** TableSession.pessoas: coluna nova, garantida no boot — ver api/store/relatorios/giro-de-mesas. */
const COM_PESSOAS = { pessoas: true } as const;
const pessoasDe = (s: object) => (s as { pessoas?: number | null }).pessoas ?? null;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const pedidos = (await pedidosDoRelatorio(ctx, {
    select: { parentOrderId: true, items: { select: { quantity: true, price: true } } },
  })) as unknown as PedidoDoTicket[];

  const ids = [...new Set(pedidos.map((p) => p.tableSessionId).filter((id): id is string => Boolean(id)))];
  const sessoes = await emLotes(ids, 500, (lote) => prisma.tableSession.findMany({
    where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
    select: { ...COM_PESSOAS, id: true, waiterId: true, waiterName: true, waiter: { select: { name: true } }, _count: { select: { guests: true } } },
  }));
  const contas = new Map<string, ContaDoTicket>(sessoes.map((s) => [s.id, {
    waiterId: s.waiterId, garcom: s.waiter?.name || s.waiterName, pessoas: pessoasDe(s), convidados: s._count.guests,
  }]));

  const resultado = ticketMedioDoPeriodo({ pedidos, contas, tz: ctx.tz });
  const cabecalho = cabecalhoDoRelatorio(ctx);
  if (sp.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "qtdNegrito" : "qtd" });
  const semPessoas = (n: NumerosDoTicket) => (n.mesas > 0 ? "sem nº de pessoas" : "");
  const celulas = (n: NumerosDoTicket, negrito = false): Celula[] => [
    R(n.faturamento, negrito), Q(n.atendimentos, negrito), Q(n.mesas, negrito),
    n.mesasComPessoas ? Q(n.pessoas, negrito) : "",
    R(n.ticketPorAtendimento, negrito), n.ticketPorPessoa === null ? semPessoas(n) : R(n.ticketPorPessoa, negrito),
    Q(n.itens, negrito), Q(n.pa, negrito),
  ];
  const COLUNAS = ["Faturamento", "Atendimentos", "Mesas", "Pessoas", "Ticket por atendimento", "Ticket por pessoa", "Itens", "P.A."];
  const filtros = f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "Todas as vendas";

  const linhas: Array<LinhaDaPlanilha | Celula[]> = [
    { celulas: [{ v: `Ticket médio — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h) · ${filtros}`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: [{ v: "Por dia", estilo: "negrito" }] },
    { celulas: ["Data", "Dia", ...COLUNAS], estilo: "cabecalho" },
    ...resultado.porDia.map((d): LinhaDaPlanilha => ({ celulas: [fmtDia(d.dia), NOMES_DOS_DIAS[d.diaSemana], ...celulas(d)] })),
    { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", ...celulas(resultado.total, true)] },
    { celulas: [] },
    { celulas: [{ v: "Por garçom", estilo: "negrito" }] },
    { celulas: ["Garçom", "", ...COLUNAS], estilo: "cabecalho" },
    ...resultado.porGarcom.map((g): LinhaDaPlanilha => ({ celulas: [g.nome, "", ...celulas(g)] })),
    { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", ...celulas(resultado.total, true)] },
    { celulas: [] },
    { celulas: [{ v: "Atendimentos: cada pedido é um; a mesa é um só, no dia do primeiro lançamento. Ticket por atendimento = faturamento ÷ atendimentos (o ticket médio do Faturamento por dia).", estilo: "suave" }] },
    { celulas: [{ v: `Pessoas: só a mesa tem (o "Quantas pessoas?" da abertura, senão as pessoas nomeadas na conta). Ticket por pessoa = o lançado nas mesas com o número ÷ as pessoas delas (${resultado.total.mesasComPessoas} de ${resultado.total.mesas} mesas). P.A. = itens ÷ atendimentos.`, estilo: "suave" }] },
  ];

  const buffer = montarPlanilha([{
    nome: "Ticket médio",
    larguras: [30, 10, 15, 13, 9, 9, 18, 18, 9, 8],
    linhas,
  }]);
  return respostaDePlanilha(buffer, `ticket-medio_${f.de}_a_${f.ate}.xlsx`);
}
