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
 *
 * E a loja começa a receber a partir da hora em que LIGOU: o JotaJá guarda 7
 * dias de fila, e o que foi pedido antes continua no portal dele.
 */

/** O restaurante (no JotaJá) de um pedido (merchant.id) ou de um evento da fila (storeId). */
export function merchantDoEvento(evento: any): string | null {
  const m = evento?.merchant?.id ?? evento?.storeId ?? evento?.merchantId ?? evento?.metadata?.merchantId;
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

const quando = (v: any): number => (v ? new Date(v).getTime() : NaN);

/**
 * Pedido criado ANTES de a loja ligar o JotaJá no FireHub (ligadoEmMs): fica no
 * portal do JotaJá, onde a loja já o atendeu. Sem a hora da ligação (loja ligada
 * antes desta regra), nada é barrado por aqui. Pedido sem data também entra.
 */
export function pedidoDeAntesDaLigacao(pedido: any, ligadoEmMs: number | null | undefined): boolean {
  if (!ligadoEmMs) return false;
  const criado = quando(pedido?.createdAt);
  return Number.isFinite(criado) && criado < ligadoEmMs;
}

/**
 * Os eventos que, NA HORA DE LIGAR, já podem sair da fila sem nem buscar o
 * pedido: CREATED com data anterior à ligação — o CREATED nasce junto com o
 * pedido, então o pedido também é de antes. Os outros eventos (confirmado,
 * cancelado…) seguem pelo caminho normal, que busca o pedido e aplica a mesma
 * regra.
 */
export function eventosDaLargada(fila: any[], ligadoEmMs: number): any[] {
  return fila.filter((e) => {
    const tipo = String(e?.eventType || e?.fullCode || "").toUpperCase();
    const ehCriacao = tipo === "CREATED" || tipo === "PLACED" || e?.code === "PLC";
    const t = quando(e?.createdAt);
    return ehCriacao && Number.isFinite(t) && t < ligadoEmMs;
  });
}

/**
 * Pedido velho demais para entrar sozinho na cozinha: feito há mais de 12 h
 * (agendado: pela hora marcada). Só acontece com fila parada — credencial que
 * caiu e voltou — e, sem isto, a loja abria o dia com a impressora soltando os
 * pedidos de ontem. O import manual não passa por aqui.
 *
 * O Open Delivery escreve `scheduledDateTimeStart/End` (T maiúsculo); a grafia
 * minúscula também é lida (ver processBrendiEvent.ts). Agendado sem nenhuma
 * data legível NÃO é descartado.
 */
export const HORAS_DO_PEDIDO_ANTIGO = 12;

export function pedidoAntigoDemais(pedido: any, agora: Date = new Date()): boolean {
  const agenda = pedido?.schedule ?? {};
  const datasDaAgenda = [
    agenda.scheduledDateTimeEnd, agenda.scheduledDatetimeEnd,
    agenda.scheduledDateTimeStart, agenda.scheduledDatetimeStart,
    pedido?.scheduledDateTime, pedido?.scheduledDatetime,
    pedido?.delivery?.deliveryDateTime, pedido?.takeout?.takeoutDateTime,
  ].map(quando).filter((t) => Number.isFinite(t));
  const agendado =
    pedido?.orderTiming === "SCHEDULED" ||
    pedido?.delivery?.mode === "SCHEDULED" ||
    pedido?.takeout?.mode === "SCHEDULED";
  if (agendado && datasDaAgenda.length === 0) return false;
  const horas = [quando(pedido?.createdAt), ...datasDaAgenda].filter((t) => Number.isFinite(t));
  if (horas.length === 0) return false;
  // A mais recente: num agendado, a hora marcada (depois da criação).
  return agora.getTime() - Math.max(...horas) > HORAS_DO_PEDIDO_ANTIGO * 3600_000;
}

/**
 * Uma credencial, uma loja. Se a mesma credencial estiver ligada em mais de uma
 * loja (cadastro antigo, conta duplicada), só a MAIS ANTIGA recebe — a mesma que
 * o código antigo escolhia ao procurar a loja pelo número do restaurante — e as
 * outras ficam de fora, sem o pedido cair ora numa, ora noutra.
 */
export function donasDasCredenciais<T extends { id: string; clientId: string | null; criadaEm: Date | string | number }>(
  lojas: T[],
): { donas: T[]; repetidas: { clientId: string; dona: T; foraDoPoll: T[] }[] } {
  const porCredencial = new Map<string, T[]>();
  for (const l of lojas) {
    if (!l.clientId) continue;
    porCredencial.set(l.clientId, [...(porCredencial.get(l.clientId) ?? []), l]);
  }
  const donas: T[] = [];
  const repetidas: { clientId: string; dona: T; foraDoPoll: T[] }[] = [];
  for (const [clientId, grupo] of porCredencial) {
    const ordenado = [...grupo].sort((a, b) => quando(a.criadaEm) - quando(b.criadaEm) || a.id.localeCompare(b.id));
    donas.push(ordenado[0]);
    if (ordenado.length > 1) repetidas.push({ clientId, dona: ordenado[0], foraDoPoll: ordenado.slice(1) });
  }
  return { donas, repetidas };
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
 * caso sem id), esta loja ganha o seu: `jotaja-<loja>-<id>`. Espelho criado em
 * nome de um funcionário da loja (código antigo) conta como da loja.
 */
export function idDoEspelhoJotaja(
  itemId: string,
  lojaId: string,
  donoDoIdGlobal: string | null | undefined,
  contasDaLoja: Iterable<string> = [lojaId],
): string {
  const daLoja = new Set([lojaId, ...contasDaLoja]);
  if (!donoDoIdGlobal || daLoja.has(donoDoIdGlobal)) return `jotaja-${itemId}`;
  return `jotaja-${lojaId}-${itemId}`;
}
