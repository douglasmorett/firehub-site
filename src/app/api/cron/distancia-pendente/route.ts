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
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyCronAuth } from "@/lib/cron-auth";
import { distanciaDaEntregaKm, lerPonto } from "@/lib/distancia-da-entrega";
import { lerAcerto } from "@/lib/ganho-do-entregador";
import { geocodeAddress } from "@/lib/geocoding";

export const dynamic = "force-dynamic";

/** Pedido mais velho que isto não muda mais acerto nenhum. */
const IDADE_MAXIMA_DIAS = 30;
/** Com coordenada é só conta local, mas ainda é um UPDATE por pedido. */
const LIMITE_COM_COORDENADA = 150;
/** Sem coordenada é uma chamada de rede cada: o Nominatim pede ~1 por segundo. */
const LIMITE_PARA_GEOCODIFICAR = 6;
const ESPERA_ENTRE_GEOCODIFICACOES_MS = 1200;

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
const ORCAMENTO_MS = 40_000;
/**
 * A fatia da fase 1. Sem ela, um dia de muita entrega com coordenada comeria o
 * ciclo inteiro e a GEOCODIFICACAO — que e o que a loja pagando por faixa
 * espera — nunca chegaria a rodar.
 */
const ORCAMENTO_FASE_1_MS = 18_000;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const comecou = Date.now();
  const acabouOTempo = () => Date.now() - comecou > ORCAMENTO_MS;

  const desde = new Date(Date.now() - IDADE_MAXIMA_DIAS * 24 * 60 * 60_000);

  const pendentesDe = { deliveryType: "DELIVERY", deliveryDistance: null, createdAt: { gte: desde } } as const;
  const campos = { id: true, franchiseeId: true, customerLatLng: true, customerAddress: true } as const;

  let medidos = 0;
  let geocodificados = 0;
  let semResposta = 0;
  let geocodificacoesFeitas = 0;

  // ── Só lojas com o pino no mapa ──────────────────────────────────────────
  //
  // Sem `storeLatLng` não existe de onde medir, e o pedido volta nulo TODA vez.
  // Como a fila é ordenada pelo mais recente, esses pedidos ficariam para
  // sempre no topo e, em poucas rodadas, ocupariam a janela inteira: medido em
  // 15/09/2026, quatro lojas sem pino somavam 724 pedidos — mais que o limite
  // do ciclo — e travariam os 565 que dava para medir.
  const lojasComPino = (
    await prisma.user.findMany({
      where: { storeLatLng: { not: Prisma.DbNull } },
      select: { id: true },
    })
  ).map((l) => l.id);
  if (lojasComPino.length === 0) {
    return NextResponse.json({ ok: true, medidos: 0, motivo: "nenhuma loja com ponto no mapa" });
  }

  // ── 1. Os que já têm o ponto: conta local ────────────────────────────────
  //
  // Busca própria, e não uma fatia de uma lista só: senão uma página cheia de
  // pedidos com coordenada empurraria para sempre os que precisam de
  // geocodificação, e a loja que paga por km nunca sairia da fila.
  const comPonto = await prisma.customerOrder.findMany({
    where: { ...pendentesDe, franchiseeId: { in: lojasComPino }, customerLatLng: { not: Prisma.DbNull } },
    select: campos,
    orderBy: { createdAt: "desc" },
    take: LIMITE_COM_COORDENADA,
  });
  for (const pedido of comPonto) {
    if (Date.now() - comecou > ORCAMENTO_FASE_1_MS) break;
    const km = await distanciaDaEntregaKm(pedido.franchiseeId, pedido.customerLatLng);
    if (km == null) { semResposta++; continue; }
    await prisma.customerOrder.update({ where: { id: pedido.id }, data: { deliveryDistance: km } });
    medidos++;
  }

  // ── 2. Os que só têm o texto do endereço: geocodifica, devagar ───────────
  //
  // E só das lojas onde a distância MUDA DINHEIRO: quem tem entregador pago por
  // faixa de km ou por km rodado. Geocodificar é o recurso escasso aqui (uma
  // chamada por pedido, ~1 por segundo), e gastá-lo com loja que paga por
  // entrega faria a loja que precisa esperar dias na fila.
  //
  // Quem decide é `lerAcerto`, a MESMA regra do fechamento — não um filtro SQL
  // parecido. Em 15/09/2026 um entregador do Hakim Centro tinha
  // `faixasDeKm: []` (vazio, sobra de cadastro): um `IS NOT NULL` qualificava a
  // loja inteira e os 2.060 pedidos dela passariam na frente dos 104 do
  // Frangoso, que é quem realmente paga por faixa.
  const motoboysAtivos = await prisma.motoboy.findMany({
    where: { active: true },
    select: { franchiseeId: true, paymentType: true, dailyRate: true, perDeliveryRate: true, perKmRate: true, faixasDeKm: true },
  });
  const lojasQuePagamPorDistancia = new Set(
    motoboysAtivos.filter((m) => lerAcerto(m as any).pagoPorDistancia).map((m) => m.franchiseeId),
  );

  const alvosDaGeocodificacao = lojasComPino.filter((id) => lojasQuePagamPorDistancia.has(id));

  // Uma fatia POR LOJA, não uma fila única: a loja com mais pedidos atrasados
  // não pode empurrar a outra para o fim do dia.
  const porLoja = Math.max(2, Math.floor(LIMITE_PARA_GEOCODIFICAR / Math.max(1, alvosDaGeocodificacao.length)));
  const semPonto: Array<{ id: string; franchiseeId: string; customerLatLng: unknown; customerAddress: string | null }> = [];
  for (const lojaId of alvosDaGeocodificacao) {
    if (semPonto.length >= LIMITE_PARA_GEOCODIFICAR) break;
    const daLoja = await prisma.customerOrder.findMany({
      where: { ...pendentesDe, customerLatLng: { equals: Prisma.DbNull }, franchiseeId: lojaId },
      select: campos,
      orderBy: { createdAt: "desc" },
      take: Math.min(porLoja, LIMITE_PARA_GEOCODIFICAR - semPonto.length),
    });
    semPonto.push(...daLoja);
  }
  for (const pedido of semPonto) {
    if (geocodificacoesFeitas >= LIMITE_PARA_GEOCODIFICAR || acabouOTempo()) break;

    // O ponto da loja entra como centro da busca: é o que evita o homônimo
    // ("Rua São João" existe em toda cidade do Brasil).
    const loja = await prisma.user.findUnique({
      where: { id: pedido.franchiseeId },
      select: { storeLatLng: true },
    });
    const centro = lerPonto(loja?.storeLatLng);
    if (!centro) { semResposta++; continue; }

    geocodificacoesFeitas++;
    const achado = await geocodeAddress(pedido.customerAddress || "", centro).catch(() => null);
    if (geocodificacoesFeitas < LIMITE_PARA_GEOCODIFICAR) {
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_GEOCODIFICACOES_MS));
    }
    if (!achado) { semResposta++; continue; }

    const coords = { lat: achado.lat, lng: achado.lng };
    const km = await distanciaDaEntregaKm(pedido.franchiseeId, coords);
    if (km == null) { semResposta++; continue; }

    // As coordenadas vão junto: a roteirização e o "motoboy mais perto"
    // passam a aproveitar o mesmo trabalho.
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: { deliveryDistance: km, customerLatLng: coords },
    });
    medidos++;
    geocodificados++;
  }

  return NextResponse.json({
    ok: true,
    comCoordenada: comPonto.length,
    paraGeocodificar: semPonto.length,
    medidos,
    geocodificados,
    semResposta,
    segundos: Math.round((Date.now() - comecou) / 100) / 10,
  });
}
