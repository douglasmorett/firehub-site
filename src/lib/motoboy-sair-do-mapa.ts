/**
 * src/lib/motoboy-sair-do-mapa.ts
 *
 * Entregador que aperta "Sair" some do mapa da Roteirização na hora.
 *
 * O mapa guarda de propósito a última posição de quem parou de mandar GPS
 * (capacete apagado, "onde foi visto por último") — serve para quando o sinal
 * cai no meio da rua. Mas quem SAIU do app não está mais trabalhando: a loja
 * (NIK) pediu que ele desapareça. Como Motoboy.lastLat/lastLng é a única posição
 * guardada (não há histórico — ver /privacidade-entregador), apagar as três
 * colunas basta: o mapa já pula quem não tem posição, e o acompanhamento do
 * cliente (lib/entrega-ao-vivo.ts) volta a mostrar só o status.
 *
 * Pedidos ainda na rua ficam intactos: só a posição é apagada.
 */

type Banco = {
  motoboy: {
    updateMany(args: {
      where: { id: string; franchiseeId: string };
      data: { lastLat: null; lastLng: null; lastLocationUpdate: null };
    }): Promise<{ count: number }>;
  };
};

/** `mb` é o que exigirMotoboy devolveu — null (sessão vencida) não apaga nada. */
export async function tirarMotoboyDoMapa(
  db: Banco,
  mb: { id: string; franchiseeId: string } | null,
): Promise<boolean> {
  if (!mb) return false;
  const r = await db.motoboy.updateMany({
    where: { id: mb.id, franchiseeId: mb.franchiseeId },
    data: { lastLat: null, lastLng: null, lastLocationUpdate: null },
  });
  return r.count > 0;
}
