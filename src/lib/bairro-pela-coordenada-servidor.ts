/**
 * O bairro pelo ponto do cliente, gravado no pedido (lib/bairro-pela-coordenada.ts
 * tem a regra; aqui é a rede e o banco).
 *
 * Quem grava o pedido chama `completarBairroPelaCoordenada(id)` logo depois do
 * create/update e espera NO MÁXIMO `esperaMs` (1,5 s). O reverse que demora
 * mais segue em segundo plano e atualiza o pedido quando chegar — a fila da
 * impressão lê o pedido do banco a cada 3 s (api/store/print-queue), então o
 * bairro quase sempre chega antes do papel. Falhou, segue como hoje: sem bairro.
 *
 * O reverse passa pela mesma fila do Nominatim da taxa e da roteirização
 * (`naFila`, 1 req/s, na frente do lote; trégua depois de 429 em
 * lib/geocoding.ts) e fica num cache em memória por ponto (~11 m) — o robô
 * regrava o pedido várias vezes com a mesma localização. Os Correios (ViaCEP)
 * têm o cache deles (lib/bairro-dos-correios.ts).
 *
 * A gravação só troca o endereço se ele AINDA for o que foi lido: o robô (o
 * cliente voltou a falar) ou a loja podem ter mudado o endereço no meio.
 */
import { prisma } from "@/lib/prisma";
import { naFila } from "@/lib/geocodificacao-servidor";
import { enderecoDoPontoNoMapa } from "@/lib/geocoding";
import { bairroDaRuaNosCorreios } from "@/lib/bairro-dos-correios";
import {
  decidirBairroDoPedido,
  pontoQuePedeBairro,
  type BuscasDoBairro,
  type PontoDoCliente,
} from "@/lib/bairro-pela-coordenada";

const PRAZO_DO_REVERSO_MS = 8_000;
const VALIDADE_MS = 24 * 60 * 60_000;
const TETO_DO_CACHE = 2000;
const cache = new Map<string, { address: unknown; em: number }>();

const chaveDoPonto = (p: PontoDoCliente) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/** O `address` do reverse, pela fila do servidor e com cache. null = sem resposta. */
async function reversoNoServidor(ponto: PontoDoCliente, loja: string | null): Promise<unknown | null> {
  const chave = chaveDoPonto(ponto);
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.address;
  const prazo = Date.now() + PRAZO_DO_REVERSO_MS;
  try {
    const r = await naFila(
      () => enderecoDoPontoNoMapa(ponto, { timeoutMs: Math.max(1000, prazo - Date.now()) }),
      prazo,
      { prioridade: "cotacao", donos: loja ? [`loja:${loja}`] : [] },
    );
    if (!r.ok) return null; // falha não fica no cache
    cache.delete(chave);
    cache.set(chave, { address: r.valor, em: Date.now() });
    if (cache.size > TETO_DO_CACHE) {
      const maisVelho = cache.keys().next().value;
      if (maisVelho !== undefined) cache.delete(maisVelho);
    }
    return r.valor;
  } catch {
    return null; // fila cheia, limite da loja, prazo
  }
}

function buscasDoServidor(loja: string | null): BuscasDoBairro {
  return {
    reverso: (ponto) => reversoNoServidor(ponto, loja),
    correios: (rua, cidade, uf) => bairroDaRuaNosCorreios(rua, cidade, uf, { prazoMs: 2500 }),
  };
}

/** Faz o trabalho e grava. Nunca lança. */
async function trabalhar(pedidoId: string, buscas?: BuscasDoBairro): Promise<string | null> {
  try {
    const pedido = await prisma.customerOrder.findUnique({
      where: { id: pedidoId },
      select: {
        franchiseeId: true,
        customerAddress: true,
        customerLatLng: true,
        deliveryType: true,
        source: true,
        openDeliveryChannel: true,
        openDeliveryOrderId: true,
        ifoodOrderId: true,
        franchisee: { select: { city: true, deliveryZones: true, deliveryZoneType: true } },
      },
    });
    if (!pedido) return null;
    const loja = pedido.franchisee ?? { city: null, deliveryZones: null, deliveryZoneType: null };
    // Sem rede quando não precisa (retirada, sem ponto, já tem bairro).
    if (!("ponto" in pontoQuePedeBairro(pedido as any, loja.city))) return null;
    const decisao = await decidirBairroDoPedido(pedido as any, loja, buscas ?? buscasDoServidor(pedido.franchiseeId));
    if (!decisao.mudar) {
      if (decisao.motivo !== "ja-tem-bairro") console.log(`[Bairro pelo ponto] pedido ${pedidoId}: sem bairro (${decisao.motivo})`);
      return null;
    }
    const gravados = await prisma.customerOrder.updateMany({
      where: { id: pedidoId, customerAddress: pedido.customerAddress },
      data: { customerAddress: decisao.endereco },
    });
    if (gravados.count !== 1) return null;
    console.log(`[Bairro pelo ponto] pedido ${pedidoId}: bairro "${decisao.bairro}" (${decisao.fonte})`);
    return decisao.bairro;
  } catch (e: any) {
    console.warn(`[Bairro pelo ponto] pedido ${pedidoId}: ${e?.message || e}`);
    return null;
  }
}

/**
 * Põe no endereço do pedido o bairro do ponto do cliente, quando falta.
 * Espera até `esperaMs`; o resto continua em segundo plano. Nunca lança.
 * Devolve o bairro gravado, ou null (sem bairro, ou ainda em andamento).
 */
export async function completarBairroPelaCoordenada(
  pedidoId: string | null | undefined,
  opcoes: { esperaMs?: number; buscas?: BuscasDoBairro } = {},
): Promise<string | null> {
  if (!pedidoId) return null;
  const trabalho = trabalhar(pedidoId, opcoes.buscas);
  const espera = Math.max(0, opcoes.esperaMs ?? 1500);
  if (espera === 0) return null;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<null>((r) => {
    relogio = setTimeout(() => r(null), espera);
  });
  try {
    return await Promise.race([trabalho, tempo]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
