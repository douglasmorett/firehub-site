/**
 * GET /api/store/relatorios/faturamento-mensal — os 12 meses de um ano, com o
 * mesmo mês do ano anterior ao lado, a variação e a projeção do mês corrente.
 *
 * Filtros comuns (lib/relatorios/base.ts) — tipo, canal, marca, horário,
 * lojas — mais:
 *   ano=2026       o ano (padrão: o de hoje). O período `de`/`ate` do filtro
 *                  NÃO é usado: o ano é o período.
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/faturamento-mensal.ts (testada em
 * scripts/teste-faturamento-mensal.ts): cada mês é o Faturamento por dia do
 * mês inteiro, a mesma régua.
 *
 * ── Desempenho: dois anos de pedidos sem estourar ───────────────────────────
 *
 * Dois anos passam do teto de MAX_DIAS (lib/relatorios/servidor.ts), e numa
 * loja de 30 mil pedidos por ano são 60 mil linhas. Então:
 *
 * - busca MÊS A MÊS, três de cada vez, e cada mês vira o resumo na hora — na
 *   memória fica um mês de pedidos, não dois anos;
 * - só as colunas dos filtros comuns e o `parentOrderId` (a régua das vendas):
 *   nada de itens, entrega ou desconto;
 * - mês futuro e mês antes do 1º pedido da loja nem vão ao banco (o Alex, que
 *   chegou do SWF agora, busca dois ou três meses, não 24).
 *
 * Somar no banco (GROUP BY mês) seria mais leve, mas seria uma SEGUNDA régua
 * das vendas, em SQL — a mesa que conta uma vez, o acréscimo, o dia que vira
 * às 5h no fuso da loja, os filtros de canal e marca. É exatamente o que a
 * régua única existe para evitar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo, pedidosDoRelatorio, type ContextoDoRelatorio } from "@/lib/relatorios/servidor";
import { ROTULO_DO_TIPO, fmtDia, naLoja } from "@/lib/relatorios/base";
import { ultimoDiaDoMes, type PedidoParaFaturamento } from "@/lib/relatorios/faturamento-por-dia";
import {
  NOMES_DOS_MESES, corteDoAnoAnterior, faturamentoMensal, lerAno, mesesDoAno, mesesParaBuscar, resumoDoMes,
  type LinhaDoMes, type ResumoDoMes,
} from "@/lib/relatorios/faturamento-mensal";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

/** Quantos meses vão ao banco ao mesmo tempo: rápido sem segurar 24 buscas abertas. */
const MESES_EM_PARALELO = 3;

/** O dia operacional do 1º pedido das lojas (qualquer status, qualquer canal) — a regra do Faturamento por dia. */
async function primeiroDiaDasLojas(ctx: ContextoDoRelatorio): Promise<string | null> {
  const primeiro = await prisma.customerOrder.findFirst({
    where: { franchiseeId: { in: ctx.lojaIds } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return primeiro ? naLoja(primeiro.createdAt, ctx.tz).dia : null;
}

async function pedidosDoMes(ctx: ContextoDoRelatorio, mes: string): Promise<PedidoParaFaturamento[]> {
  const janela = janelaDoPeriodo(`${mes}-01`, ultimoDiaDoMes(mes), ctx.tz);
  return (await pedidosDoRelatorio(ctx, { janela, select: { parentOrderId: true } })) as unknown as PedidoParaFaturamento[];
}

/** Roda `fazer` em cada item, `n` de cada vez, na ordem. */
async function emGrupos<T, R>(itens: T[], n: number, fazer: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += n) saida.push(...(await Promise.all(itens.slice(i, i + n).map(fazer))));
  return saida;
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const primeiroDia = await primeiroDiaDasLojas(ctx);
  const ano = lerAno(sp.get("ano"), ctx.hoje, primeiroDia);
  const doAno = mesesDoAno(ano);
  const doAnterior = mesesDoAno(ano - 1);
  const corte = corteDoAnoAnterior(ctx.hoje);
  const mesCorrenteDoAnterior = corte.dia.slice(0, 7);

  // Os meses com dado, dos dois anos, viram resumo assim que chegam.
  const resumos = new Map<string, ResumoDoMes>();
  let anteriorAteOMesmoDia: ResumoDoMes | null = null;
  const buscar = [...mesesParaBuscar(doAno, ctx.hoje, primeiroDia), ...mesesParaBuscar(doAnterior, ctx.hoje, primeiroDia)];
  await emGrupos(buscar, MESES_EM_PARALELO, async (mes) => {
    const pedidos = await pedidosDoMes(ctx, mes);
    resumos.set(mes, resumoDoMes({ mes, tz: ctx.tz, hoje: ctx.hoje, primeiroDia, pedidos }));
    // O mês corrente do ano passado também é visto até o mesmo dia e horário de hoje.
    if (mes === mesCorrenteDoAnterior && doAnterior.includes(mes)) {
      anteriorAteOMesmoDia = resumoDoMes({ mes, tz: ctx.tz, hoje: ctx.hoje, primeiroDia, pedidos, corte: corte.instante, hojeDoCorte: corte.dia });
    }
  });
  const resumo = (mes: string) => resumos.get(mes) ?? resumoDoMes({ mes, tz: ctx.tz, hoje: ctx.hoje, primeiroDia, pedidos: [] });

  const resultado = faturamentoMensal({ ano, atual: doAno.map(resumo), anterior: doAnterior.map(resumo), anteriorAteOMesmoDia });
  const anoDeHoje = Number(ctx.hoje.slice(0, 4));
  const primeiroAno = primeiroDia ? Number(primeiroDia.slice(0, 4)) : anoDeHoje;
  const anos = Array.from({ length: anoDeHoje - primeiroAno + 1 }, (_, i) => primeiroAno + i);

  const cabecalho = cabecalhoDoRelatorio(ctx);
  const corpo = { ...cabecalho, ...resultado, anos, primeiroDia, corte: { dia: corte.dia } };

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
  const P = (v: number | null | undefined): Celula => ({ v: v ?? null, estilo: "pct" });
  const temDado = (m: ResumoDoMes) => m.estado === "fechado" || m.estado === "corrente";

  const rotuloDoMes = (l: LinhaDoMes) => {
    const nome = NOMES_DOS_MESES[l.indice];
    if (l.atual.estado === "corrente") return `${nome} (até ${fmtDia(l.atual.ateODia as string)})`;
    if (l.atual.estado === "futuro") return `${nome} (ainda não chegou)`;
    if (l.atual.estado === "sem-dados") return `${nome} (sem dados no FireHub)`;
    return l.atual.comecouEm ? `${nome} (desde ${fmtDia(l.atual.comecouEm)})` : nome;
  };
  const linhaDoMes = (l: LinhaDoMes): LinhaDaPlanilha => {
    const a = l.atual, b = l.anterior, c = l.anteriorAteOMesmoDia;
    return {
      celulas: [
        rotuloDoMes(l),
        temDado(a) ? R(a.valor) : null, temDado(a) ? Q(a.vendas) : null, temDado(a) ? R(a.ticketMedio) : null, temDado(a) ? R(a.mediaPorDia) : null,
        a.projecao !== null ? R(a.projecao) : null,
        temDado(b) ? R(b.valor) : b.estado === "sem-dados" ? "sem dados" : null,
        temDado(b) ? Q(b.vendas) : null, temDado(b) ? R(b.ticketMedio) : null,
        c ? R(c.valor) : null,
        P(l.variacao.valor), P(l.variacao.vendas), P(l.variacao.ticketMedio),
      ],
    };
  };

  const cmp = resultado.comparacao;
  const linhas: Array<LinhaDaPlanilha | Celula[]> = [
    { celulas: [{ v: `Faturamento mensal ${ano} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `${ano} contra ${ano - 1}, mês a mês (o dia vira às 5h). Gerado em ${fmtDia(ctx.hoje)}.`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: "Cada mês é o Faturamento por dia do mês inteiro: a mesa conta uma vez, cancelados ficam fora. O mês corrente compara com o ano anterior até o mesmo dia e horário.", estilo: "suave" }] },
    { celulas: [] },
    {
      celulas: [
        "Mês", `Faturamento ${ano}`, "Vendas", "Ticket médio", "Média por dia", "Projeção do mês",
        `Faturamento ${ano - 1}`, `Vendas ${ano - 1}`, `Ticket ${ano - 1}`, `${ano - 1} até o mesmo dia`,
        "Variação faturamento", "Variação vendas", "Variação ticket",
      ],
      estilo: "cabecalho",
    },
    ...resultado.meses.map(linhaDoMes),
    {
      celulas: [
        { v: "TOTAL", estilo: "negrito" }, R(resultado.total.valor, true), Q(resultado.total.vendas, true), R(resultado.total.ticketMedio, true), null, null,
        R(resultado.totalAnterior.valor, true), Q(resultado.totalAnterior.vendas, true), R(resultado.totalAnterior.ticketMedio, true),
      ],
    },
    { celulas: [] },
    { celulas: [{ v: `Ano contra ano nos ${cmp.meses} meses com dado nos dois anos${resultado.mesCorrente ? " (o mês corrente até o mesmo dia)" : ""}`, estilo: "negrito" }] },
    { celulas: ["", `${ano}`, `${ano - 1}`, "Variação"], estilo: "cabecalho" },
    { celulas: ["Faturamento", R(cmp.atual.valor), R(cmp.anterior.valor), P(cmp.variacao.valor)] },
    { celulas: ["Vendas", Q(cmp.atual.vendas), Q(cmp.anterior.vendas), P(cmp.variacao.vendas)] },
    { celulas: ["Ticket médio", R(cmp.atual.ticketMedio), R(cmp.anterior.ticketMedio), P(cmp.variacao.ticketMedio)] },
    { celulas: [] },
    { celulas: [{ v: "Projeção: no ritmo dos dias que já fecharam no mês (hoje ainda está vendendo e não entra no ritmo).", estilo: "suave" }] },
    { celulas: [{ v: "Mês sem dados: antes do 1º pedido da loja no FireHub. O mês em que a loja começou no meio não tem variação.", estilo: "suave" }] },
  ];

  const buffer = montarPlanilha([{
    nome: `Faturamento ${ano}`,
    congelarLinhas: 6,
    larguras: [30, 16, 10, 13, 14, 16, 16, 12, 13, 18, 14, 13, 13],
    linhas,
  }]);
  return respostaDePlanilha(buffer, `faturamento-mensal_${ano}.xlsx`);
}
