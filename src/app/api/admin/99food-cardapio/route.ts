import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ehAdminNoBanco } from "@/lib/permissoes-da-equipe";
import { lojas99DaConta } from "@/lib/food99-lojas";
import { cardapioDaLoja, detalheDaLoja, getAuthToken } from "@/lib/food99-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/99food-cardapio?loja=<id da conta FireHub>
 *
 * Lê o cardápio da 99 das lojas que a conta já ligou, para copiar para o
 * FireHub. Só ADMIN, só leitura: não grava nada aqui nem na 99. O token sai de
 * `getAuthToken`, o mesmo caminho dos pedidos.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(await ehAdminNoBanco(session))) {
    return NextResponse.json({ error: "Só o administrador." }, { status: 403 });
  }
  const loja = String(req.nextUrl.searchParams.get("loja") || "").trim();
  if (!loja) return NextResponse.json({ error: "Informe ?loja=<id da conta>." }, { status: 400 });

  const vinculos = await lojas99DaConta(loja);
  const ids = vinculos.length ? vinculos.map((v) => v.appShopId).filter(Boolean) : [loja];
  const lojas = [];
  for (const appShopId of ids) {
    const t = await getAuthToken(String(appShopId));
    if (!t.autorizada) {
      lojas.push({ appShopId, erro: t.erro || "Loja não autorizada na 99." });
      continue;
    }
    const [detalhe, cardapio] = await Promise.all([
      detalheDaLoja(t.token.auth_token).catch(() => null),
      cardapioDaLoja(t.token.auth_token),
    ]);
    lojas.push({ appShopId, detalhe, cardapio });
  }
  return NextResponse.json({ loja, lojas });
}
