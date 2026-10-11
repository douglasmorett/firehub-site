/**
 * GET /api/integracoes/firecheck/itens  (Authorization: Bearer <chave da ligação>)
 *   → { loja, itens: [{ nome, tipo: "PRODUTO" | "INSUMO", unidade }] }
 *
 * A lista do campo "item" no descarte do FireCheck: com o nome igual ao do
 * cardápio/estoque, o descarte casa e vira baixa pela ficha.
 */
import { NextRequest, NextResponse } from "next/server";
import { itensParaODescarte, lojaDaChave } from "@/lib/cmv/firecheck";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req.headers.get("authorization"));
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  return NextResponse.json({ loja: loja.nome, itens: await itensParaODescarte(loja.id) });
}
