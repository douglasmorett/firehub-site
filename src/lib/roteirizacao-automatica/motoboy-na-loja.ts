/**
 * "Motoboy na loja" — o carimbo de chegada (`Motoboy.naLojaDesde`).
 *
 * Ninguém media motoboy × loja até aqui (plano no vault, "FireHub - Plano
 * despacho automático", lacuna 1). A Rota 100% automatizada chama o motoboy
 * que CHEGOU PRIMEIRO na loja (D10, pedido do Douglas em 21/10/2026), então o
 * POST de localização do app (api/motoboys/location) passa por aqui:
 *   - dentro de `raioDaLojaM` do pino e sem carimbo → carimba agora;
 *   - fora do raio → apaga o carimbo (saiu da loja);
 *   - loja sem pino → não faz nada (o ponto achado pelo endereço pode ser o
 *     centro da cidade e não serve para raio de 150 m).
 *
 * ── Chamado ANTES de gravar a posição nova, de propósito ───────────────────
 * O app desliga o GPS fora do horário, o "Sair" tira o motoboy do mapa e o
 * celular sem bateria simplesmente para de mandar. Em todos os casos o
 * carimbo de ontem ficaria lá, e no dia seguinte quem chegasse às 18h seria
 * "o primeiro na loja desde as 23h de ontem". Lendo o `lastLocationUpdate`
 * de ANTES da posição nova dá para saber: se a última posição tinha mais de
 * 3 min (POSICAO_VALE_MS, a mesma régua do mapa ao vivo), a chegada é nova.
 *
 * Só nas lojas liberadas (liberacao.ts): nas outras o GPS não paga nem uma
 * consulta a mais. Nunca lança — a posição do motoboy importa mais que isto.
 */
import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja, type Ponto } from "@/lib/ponto-da-loja";
import { linhaRetaKm } from "@/lib/geocoding";
import { POSICAO_VALE_MS } from "@/lib/entrega-ao-vivo";
import { lerRoteirizacaoAutomatica } from "./config";
import { liberadaPara } from "./liberacao";

type DaLoja = { ponto: Ponto | null; raioM: number };

/**
 * O pino muda uma vez por ano; o GPS chega a cada ~12 s por motoboy. Um
 * minuto de cache: a loja que muda o raio na janela vê valer no minuto seguinte.
 */
const cache = new Map<string, { dados: DaLoja; exp: number }>();
const TTL_MS = 60_000;

async function daLoja(lojaId: string): Promise<DaLoja> {
  const guardado = cache.get(lojaId);
  if (guardado && guardado.exp > Date.now()) return guardado.dados;
  const linha = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeLatLng: true, deliveryConfig: true } });
  const dados = { ponto: lerPontoDaLoja(linha?.storeLatLng), raioM: lerRoteirizacaoAutomatica(linha?.deliveryConfig).raioDaLojaM };
  cache.set(lojaId, { dados, exp: Date.now() + TTL_MS });
  return dados;
}

/** Zera o cache — para o PUT da regra valer na hora. */
export function esquecerLojaDoCarimbo(lojaId: string) {
  cache.delete(lojaId);
}

export async function carimbarChegadaNaLoja(motoboyId: string, franchiseeId: string, lat: number, lng: number): Promise<void> {
  try {
    if (!liberadaPara(franchiseeId)) return;
    const { ponto, raioM } = await daLoja(franchiseeId);
    if (!ponto) return;
    const dentro = linhaRetaKm(ponto.lat, ponto.lng, lat, lng) * 1000 <= raioM;
    const motoboy = prisma.motoboy as any; // naLojaDesde: coluna nova (garantir-colunas)
    if (dentro) {
      const agora = new Date();
      await motoboy.updateMany({
        where: {
          id: motoboyId,
          franchiseeId,
          active: true,
          OR: [
            { naLojaDesde: null },
            { lastLocationUpdate: null },
            { lastLocationUpdate: { lt: new Date(agora.getTime() - POSICAO_VALE_MS) } },
          ],
        },
        data: { naLojaDesde: agora },
      });
    } else {
      // Só grava quando muda: o GPS na rua chega a cada 12 s.
      await motoboy.updateMany({
        where: { id: motoboyId, franchiseeId, naLojaDesde: { not: null } },
        data: { naLojaDesde: null },
      });
    }
  } catch (e: any) {
    console.warn("[Rota automática] carimbo de chegada falhou:", e?.message?.slice(0, 160));
  }
}
