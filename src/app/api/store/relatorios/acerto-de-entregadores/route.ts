/**
 * GET /api/store/relatorios/acerto-de-entregadores — o acerto da equipe de
 * entrega no período, com o custo por entrega, o saldo de cada motoboy e os
 * dias e horários da equipe.
 *
 * Filtros: o período e a loja (lib/relatorios/base.ts). Tipo de venda, canal,
 * marca e horário não se aplicam: o acerto do motoboy é o acerto inteiro.
 *   comparar=0       sem o período anterior (padrão: compara)
 *   formato=xlsx     baixa a planilha em vez do JSON
 *
 * Os números de cada motoboy vêm de `montarRelatorioDosEntregadores`, a MESMA
 * conta da tela Motoboys e do app do entregador; a soma da equipe está em
 * lib/relatorios/acerto-de-entregadores.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { fmtDia, fmtReais, naLoja, periodoAnterior } from "@/lib/relatorios/base";
import { montarRelatorioDosEntregadores } from "@/lib/relatorio-do-entregador";
import { acertoDaEquipe, type MotoboyDoAcerto } from "@/lib/relatorios/acerto-de-entregadores";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { ROTULO_DA_ORIGEM, type OrigemDoGanho } from "@/lib/ganho-do-entregador";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const comparar = sp.get("comparar") !== "0";
  const anterior = periodoAnterior(ctx.filtros.de, ctx.filtros.ate);
  const nomeDaLoja = (id: string) => ctx.lojasDaConta.find((l) => l.id === id)?.nome || "Loja";

  // A janela do relatório é [inicio, fim); a do acerto fecha no último instante.
  const montar = (janela: { inicio: Date; fim: Date }) =>
    Promise.all(ctx.lojaIds.map(async (lojaId) => {
      const { report } = await montarRelatorioDosEntregadores({
        lojaId, fromDate: janela.inicio, toDate: new Date(janela.fim.getTime() - 1), tz: ctx.tz,
      });
      return { loja: nomeDaLoja(lojaId), report: report as unknown as MotoboyDoAcerto[] };
    }));

  const [atual, doAnterior] = await Promise.all([
    montar({ inicio: ctx.inicio, fim: ctx.fim }),
    comparar ? montar(janelaDoPeriodo(anterior.de, anterior.ate, ctx.tz)) : Promise.resolve(null),
  ]);

  const resultado = acertoDaEquipe(atual, ctx.tz);
  const resultadoAnterior = doAnterior ? acertoDaEquipe(doAnterior, ctx.tz) : null;
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({
      ...cabecalho,
      periodoAnterior: comparar ? anterior : null,
      ...resultado,
      anterior: resultadoAnterior
        ? {
            total: resultadoAnterior.total,
            porMotoboy: Object.fromEntries(resultadoAnterior.linhas.map((l) => [l.id, { entregas: l.entregas, aPagar: l.aPagar }])),
          }
        : null,
    });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  // Aba 1: o acerto de cada motoboy (o papel que a loja confere com ele).
  // Aba 2: cada entrega, com o que ela rendeu e de onde saiu o valor.
  const variasLojas = ctx.lojaIds.length > 1;
  const titulo = (t: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${t} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [] },
  ];
  const R = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "qtdNegrito" : "qtd" });

  const colunasDoAcerto = [
    "Motoboy", ...(variasLojas ? ["Loja"] : []), "Tipo de pagamento", "Dias", "Entregas", "Km", "Diária", "Por entrega",
    "Lanche descontado", "Pendências", "A pagar", "Dinheiro com ele", "Saldo (loja paga + / ele devolve −)", "Custo por entrega", "Valor dos pedidos",
    "Maquininha", "Pix na entrega", "Pago online", "Fiado (pedidos)", "Canceladas c/ corrida",
  ];
  const t = resultado.total;
  const abaAcerto: LinhaDaPlanilha[] = [
    ...titulo("Acerto de entregadores"),
    { celulas: colunasDoAcerto, estilo: "cabecalho" },
    ...resultado.linhas.map((l): LinhaDaPlanilha => ({
      celulas: [
        l.nome, ...(variasLojas ? [l.loja] : []), l.tipo, Q(l.dias), Q(l.entregas), Q(l.km), R(l.diaria), R(l.porEntrega),
        R(l.lanche), R(l.pendencias), R(l.aPagar, true), R(l.dinheiroComEle), R(l.saldo, true), l.custoPorEntrega === null ? "" : R(l.custoPorEntrega),
        R(l.valorLevado), R(l.maquininha), R(l.pix), R(l.online), R(l.fiadoDosPedidos), Q(l.canceladasComCorrida),
      ],
    })),
    {
      celulas: [
        { v: "TOTAL DA EQUIPE", estilo: "negrito" }, ...(variasLojas ? [""] : []), "", "", Q(t.entregas, true), Q(t.km, true), R(t.diaria, true), R(t.porEntrega, true),
        R(t.lanche, true), R(t.pendencias, true), R(t.aPagar, true), R(t.dinheiroComEles, true), R(t.saldo, true), t.custoPorEntrega === null ? "" : R(t.custoPorEntrega, true),
        R(t.valorLevado, true),
      ],
    },
    { celulas: [] },
    { celulas: [{ v: "A pagar = a diária de cada dia trabalhado (a do cadastro ou a ajustada pela loja naquele dia) + o valor de cada entrega − o lanche acima do combinado − as pendências. É o mesmo total da tela Motoboys (Diária + taxas).", estilo: "suave" }] },
    { celulas: [{ v: "Saldo = a pagar − o dinheiro que ficou com ele (pedidos em dinheiro + o troco que levou da loja). Positivo: a loja paga; negativo: ele devolve.", estilo: "suave" }] },
    { celulas: [{ v: "Entrega cancelada depois que o motoboy saiu conta como corrida; antes de sair, não. Pedido levado pelo entregador do app fica fora.", estilo: "suave" }] },
  ];

  const abaEntregas: LinhaDaPlanilha[] = [
    ...titulo("Entregas do acerto"),
    { celulas: ["Dia", "Hora", "Motoboy", ...(variasLojas ? ["Loja"] : []), "Pedido", "Cliente", "Situação", "Valor do pedido", "Forma de pagamento", "Km", "Rendeu ao motoboy", "De onde saiu o valor", "Dinheiro a entregar"], estilo: "cabecalho" },
  ];
  for (const { loja, report } of atual) {
    for (const m of report) {
      for (const o of m.orders as any[]) {
        const quando = naLoja(new Date(o.createdAt), ctx.tz);
        const hora = new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ctx.tz });
        const situacao = o.cancelado ? (o.corrida ? "Cancelado depois de sair (corrida conta)" : "Cancelado antes de sair") : String(o.status || "");
        abaEntregas.push({
          celulas: [
            fmtDia(quando.dia), hora, m.motoboy.name, ...(variasLojas ? [loja] : []),
            o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : o.ifoodReference || o.openDeliveryReference || String(o.id).slice(-6),
            o.customerName || "", situacao, R(Number(o.totalAmount) || 0), o.paymentMethod || "",
            o.deliveryDistance ? Q(Number(o.deliveryDistance)) : "", R(Number(o.ganhoDoMotoboy) || 0),
            ROTULO_DA_ORIGEM[o.origemDoGanho as OrigemDoGanho] || o.origemDoGanho || "", R(Number(o.cashToDeliver) || 0),
          ],
        });
      }
    }
  }

  // Aba 3: as pendências e as diárias mudadas à mão — o que a loja tirou ou
  // mudou no acerto, com o motivo e quem lançou.
  const abaAjustes: LinhaDaPlanilha[] = [
    ...titulo("Pendências e diárias ajustadas"),
    { celulas: ["Dia", "Motoboy", ...(variasLojas ? ["Loja"] : []), "Tipo", "Valor", "Motivo / padrão", "Lançada por"], estilo: "cabecalho" },
  ];
  for (const l of resultado.linhas) {
    for (const p of l.listaDePendencias) {
      abaAjustes.push({ celulas: [fmtDia(p.dia), l.nome, ...(variasLojas ? [l.loja] : []), "Pendência (descontada)", R(-p.valor), p.motivo, p.criadoPor || ""] });
    }
    for (const d of l.diariasAjustadas) {
      abaAjustes.push({ celulas: [fmtDia(d.dia), l.nome, ...(variasLojas ? [l.loja] : []), "Diária ajustada", R(d.valor), `padrão ${fmtReais(d.padrao)}`, ""] });
    }
  }
  if (abaAjustes.length === 4) abaAjustes.push({ celulas: [{ v: "Nenhuma pendência nem diária ajustada no período.", estilo: "suave" }] });

  const buffer = montarPlanilha([
    { nome: "Acerto", congelarLinhas: 4, larguras: [26, ...(variasLojas ? [20] : []), 24, 7, 10, 8, 12, 13, 12, 12, 13, 14, 18, 13, 15, 13, 13, 13, 13, 12], linhas: abaAcerto },
    { nome: "Entregas", congelarLinhas: 4, larguras: [11, 7, 22, ...(variasLojas ? [20] : []), 12, 26, 26, 13, 28, 7, 13, 26, 14], linhas: abaEntregas },
    { nome: "Ajustes", congelarLinhas: 4, larguras: [11, 22, ...(variasLojas ? [20] : []), 22, 12, 40, 20], linhas: abaAjustes },
  ]);
  return respostaDePlanilha(buffer, `acerto-de-entregadores_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
