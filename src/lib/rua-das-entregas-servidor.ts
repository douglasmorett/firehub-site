/**
 * A leitura das entregas da loja para lib/rua-das-entregas.ts — a rua que o
 * mapa não tem, pelo ponto das entregas que já foram nela.
 *
 * Só é lida quando a cotação precisa (o mapa não achou a rua do cliente), e
 * fica 30 min na memória, como a âncora do CEP (lib/ponto-aprendido.ts,
 * `ancorasDaLoja`). Nada é gravado. Banco fora = sem entregas: a cotação segue
 * como sempre.
 */
import { prisma } from "@/lib/prisma";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { lerPontoGravado, distanciaKm, type Ponto } from "@/lib/ponto-do-pedido";
import { bairroDoEndereco } from "@/lib/bairro-do-endereco";
import { PINO_NO_CENTRO_DO_BAIRRO_KM, ruasDasEntregas, pontoDaRuaNasEntregas, centroDoBairroNasEntregas, type CentroDoBairro, type EntregaComPonto, type PontoDaRua, type RuasDasEntregas } from "@/lib/rua-das-entregas";

export const DIAS_DAS_RUAS_DAS_ENTREGAS = 180;
const VALIDADE_MS = 30 * 60_000;
const TETO_DE_ENTREGAS = 4000;
/** Os canais que escrevem a cidade do cliente no fim do endereço (lib/relatorios/areas-de-entrega.ts). */
const CANAIS_COM_CIDADE_NO_FIM = new Set(["IFOOD", "BRENDI", "JOTAJA"]);

type EntregasDaLoja = { entregas: EntregaComPonto[]; ruas: RuasDasEntregas };

const naMemoria = new Map<string, { ate: number; dados: Promise<EntregasDaLoja> }>();

/** As ruas das entregas desta loja. Nunca lança: banco fora = vazio. */
export async function ruasDasEntregasDaLoja(franchiseeId: string, cidade?: string | null): Promise<RuasDasEntregas> {
  return (await entregasDaLoja(franchiseeId, cidade)).ruas;
}

/** As entregas com ponto de verdade desta loja (sem os pinos no centro de bairro) e as ruas delas. */
function entregasDaLoja(franchiseeId: string, cidade?: string | null): Promise<EntregasDaLoja> {
  if (!franchiseeId) return Promise.resolve({ entregas: [], ruas: new Map() });
  const guardada = naMemoria.get(franchiseeId);
  if (guardada && guardada.ate > Date.now()) return guardada.dados;
  const dados = (async (): Promise<EntregasDaLoja> => {
    try {
      const linhas = await prisma.$queryRawUnsafe<
        { customerAddress: string | null; customerLatLng: unknown; source: string | null; openDeliveryChannel: string | null; ifoodOrderId: string | null }[]
      >(
        `SELECT "customerAddress", "customerLatLng", "source", "openDeliveryChannel", "ifoodOrderId"
           FROM "CustomerOrder"
          WHERE "franchiseeId" = $1 AND "deliveryType" = 'DELIVERY' AND "customerLatLng" IS NOT NULL
            AND "customerAddress" IS NOT NULL AND "createdAt" > NOW() - INTERVAL '${DIAS_DAS_RUAS_DAS_ENTREGAS} days'
          ORDER BY "createdAt" DESC LIMIT ${TETO_DE_ENTREGAS}`,
        franchiseeId,
      );
      const entregas: EntregaComPonto[] = [];
      const centros: Ponto[] = [];
      // Do mais antigo para o mais novo: a rua escrita no resultado é a da entrega mais recente.
      for (const l of [...(linhas || [])].reverse()) {
        const canal = canalDoPedido(l);
        const g = lerPontoGravado(l.customerLatLng, canal.ehMarketplace);
        if (!g) continue;
        if (g.fonte === "bairro") { centros.push(g.ponto); continue; }
        if (g.fonte !== "parceiro" && g.fonte !== "cliente" && g.fonte !== "manual") continue;
        const endereco = String(l.customerAddress);
        const bairro = bairroDoEndereco(endereco, { cidades: [cidade], ultimaParteEhCidade: CANAIS_COM_CIDADE_NO_FIM.has(canal.chave) });
        entregas.push({ endereco, bairro, ponto: g.ponto });
      }
      const ruas = ruasDasEntregas(entregas, centros);
      // As mesmas que entram nas ruas (sem o pino que ficou no centro de um bairro), com ou sem nome de rua.
      const valem = entregas.filter((e) => !centros.some((c) => distanciaKm(c, e.ponto) <= PINO_NO_CENTRO_DO_BAIRRO_KM));
      return { entregas: valem, ruas };
    } catch (e: any) {
      console.warn(`[Rua das entregas] leitura das entregas falhou: ${e?.message}`);
      naMemoria.delete(franchiseeId);
      return { entregas: [], ruas: new Map() };
    }
  })();
  naMemoria.set(franchiseeId, { ate: Date.now() + VALIDADE_MS, dados });
  if (naMemoria.size > 500) naMemoria.delete(naMemoria.keys().next().value as string);
  return dados;
}

/** O ponto da rua do cliente pelas entregas da loja (o gancho `ruaNasEntregas` da verificação). */
export async function pontoDaRuaPelasEntregasDaLoja(
  franchiseeId: string,
  cidade: string | null | undefined,
  ruas: string[],
  bairro: string | null,
): Promise<PontoDaRua | null> {
  const indice = await ruasDasEntregasDaLoja(franchiseeId, cidade);
  return indice.size ? pontoDaRuaNasEntregas(ruas, bairro, indice) : null;
}

/**
 * O centro do bairro que o cliente escreveu, pelas entregas da loja nele
 * (lib/rua-das-entregas.ts, `centroDoBairroNasEntregas`). Nunca lança.
 */
export async function centroDoBairroPelasEntregasDaLoja(
  franchiseeId: string,
  cidade: string | null | undefined,
  bairro: string | null,
): Promise<CentroDoBairro | null> {
  if (!bairro) return null;
  const { entregas } = await entregasDaLoja(franchiseeId, cidade);
  return entregas.length ? centroDoBairroNasEntregas(bairro, entregas) : null;
}
