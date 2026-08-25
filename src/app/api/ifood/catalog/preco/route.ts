/**
 * /api/ifood/catalog/preco
 * O PATCH de preço — de item ou de complemento.
 *
 * A homologação é explícita: alteração de preço TEM que sair por PATCH. Reenviar
 * o item por PUT muda o preço na tela do mesmo jeito e reprova assim mesmo.
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { atualizarPrecoItem, atualizarPrecoComplemento } from "@/lib/ifood-catalog";

export async function PATCH(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const preco = Number(corpo?.preco);

    if (corpo?.optionId) {
      const r = await atualizarPrecoComplemento(ctx, {
        optionId: corpo.optionId,
        preco,
        precoOriginal: corpo?.precoOriginal ? Number(corpo.precoOriginal) : undefined,
      });
      return responder(r, { alvo: "complemento", endpoint: "PATCH /options/price" });
    }

    const r = await atualizarPrecoItem(ctx, {
      itemId: corpo?.itemId,
      preco,
      precoOriginal: corpo?.precoOriginal ? Number(corpo.precoOriginal) : undefined,
    });
    return responder(r, { alvo: "item", endpoint: "PATCH /items/price" });
  });
}
