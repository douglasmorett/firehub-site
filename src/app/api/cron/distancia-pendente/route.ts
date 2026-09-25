/**
 * GET /api/cron/distancia-pendente
 *
 * Preenche `CustomerOrder.deliveryDistance` nos pedidos de entrega que
 * nasceram sem ela — é o número que a escada de km do entregador compara no
 * fechamento (lib/ganho-do-entregador.ts).
 *
 * ── Por que um cron, e não na importação ────────────────────────────────────
 *
 * Pedido de app chega com o ponto do cliente em ~2 de cada 3 casos (medido em
 * 15/09/2026: 1.272 de 1.872 no iFood, 12 de 76 no 99Food). Esses já saem
 * medidos na hora de gravar, de graça. O resto só tem o TEXTO do endereço, e
 * geocodificar custa uma chamada de rede com limite de 1/s — na importação
 * isso seria latência no minuto mais quente do serviço, e o pedido é mais
 * importante que a medida. Aqui fora, o mesmo trabalho não atrapalha ninguém
 * e chega muito antes do fechamento da semana.
 *
 * ── A ordem, da mais barata para a mais cara ────────────────────────────────
 *   1. Tem `customerLatLng` gravado: é só a conta. Centenas por ciclo.
 *   2. Não tem: geocodifica o endereço, grava TAMBÉM as coordenadas (a
 *      roteirização passa a aproveitar) e mede. Poucos por ciclo, espaçados.
 *
 * Pedido que não dá para medir fica sem distância e é tentado de novo — até o
 * limite de idade, para não ficar batendo em endereço impossível para sempre.
 *
 * ── O ponto gravado e o repasse por faixa (25/09/2026) ──────────────────────
 *
 * O pedido do site e do balcão agora grava o ponto que DECIDIU a taxa
 * (`customerLatLng` = {lat,lng,origem,medida}); a fase 1 mede a partir dele, e
 * não de uma geocodificação nova. Ponto de enchimento (o 99Food manda
 * (-23,-43) quando não sabe: 33 de 270 pedidos em 20 dias) é apagado para a
 * fase 2 geocodificar o texto — medir dele gravou 54,34 km na Brazza Burguer.
 * O mesmo vale para o ponto longe demais da loja (R8: além de
 * max(2 × raio, 15 km)), a menos que seja o pino/GPS do próprio cliente
 * (lib/entrega-do-pedido.ts, `descarteDoPontoGravado`).
 *
 * A fase 2 passa a atender também a loja que paga pela TABELA de faixas
 * (repasse por faixa na tela de Entrega), não só a que tem entregador pago por
 * km: para ela a distância também é dinheiro. E no pedido próprio RECENTE que
 * nasceu sem distância, o repasse da faixa é gravado junto
 * (`repasseQueOCronCompleta`); pedido de mais de algumas horas ganha só a
 * distância — o acerto dele já pode ter sido pago.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyCronAuth } from "@/lib/cron-auth";
import { distanciaDaEntregaKm, lerPonto } from "@/lib/distancia-da-entrega";
import { lerAcerto } from "@/lib/ganho-do-entregador";
import { geocodificarNoServidor } from "@/lib/geocodificacao-servidor";
import { lerRegraDeRepasse, temRepassePorFaixa, type RegraDeRepasse } from "@/lib/repasse-do-entregador";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import {
  descarteDoPontoGravado,
  geocodificacaoAchou,
  origemDaGeocodificacao,
  repasseQueOCronCompleta,
} from "@/lib/entrega-do-pedido";

export const dynamic = "force-dynamic";

/** Pedido mais velho que isto não muda mais acerto nenhum. */
const IDADE_MAXIMA_DIAS = 30;
/** Com coordenada é só conta local, mas ainda é um UPDATE por pedido. */
const LIMITE_COM_COORDENADA = 150;
/** Sem coordenada é uma chamada de rede cada: o Nominatim pede ~1 por segundo. */
const LIMITE_PARA_GEOCODIFICAR = 6;

/**
 * O prazo do cron-runner é 55 s (scripts/cron-runner.js) e ele DERRUBA a
 * chamada ao estourar. Na primeira rodada em produção, 15/09/2026, o ciclo
 * gravou 300 distâncias, entrou na geocodificação e foi cortado no meio — o
 * contador parou em 302 e não subiu mais.
 *
 * Trabalho por ciclo agora é limitado pelo RELÓGIO, não só pela contagem:
 * quando o orçamento acaba, a rodada devolve o que fez e o próximo ciclo
 * continua de onde parou. A fila é sempre "o que ainda está nulo", então
 * parar no meio nunca perde nada.
 */
const ORCAMENTO_MS = 45_000;
/**
 * A fatia da fase 1. Sem ela, um dia de muita entrega com coordenada comeria o
 * ciclo inteiro e a GEOCODIFICACAO — que e o que a loja pagando por faixa
 * espera — nunca chegaria a rodar.
 */
const ORCAMENTO_FASE_1_MS = 12_000;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const comecou = Date.now();
  const acabouOTempo = () => Date.now() - comecou > ORCAMENTO_MS;

  const desde = new Date(Date.now() - IDADE_MAXIMA_DIAS * 24 * 60 * 60_000);

  const pendentesDe = { deliveryType: "DELIVERY", deliveryDistance: null, createdAt: { gte: desde } } as const;
  // O canal e o repasse gravado vêm junto: é o que decide se o cron completa
  // o repasse da faixa (só pedido próprio, e só se a venda não gravou).
  const campos = {
    id: true, franchiseeId: true, customerLatLng: true, customerAddress: true, motoboyFee: true,
    source: true, ifoodOrderId: true, openDeliveryChannel: true, openDeliveryOrderId: true,
    // A idade decide se o repasse ainda pode ser completado (pedido velho
    // pode já ter sido pago no fechamento).
    createdAt: true,
  } as const;
  type PedidoPendente = {
    id: string; franchiseeId: string; customerLatLng: unknown; customerAddress: string | null; motoboyFee: number | null;
    source: string | null; ifoodOrderId: string | null; openDeliveryChannel: string | null; openDeliveryOrderId: string | null;
    createdAt: Date;
  };

  let medidos = 0;
  let geocodificados = 0;
  let semResposta = 0;
  let pontosDescartados = 0;
  let repassesGravados = 0;

  // ── Só lojas com o pino no mapa ──────────────────────────────────────────
  //
  // Sem `storeLatLng` não existe de onde medir, e o pedido volta nulo TODA vez.
  // Como a fila é ordenada pelo mais recente, esses pedidos ficariam para
  // sempre no topo e, em poucas rodadas, ocupariam a janela inteira: medido em
  // 15/09/2026, quatro lojas sem pino somavam 724 pedidos — mais que o limite
  // do ciclo — e travariam os 565 que dava para medir.
  const lojas = await prisma.user.findMany({
    where: { storeLatLng: { not: Prisma.DbNull } },
    select: { id: true, deliveryConfig: true, deliveryZones: true, storeLatLng: true },
  });
  const lojasComPino = lojas.map((l) => l.id);
  if (lojasComPino.length === 0) {
    return NextResponse.json({ ok: true, medidos: 0, motivo: "nenhuma loja com ponto no mapa" });
  }
  const tabelaDaLoja = new Map<string, { regra: RegraDeRepasse; zonas: unknown; porFaixa: boolean; ponto: { lat: number; lng: number } | null }>(
    lojas.map((l) => [
      l.id,
      {
        regra: lerRegraDeRepasse(l.deliveryConfig),
        zonas: l.deliveryZones,
        porFaixa: temRepassePorFaixa(l.deliveryConfig, l.deliveryZones),
        ponto: lerPonto(l.storeLatLng),
      },
    ]),
  );

  /** O `data` do UPDATE: a distância e, no pedido próprio sem repasse, o da faixa. */
  const gravacao = (pedido: PedidoPendente, km: number): { deliveryDistance: number; motoboyFee?: number } => {
    const loja = tabelaDaLoja.get(pedido.franchiseeId);
    const repasse = loja
      ? repasseQueOCronCompleta({
          regra: loja.regra,
          zonas: loja.zonas,
          km,
          ehMarketplace: canalDoPedido(pedido).ehMarketplace,
          motoboyFeeAtual: pedido.motoboyFee,
          criadoEm: pedido.createdAt,
        })
      : null;
    if (repasse != null) repassesGravados++;
    return { deliveryDistance: km, ...(repasse != null ? { motoboyFee: repasse } : {}) };
  };

  // ── 1. Os que já têm o ponto: conta local ────────────────────────────────
  //
  // Busca própria, e não uma fatia de uma lista só: senão uma página cheia de
  // pedidos com coordenada empurraria para sempre os que precisam de
  // geocodificação, e a loja que paga por km nunca sairia da fila.
  //
  // O ponto é o que o pedido GRAVOU — no site e no balcão, o mesmo que decidiu
  // a taxa. Medir de outro lugar faria o acerto do motoboy e a taxa do cliente
  // discordarem sobre a mesma entrega.
  const comPonto: PedidoPendente[] = await prisma.customerOrder.findMany({
    where: { ...pendentesDe, franchiseeId: { in: lojasComPino }, customerLatLng: { not: Prisma.DbNull } },
    select: campos,
    orderBy: { createdAt: "desc" },
    take: LIMITE_COM_COORDENADA,
  });
  for (const pedido of comPonto) {
    if (Date.now() - comecou > ORCAMENTO_FASE_1_MS) break;
    const loja = tabelaDaLoja.get(pedido.franchiseeId);
    const descarte = descarteDoPontoGravado(pedido.customerLatLng, { ponto: loja?.ponto ?? null, zonas: loja?.zonas });
    if (descarte === "enchimento" || descarte === "longe") {
      // (-23,-43), ou o ponto do app a 120 km da loja, não é o cliente:
      // apagar deixa a fase 2 achar o endereço pelo texto, tira da
      // roteirização um pino no meio do mar e libera a vaga deste ciclo.
      // Deixar o ponto ali prendia o pedido na fase 1 (a medida o recusa) até
      // sair da janela de 30 dias.
      await prisma.customerOrder.update({ where: { id: pedido.id }, data: { customerLatLng: Prisma.DbNull } });
      pontosDescartados++;
      continue;
    }
    if (descarte === "longe-do-cliente") {
      // O pino/GPS do próprio cliente longe da loja: a palavra dele não se
      // apaga. Fica sem distância e registrado para quem for conferir.
      console.warn(`[distancia-pendente] pedido ${pedido.id}: ponto do cliente longe demais da loja ${pedido.franchiseeId} — sem distância`);
      semResposta++;
      continue;
    }
    const km = await distanciaDaEntregaKm(pedido.franchiseeId, pedido.customerLatLng);
    if (km == null) { semResposta++; continue; }
    await prisma.customerOrder.update({ where: { id: pedido.id }, data: gravacao(pedido, km) });
    medidos++;
  }

  // ── 2. Os que só têm o texto do endereço: geocodifica, devagar ───────────
  //
  // E só das lojas onde a distância MUDA DINHEIRO: quem tem entregador pago por
  // faixa de km ou por km rodado, e quem paga pela tabela de faixas da loja
  // (repasse por faixa). Geocodificar é o recurso escasso aqui (uma chamada
  // por pedido, ~1 por segundo), e gastá-lo com loja que paga por entrega
  // faria a loja que precisa esperar dias na fila.
  //
  // Quem decide é `lerAcerto`, a MESMA regra do fechamento — não um filtro SQL
  // parecido. Em 15/09/2026 um entregador do Hakim Centro tinha
  // `faixasDeKm: []` (vazio, sobra de cadastro): um `IS NOT NULL` qualificava a
  // loja inteira e os 2.060 pedidos dela passariam na frente dos 104 do
  // Frangoso, que é quem realmente paga por faixa. Do lado da loja, quem decide
  // é `temRepassePorFaixa` (lib/repasse-do-entregador.ts): separou os valores
  // e preencheu o repasse em alguma faixa.
  const motoboysAtivos = await prisma.motoboy.findMany({
    where: { active: true },
    select: { franchiseeId: true, paymentType: true, dailyRate: true, perDeliveryRate: true, perKmRate: true, faixasDeKm: true },
  });
  const lojasQuePagamPorDistancia = new Set(
    motoboysAtivos.filter((m) => lerAcerto(m as any).pagoPorDistancia).map((m) => m.franchiseeId),
  );

  const alvosDaGeocodificacao = lojasComPino.filter(
    (id) => lojasQuePagamPorDistancia.has(id) || tabelaDaLoja.get(id)?.porFaixa === true,
  );

  // Uma fatia POR LOJA, não uma fila única: a loja com mais pedidos atrasados
  // não pode empurrar a outra para o fim do dia.
  const porLoja = Math.max(2, Math.floor(LIMITE_PARA_GEOCODIFICAR / Math.max(1, alvosDaGeocodificacao.length)));

  /**
   * Quantos pedidos recentes entram no SORTEIO de cada ciclo.
   *
   * Pegar sempre "os N mais novos" trava a fila no primeiro endereço que o mapa
   * não resolve: ele fica no topo e é repescado em toda rodada, para sempre.
   * Aconteceu no mesmo dia em que isto entrou (15/09/2026) — dois endereços do
   * 99Food com observação solta no fim ("Em cima da oficina do Eduardo")
   * queimavam 2 das 6 vagas de cada ciclo, e nada os faria resolver.
   *
   * Sorteando dentro dos 30 mais recentes, o pedido novo continua sendo
   * prioridade (a janela é pequena e só de recentes) e o endereço impossível
   * cai numa vez a cada cinco, em vez de em todas.
   */
  const JANELA_DO_SORTEIO = 30;

  const semPonto: PedidoPendente[] = [];
  for (const lojaId of alvosDaGeocodificacao) {
    if (semPonto.length >= LIMITE_PARA_GEOCODIFICAR) break;
    const recentes: PedidoPendente[] = await prisma.customerOrder.findMany({
      where: { ...pendentesDe, customerLatLng: { equals: Prisma.DbNull }, franchiseeId: lojaId },
      select: campos,
      orderBy: { createdAt: "desc" },
      take: JANELA_DO_SORTEIO,
    });
    // Embaralha a janela e tira a fatia desta loja.
    for (let i = recentes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recentes[i], recentes[j]] = [recentes[j], recentes[i]];
    }
    semPonto.push(...recentes.slice(0, Math.min(porLoja, LIMITE_PARA_GEOCODIFICAR - semPonto.length)));
  }
  // Quem geocodifica é a lib da casa (lib/geocodificacao-servidor.ts): cache no
  // banco, limitador de 1,1 s do Nominatim, busca ESTRUTURADA e Photon de
  // reserva. O `geocodeAddress` cru que estava aqui engasgava justamente no
  // formato do 99Food — "Rua Juazeiro, 326 - Trindade, São Gonçalo - RJ, na rua
  // do bar do amarelo" — porque a observação solta no fim entra na busca e o
  // Nominatim não acha nada. Medido em 15/09/2026: 2 de 3 endereços falhavam.
  const porLojaPendente = new Map<string, PedidoPendente[]>();
  for (const pedido of semPonto) {
    const lista = porLojaPendente.get(pedido.franchiseeId) || [];
    lista.push(pedido);
    porLojaPendente.set(pedido.franchiseeId, lista);
  }

  for (const [lojaId, pedidos] of porLojaPendente) {
    if (acabouOTempo()) break;
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { storeLatLng: true, city: true, storeAddress: true },
    });
    const centro = lerPonto(loja?.storeLatLng);
    if (!centro) { semResposta += pedidos.length; continue; }

    const achados = await geocodificarNoServidor(
      pedidos.map((p) => ({ id: p.id, endereco: p.customerAddress || "" })),
      { cidade: loja?.city || "", endereco: loja?.storeAddress, centro },
    ).catch(() => []);

    for (const a of achados) {
      // "Caiu na loja" é ausência de resposta, não endereço encontrado. Gravar
      // isso daria 0 km e pagaria a faixa mais barata em TODA entrega perdida.
      // (Inclui o "caiu no mar → loja", que a checagem antiga deixava passar.)
      if (!geocodificacaoAchou(a.origem)) { semResposta++; continue; }
      const pedido = pedidos.find((p) => p.id === a.id);
      const coords = { lat: a.lat, lng: a.lng };
      const km = await distanciaDaEntregaKm(lojaId, coords);
      if (km == null || !pedido) { semResposta++; continue; }
      // As coordenadas vão junto: a roteirização e o "motoboy mais perto"
      // passam a aproveitar o mesmo trabalho. Com a origem, para quem lê
      // saber que foi o mapa (ou o centro do bairro), e não o cliente.
      await prisma.customerOrder.update({
        where: { id: a.id },
        data: { ...gravacao(pedido, km), customerLatLng: { ...coords, origem: origemDaGeocodificacao(a.origem) } },
      });
      medidos++;
      geocodificados++;
    }
    semResposta += Math.max(0, pedidos.length - achados.length);
  }

  return NextResponse.json({
    ok: true,
    comCoordenada: comPonto.length,
    paraGeocodificar: semPonto.length,
    medidos,
    geocodificados,
    semResposta,
    pontosDescartados,
    repassesGravados,
    segundos: Math.round((Date.now() - comecou) / 100) / 10,
  });
}
