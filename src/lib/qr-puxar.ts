/**
 * src/lib/qr-puxar.ts
 *
 * O código que o QR da comanda carrega — e NADA além dele.
 *
 * Desenho de propósito: o QR leva `AAAAMMDD-numero` (a data + o número diário
 * que já sai impresso em corpo dobrado no topo da MESMA comanda). Não há token,
 * segredo ou credencial no papel: a via grampeada no saco e a comanda no lixo
 * não valem nada sozinhas — quem puxa o pedido é o MOTOBOY LOGADO no app, e a
 * autorização é a sessão assinada dele (motoboy-sessao.ts), nunca o QR.
 *
 * Um relógio só, nos dois trilhos: o dailyOrderNumber é chaveado em
 * America/Sao_Paulo (order-number.ts, dateKeySP, hardcoded) — então a data do
 * QR TAMBÉM é SP, calculada por este helper compartilhado entre o payload de
 * impressão (servidor) e o app do motoboy (browser). Intl existe nos dois.
 */

/** Data no fuso de São Paulo, AAAAMMDD — o MESMO relógio do dailyOrderNumber. */
export function chaveDoDiaSP(ref: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ref)).replace(/-/g, "");
}

/** Início (UTC) do dia SP para uma chave AAAAMMDD. */
export function inicioDoDiaSP(chave: string): Date {
  const y = chave.slice(0, 4), m = chave.slice(4, 6), d = chave.slice(6, 8);
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

export function codigoDoPedido(createdAt: Date | string, numero: number): string {
  return `${chaveDoDiaSP(createdAt)}-${numero}`;
}

export function urlDoPuxar(base: string, slug: string, codigo: string): string {
  return `${String(base).replace(/\/+$/, "")}/loja/${slug}/motoboy?p=${codigo}`;
}
