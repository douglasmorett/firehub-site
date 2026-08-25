/**
 * /api/ifood/catalog/item
 *   GET ?itemId=… → o item inteiro, com produto, grupos e complementos
 *   PUT           → cria ou reescreve o item (cenários 1 e 2 de Catalog)
 *
 * O PUT devolve os ids gerados porque é com eles que a tela vai chamar os
 * PATCH de preço e de pausa no cenário 3.
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { itemCompleto, salvarItem } from "@/lib/ifood-catalog";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, params }) => {
    const itemId = params.get("itemId") ?? "";
    if (!itemId) {
      return responder({ ok: false, status: 400, data: null, texto: "", tentativas: 0 });
    }
    return responder(await itemCompleto(ctx, itemId));
  });
}

export async function PUT(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const { resposta, ids } = await salvarItem(ctx, {
      id: corpo?.id,
      productId: corpo?.productId,
      categoryId: corpo?.categoryId,
      nome: corpo?.nome,
      descricao: corpo?.descricao,
      preco: Number(corpo?.preco),
      status: corpo?.status ?? "AVAILABLE",
      imagePath: corpo?.imagePath ?? null,
      externalCode: corpo?.externalCode ?? null,
      grupos: corpo?.grupos ?? [],
    });
    return responder(resposta, { ids });
  });
}
