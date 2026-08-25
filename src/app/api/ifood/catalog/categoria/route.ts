/**
 * /api/ifood/catalog/categoria
 * Cenário 1 da homologação de Catalog: criar a categoria "Teste Homologação".
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { criarCategoria } from "@/lib/ifood-catalog";

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const r = await criarCategoria(ctx, {
      nome: corpo?.nome,
      status: corpo?.status ?? "AVAILABLE",
      template: corpo?.template ?? "DEFAULT",
    });
    return responder(r, { categoria: r.data ?? null });
  });
}
