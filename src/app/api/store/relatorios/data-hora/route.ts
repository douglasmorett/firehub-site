/**
 * GET /api/store/relatorios/data-hora — "Vendas por dia e hora", o mapa de
 * calor da semana da Saipos (dia × hora), com as respostas prontas.
 *
 * Filtros comuns (lib/relatorios/base.ts): período, horário, tipo de venda,
 * canal, marca e loja. Categoria e produto não se aplicam: a casa do mapa é o
 * PEDIDO (quando o cliente chegou), não o item.
 *   formato=xlsx   baixa a planilha (Resumo + matrizes de vendas, valor e itens)
 *
 * A métrica escolhida na tela (vendas, valor, itens) não vem para cá: a
 * resposta traz as três, e trocar de métrica não refaz a busca.
 *
 * A conta está em lib/relatorios/data-hora.ts (testada em
 * scripts/teste-data-hora.ts) — inclusive como a mesa entra.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { NOMES_DOS_DIAS, ROTULO_DO_TIPO, fmtDia, naLoja } from "@/lib/relatorios/base";
import { quantidadeDeItens } from "@/lib/relatorios/regua-da-venda";
import {
  METRICAS, ROTULO_DA_METRICA, avisoAntesDasVendas, avisoDoDiaEmAndamento, frasesDasRespostas, rotuloDaHora,
  vendasPorDiaEHora, type Metrica, type ResultadoDataHora,
} from "@/lib/relatorios/data-hora";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type Celula, type EstiloDaCelula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const [pedidos, primeiro] = await Promise.all([
    // Só o que a conta lê: quantidade e preço de cada item (o preço só para a
    // régua do valor impossível) e o vínculo do acréscimo.
    pedidosDoRelatorio(ctx, {
      select: { parentOrderId: true, items: { select: { quantity: true, price: true } } },
    }),
    // O primeiro pedido da loja (qualquer status e canal — índice franchiseeId,
    // createdAt): os dias antes dele não entram na média de cada dia da semana.
    prisma.customerOrder.findFirst({
      where: { franchiseeId: { in: ctx.lojaIds } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  // Sem fator de mesa: pela régua única o valor da mesa é o lançado, na hora
  // de cada lançamento (lib/relatorios/regua-da-venda.ts). Até 24/09/2026 esta
  // rota buscava as sessões para abater o desconto do fechamento do valor, e o
  // total daqui não batia com nenhum outro relatório.
  const agora = naLoja(new Date(), ctx.tz);
  const resultado = vendasPorDiaEHora(
    pedidos.map((p) => {
      const items = (p.items || []) as { quantity: number; price: number }[];
      return {
        id: p.id,
        createdAt: p.createdAt,
        status: p.status,
        totalAmount: p.totalAmount,
        tableSessionId: p.tableSessionId,
        parentOrderId: p.parentOrderId ?? null,
        itens: quantidadeDeItens({ items }),
        items,
      };
    }),
    {
      tz: ctx.tz, de: ctx.filtros.de, ate: ctx.filtros.ate, agora: { dia: agora.dia, hora: agora.hora },
      inicioDasVendas: primeiro ? naLoja(primeiro.createdAt, ctx.tz).dia : null,
    },
  );
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, pedidosLidos: pedidos.length, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    ctx.filtros.horaDe || ctx.filtros.horaAte ? `Horário ${ctx.filtros.horaDe || "00:00"}–${ctx.filtros.horaAte || "24:00"}` : "",
    ctx.filtros.tipos.length ? `Tipo: ${ctx.filtros.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    ctx.filtros.canais.length ? `Canal: ${ctx.filtros.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    ctx.filtros.marcas.length ? `Marca: ${ctx.filtros.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  // "0 dias" num período de 31 nunca sai sem o motivo: ou a loja ainda não
  // vendia pelo FireHub (a NIK em janeiro/2025), ou o período não começou.
  const diasEmTexto = resultado.dias > 0
    ? `${resultado.dias} dia${resultado.dias === 1 ? "" : "s"}`
    : resultado.vendasComecaramDepois ? "nenhum dia com a loja vendendo pelo FireHub" : "nenhum dia: o período ainda não começou";
  const topo = (titulo: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (${diasEmTexto}; o dia vira às 5h — o pedido da 1h de sábado é da sexta)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    {
      celulas: [{
        v: [
          resultado.vendasComecaramDepois ? avisoAntesDasVendas(resultado.vendasComecaramDepois) : "",
          "Média = por ocorrência daquele dia da semana no período (3 sextas e 4 sábados não favorecem o sábado).",
          resultado.inicioDasVendas ? `A loja começou a vender em ${fmtDia(resultado.inicioDasVendas)}: os dias antes não entram na média.` : "",
          resultado.diaEmAndamento !== null
            ? avisoDoDiaEmAndamento(resultado.diaEmAndamento)
            : resultado.hojeEmAndamento ? "Hoje ainda está em andamento: as horas que não chegaram não entram na média." : "",
        ].filter(Boolean).join(" "),
        estilo: "suave",
      }],
    },
    { celulas: [] },
  ];

  const estiloDe = (m: Metrica, negrito = false): EstiloDaCelula => (m === "valor" ? (negrito ? "reaisNegrito" : "reais") : negrito ? "qtdNegrito" : "qtd");
  const horas = resultado.ordemDasHoras;
  const dias = resultado.ordemDosDias;

  /** A matriz dia × hora de uma métrica: um bloco de média e um de total. */
  const abaDaMetrica = (m: Metrica): AbaDaPlanilha => {
    const s = resultado.metricas[m];
    const bloco = (qual: "media" | "total"): LinhaDaPlanilha[] => {
      const mapa = qual === "media" ? s.mapa.media : s.mapa.total;
      const doDia = qual === "media" ? s.porDia.media : s.porDia.total;
      const daHora = qual === "media" ? s.porHora.todos : s.porHora.total;
      const canto = qual === "media" ? s.mediaPorDia : s.total;
      return [
        { celulas: [{ v: qual === "media" ? `${ROTULO_DA_METRICA[m]} — média por dia (em cada dia da semana)` : `${ROTULO_DA_METRICA[m]} — total no período`, estilo: "negrito" }] },
        { celulas: ["Dia", "Dias", ...horas.map((h) => `${h}h`), qual === "media" ? "Média do dia" : "Total do dia"], estilo: "cabecalho" },
        ...dias.map((w): LinhaDaPlanilha => ({
          celulas: [
            NOMES_DOS_DIAS[w],
            { v: resultado.diasPorSemana[w], estilo: "qtd" },
            ...horas.map((h): Celula => ({ v: mapa[w][h] ?? null, estilo: estiloDe(m) })),
            { v: doDia[w] ?? null, estilo: estiloDe(m, true) },
          ],
        })),
        {
          celulas: [
            { v: qual === "media" ? "Todos os dias" : "Total", estilo: "negrito" },
            { v: resultado.dias, estilo: "qtdNegrito" },
            ...horas.map((h): Celula => ({ v: daHora[h] ?? null, estilo: estiloDe(m, true) })),
            { v: canto, estilo: estiloDe(m, true) },
          ],
        },
      ];
    };
    return {
      nome: ROTULO_DA_METRICA[m],
      congelarLinhas: 7,
      larguras: [14, 6, ...horas.map(() => (m === "valor" ? 11 : 7)), 14],
      linhas: [...topo(`Vendas por dia e hora — ${ROTULO_DA_METRICA[m].toLowerCase()}`), ...bloco("media"), { celulas: [] }, ...bloco("total")],
    };
  };

  const abas: AbaDaPlanilha[] = [abaDoResumo(resultado, topo), ...METRICAS.map(abaDaMetrica)];
  const buffer = montarPlanilha(abas);
  return respostaDePlanilha(buffer, `vendas-por-dia-e-hora_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}

/** A aba "Resumo": as respostas prontas, por dia da semana e por hora. */
function abaDoResumo(res: ResultadoDataHora, topo: (titulo: string) => LinhaDaPlanilha[]): AbaDaPlanilha {
  const { pedidos, valor, itens } = res.metricas;
  const frases = Object.fromEntries(METRICAS.map((m) => [m, frasesDasRespostas(res.metricas[m], m)])) as Record<Metrica, ReturnType<typeof frasesDasRespostas>>;
  const perguntas: { chave: "melhorHora" | "melhorDia" | "horaMaisParada" | "pico"; texto: string }[] = [
    { chave: "melhorHora", texto: "Melhor horário" },
    { chave: "melhorDia", texto: "Melhor dia" },
    { chave: "horaMaisParada", texto: "Horário mais parado (com a loja vendendo)" },
    { chave: "pico", texto: "Pico da semana" },
  ];
  const resposta = (m: Metrica, chave: string) => frases[m].find((f) => f.chave === chave)?.resposta || "—";
  const ticket = (v: number, p: number) => (p > 0 ? Math.round((v / p) * 100) / 100 : null);

  return {
    nome: "Resumo",
    congelarLinhas: 0,
    larguras: [40, 14, 14, 14, 14, 14, 14, 14, 14],
    linhas: [
      ...topo("Vendas por dia e hora"),
      { celulas: ["Pergunta", "Por vendas", "Por valor", "Por itens"], estilo: "cabecalho" },
      ...perguntas.map((q) => [q.texto, resposta("pedidos", q.chave), resposta("valor", q.chave), resposta("itens", q.chave)]),
      { celulas: [] },
      { celulas: [{ v: "Por dia da semana", estilo: "negrito" }] },
      { celulas: ["Dia", "Dias no período", "Vendas por dia", "Vendas no total", "Valor por dia", "Valor no total", "Itens por dia", "Itens no total", "Ticket médio"], estilo: "cabecalho" },
      ...res.ordemDosDias.map((w): Celula[] => [
        NOMES_DOS_DIAS[w],
        { v: res.diasPorSemana[w], estilo: "qtd" },
        { v: pedidos.porDia.media[w], estilo: "qtd" }, { v: pedidos.porDia.total[w], estilo: "qtd" },
        { v: valor.porDia.media[w], estilo: "reais" }, { v: valor.porDia.total[w], estilo: "reais" },
        { v: itens.porDia.media[w], estilo: "qtd" }, { v: itens.porDia.total[w], estilo: "qtd" },
        { v: ticket(valor.porDia.total[w], pedidos.porDia.total[w]), estilo: "reais" },
      ]),
      {
        celulas: [
          { v: "Um dia médio / total", estilo: "negrito" }, { v: res.dias, estilo: "qtdNegrito" },
          { v: pedidos.mediaPorDia, estilo: "qtdNegrito" }, { v: pedidos.total, estilo: "qtdNegrito" },
          { v: valor.mediaPorDia, estilo: "reaisNegrito" }, { v: valor.total, estilo: "reaisNegrito" },
          { v: itens.mediaPorDia, estilo: "qtdNegrito" }, { v: itens.total, estilo: "qtdNegrito" },
          { v: ticket(valor.total, pedidos.total), estilo: "reaisNegrito" },
        ],
      },
      { celulas: [] },
      { celulas: [{ v: "Por hora (média por dia)", estilo: "negrito" }] },
      { celulas: ["Hora", "Vendas (todos os dias)", "Vendas seg–qui", "Vendas sex–dom", "Valor (todos os dias)", "Valor seg–qui", "Valor sex–dom", "Vendas no total", "Valor no total"], estilo: "cabecalho" },
      ...res.ordemDasHoras.map((h): Celula[] => [
        rotuloDaHora(h),
        { v: pedidos.porHora.todos[h], estilo: "qtd" }, { v: pedidos.porHora.semana[h], estilo: "qtd" }, { v: pedidos.porHora.fimDeSemana[h], estilo: "qtd" },
        { v: valor.porHora.todos[h], estilo: "reais" }, { v: valor.porHora.semana[h], estilo: "reais" }, { v: valor.porHora.fimDeSemana[h], estilo: "reais" },
        { v: pedidos.porHora.total[h], estilo: "qtd" }, { v: valor.porHora.total[h], estilo: "reais" },
      ]),
      { celulas: [] },
      { celulas: [{ v: "Cancelados não entram. Valor = total do pedido (com a taxa de entrega). Vendas = atendimentos: a mesa é UMA venda, na hora do primeiro lançamento; o valor e os itens de cada lançamento ficam na hora dele (o lançado, sem taxa de serviço e gorjeta; o desconto do fechamento não sai do valor) — a mesma régua do Vendas por período e do Faturamento por dia.", estilo: "suave" }] },
      { celulas: [{ v: `"Horário mais parado" procura só entre as horas em que a loja costuma vender (${res.expediente.map((h) => `${h}h`).join(", ") || "nenhuma"}): a hora em que ela está fechada não é "parada".`, estilo: "suave" }] },
    ],
  };
}
