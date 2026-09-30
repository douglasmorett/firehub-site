/**
 * GET /api/store/relatorios/areas-de-entrega — o "Vendas por área de entrega" da Saipos.
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   pctPor=pedidos   percentual pela quantidade de pedidos (padrão: pelo valor)
 *   comparar=0       sem a coluna do período anterior (padrão: compara)
 *   formato=xlsx     baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/areas-de-entrega.ts (testada em
 * scripts/teste-areas-de-entrega.ts). Aqui só se busca: os pedidos do período
 * (com os cancelados, que o relatório CONTA por área sem somar na venda), os
 * do período anterior de mesmo tamanho e a configuração de entrega ATUAL de
 * cada loja — a mesma que o /api/delivery-fee usa para cobrar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { fmtDia, periodoAnterior, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import {
  ROTULO_DA_SITUACAO, vendasPorArea, type LinhaDaArea, type LojaParaAreas, type NumerosDaArea, type PedidoParaAreas,
} from "@/lib/relatorios/areas-de-entrega";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

/** Só o que a conta lê, por cima das colunas dos filtros. */
const COLUNAS_DA_ENTREGA = {
  customerAddress: true,
  customerLatLng: true,
  deliveryFee: true,
  deliveryDistance: true,
  deliveryBy: true,
  ifoodDriverName: true,
  ifoodDriverStatus: true,
  parentOrderId: true,
} as const;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const pctPor = sp.get("pctPor") === "pedidos" ? "pedidos" : "valor";
  const comparar = sp.get("comparar") !== "0";
  const anterior = periodoAnterior(ctx.filtros.de, ctx.filtros.ate);
  // "Nada marcado" é todos os tipos — inclusive a retirada.
  const incluirRetirada = ctx.filtros.tipos.length === 0 || ctx.filtros.tipos.includes("RETIRADA");

  const [pedidos, pedidosAnteriores, lojas] = await Promise.all([
    pedidosDoRelatorio(ctx, { select: COLUNAS_DA_ENTREGA, incluirForaDaVenda: true }),
    comparar
      ? pedidosDoRelatorio(ctx, { select: COLUNAS_DA_ENTREGA, janela: janelaDoPeriodo(anterior.de, anterior.ate, ctx.tz) })
      : Promise.resolve(null),
    prisma.user.findMany({
      where: { id: { in: ctx.lojaIds } },
      select: {
        id: true, storeName: true, name: true, city: true, storeAddress: true, storeLatLng: true,
        deliveryZones: true, deliveryZoneType: true, deliveryConfig: true,
      },
    }),
  ]);

  const lojasDaConta: LojaParaAreas[] = lojas.map((l) => ({
    id: l.id,
    nome: ctx.lojasDaConta.find((x) => x.id === l.id)?.nome || l.storeName || l.name || "Loja",
    city: l.city, storeAddress: l.storeAddress, storeLatLng: l.storeLatLng,
    deliveryZones: l.deliveryZones, deliveryZoneType: l.deliveryZoneType, deliveryConfig: l.deliveryConfig,
  }));

  const resultado = vendasPorArea(pedidos as PedidoParaAreas[], lojasDaConta, {
    anteriores: pedidosAnteriores as PedidoParaAreas[] | null,
    incluirRetirada,
    pctPor,
  });
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, periodoAnterior: comparar ? anterior : null, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  // Uma aba, com as entregas da loja, as do parceiro e a retirada em blocos,
  // subtotal em cada um. Coluna "Situação" para filtrar no Excel o que é área
  // cadastrada, fora da área ou sem ponto — na tela isso é um selo.
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    ctx.filtros.horaDe || ctx.filtros.horaAte ? `Horário ${ctx.filtros.horaDe || "00:00"}–${ctx.filtros.horaAte || "24:00"}` : "",
    ctx.filtros.tipos.length ? `Tipo: ${ctx.filtros.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    ctx.filtros.canais.length ? `Canal: ${ctx.filtros.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    ctx.filtros.marcas.length ? `Marca: ${ctx.filtros.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const variasLojas = resultado.cadastroDasLojas.length > 1;
  const comoAsAreas = resultado.cadastroDasLojas.map((l) => {
    const como = l.modo === "SEM_AREA"
      ? "sem área de entrega cadastrada — agrupado pelo bairro escrito no endereço"
      : `${l.rotuloDoModo} (${l.areasCadastradas} área${l.areasCadastradas === 1 ? "" : "s"})${l.temPontoDaLoja ? "" : " — a loja não tem o ponto no mapa"}`;
    return variasLojas ? `${l.nome}: ${como}` : como;
  }).join(" · ");

  const titulosDasColunas = [
    "Área", ...(variasLojas ? ["Loja"] : []), "Situação", "Pedidos", "Valor", "%", "Ticket médio",
    "Taxa média cobrada", "Taxa da área hoje", "Entregas sem taxa", "Distância média (km)", "Pedidos com distância",
    "Decididos sem o ponto", "Cancelados", "Valor cancelado",
    ...(comparar ? ["Pedidos (período anterior)", "Valor (período anterior)"] : []),
    "Canais",
  ];

  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Vendas por área de entrega — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)${comparar ? ` · comparado com ${fmtDia(anterior.de)} a ${fmtDia(anterior.ate)}` : ""}`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: `Áreas: ${comoAsAreas}`, estilo: "suave" }] },
    { celulas: [{ v: "As áreas são as cadastradas HOJE: mudar as áreas reclassifica o histórico.", estilo: "suave" }] },
    { celulas: [{ v: `Percentual pelo ${resultado.pctPor === "pedidos" ? "número de pedidos" : "valor"}, sobre o total de entregas (loja + parceiro).`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: titulosDasColunas, estilo: "cabecalho" },
  ];

  const numeros = (n: NumerosDaArea & { taxaDaArea?: number | null; anterior?: { pedidos: number; valor: number } | null }, negrito: boolean): Celula[] => [
    { v: n.pedidos, estilo: negrito ? "qtdNegrito" : "qtd" },
    { v: n.valor, estilo: negrito ? "reaisNegrito" : "reais" },
    { v: n.pct / 100, estilo: negrito ? "pctNegrito" : "pct" },
    n.ticketMedio === null ? "" : { v: n.ticketMedio, estilo: negrito ? "reaisNegrito" : "reais" },
    n.taxaMedia === null ? "" : { v: n.taxaMedia, estilo: negrito ? "reaisNegrito" : "reais" },
    n.taxaDaArea == null ? "" : { v: n.taxaDaArea, estilo: "reais" },
    { v: n.semTaxa, estilo: "qtd" },
    n.distanciaMedia === null ? "" : { v: n.distanciaMedia, estilo: "qtd" },
    { v: n.comDistancia, estilo: "qtd" },
    { v: n.aproximados, estilo: "qtd" },
    { v: n.cancelados, estilo: "qtd" },
    { v: n.valorCancelado, estilo: "reais" },
    ...(comparar
      ? (n.anterior ? [{ v: n.anterior.pedidos, estilo: "qtd" as const }, { v: n.anterior.valor, estilo: "reais" as const }] : ["", ""])
      : []),
  ];

  const situacao = (l: LinhaDaArea) => (l.situacao === "PARCEIRO" ? `Entrega ${l.parceiro || "do parceiro"}` : ROTULO_DA_SITUACAO[l.situacao]);
  const linhaDaArea = (l: LinhaDaArea): LinhaDaPlanilha => ({
    celulas: [
      l.nome, ...(variasLojas ? [l.loja] : []), situacao(l),
      ...numeros(l, false),
      l.canais.map((c) => `${c.nome} ${c.pedidos}`).join(" · "),
    ],
  });
  // O % de cada subtotal (e do total) vem pronto da conta, pela mesma régua das
  // linhas: sem entrega nenhuma, o total é 0%, não 100%.
  const subtotal = (rotulo: string, t: NumerosDaArea, ant: { pedidos: number; valor: number } | null | undefined): LinhaDaPlanilha => ({
    celulas: [{ v: rotulo, estilo: "negrito" }, ...(variasLojas ? [""] : []), "", ...numeros({ ...t, anterior: ant ?? null }, true), ""],
  });

  const vazio = { celulas: [] as Celula[] };
  const linhas: LinhaDaPlanilha[] = [
    ...topo,
    { celulas: [{ v: "ENTREGAS DA LOJA", estilo: "negrito" }] },
    ...resultado.linhas.map(linhaDaArea),
    subtotal("Subtotal — entregas da loja", resultado.propria, resultado.anterior?.propria),
    vazio,
  ];
  if (resultado.parceiro.length) {
    linhas.push(
      { celulas: [{ v: "ENTREGAS DO PARCEIRO (a área e a taxa são da plataforma)", estilo: "negrito" }] },
      ...resultado.parceiro.map(linhaDaArea),
      subtotal("Subtotal — entregas do parceiro", resultado.doParceiro, resultado.anterior?.doParceiro),
      vazio,
    );
  }
  // O bairro que parou de pedir não tem linha neste período; sem ele aqui, a
  // coluna do anterior não fecha com o total.
  if (resultado.anterior?.pararam.length) {
    const colunasAteOAnterior = titulosDasColunas.length - (variasLojas ? 3 : 2) - 3; // números antes das duas do anterior
    linhas.push(
      { celulas: [{ v: "VENDERAM NO PERÍODO ANTERIOR E NADA NESTE", estilo: "negrito" }] },
      ...resultado.anterior.pararam.map((a): LinhaDaPlanilha => ({
        celulas: [
          a.nome, ...(variasLojas ? [a.loja] : []), a.situacao === "PARCEIRO" ? `Entrega ${a.parceiro || "do parceiro"}` : ROTULO_DA_SITUACAO[a.situacao],
          { v: 0, estilo: "qtd" }, { v: 0, estilo: "reais" },
          ...Array.from({ length: colunasAteOAnterior - 2 }, () => ""),
          { v: a.pedidos, estilo: "qtd" }, { v: a.valor, estilo: "reais" },
        ],
      })),
      vazio,
    );
  }
  linhas.push(subtotal("TOTAL DE ENTREGAS", resultado.total, resultado.anterior));
  if (resultado.retirada) {
    linhas.push({
      celulas: [
        { v: "Retirada (sem entrega)", estilo: "negrito" }, ...(variasLojas ? [""] : []), "Fora do 100%",
        { v: resultado.retirada.pedidos, estilo: "qtd" }, { v: resultado.retirada.valor, estilo: "reais" }, "",
        resultado.retirada.ticketMedio === null ? "" : { v: resultado.retirada.ticketMedio, estilo: "reais" },
      ],
    });
  }
  linhas.push(
    vazio,
    { celulas: [{ v: "Valor = total do pedido, com a taxa de entrega. Cancelados não somam na venda (aparecem na coluna própria). Mesa, balcão e totem não entram: não têm entrega.", estilo: "suave" }] },
    { celulas: [{ v: "A área sai da mesma regra que cobra a taxa: ponto do cliente no mapa quando o pedido tem; senão o bairro escrito no endereço. \"Decididos sem o ponto\" = pela distância gravada no pedido ou pelo nome do bairro.", estilo: "suave" }] },
    { celulas: [{ v: "Acréscimo (item pedido depois, no mesmo endereço) soma o valor na área do pedido original e não conta como outra entrega.", estilo: "suave" }] },
  );

  const larguras = [34, ...(variasLojas ? [22] : []), 24, 9, 13, 8, 12, 12, 12, 10, 12, 11, 11, 10, 13, ...(comparar ? [13, 14] : []), 36];
  const buffer = montarPlanilha([{ nome: "Áreas de entrega", congelarLinhas: topo.length, larguras, linhas }]);
  return respostaDePlanilha(buffer, `areas-de-entrega_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
