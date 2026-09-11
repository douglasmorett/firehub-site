/**
 * As coordenadas que o próprio iFood manda no pedido.
 *
 * Todo pedido de entrega do iFood chega com
 * `delivery.deliveryAddress.coordinates = { latitude, longitude }` — o ponto
 * exato que o cliente marcou no app. A roteirização, porém, só conhecia o
 * texto do endereço e geocodificava tudo no Nominatim; um bairro mal lido
 * bastava para o pino cair a quilômetros da casa (pedido 17 da Lucas Pimenta,
 * "Alcantara - São Gonçalo", 10/09/2026). Guardar o ponto do parceiro em
 * `CustomerOrder.customerLatLng` faz a roteirização e o "atribuir motoboy
 * mais perto" usarem o dado certo sem consultar ninguém.
 *
 * Só aceita ponto dentro do Brasil e diferente de (0,0): coordenada zerada é
 * o que vem quando o app do cliente não conseguiu geolocalizar.
 */
export function coordenadasDoIfood(orderData: any): { lat: number; lng: number } | undefined {
  const c = orderData?.delivery?.deliveryAddress?.coordinates;
  if (!c) return undefined;
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  if (lat < -34 || lat > 6 || lng < -74 || lng > -34) return undefined;
  return { lat, lng };
}
// `undefined`, nunca `null`: para o Prisma, null num campo Json exige
// Prisma.JsonNull — passar null cru derruba o create do pedido inteiro.
