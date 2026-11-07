import { NextRequest, NextResponse } from "next/server";
import { keetaConfigurada } from "@/lib/keeta/api";
import { cardapioDoMerchant, chaveDoCardapioConfere } from "@/lib/keeta/cardapio";

/**
 * GET /api/keeta/cardapio/<merchantId> — o cardápio da loja para a Keeta
 * (Open Delivery `GET /v1/merchant`).
 *
 * É a `getMerchantURL` que o onboarding registra (lib/keeta/vinculo.ts), uma
 * por loja. A Keeta manda a chave em `X-API-KEY`; sem ela certa, 401 — o
 * cardápio com preço e status não fica aberto para qualquer um.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  if (!keetaConfigurada()) return NextResponse.json({ error: "Keeta não configurada" }, { status: 503 });
  const { merchantId } = await params;
  if (!chaveDoCardapioConfere(merchantId, req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "apiKey inválida" }, { status: 401 });
  }
  const cardapio = await cardapioDoMerchant(merchantId).catch((e) => {
    console.error(`[Keeta] ❌ cardápio de ${merchantId}: ${e?.message || e}`);
    return undefined;
  });
  if (cardapio === undefined) return NextResponse.json({ error: "Erro ao montar o cardápio" }, { status: 500 });
  if (!cardapio) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  console.log(`[Keeta] 📋 Keeta leu o cardápio de ${merchantId}: ${cardapio.itemOffers.length} itens`);
  return NextResponse.json(cardapio);
}
