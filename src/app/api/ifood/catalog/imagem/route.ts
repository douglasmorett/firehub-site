/**
 * /api/ifood/catalog/imagem
 * Sobe a foto e devolve o imagePath — o passo que precede o item e cada
 * complemento nos cenários 1 e 2.
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { subirImagem } from "@/lib/ifood-catalog";

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const r = await subirImagem(ctx, corpo?.imagem);
    return responder(r, { imagePath: r.data?.imagePath ?? null });
  });
}
