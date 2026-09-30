/**
 * GET /api/store/relatorios/tempos — "Tempo por status e produção".
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   apenasAtrasados=0   a lista traz TODOS os pedidos (padrão: só os que saíram depois do prazo)
 *   formato=xlsx        baixa a planilha (as duas partes, e a lista com todos os pedidos)
 *
 * Categoria e produto marcados: as etapas contam os pedidos que TÊM esse item
 * ("quanto demora um pedido com pizza"), e a produção mostra só esses itens.
 *
 * A conta está em lib/relatorios/tempos.ts (testada em scripts/teste-tempos.ts),
 * inclusive o porquê de cada régua — o aceite recarimbado, o pedido que a loja
 * aceita sozinha, o "entregue" que é a conclusão do iFood horas depois, os dois
 * totais, o agendado separado.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { catalogoDoRelatorio } from "@/lib/relatorios/catalogo";
import { canalDoRelatorio, DIAS_CURTOS, fmtDia, ROTULO_DO_TIPO, tipoDeVenda } from "@/lib/relatorios/base";
import {
  aceitoNaChegada, antesDoDado, DIA_DO_PRONTO_POR_ITEM, DIA_DOS_CARIMBOS, ETAPAS, limitesDoAlerta, ROTULO_DA_FAIXA, temposDoRelatorio,
  TETO_DA_RUA_MIN, type ChaveDaEtapa, type ConfigDosTempos, type NoDaProducao, type PedidoParaTempos, type ResumoDoPrazo,
} from "@/lib/relatorios/tempos";
import { categoriaDoItem, SEM_CATEGORIA } from "@/lib/itens-do-relatorio";
import { nomeDoProduto } from "@/lib/relatorios/itens-vendidos";
import { chaveDoNome } from "@/lib/categoria-do-item";
import { canaisConhecidos, canalDoPedido } from "@/lib/canal-do-pedido";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/** Quantas linhas a TELA recebe na lista de pedidos. A planilha leva todas. */
const LIMITE_DA_LISTA_NA_TELA = 1000;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const planilha = sp.get("formato") === "xlsx";

  const [pedidos, catalogo, dono, lojas] = await Promise.all([
    pedidosDoRelatorio(ctx, {
      select: {
        acceptedAt: true, readyAt: true, dispatchedAt: true, deliveredAt: true,
        kdsProductionAt: true, kdsFinishingAt: true, kdsFinishedAt: true, scheduledDatetime: true,
        dailyOrderNumber: true, openDeliveryReference: true,
        // O cartão do painel decide retirada (40 min) ou entrega (45 min) pelo
        // tipo gravado e pelo marcador na observação — o prazo copia o cartão.
        notes: true,
        items: {
          select: {
            quantity: true, productName: true, menuProductId: true, comboSelections: true, prontoEm: true,
            menuProduct: { select: { id: true, name: true, category: true, active: true } },
          },
        },
      },
    }),
    catalogoDoRelatorio(ctx.lojaIds),
    prisma.user.findUnique({ where: { id: ctx.donoId }, select: { timeAlertConfig: true } }),
    // Cada loja com o seu aceite automático: é a coluna que decide se o
    // pedido do site, da Wabiz, do 99Food e do totem nasce ACEITO.
    prisma.user.findMany({ where: { id: { in: ctx.lojaIds } }, select: { id: true, autoAcceptOrders: true } }),
  ]);
  const aceitaSozinha = new Set(lojas.filter((l) => l.autoAcceptOrders).map((l) => l.id));

  // O pedido na forma da conta: tipo, canal e, para cada item, a categoria DE
  // VERDADE (a do cardápio, também para o item espelho do iFood) e a chave que
  // junta "o mesmo produto" vindo de canais diferentes (a do Itens vendidos).
  const paraConta: PedidoParaTempos[] = pedidos.map((p) => {
    const mapas = catalogo.mapasDe(p.franchiseeId);
    const canal = canalDoRelatorio(p);
    return {
      id: p.id,
      status: p.status,
      tipo: tipoDeVenda(p),
      canal,
      numero: p.dailyOrderNumber ?? null,
      referencia: canalDoPedido(p as any).referencia,
      deliveryType: p.deliveryType,
      notes: p.notes,
      aceitoPelaLoja: aceitoNaChegada(canal, p.createdAt, aceitaSozinha.has(p.franchiseeId)),
      createdAt: p.createdAt,
      acceptedAt: p.acceptedAt, readyAt: p.readyAt, dispatchedAt: p.dispatchedAt, deliveredAt: p.deliveredAt,
      kdsProductionAt: p.kdsProductionAt, kdsFinishingAt: p.kdsFinishingAt, kdsFinishedAt: p.kdsFinishedAt,
      scheduledDatetime: p.scheduledDatetime,
      itens: (p.items || []).map((i: any) => {
        const categoria = categoriaDoItem(i, mapas) || SEM_CATEGORIA;
        const nome = nomeDoProduto(i);
        return {
          nome, categoria,
          chave: `${categoria}:${chaveDoNome(nome) || nome.toLowerCase()}`,
          produtoId: i.menuProductId || i.menuProduct?.id || null,
          quantidade: Number(i.quantity) || 0,
          prontoEm: i.prontoEm,
        };
      }),
    };
  });

  const limites = limitesDoAlerta(dono?.timeAlertConfig);
  const cfg: ConfigDosTempos = {
    tz: ctx.tz,
    limites,
    periodo: { de: ctx.filtros.de, ate: ctx.filtros.ate },
    categorias: new Set(ctx.filtros.categorias),
    produtos: new Set(ctx.filtros.produtos),
    // A planilha leva todos os pedidos, com a coluna "Situação" para filtrar.
    apenasAtrasados: planilha ? false : sp.get("apenasAtrasados") !== "0",
    limiteDaLista: planilha ? Number.MAX_SAFE_INTEGER : LIMITE_DA_LISTA_NA_TELA,
  };
  const resultado = temposDoRelatorio(paraConta, cfg);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const avisos = {
    carimbosDesde: DIA_DOS_CARIMBOS,
    prontoPorItemDesde: DIA_DO_PRONTO_POR_ITEM,
    periodoAntesDosCarimbos: antesDoDado(ctx.filtros.de, DIA_DOS_CARIMBOS),
    periodoAntesDoProntoPorItem: antesDoDado(ctx.filtros.de, DIA_DO_PRONTO_POR_ITEM),
    tetoDaRua: TETO_DA_RUA_MIN,
  };

  if (!planilha) {
    return NextResponse.json({ ...cabecalho, ...resultado, avisos });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    ctx.filtros.horaDe || ctx.filtros.horaAte ? `Horário ${ctx.filtros.horaDe || "00:00"}–${ctx.filtros.horaAte || "24:00"}` : "",
    ctx.filtros.tipos.length ? `Tipo: ${ctx.filtros.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    ctx.filtros.canais.length ? `Canal: ${ctx.filtros.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    ctx.filtros.marcas.length ? `Marca: ${ctx.filtros.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
    ctx.filtros.categorias.length ? `Pedidos com: ${ctx.filtros.categorias.join(", ")}` : "",
    ctx.filtros.produtos.length ? `${ctx.filtros.produtos.length} produto(s) marcado(s)` : "",
  ].filter(Boolean).join(" · ");
  const alertas = [
    limites.amareloAtivo ? `amarelo com até ${limites.amareloMin} min de folga` : "amarelo desligado",
    limites.vermelhoAtivo ? `vermelho com até ${limites.vermelhoMin} min` : "vermelho desligado",
  ].join(", ");

  // Minutos como NÚMERO com uma casa (o lojista soma e faz gráfico no Excel).
  const min = (v: number | null | undefined, negrito = false): Celula =>
    v === null || v === undefined ? "" : { v, estilo: negrito ? "qtdNegrito" : "qtd" };
  const qtd = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "qtdNegrito" : "qtd" });
  const pct = (parte: number, todo: number): Celula => (todo > 0 ? { v: parte / todo, estilo: "pct" } : "");

  const relogio = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const quando = (isoString: string | null) => (isoString ? relogio.format(new Date(isoString)).replace(",", "") : "");

  const topo = (titulo: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: `Tempos em minutos. Prazo: o do cartão do painel — a hora prometida pela plataforma, senão 40 min (retirada, balcão, totem) ou 45 min (entrega e o pedido do site para retirar, que o cartão não reconhece como retirada); mesa não tem prazo. Alertas: ${alertas}.`, estilo: "suave" }] },
    { celulas: [] },
  ];

  // Aba 1 — as etapas e o prazo.
  const linhasDoPrazo = (p: ResumoDoPrazo): LinhaDaPlanilha[] => [
    { celulas: ["Situação na saída", "Pedidos", "% dos medidos"], estilo: "cabecalho" },
    { celulas: ["Saiu no prazo", qtd(p.noPrazo), pct(p.noPrazo, p.medidos)] },
    { celulas: ["Alerta amarelo", qtd(p.amarelo), pct(p.amarelo, p.medidos)] },
    { celulas: ["Alerta vermelho (em cima da hora)", qtd(p.vermelho), pct(p.vermelho, p.medidos)] },
    { celulas: [{ v: "Estourou o prazo", estilo: "negrito" }, qtd(p.estourados, true), pct(p.estourados, p.medidos)] },
    { celulas: [{ v: "Medidos", estilo: "negrito" }, qtd(p.medidos, true), ""] },
    { celulas: [{ v: "Sem hora de saída (não medidos)", estilo: "suave" }, qtd(p.semCarimbo), ""] },
    { celulas: [{ v: "Fora da curva (finalizado horas depois, não medidos)", estilo: "suave" }, qtd(p.foraDaCurva), ""] },
    ...(p.semPrazo ? [{ celulas: [{ v: "Mesa (sem prazo)", estilo: "suave" as const }, qtd(p.semPrazo), ""] }] : []),
    ...(p.estourados ? [{ celulas: ["Atraso mediano dos estourados (min)", min(p.atrasoMediano), ""] }, { celulas: ["Maior atraso (min)", min(p.maiorAtraso), ""] }] : []),
  ];
  const abaEtapas: LinhaDaPlanilha[] = [
    ...topo("Tempo por etapa"),
    { celulas: ["Etapa", "Vale para", "Pedidos", "Medidos", "Sem carimbo", "Fora da curva", "Carimbo reescrito", "Mínimo", "Mediana", "Média", "90% em até", "Máximo"], estilo: "cabecalho" },
    ...resultado.etapas.map((e) => ({
      celulas: [
        { v: e.titulo, estilo: "negrito" as const }, e.aplicaA, qtd(e.elegiveis), qtd(e.medidos), qtd(e.semCarimbo), qtd(e.foraDaCurva), qtd(e.reescritos),
        min(e.minimo), min(e.mediana, true), min(e.media), min(e.p90), min(e.maximo),
      ],
    })),
    { celulas: [] },
    { celulas: [{ v: `Pedidos no período: ${resultado.pedidos} (cancelados não entram)${resultado.agendados ? ` · ${resultado.agendados} agendado(s), contados à parte` : ""}.`, estilo: "suave" }] },
    { celulas: [{ v: "Cada etapa conta só o pedido com os dois carimbos dela: falta de carimbo não vira zero. As etapas não somam o total (cada uma tem os seus pedidos medidos).", estilo: "suave" }] },
    { celulas: [{ v: "Carimbo reescrito: o sistema guarda a ÚLTIMA vez que o pedido passou por 'aceito', e a baixa da cozinha e o 'pronto' do iFood regravam essa hora — nesses pedidos a espera pelo aceite não é conhecida. O pedido que a loja aceita sozinha (aceite automático ligado: site, Wabiz, 99Food, totem) não esperou aceite e não entra nessa etapa.", estilo: "suave" }] },
    { celulas: [{ v: "Total da entrega: do pedido até o cliente receber em casa. Total na loja: do pedido até ficar pronto no balcão, na retirada, no totem e na mesa. São perguntas diferentes e ficam separadas — juntas, a mediana mudaria só com a mistura do dia.", estilo: "suave" }] },
    { celulas: [{ v: `Fora da curva: carimbos fora de ordem, mais de 4 h na etapa ou mais de ${TETO_DA_RUA_MIN} min na rua (é o pedido encerrado depois — pela conclusão automática do iFood ou pelo fechamento do caixa —, não a entrega).`, estilo: "suave" }] },
    ...(avisos.periodoAntesDosCarimbos ? [{ celulas: [{ v: `Os carimbos de etapa existem desde ${fmtDia(DIA_DOS_CARIMBOS)}: pedidos anteriores não têm medição.`, estilo: "suave" as const }] }] : []),
    { celulas: [] },
    { celulas: [{ v: "Por tipo de venda (mediana)", estilo: "titulo" }] },
    { celulas: ["Tipo", "Pedidos", ...ETAPAS.map((e) => e.titulo), "Estouraram o prazo"], estilo: "cabecalho" },
    ...resultado.porTipo.map((t) => ({
      celulas: [
        { v: ROTULO_DO_TIPO[t.tipo], estilo: "negrito" as const }, qtd(t.pedidos),
        ...ETAPAS.map((e) => min(t.etapas[e.chave as ChaveDaEtapa].mediana)),
        t.tipo === "MESA" ? "" : qtd(t.estourados),
      ] as Celula[],
    })),
    { celulas: [] },
    { celulas: [{ v: "Prazo dos pedidos para agora", estilo: "titulo" }] },
    ...linhasDoPrazo(resultado.prazo),
    ...(resultado.agendados ? [
      { celulas: [] },
      { celulas: [{ v: `Agendados (${resultado.agendados}) — o prazo é a hora marcada`, estilo: "titulo" as const }] },
      ...linhasDoPrazo(resultado.prazoDosAgendados),
    ] : []),
  ];

  // Aba 2 — a mediana de cada etapa, dia a dia.
  const colunasDasEtapas = ETAPAS.map((e) => e.titulo);
  const abaPorDia: LinhaDaPlanilha[] = [
    ...topo("Tempo por etapa, por dia (mediana)"),
    { celulas: ["Dia", "Dia da semana", "Pedidos", ...colunasDasEtapas, "Com prazo medido", "Estouraram o prazo", "% estourados"], estilo: "cabecalho" },
    ...resultado.porDia.map((d) => ({
      celulas: [
        fmtDia(d.dia), DIAS_CURTOS[d.diaSemana], qtd(d.pedidos),
        ...ETAPAS.map((e) => min(d.etapas[e.chave as ChaveDaEtapa].mediana)),
        qtd(d.medidosNoPrazo), qtd(d.estourados), pct(d.estourados, d.medidosNoPrazo),
      ] as Celula[],
    })),
    { celulas: [] },
    { celulas: [{ v: "Mediana: metade dos pedidos do dia ficou abaixo deste tempo. Célula vazia: nenhum pedido medido naquela etapa.", estilo: "suave" }] },
  ];

  // Aba 3 — todos os pedidos (a lista da tela sem o "só atrasados").
  const abaPedidos: LinhaDaPlanilha[] = [
    ...topo("Pedidos e prazo"),
    { celulas: ["Dia", "Hora", "Nº", "Nº do parceiro", "Canal", "Tipo", "Agendado", "Prazo", "Saída", "Até sair (min)", "Situação", "Passou do prazo (min)", ...colunasDasEtapas.map((t) => `${t} (min)`)], estilo: "cabecalho" },
    ...resultado.lista.map((l) => ({
      celulas: [
        fmtDia(l.dia), l.hora, l.numero ?? "", l.referencia ?? "", nomeDoCanal.get(l.canal) || l.canal, ROTULO_DO_TIPO[l.tipo], l.agendado ? "Sim" : "",
        quando(l.prazo), quando(l.saida), min(l.tempoAteSaida), ROTULO_DA_FAIXA[l.faixa],
        l.faixa === "estourado" ? min(l.excedeu, true) : "",
        ...ETAPAS.map((e) => min(l.etapas[e.chave as ChaveDaEtapa])),
      ] as Celula[],
    })),
  ];

  // Aba 4 — produção por produto (categoria → produto, com os "+" do Excel).
  const linhaDaProducao = (n: NoDaProducao, nivel: number, categoria: string): LinhaDaPlanilha => {
    const forte = n.tipo === "categoria";
    return {
      nivel,
      celulas: [
        { v: `${"    ".repeat(nivel)}${n.nome}`, estilo: forte ? "negrito" : "texto" },
        forte ? "Categoria" : "Produto", categoria,
        qtd(n.medidos, forte), qtd(n.quantidade, forte),
        min(n.minimo), min(n.mediana, forte), min(n.media), min(n.p90), min(n.maximo),
      ],
    };
  };
  const pr = resultado.producao;
  const abaProducao: LinhaDaPlanilha[] = [
    ...topo("Tempo de produção por produto"),
    { celulas: ["Nome", "Tipo", "Categoria", "Medições", "Quantidade", "Mínimo", "Mediana", "Média", "90% em até", "Máximo"], estilo: "cabecalho" },
    ...pr.categorias.flatMap((c) => [linhaDaProducao(c, 0, c.nome), ...(c.filhos || []).map((f) => linhaDaProducao(f, 1, c.nome))]),
    { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", qtd(pr.medidos, true), qtd(pr.quantidade, true), min(pr.minimo), min(pr.mediana, true), min(pr.media), min(pr.p90), min(pr.maximo)] },
    { celulas: [] },
    { celulas: [{ v: "Da entrada do pedido na cozinha (a tela do KDS; balcão e mesa, a hora do lançamento) até o cozinheiro dar o item por pronto. O pronto é da TELA: os itens da mesma tela ganham a mesma hora na baixa.", estilo: "suave" }] },
    { celulas: [{ v: `Medição = uma linha de pedido ("10 esfihas" é uma medição e 10 unidades). Itens sem pronto (bebida só na finalização, por exemplo): ${pr.semPronto}. Fora da curva (pronto fora de ordem, a mais de 4 h, ou de pedido que a cozinha só finalizou horas depois): ${pr.foraDaCurva}. Agendados não entram.`, estilo: "suave" }] },
    ...(avisos.periodoAntesDoProntoPorItem ? [{ celulas: [{ v: `O pronto por item existe desde ${fmtDia(DIA_DO_PRONTO_POR_ITEM)}: antes disso não há medição.`, estilo: "suave" as const }] }] : []),
  ];

  // Aba 5 — produção por hora do dia.
  const abaPorHora: LinhaDaPlanilha[] = [
    ...topo("Tempo de produção por hora do dia"),
    { celulas: ["Hora", "Medições", "Quantidade", "Mediana", "90% em até", "Máximo"], estilo: "cabecalho" },
    ...pr.porHora.map((x) => ({
      celulas: [`${String(x.hora).padStart(2, "0")}h`, qtd(x.medidos), qtd(x.quantidade), min(x.mediana), min(x.p90), min(x.maximo)] as Celula[],
    })),
    { celulas: [] },
    { celulas: [{ v: "A hora é a da entrada do pedido na cozinha, no relógio da loja; da 0h às 4h é o fim do expediente do dia anterior.", estilo: "suave" }] },
  ];

  const buffer = montarPlanilha([
    { nome: "Etapas", congelarLinhas: 6, larguras: [30, 44, 10, 10, 12, 13, 17, 10, 10, 10, 12, 10], linhas: abaEtapas },
    { nome: "Por dia", congelarLinhas: 6, larguras: [12, 13, 10, 17, 12, 22, 10, 16, 14, 17, 18, 13], linhas: abaPorDia },
    { nome: "Pedidos", congelarLinhas: 6, larguras: [12, 7, 7, 15, 12, 10, 10, 13, 13, 14, 19, 20, 17, 12, 22, 10, 16, 14], linhas: abaPedidos },
    { nome: "Produção por produto", congelarLinhas: 6, larguras: [44, 11, 24, 11, 12, 10, 10, 10, 12, 10], linhas: abaProducao },
    { nome: "Produção por hora", congelarLinhas: 6, larguras: [10, 11, 12, 10, 12, 10], linhas: abaPorHora },
  ]);
  return respostaDePlanilha(buffer, `tempos_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
