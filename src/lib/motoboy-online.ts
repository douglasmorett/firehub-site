/**
 * src/lib/motoboy-online.ts
 *
 * Quem está "online no app" para o "Despachar Rota de Entrega": mandou
 * localização nos últimos 30 min — o mesmo corte que o mapa da Roteirização
 * usa para o capacete aceso. O app manda a cada ~12 s com a localização
 * ligada; o "Sair" apaga a posição (lib/motoboy-sair-do-mapa.ts) e
 * /api/motoboys/location esconde a de antes do fechamento do caixa.
 *
 * Só vale quando a loja liga appMotoboyConfig.despachoSoOnline (Lucas,
 * Frangoso, 26/10/2026: lista cheia, dois "Douglas", dois "Luiz", rota indo
 * para o motoboy errado).
 */
export const MINUTOS_ONLINE = 30;

export function estaOnlineNoApp(
  mb: { lastLocationUpdate?: string | Date | null },
  agora: number = Date.now(),
): boolean {
  if (!mb.lastLocationUpdate) return false;
  const em = new Date(mb.lastLocationUpdate).getTime();
  if (!Number.isFinite(em)) return false;
  return agora - em <= MINUTOS_ONLINE * 60_000;
}
