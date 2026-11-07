/**
 * src/lib/espelho-de-integracao.ts
 *
 * O ESPELHO de integração agora tem campo: `MenuProduct.origemIntegracao`.
 *
 * Até 07/11/2026 o espelho (o produto que o pedido do iFood, 99Food, Keeta…
 * cria só para `CustomerOrderItem` ter um `menuProductId`) era uma linha comum
 * do cardápio, e cada tela adivinhava se era espelho pelo prefixo do id, pela
 * categoria ou pelo `active`. O 99Food criava o dele ATIVO e com a categoria
 * real do produto de mesmo nome — passava por todos os filtros e aparecia no
 * site, no robô e no balcão, sem foto e "pausado". Foi a queixa do Douglas:
 * "o cardápio dos meus clientes está confuso".
 *
 * Regras, as mesmas para todo canal:
 *
 *   1. Espelho nasce com `origemIntegracao` preenchida, pausado e fora dos
 *      quatro canais (`camposDoEspelho`). Nenhum caminho decide isso.
 *   2. Toda leitura de cardápio — site, robô, balcão, mesa, totem, painel,
 *      combos, relatórios — exclui `origemIntegracao != null`
 *      (`SEM_PRODUTO_DE_INTEGRACAO` em lib/cardapio-interno.ts já traz isso).
 *      O dono da loja também não vê o espelho; o único lugar que o cita é a
 *      tela "Itens das integrações", para vincular.
 *   3. Antes de criar espelho, o pedido tenta achar o produto REAL: pelo
 *      Código PDV que o lojista digitou no marketplace (volta no pedido como
 *      `externalCode`) ou pelo vínculo manual gravado no espelho
 *      (`vinculadoA`). Achou, o item conecta direto no produto da loja — e
 *      KDS, impressora, ficha e relatório deixam de adivinhar pelo nome.
 */
import { prisma } from "./prisma";

/** Canais que criam espelho. O valor vai em `MenuProduct.origemIntegracao`. */
export const ORIGENS = {
  IFOOD: "IFOOD",
  FOOD99: "99FOOD",
  KEETA: "KEETA",
  AIQFOME: "AIQFOME",
  ANOTAAI: "ANOTAAI",
  CARDAPIOWEB: "CARDAPIOWEB",
  WABIZ: "WABIZ",
  BRENDI: "BRENDI",
  JOTAJA: "JOTAJA",
  RESTAURADO: "RESTAURADO",
} as const;
export type Origem = (typeof ORIGENS)[keyof typeof ORIGENS];

/** Trecho de `where`: só produto da loja, nunca espelho. */
export const SEM_ESPELHO = { origemIntegracao: null } as const;

/**
 * O que todo `create` de espelho leva, além de id/nome/preço/categoria.
 * Pausado e fora dos quatro canais: não existe caminho em que um espelho deva
 * aparecer para alguém.
 */
export function camposDoEspelho(origem: Origem, codigoExterno?: string | null) {
  return {
    origemIntegracao: origem,
    codigoExterno: codigoExterno ? String(codigoExterno).slice(0, 190) : null,
    active: false,
    activePDV: false,
    activeDelivery: false,
    activeTotem: false,
    activeGarcom: false,
  };
}

/**
 * Acha o produto REAL da loja para um item de integração, sem espelho.
 *
 * Ordem: Código PDV (`externalCode` do marketplace = `codigoPDV` numérico da
 * loja, ou o próprio id do produto, que é o que o cardápio enviado à Keeta
 * carrega) → vínculo manual gravado no espelho (`vinculadoA`). Devolve o id
 * do produto ou null. Nunca lança: o pedido tem que gravar de qualquer jeito.
 */
export async function produtoRealDoItem(opts: {
  franchiseeId: string;
  codigoExterno?: string | null;
  idDoEspelho?: string | null;
}): Promise<string | null> {
  try {
    const codigo = opts.codigoExterno ? String(opts.codigoExterno).trim() : "";
    if (codigo) {
      const numero = /^\d{1,9}$/.test(codigo) ? Number(codigo) : null;
      const real = await (prisma.menuProduct as any).findFirst({
        where: {
          franchiseeId: opts.franchiseeId,
          origemIntegracao: null,
          OR: [...(numero != null ? [{ codigoPDV: numero }] : []), { id: codigo }],
        },
        select: { id: true },
      });
      if (real) return real.id as string;
    }
    if (opts.idDoEspelho) {
      const espelho = await (prisma.menuProduct as any).findUnique({
        where: { id: opts.idDoEspelho },
        select: { vinculadoA: true, franchiseeId: true },
      });
      if (espelho?.vinculadoA && espelho.franchiseeId === opts.franchiseeId) {
        const real = await (prisma.menuProduct as any).findFirst({
          where: { id: espelho.vinculadoA, franchiseeId: opts.franchiseeId, origemIntegracao: null },
          select: { id: true },
        });
        if (real) return real.id as string;
      }
    }
  } catch (err: any) {
    console.warn("[espelho] produtoRealDoItem falhou:", err?.message);
  }
  return null;
}

/**
 * Próximo Código PDV da loja (1, 2, 3…). É o número que o lojista digita no
 * "Código PDV" do iFood para o pedido entrar ligado ao produto certo.
 */
export async function proximoCodigoPDV(franchiseeId: string | null | undefined): Promise<number | null> {
  if (!franchiseeId) return null;
  try {
    const r = await (prisma.menuProduct as any).aggregate({
      where: { franchiseeId },
      _max: { codigoPDV: true },
    });
    return (Number(r?._max?.codigoPDV) || 0) + 1;
  } catch {
    return null;
  }
}
