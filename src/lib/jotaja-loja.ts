/**
 * lib/jotaja-loja.ts — de que loja é este pedido do JotaJá. Regras puras, sem
 * banco (teste: scripts/teste-jotaja-por-loja.ts).
 *
 * Regra do Douglas (16/10/2026): a integração é POR LOJA, igual iFood e Brendi.
 * Pedido do JotaJá só entra na loja cuja credencial o buscou, e só se for do
 * restaurante dessa loja no JotaJá (merchant.id = User.jotajaMerchantId). Nada
 * de procurar "a loja certa" pelo banco inteiro: era assim que o pedido podia
 * cair em outra conta (inclusive na de um funcionário, que herda o
 * jotajaMerchantId do dono pela tela de Equipe).
 */

/** O restaurante (no JotaJá) de um evento da fila ou de um pedido. */
export function merchantDoEvento(evento: any): string | null {
  const m = evento?.storeId ?? evento?.merchant?.id ?? evento?.merchantId ?? evento?.metadata?.merchantId;
  return m === undefined || m === null || String(m).trim() === "" ? null : String(m).trim();
}

export type DecisaoDaLoja =
  | { entra: true; adotarMerchant: string | null }
  | { entra: false; motivo: string };

/**
 * O pedido buscado com a credencial da loja pode entrar nela?
 * - Loja com o número do restaurante gravado: só pedido desse restaurante.
 * - Loja sem o número: a credencial é dela, então o pedido também — e o número
 *   passa a ser gravado (adotarMerchant) — a não ser que OUTRA loja do FireHub
 *   já seja esse restaurante.
 */
export function decidirLojaDoPedido(p: {
  merchantDaLoja: string | null | undefined;
  merchantDoPedido: string | null | undefined;
  outraLojaComEsseMerchant: string | null | undefined;
}): DecisaoDaLoja {
  const daLoja = p.merchantDaLoja ? String(p.merchantDaLoja).trim() : "";
  const doPedido = p.merchantDoPedido ? String(p.merchantDoPedido).trim() : "";
  if (daLoja) {
    if (!doPedido || doPedido === daLoja) return { entra: true, adotarMerchant: null };
    return { entra: false, motivo: `pedido do restaurante ${doPedido} do JotaJá; esta loja é o ${daLoja}` };
  }
  if (!doPedido) return { entra: true, adotarMerchant: null };
  if (p.outraLojaComEsseMerchant) {
    return { entra: false, motivo: `o restaurante ${doPedido} do JotaJá já está em outra loja do FireHub (${p.outraLojaComEsseMerchant})` };
  }
  return { entra: true, adotarMerchant: doPedido };
}

/**
 * Na hora de LIGAR: de que restaurante é a credencial? A fila mostra. Mais de
 * um restaurante na mesma fila = credencial de parceiro, não de loja — não liga.
 */
export function conferirFilaNaLigacao(
  eventos: any[],
  merchantInformado: string | null | undefined,
): { merchant: string | null; erro: string | null } {
  const informado = merchantInformado ? String(merchantInformado).trim() : "";
  const naFila = Array.from(new Set(eventos.map(merchantDoEvento).filter((m): m is string => !!m)));
  if (naFila.length > 1) {
    return { merchant: null, erro: `essa credencial traz pedidos de ${naFila.length} restaurantes do JotaJá (${naFila.join(", ")}) — tem que ser a credencial só desta loja` };
  }
  if (informado && naFila.length === 1 && naFila[0] !== informado) {
    return { merchant: null, erro: `essa credencial é do restaurante ${naFila[0]} no JotaJá, não do ${informado}` };
  }
  return { merchant: informado || naFila[0] || null, erro: null };
}

/**
 * Pedido velho demais para entrar sozinho na cozinha: feito há mais de 12 h
 * (agendado: pela hora marcada). Só acontece com fila parada — integração
 * ligada tarde, credencial que caiu e voltou — e, sem isto, a loja abria o dia
 * com a impressora soltando os pedidos de ontem. O import manual não passa
 * por aqui.
 */
export const HORAS_DO_PEDIDO_ANTIGO = 12;

export function pedidoAntigoDemais(pedido: any, agora: Date = new Date()): boolean {
  const horas = [
    pedido?.createdAt,
    pedido?.schedule?.scheduledDatetimeEnd,
    pedido?.schedule?.scheduledDatetimeStart,
    pedido?.scheduledDatetime,
  ]
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (horas.length === 0) return false;
  // A mais recente: num agendado, a hora marcada (depois da criação).
  return agora.getTime() - Math.max(...horas) > HORAS_DO_PEDIDO_ANTIGO * 3600_000;
}

/** O id do item no catálogo do JotaJá (o mesmo em todo pedido do produto). */
export function idDoItemJotaja(item: any): string {
  const nome = item?.name || item?.productName || item?.title || item?.label || "Item Jotajá";
  const id = item?.id || item?.externalId || item?.externalCode;
  if (id) return String(id);
  // Sem id no catálogo: pelo NOME, nunca aleatório (senão cada pedido cria um espelho novo).
  return `nome-${String(nome).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
}

/**
 * O id do produto-espelho do item. `jotaja-<id>` é global; se esse id já é de
 * OUTRA loja (dois restaurantes com o mesmo id de item, ou com o mesmo nome no
 * caso sem id), esta loja ganha o seu: `jotaja-<loja>-<id>`. Os espelhos que já
 * existem continuam com o id de sempre.
 */
export function idDoEspelhoJotaja(itemId: string, lojaId: string, donoDoIdGlobal: string | null | undefined): string {
  if (!donoDoIdGlobal || donoDoIdGlobal === lojaId) return `jotaja-${itemId}`;
  return `jotaja-${lojaId}-${itemId}`;
}
