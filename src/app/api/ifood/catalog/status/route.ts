/**
 * /api/ifood/catalog/status
 * O PATCH de pausa — item, complemento ou grupo inteiro.
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import {
  atualizarStatusItem,
  atualizarStatusComplemento,
  atualizarStatusGrupo,
} from "@/lib/ifood-catalog";

export async function PATCH(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const status = corpo?.status;

    if (corpo?.optionGroupId) {
      const r = await atualizarStatusGrupo(ctx, { optionGroupId: corpo.optionGroupId, status });
      return responder(r, { alvo: "grupo", endpoint: "PATCH /optionGroups/status" });
    }
    if (corpo?.optionId) {
      const r = await atualizarStatusComplemento(ctx, { optionId: corpo.optionId, status });
      return responder(r, { alvo: "complemento", endpoint: "PATCH /options/status" });
    }
    const r = await atualizarStatusItem(ctx, { itemId: corpo?.itemId, status });
    return responder(r, { alvo: "item", endpoint: "PATCH /items/status" });
  });
}
