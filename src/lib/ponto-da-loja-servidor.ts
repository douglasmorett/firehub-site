/**
 * De onde o mapa parte, para CADA loja.
 *
 * Regra: o mapa abre onde a loja está — sempre. A ordem é
 *   1. o pino que o lojista salvou (storeLatLng), se existir;
 *   2. o ENDEREÇO do cadastro, geocodificado uma vez e guardado no cache
 *      (a maioria das lojas está aqui: nunca abriu a tela do pino);
 *   3. só a cidade;
 *   4. nada — e aí o mapa abre no Brasil inteiro e pede o pino, em vez de
 *      fingir que a loja fica em Rio das Ostras.
 *
 * O passo 2 nunca escreve em `storeLatLng`: aquele campo decide raio e taxa de
 * entrega (lib/area-de-entrega.ts, lib/distancia-da-entrega.ts) e um ponto que
 * o lojista não conferiu não pode passar a cobrar frete. Aqui ele só move a
 * câmera.
 */
import { prisma } from "@/lib/prisma";
import { pontoDeEndereco } from "@/lib/geocodificacao-servidor";
import { lerPontoDaLoja, type Ponto } from "@/lib/ponto-da-loja";

export type OrigemDoPonto = "cadastro" | "endereco" | "cidade";

export type LojaNoMapa = {
  ponto: Ponto | null;
  origem: OrigemDoPonto | null;
  endereco: string;
  cidade: string;
};

type DadosDaLoja = {
  id?: string;
  storeLatLng?: unknown;
  storeAddress?: string | null;
  city?: string | null;
};

/**
 * O ponto da loja muda uma vez por ano; a tela de pedidos recarrega o dia
 * inteiro. Sem cache de processo, cada render pagaria uma consulta ao cache do
 * banco — e, na primeira vez, a ida à rede.
 */
const cache = new Map<string, { valor: LojaNoMapa; exp: number }>();
/** Buscas em andamento, para duas abas não pedirem o mesmo endereço lá fora. */
const emVoo = new Map<string, Promise<LojaNoMapa>>();
const TTL_OK_MS = 30 * 60_000;
/** Falhou (rede fora, limite do geocodificador): tenta de novo logo. */
const TTL_FALHA_MS = 60_000;

/**
 * Teto para a resolução não segurar o render da página. O geocodificador
 * externo tem dia ruim; quando tem, a loja abre o mapa sem o pino da casinha —
 * nunca com a tela parada. A busca continua no servidor e o resultado cai no
 * GeocodeCache, então a próxima abertura já vem pronta.
 *
 * A tela de pedidos, que é onde a loja trabalha, pede um prazo bem mais curto
 * que a aba do mapa: ali o mapa é um botão, não a tela.
 */
const PRAZO_MS = 5000;

export async function resolverLojaNoMapa(loja: DadosDaLoja, opcoes?: { prazoMs?: number }): Promise<LojaNoMapa> {
  const endereco = String(loja.storeAddress || "").trim();
  const cidade = String(loja.city || "").trim();

  const doCadastro = lerPontoDaLoja(loja.storeLatLng);
  if (doCadastro) return { ponto: doCadastro, origem: "cadastro", endereco, cidade };

  const chave = loja.id || `${endereco}|${cidade}`;
  const emCache = cache.get(chave);
  if (emCache && emCache.exp > Date.now()) return emCache.valor;

  // Uma busca por loja, mesmo com duas abas abrindo ao mesmo tempo: a segunda
  // espera a primeira em vez de pedir o mesmo endereço de novo lá fora.
  let busca = emVoo.get(chave);
  if (!busca) {
    busca = pontoDeEndereco(endereco, cidade)
      .catch((e: any) => {
        console.warn("[PontoDaLoja] não resolveu:", e?.message);
        return null;
      })
      .then((achado) => {
        const valor: LojaNoMapa = achado
          ? {
              ponto: { lat: achado.lat, lng: achado.lng },
              origem: achado.origem.includes("cidade") ? "cidade" : "endereco",
              endereco,
              cidade,
            }
          : { ponto: null, origem: null, endereco, cidade };
        cache.set(chave, { valor, exp: Date.now() + (valor.ponto ? TTL_OK_MS : TTL_FALHA_MS) });
        return valor;
      })
      .finally(() => {
        emVoo.delete(chave);
      });
    emVoo.set(chave, busca);
  }

  // Estourado o prazo, a tela abre sem o pino e a busca segue: ela mesma grava
  // o cache, então quem abrir depois — inclusive a aba do mapa — já acha pronto.
  const semPonto: LojaNoMapa = { ponto: null, origem: null, endereco, cidade };
  return await Promise.race([
    busca,
    new Promise<LojaNoMapa>((r) => setTimeout(() => r(semPonto), opcoes?.prazoMs ?? PRAZO_MS)),
  ]);
}

/** O mesmo, quando quem chama só tem o id da loja. */
export async function lojaNoMapaPorId(lojaId: string): Promise<LojaNoMapa> {
  const emCache = cache.get(lojaId);
  if (emCache && emCache.exp > Date.now()) return emCache.valor;

  const loja = await prisma.user
    .findUnique({ where: { id: lojaId }, select: { id: true, storeLatLng: true, storeAddress: true, city: true } })
    .catch(() => null);
  if (!loja) return { ponto: null, origem: null, endereco: "", cidade: "" };
  return resolverLojaNoMapa(loja);
}
