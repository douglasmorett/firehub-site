/**
 * Os ids de loja de um evento do 99Food (lib/webhook-99food-log.ts): as chaves
 * de id do payload e o que o webhook anotou no motivo. Igualdade exata com os
 * ids da loja decide quem vê o evento — o log é de TODAS as lojas, com dados
 * de cliente no payload.
 */
export function idsDoEvento99Food(e: { payload: string; motivo?: string }): string[] {
  return [
    ...e.payload.matchAll(/"(?:app_shop_id|appShopId|shop_id|shopId|merchantId|storeId)"\s*:\s*"?([^",}\s]+)/g),
    ...(e.motivo || "").matchAll(/(?:shop_id "|app_shop_id do evento: |da conta )([^"\s)]+)/g),
  ].map((m) => m[1]);
}
