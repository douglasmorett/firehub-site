/**
 * /api/ifood/catalog
 * O cardápio como o iFood o enxerga: catálogos e categorias, com os itens
 * dentro de cada uma quando `?itens=1`.
 */
import { NextRequest } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { listarCatalogos, listarCategorias } from "@/lib/ifood-catalog";
import { NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, params }) => {
    const comItens = params.get("itens") === "1";

    const [catalogos, categorias] = await Promise.all([
      listarCatalogos(ctx),
      listarCategorias(ctx, comItens),
    ]);

    // Uma das duas falhando já é motivo para mostrar o erro: sem catálogo não
    // há onde criar categoria, e sem categoria não há onde criar item.
    if (!catalogos.ok) return responder(catalogos);
    if (!categorias.ok) return responder(categorias);

    return NextResponse.json({
      ok: true,
      merchantId: ctx.merchantId,
      loja: ctx.label ?? null,
      ifood: { status: categorias.status, ok: true, origem: categorias.origem },
      catalogos: catalogos.data ?? [],
      categorias: categorias.data ?? [],
    });
  });
}
