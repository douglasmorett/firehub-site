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
 * ── Gravada na VENDA, não calculada no relatório ────────────────────────────
 *
 * Mesma razão do `motoboyFee` (lib/repasse-do-entregador.ts): a loja muda o
 * ponto no mapa ou o modo de medição e o acerto do mês passado continua
 * batendo com o que ela pagou. E é o que faz "daqui pra frente" ser literal:
 * pedido antigo segue nulo, pedido novo nasce com a distância.
 */

import { prisma } from "@/lib/prisma";
import { haversineDistanceKm } from "@/lib/geocoding";
import { distanciaPorRotaKm, medicaoDaLoja } from "@/lib/distancia-por-rota";

export type Ponto = { lat: number; lng: number };

/**
 * Acima disto não é entrega, é endereço homônimo — o mesmo corte de
 * `area-de-entrega.ts`. Gravar 500 km faria a última faixa da escada pagar uma
 * entrega que foi de 3 km.
 */
const DISTANCIA_ABSURDA_KM = 60;

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** Lê `{lat,lng}` venha como vier do parceiro. Nulo = não dá para medir. */
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

type DadosDaLoja = { ponto: Ponto | null; deliveryZoneType: unknown };

/**
 * O ponto da loja muda uma vez por ano; o pedido chega a cada minuto. Sem o
 * cache isto seria uma consulta a mais em toda importação de pedido.
 */
const cacheDaLoja = new Map<string, { dados: DadosDaLoja; exp: number }>();
const TTL_MS = 10 * 60_000;

async function dadosDaLoja(franchiseeId: string): Promise<DadosDaLoja> {
  const emCache = cacheDaLoja.get(franchiseeId);
  if (emCache && emCache.exp > Date.now()) return emCache.dados;

  const linha = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeLatLng: true, deliveryZoneType: true },
  });
  const dados: DadosDaLoja = {
    ponto: lerPonto(linha?.storeLatLng),
    deliveryZoneType: linha?.deliveryZoneType,
  };
  cacheDaLoja.set(franchiseeId, { dados, exp: Date.now() + TTL_MS });
  return dados;
}

/** Zera o cache do ponto da loja — para quando a tela de Entrega salva. */
export function esquecerPontoDaLoja(franchiseeId?: string) {
  if (franchiseeId) cacheDaLoja.delete(franchiseeId);
  else cacheDaLoja.clear();
}

/**
 * A distância desta entrega, em km. `null` quando não há como medir — e nulo é
 * resposta legítima: o relatório sabe cair no acerto seguinte, enquanto um
 * número inventado pagaria a faixa errada sem ninguém desconfiar.
 *
 * NUNCA lança: importação de pedido não pode falhar por causa de uma medida.
 */
export async function distanciaDaEntregaKm(
  franchiseeId: string,
  coordsDoCliente: unknown,
): Promise<number | null> {
  try {
    const destino = lerPonto(coordsDoCliente);
    if (!destino) return null;

    const loja = await dadosDaLoja(franchiseeId);
    if (!loja.ponto) return null;

    const emLinhaReta = haversineDistanceKm(loja.ponto.lat, loja.ponto.lng, destino.lat, destino.lng);
    if (!(emLinhaReta > 0) || emLinhaReta > DISTANCIA_ABSURDA_KM) return null;

    if (medicaoDaLoja(loja.deliveryZoneType) === "ROTA") {
      const porRua = await distanciaPorRotaKm(loja.ponto, destino);
      // Rota menor que a linha reta é impossível: resposta ruim do roteador.
      if (porRua != null && porRua >= emLinhaReta - 0.05 && porRua <= DISTANCIA_ABSURDA_KM) {
        return arredondar(porRua);
      }
    }
    return arredondar(emLinhaReta);
  } catch {
    // Loja sem ponto, roteador fora do ar, coordenada torta: segue sem medida.
    return null;
  }
}

/**
 * A distância que a área de entrega JÁ mediu neste pedido, pronta para gravar.
 *
 * O pedido do site passa por `avaliarEntrega`, que geocodifica o endereço e
 * mede — de graça, e com o mesmo endereço que decidiu a taxa. Medir de novo
 * aqui seria casar o endereço duas vezes ([[firehub-area-de-entrega]]).
 */
export function distanciaDoVeredicto(veredicto: { distanciaKm?: number } | null | undefined): number | null {
  const km = Number(veredicto?.distanciaKm);
  if (!Number.isFinite(km) || !(km > 0) || km > DISTANCIA_ABSURDA_KM) return null;
  return arredondar(km);
}
