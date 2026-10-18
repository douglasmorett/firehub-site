/**
 * CLUBE × CAKTO — o que o webhook diz e o link do checkout. Puro, sem banco.
 *
 * Documentação: docs.cakto.com.br/conceitos/webhooks (corpo `{secret, event,
 * data}`). Lições do FireHub Prazos (api/prazos/cakto) e do FireCheck:
 * - no disparo "Agrupado" `data` vem como LISTA;
 * - a assinatura HMAC real não bateu com a fórmula da documentação (07/09):
 *   quem autentica é o segredo (da URL ou do corpo);
 * - o FireCheck não guardava o payload e a renovação "sumiu" sem rastro —
 *   aqui todo corpo é guardado (PayloadDoParceiro, canal "cakto-clube");
 * - resposta não-2xx a Cakto NÃO reenvia: erro nosso devolve 500 só quando
 *   vale a pena reenviar à mão.
 *
 * A compra volta para o NOSSO cliente pelo `callback` (vai no link do checkout
 * e volta em `data.callback` em todo evento, desde 21/09/2026). Sem ele (link
 * aberto fora do app), o telefone do comprador.
 */

export type AcaoDoEvento =
  /** Pagou (1ª compra, renovação, atraso recuperado, retomada): soma um mês. */
  | "pagou"
  /** A cobrança falhou ou atrasou: fica pendente, o que já foi pago vale até acabar. */
  | "atrasou"
  /** Cancelou: o que já foi pago vale até acabar. */
  | "cancelou"
  /** Estorno ou chargeback: o desconto para na hora. */
  | "estornou"
  | null;

export function acaoDoEvento(evento: string, statusDoPedido = ""): AcaoDoEvento {
  const e = String(evento || "").toLowerCase().trim();
  const s = String(statusDoPedido || "").toLowerCase().trim();
  if (e === "purchase_approved" || e === "subscription_renewed" || e === "subscription_resumed" || e === "subscription_late_recovered") return "pagou";
  // A assinatura nasce junto da 1ª compra; só conta como pagamento se já veio paga
  // (o purchase_approved da mesma venda soma o mês — ver `chaveDoPagamento`).
  if (e === "subscription_created") return /^(paid|approved|active|pago)$/.test(s) ? "pagou" : null;
  if (e === "subscription_renewal_refused" || e === "subscription_late" || e === "subscription_paused") return "atrasou";
  if (e === "subscription_canceled" || e === "subscription_cancelled") return "cancelou";
  if (e === "refund" || e === "chargeback") return "estornou";
  return null;
}

export type EventoDaCakto = {
  evento: string;
  acao: AcaoDoEvento;
  /** Id do pedido na Cakto — o mesmo pagamento não soma dois meses. */
  pedidoId: string | null;
  assinaturaId: string | null;
  callback: string | null;
  telefone: string | null;
  email: string | null;
  nome: string | null;
  produto: string;
  valor: number | null;
  pagoEm: Date | null;
  segredoDoCorpo: string;
};

const texto = (v: unknown) => (v == null ? "" : String(v)).trim();

export function lerEventoDaCakto(body: any): EventoDaCakto | null {
  if (!body || typeof body !== "object") return null;
  const evento = texto(body.event || body.type || body.event_type);
  const dados: any = Array.isArray(body.data)
    ? body.data.find((x: any) => texto(x?.callback)) || body.data[0] || {}
    : body.data && typeof body.data === "object"
      ? body.data
      : body;
  const cliente: any = dados.customer && typeof dados.customer === "object" ? dados.customer : {};
  const telefone = texto(cliente.phone || cliente.cellphone || dados.customerCellphone || dados.phone).replace(/\D/g, "");
  const email = texto(cliente.email || dados.customerEmail || dados.email).toLowerCase();
  const assinatura = dados.subscription;
  const assinaturaId = texto(
    (assinatura && typeof assinatura === "object" ? assinatura.id : assinatura) || dados.subscription_id,
  );
  const valor = Number(dados.amount ?? dados.baseAmount ?? dados.offer?.price);
  const pago = texto(dados.paidAt || dados.paid_at || dados.createdAt);
  const pagoEm = pago && Number.isFinite(new Date(pago).getTime()) ? new Date(pago) : null;
  return {
    evento,
    acao: acaoDoEvento(evento, texto(dados.status)),
    pedidoId: texto(dados.id || dados.refId) || null,
    assinaturaId: assinaturaId || null,
    callback: texto(dados.callback).slice(0, 255) || null,
    telefone: telefone.length >= 8 ? telefone : null,
    email: email || null,
    nome: texto(cliente.name || dados.customerName).slice(0, 80) || null,
    produto: `${texto(dados.product?.name)} ${texto(dados.offer?.name)}`.trim(),
    valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    pagoEm,
    segredoDoCorpo: texto(body.secret),
  };
}

/**
 * O mesmo pagamento chega por dois eventos (purchase_approved e
 * subscription_created da mesma venda): a trava usa o id do PEDIDO, não o
 * nome do evento, para "pagou" — e o evento para o resto.
 */
export function chaveDoPagamento(e: Pick<EventoDaCakto, "acao" | "pedidoId" | "evento" | "assinaturaId">): string | null {
  if (e.acao === "pagou") return e.pedidoId ? `pago:${e.pedidoId}` : null;
  const ref = e.pedidoId || e.assinaturaId;
  return ref ? `${e.evento}:${ref}` : null;
}

/** O `callback` que vai no link: só letras, números e `._~-` (regra da Cakto). */
export function callbackValido(v: unknown): string | null {
  const s = texto(v);
  return /^[A-Za-z0-9._~-]{8,255}$/.test(s) ? s : null;
}

/**
 * O link do checkout com o cliente já preenchido e o `callback` que liga a
 * compra a ele. `phone` vai com 55 na frente (o checkout é do Brasil).
 */
export function linkDoCheckoutDoCliente(
  base: string,
  c: { callback: string; nome?: string | null; telefone?: string | null },
): string {
  const u = new URL(base);
  u.searchParams.set("callback", c.callback);
  if (c.nome) u.searchParams.set("name", c.nome);
  const tel = String(c.telefone || "").replace(/\D/g, "");
  if (tel.length >= 10) u.searchParams.set("phone", tel.startsWith("55") && tel.length >= 12 ? tel : `55${tel}`);
  u.searchParams.set("utm_source", "app");
  u.searchParams.set("utm_campaign", "clube");
  return u.toString();
}
