/**
 * src/lib/distancia-da-entrega.ts — quantos km tem ESTA entrega.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * `CustomerOrder.deliveryDistance` existia no schema e era lido pelo relatório
 * do motoboy desde sempre — e NUNCA era escrito. Em 15/09/2026 a coluna estava
 * nula nas 5.438 entregas dos 30 dias anteriores, no banco inteiro.
 *
 * O efeito: tudo que o lojista cadastra por distância morria calado. A escada
 * do entregador ("até 2 km R$ 3, até 4 km R$ 4") devolvia "não sei" e o acerto
 * caía no campo seguinte da ordem — no Frangoso, R$ 2,00 fixos para entrega de
 * 1 km e de 12 km; e quem estava como R$/km recebia `0 × 1 = R$ 0,00`.
 *
 * ── A régua é a MESMA da área de entrega ────────────────────────────────────
 *
 * Linha reta por padrão, pelas ruas quando a loja escolheu "por rota"
 * (`medicaoDaLoja`) — o mesmo número que decidiu a taxa cobrada do cliente.
 * Medir o repasse com uma régua e a taxa com outra é como o acerto do
 * entregador e o extrato da loja passam a discordar.
 *
 * ── Roteador fora: melhor "ainda não sei" que a linha reta calada ───────────
 *
 * Pedido de marketplace e o cron de pendentes não têm cliente esperando. Se
 * o roteador está fora (rede, 429, disjuntor), a distância fica nula e o cron
 * (api/cron/distancia-pendente) mede de novo daqui a 10 minutos, pela rua de
 * verdade. Antes, a linha reta entrava no lugar, sem aviso, e ficava para
 * sempre: Gamboa a 2,50 km em vez de 4,78 km de rua, motoboy pago pela faixa
 * de baixo. Quando o roteador RESPONDE que não há rota (ponto numa ilha, fora
 * da malha), perguntar de novo dá o mesmo: aí vale a estimativa declarada
 * (linha reta × o fator de desvio da loja).
 *
 * Queda LONGA do roteador (403 de IP bloqueado, 429 por horas): o par que
 * falha há mais de 2 h passa a receber a estimativa declarada. Sem isto o cron
 * repetia por 30 dias, e o acerto semanal fechava com o motoboy pago por faixa
 * recebendo R$ 0 "SEM_DISTANCIA".
 *
 * ── Coordenada de parceiro falsa (R8) ───────────────────────────────────────
 *
 * O 99Food manda (-23,-43) quando não sabe o ponto; a Brazza Burguer gravou
 * 54,34 km em ~17 entregas. Grau inteiro ou menos de 3 casas → sem ponto e sem
 * distância, venha de onde vier. O ponto de PARCEIRO a mais de max(2 × raio da
 * loja, 15 km) também não é o cliente: `pontoEDistanciaDoParceiro` grava sem
 * ponto e sem distância. O corte é só do parceiro — o GPS, o pino e a
 * localização do WhatsApp do próprio cliente valem até 60 km, como sempre (a
 * loja por bairro não tem raio, e o corte de 15 km zerava o repasse de uma
 * entrega de 18 km).
 *
 * ── Gravada na VENDA, não calculada no relatório ────────────────────────────
 *
 * Mesma razão do `motoboyFee` (lib/repasse-do-entregador.ts): a loja muda o
 * ponto no mapa ou o modo de medição e o acerto do mês passado continua
 * batendo com o que ela pagou. E é o que faz "daqui pra frente" ser literal:
 * pedido antigo segue nulo, pedido novo nasce com a distância.
 */

import { prisma } from "@/lib/prisma";
import { haversineDistanceKm } from "@/lib/geocoding";
import { rotaEntre, medicaoDaLoja, fatorDeDesvio, estimarPelaLinhaReta, chaveDaRota } from "@/lib/distancia-por-rota";
import { coordenadaGrosseira, limiteDoParceiroKm, pontoDoParceiroParaALoja } from "@/lib/coordenadas-do-parceiro";
import type { MedidaDaDistancia } from "@/lib/cotacao-de-entrega";

export type Ponto = { lat: number; lng: number };

/**
 * Acima disto não é entrega, é endereço homônimo — o mesmo corte de
 * `area-de-entrega.ts`. Gravar 500 km faria a última faixa da escada pagar uma
 * entrega que foi de 3 km.
 */
const DISTANCIA_ABSURDA_KM = 60;

const arredondar = (n: number) => Math.round(n * 100) / 100;

/**
 * Lê `{lat,lng}` venha como vier do parceiro ou do banco. Nulo = não dá para
 * medir. O `customerLatLng` gravado pelo pedido passou a ser
 * `{lat,lng,origem,medida}` (25/09/2026) — os campos a mais são ignorados.
 */
export function lerPonto(v: unknown): Ponto | null {
  const o = v as any;
  if (!o || typeof o !== "object") return null;
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.lon ?? o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0,0) é o Atlântico — é "não sei" disfarçado de coordenada, e chega assim
  // de parceiro que preenche o campo com zero em vez de omitir.
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

type DadosDaLoja = { ponto: Ponto | null; deliveryZoneType: unknown; raioMaximoKm: number | null };

/**
 * O ponto da loja muda uma vez por ano; o pedido chega a cada minuto. Sem o
 * cache isto seria uma consulta a mais em toda importação de pedido.
 */
const cacheDaLoja = new Map<string, { dados: DadosDaLoja; exp: number }>();
const TTL_MS = 10 * 60_000;

/**
 * Até onde a loja entrega, para o corte de ponto de PARCEIRO: a maior faixa
 * de km ou o vértice mais longe da área desenhada. Loja por bairro não tem
 * raio — vale o mínimo de 15 km (só para ponto de parceiro).
 */
function raioMaximoDoCadastro(zonasBrutas: unknown, ponto: Ponto | null): number | null {
  let zonas: any[] = [];
  if (Array.isArray(zonasBrutas)) zonas = zonasBrutas;
  else if (typeof zonasBrutas === "string") {
    try {
      const lido = JSON.parse(zonasBrutas);
      if (Array.isArray(lido)) zonas = lido;
    } catch {}
  }
  let maior = 0;
  for (const z of zonas) {
    const km = Number(z?.km ?? z?.radius ?? z?.maxKm ?? 0);
    if (Number.isFinite(km) && km > maior) maior = km;
    if (ponto && Array.isArray(z?.pontos)) {
      for (const p of z.pontos) {
        const lat = Number(p?.[0] ?? p?.lat);
        const lng = Number(p?.[1] ?? p?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const d = haversineDistanceKm(ponto.lat, ponto.lng, lat, lng);
          if (d > maior) maior = d;
        }
      }
    }
  }
  return maior > 0 ? maior : null;
}

async function dadosDaLoja(franchiseeId: string): Promise<DadosDaLoja> {
  const emCache = cacheDaLoja.get(franchiseeId);
  if (emCache && emCache.exp > Date.now()) return emCache.dados;

  const linha = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeLatLng: true, deliveryZoneType: true, deliveryZones: true },
  });
  const ponto = lerPonto(linha?.storeLatLng);
  const dados: DadosDaLoja = {
    ponto,
    deliveryZoneType: linha?.deliveryZoneType,
    raioMaximoKm: raioMaximoDoCadastro(linha?.deliveryZones, ponto),
  };
  cacheDaLoja.set(franchiseeId, { dados, exp: Date.now() + TTL_MS });
  return dados;
}

/** Zera o cache do ponto da loja — para quando a tela de Entrega salva. */
export function esquecerPontoDaLoja(franchiseeId?: string) {
  if (franchiseeId) cacheDaLoja.delete(franchiseeId);
  else cacheDaLoja.clear();
}

export type MedidaDaEntrega = { km: number; medida: MedidaDaDistancia };

/**
 * Desde quando o roteador falha (de forma transitória) para cada par
 * loja → cliente. Passadas 2 h, a medida deixa de esperar a rua e sai
 * estimada, declarada: a queda longa não pode virar distância nula para sempre.
 */
const falhandoDesde = new Map<string, number>();
const ESTIMAR_DEPOIS_DE_MS = 2 * 60 * 60_000;
const TETO_DAS_FALHAS = 5000;

function lembrarFalha(chave: string): number {
  const desde = falhandoDesde.get(chave);
  if (desde != null) return desde;
  const agora = Date.now();
  falhandoDesde.set(chave, agora);
  if (falhandoDesde.size > TETO_DAS_FALHAS) {
    const maisVelha = falhandoDesde.keys().next().value;
    if (maisVelha !== undefined) falhandoDesde.delete(maisVelha);
  }
  return agora;
}

/** Faz as falhas lembradas parecerem `ms` mais velhas. SÓ PARA TESTE. */
export function envelhecerFalhasDoRoteadorParaTeste(ms: number) {
  for (const [chave, desde] of falhandoDesde) falhandoDesde.set(chave, desde - ms);
}

export type OpcoesDaMedida = {
  /**
   * Com o roteador fora (falha transitória), devolve a estimativa declarada em
   * vez de null — para quem não tem um cron que meça depois. Padrão: só depois
   * de 2 h de falha do mesmo par; antes disso o cron mede pela rua quando o
   * roteador voltar.
   */
  estimarSeORoteadorCair?: boolean;
  /**
   * O ponto veio do PARCEIRO (iFood, 99Food, Brendi, Wabiz): além de 60 km,
   * vale o corte de max(2 × raio da loja, 15 km) do R8. O ponto do próprio
   * cliente (GPS, pino, localização do WhatsApp) não tem esse corte.
   */
  doParceiro?: boolean;
};

/**
 * A distância desta entrega e COMO foi medida, para quem pode registrar a
 * medida no pedido. `null` quando não há como medir agora.
 *
 * NUNCA lança.
 */
export async function medirEntrega(
  franchiseeId: string,
  coordsDoCliente: unknown,
  opcoes?: OpcoesDaMedida,
): Promise<MedidaDaEntrega | null> {
  try {
    const destino = lerPonto(coordsDoCliente);
    if (!destino) return null;
    // Antes do banco: o enchimento se reconhece sem saber de que loja é.
    if (coordenadaGrosseira(destino.lat, destino.lng)) return null;

    const loja = await dadosDaLoja(franchiseeId);
    if (!loja.ponto) return null;

    const emLinhaReta = haversineDistanceKm(loja.ponto.lat, loja.ponto.lng, destino.lat, destino.lng);
    // Distância 0 é entrega de verdade (cliente na porta da loja). Longe
    // demais da loja não é o cliente: 60 km para todo mundo, e o corte do
    // R8 para o ponto de parceiro.
    const teto = opcoes?.doParceiro ? Math.min(DISTANCIA_ABSURDA_KM, limiteDoParceiroKm(loja.raioMaximoKm)) : DISTANCIA_ABSURDA_KM;
    if (!(emLinhaReta >= 0) || emLinhaReta > teto) return null;

    if (medicaoDaLoja(loja.deliveryZoneType) === "ROTA") {
      const chave = chaveDaRota(loja.ponto, destino);
      const rota = await rotaEntre(loja.ponto, destino);
      // Rota menor que a linha reta é impossível: o ponto foi arrastado até
      // uma rua mais perto da loja, e a rota é de outro lugar.
      if (rota.ok && rota.km >= emLinhaReta - 0.05 && rota.km <= DISTANCIA_ABSURDA_KM) {
        falhandoDesde.delete(chave);
        return { km: arredondar(rota.km), medida: "rota" };
      }
      const definitiva = rota.ok || rota.tipo === "definitiva";
      if (!definitiva) {
        const desde = lembrarFalha(chave);
        const quedaLonga = Date.now() - desde >= ESTIMAR_DEPOIS_DE_MS;
        if (!quedaLonga && !opcoes?.estimarSeORoteadorCair) return null;
      } else {
        falhandoDesde.delete(chave);
      }
      const { fator } = await fatorDeDesvio(loja.ponto);
      return { km: estimarPelaLinhaReta(emLinhaReta, fator), medida: "estimada" };
    }
    return { km: arredondar(emLinhaReta), medida: "linha-reta" };
  } catch {
    // Loja sem ponto, roteador fora do ar, coordenada torta: segue sem medida.
    return null;
  }
}

/**
 * A distância desta entrega, em km. `null` quando não há como medir — e nulo é
 * resposta legítima: o relatório sabe cair no acerto seguinte, e o cron de
 * pendentes mede de novo; um número inventado pagaria a faixa errada sem
 * ninguém desconfiar.
 *
 * NUNCA lança: importação de pedido não pode falhar por causa de uma medida.
 */
export async function distanciaDaEntregaKm(
  franchiseeId: string,
  coordsDoCliente: unknown,
  opcoes?: OpcoesDaMedida,
): Promise<number | null> {
  const m = await medirEntrega(franchiseeId, coordsDoCliente, opcoes);
  return m ? m.km : null;
}

/**
 * O ponto que o PARCEIRO mandou, conferido para ESTA loja (R8), pronto para
 * `customerLatLng`. `undefined` (nunca null: o Prisma derruba o create com
 * null cru num Json) quando é enchimento ou está longe demais da loja.
 *
 * Só a distância nula não bastava: o ponto de uma rua homônima a 40 km ia para
 * `customerLatLng`, e a roteirização e o app do motoboy punham o pino lá — e
 * o cron, que só apaga ponto de enchimento, media de novo a cada ciclo por
 * 30 dias. Sem ponto, o cron e a roteirização geocodificam pelo texto.
 *
 * NUNCA lança: sem o cadastro da loja, só a regra do enchimento vale.
 */
export async function pontoDoParceiroDaLoja(franchiseeId: string, bruto: unknown): Promise<Ponto | undefined> {
  const ponto = lerPonto(bruto);
  if (!ponto || coordenadaGrosseira(ponto.lat, ponto.lng)) return undefined;
  let loja: DadosDaLoja;
  try {
    loja = await dadosDaLoja(franchiseeId);
  } catch {
    return ponto;
  }
  const serve = pontoDoParceiroParaALoja(ponto, { ponto: loja.ponto, raioMaximoKm: loja.raioMaximoKm });
  if (!serve && loja.ponto) {
    const km = haversineDistanceKm(loja.ponto.lat, loja.ponto.lng, ponto.lat, ponto.lng);
    console.warn(
      `[Parceiro] ponto do cliente a ${km} km da loja ${franchiseeId} (limite ${limiteDoParceiroKm(loja.raioMaximoKm)} km) — pedido gravado sem ponto`,
    );
  }
  return serve;
}

/**
 * O ponto do parceiro já conferido (R8) E a distância dele — o que a
 * importação de pedido grava em `customerLatLng` e `deliveryDistance`.
 */
export async function pontoEDistanciaDoParceiro(
  franchiseeId: string,
  bruto: unknown,
): Promise<{ ponto: Ponto | undefined; km: number | null }> {
  const ponto = await pontoDoParceiroDaLoja(franchiseeId, bruto);
  if (!ponto) return { ponto: undefined, km: null };
  const km = await distanciaDaEntregaKm(franchiseeId, ponto, { doParceiro: true });
  return { ponto, km };
}

/**
 * A distância que a área de entrega JÁ mediu neste pedido, pronta para gravar.
 *
 * O pedido do site passa por `avaliarEntrega`, que geocodifica o endereço e
 * mede — de graça, e com o mesmo endereço que decidiu a taxa. Medir de novo
 * aqui seria casar o endereço duas vezes ([[firehub-area-de-entrega]]).
 * Distância 0 vale: é o cliente na porta da loja.
 */
export function distanciaDoVeredicto(veredicto: { distanciaKm?: number } | null | undefined): number | null {
  const km = Number(veredicto?.distanciaKm);
  if (veredicto?.distanciaKm == null || !Number.isFinite(km) || km < 0 || km > DISTANCIA_ABSURDA_KM) return null;
  return arredondar(km);
}
