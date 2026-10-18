/**
 * CLUBE × ASAAS DA LOJA — a mensalidade no cartão, cobrada todo mês sozinha.
 *
 * Douglas, 18/10/2026: qualquer loja com o app próprio cria o clube dela; o
 * cliente paga no CARTÃO AUTOMÁTICO pelo Asaas DA LOJA (lib/asaas-da-loja.ts,
 * a chave que o lojista conectou para o pagamento online). O FireHub não cobra
 * nada por cima: sem split.
 *
 * ── Por que o Checkout do Asaas, e não "assinatura + fatura" ───────────────
 *
 * O cartão NUNCA passa pelo FireHub: é digitado numa página do Asaas. Duas
 * páginas do Asaas fazem isso, e a documentação (lida em 18/10/2026) só
 * garante uma delas para assinatura:
 *
 * - Checkout recorrente — docs.asaas.com/docs/checkout-com-assinatura-recorrente:
 *   `POST /v3/checkouts` com `billingTypes: ["CREDIT_CARD"]`,
 *   `chargeTypes: ["RECURRENT"]` e `subscription {cycle, nextDueDate}`.
 *   "Após o pagador concluir o Checkout, o Asaas cria a assinatura com a
 *   recorrência definida em `subscription`." "As próximas cobranças são
 *   geradas de acordo com `cycle`." E na assinatura com cartão "o cartão é
 *   validado e utilizado nas cobranças futuras"; no vencimento "o Asaas tenta
 *   a cobrança no cartão" (docs.asaas.com/docs/faq-assinaturas). É o que vale
 *   aqui. O link é https://asaas.com/checkoutSession/show?id=<id>
 *   (docs.asaas.com/docs/link-do-checkout-e-redirecionamento-do-cliente).
 * - Assinatura criada sem o cartão + fatura (invoiceUrl) da 1ª cobrança: a
 *   fatura aceita o cartão (docs.asaas.com/docs/cobrancas-via-cartao-de-credito),
 *   mas nenhuma página diz que o cartão digitado nela passa a ser o da
 *   assinatura. Não usada.
 * - Tokenização (`creditCardToken`) exigiria o cartão passando pelo nosso
 *   servidor (escopo PCI maior, docs.asaas.com/docs/pci-dss-1) e, em
 *   produção, pedido de liberação ao gerente da conta. Não usada.
 *
 * ── Quem é quem ─────────────────────────────────────────────────────────────
 *
 * Cada sócio vira um CLIENTE próprio no Asaas da loja (externalReference
 * `clube:<id do sócio>`), criado antes do checkout e passado em `customer`.
 * A assinatura que o checkout cria nasce nesse cliente: é por ele que o
 * FireHub acha a assinatura, sem depender da ordem dos avisos.
 *
 * ── O aviso não decide nada ─────────────────────────────────────────────────
 *
 * Como no pagamento dos pedidos: o webhook só diz QUEM mexeu. O status do
 * sócio sai da LEITURA da assinatura e das cobranças dela no Asaas, com a
 * chave da loja (`reconciliar`) — aviso forjado não faz sócio, aviso repetido
 * não soma mês, aviso perdido se corrige na próxima leitura.
 */
import { asaasDaLoja, cobrancaPaga, type Ambiente, type RespostaAsaas } from "@/lib/asaas-da-loja";
import type { StatusGravado } from "@/lib/clube/regras";

export const referenciaDoClube = (assinanteId: string) => `clube:${assinanteId}`;
export const assinanteDaReferencia = (ref: unknown): string | null => {
  const s = String(ref || "");
  return s.startsWith("clube:") && s.length > 6 ? s.slice(6) : null;
};

// ── DATAS (o Asaas fala em dia de Brasília) ─────────────────────────────────

export function diaEmSaoPaulo(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

/** "2026-01-31" + 1 mês = "2026-02-28" (o dia que não existe vira o último do mês). */
export function maisUmMes(dia: string, meses = 1): string {
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Fim do dia em Brasília, em ISO. */
const fimDoDia = (dia: string) => new Date(`${dia}T23:59:59-03:00`).toISOString();
const meioDoDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`).toISOString();
const soDia = (v: unknown): string | null => {
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ── O CHECKOUT ──────────────────────────────────────────────────────────────

/** Coroa 64×64 do item do checkout (o Asaas exige `imageBase64` em todo item). */
export const IMAGEM_DO_ITEM =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAApElEQVR42u3YQQqDQAwFUD2FFLz/BXo29y4KXch01NKpcfIgy89P3kYYh/kx3XoGAAAAAAAAAAAAAAAAAACADIDlOb4mSD4Z4N1+cEfrfDLApn13R+t8MkCxvbKjdT4ZoNJe3NE6nwyw2/6f+RIQ5Pq6oV9AqOsrhk4BAa//ZOgREPb6ouH0k/Lar/4P3sQAAAAA1wL8WgQAAAAAAAAAAAAAiDIrIUgwJWuhIwsAAAAASUVORK5CYII=";

export function corpoDoCheckout(o: {
  clienteId: string;
  assinanteId: string;
  nomeDoClube: string;
  valor: number;
  percentual: number;
  voltarPara: string;
  agora?: Date;
}) {
  const hoje = diaEmSaoPaulo(o.agora);
  const pct = Number.isInteger(o.percentual) ? String(o.percentual) : String(o.percentual).replace(".", ",");
  return {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: 60,
    externalReference: referenciaDoClube(o.assinanteId),
    customer: o.clienteId,
    callback: { successUrl: `${o.voltarPara}${o.voltarPara.includes("?") ? "&" : "?"}clube=ok`, cancelUrl: o.voltarPara, expiredUrl: o.voltarPara },
    items: [
      {
        name: o.nomeDoClube.slice(0, 30),
        description: `${pct}% de desconto em todos os pedidos pelo aplicativo. Mensal, cancele quando quiser.`.slice(0, 150),
        quantity: 1,
        value: Math.round(o.valor * 100) / 100,
        imageBase64: IMAGEM_DO_ITEM,
      },
    ],
    // A 1ª mensalidade vence hoje (paga na hora, no checkout); as próximas,
    // no mesmo dia dos meses seguintes. O fim fica longe: o clube não acaba sozinho.
    subscription: { cycle: "MONTHLY", nextDueDate: `${hoje} 00:00:00`, endDate: `${maisUmMes(hoje, 120)} 23:59:59` },
  };
}

/** O link que o cliente abre. A resposta pode trazer `link`; senão, o formato da documentação. */
export function linkDoCheckout(dados: { id?: string; link?: string | null } | null, ambiente: Ambiente): string | null {
  if (dados?.link && /^https:\/\//i.test(dados.link)) return dados.link;
  if (!dados?.id) return null;
  const base = ambiente === "producao" ? "https://asaas.com" : "https://sandbox.asaas.com";
  return `${base}/checkoutSession/show?id=${encodeURIComponent(dados.id)}`;
}

// ── O AVISO (webhook da loja) ───────────────────────────────────────────────

export type AvisoDoClube = {
  evento: string;
  assinaturaId: string | null;
  clienteId: string | null;
  checkoutId: string | null;
  assinanteId: string | null;
};

/**
 * O aviso do Asaas é do clube? Assinatura, checkout ou cobrança que nasceu de
 * uma assinatura. Cobrança avulsa (o pedido pago pelo site) devolve null e
 * segue o caminho de sempre.
 */
export function avisoDoClube(corpo: any): AvisoDoClube | null {
  const evento = String(corpo?.event || "");
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (evento.startsWith("SUBSCRIPTION_")) {
    const s = corpo?.subscription || {};
    return { evento, assinaturaId: texto(s.id), clienteId: texto(s.customer), checkoutId: texto(s.checkoutSession), assinanteId: assinanteDaReferencia(s.externalReference) };
  }
  if (evento.startsWith("CHECKOUT_")) {
    const c = corpo?.checkout || corpo?.checkoutSession || {};
    const ref = assinanteDaReferencia(c.externalReference);
    // Checkout que não é do clube (a loja usa o Checkout do Asaas por fora): não é nosso.
    if (!ref && !texto(c.customer)) return null;
    return { evento, assinaturaId: texto(c.subscription?.id ?? c.subscription), clienteId: texto(c.customer), checkoutId: texto(c.id), assinanteId: ref };
  }
  if (evento.startsWith("PAYMENT_")) {
    const p = corpo?.payment || {};
    const assinatura = texto(p.subscription);
    if (!assinatura) return null;
    return { evento, assinaturaId: assinatura, clienteId: texto(p.customer), checkoutId: texto(p.checkoutSession), assinanteId: assinanteDaReferencia(p.externalReference) };
  }
  return null;
}

// ── O STATUS DO SÓCIO PELO QUE ESTÁ NO ASAAS ────────────────────────────────

export type AssinaturaNoAsaas = { id: string; status?: string | null; deleted?: boolean | null; dateCreated?: string | null; customer?: string | null };
export type CobrancaNoAsaas = {
  id: string;
  status?: string | null;
  value?: number | null;
  netValue?: number | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  deleted?: boolean | null;
  invoiceUrl?: string | null;
};

/** O que fica gravado de cada mensalidade (números do painel). */
export type MensalidadeGravada = {
  id: string;
  status: string;
  valor: number;
  valorLiquido: number | null;
  vencimento: string | null;
  /** Dia em que o dinheiro foi pago (cartão: confirmado). null = não pago. */
  pagoEm: string | null;
};

const ESTORNO = ["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"];

export type Reconciliado = {
  status: StatusGravado;
  pagoAte: string | null;
  desde: string | null;
  pagamentos: number;
  assinaturaId: string | null;
  mensalidades: MensalidadeGravada[];
  /** A cobrança vencida que falta pagar (a fatura do Asaas), para o "Pagar o clube". */
  emAtraso: { id: string; invoiceUrl: string | null } | null;
};

/**
 * O status do sócio pela assinatura e pelas cobranças dela, lidas do Asaas.
 *
 * - Mensalidade paga (RECEIVED/CONFIRMED) cobre do vencimento dela até o mesmo
 *   dia do mês seguinte, fim do dia (a tolerância de 3 dias de
 *   `situacaoDaAssinatura` cobre as novas tentativas do cartão).
 * - Estornada ou em chargeback não cobre nada.
 * - Assinatura removida ou inativa = CANCELADO (o que já foi pago vale até acabar).
 * - Cobrança vencida sem pagar depois da última paga = PENDENTE (o cartão
 *   recusou): o desconto sai, o app mostra "pagar o clube".
 * - Nada pago ainda = AGUARDANDO (abriu o checkout e não concluiu); se houve
 *   estorno, PENDENTE.
 */
export function reconciliar(
  assinatura: AssinaturaNoAsaas | null,
  cobrancas: CobrancaNoAsaas[],
  agora: Date = new Date(),
): Reconciliado {
  const hoje = diaEmSaoPaulo(agora);
  const validas = cobrancas.filter((c) => c && c.id && !c.deleted);
  const mensalidades: MensalidadeGravada[] = validas.map((c) => {
    const status = String(c.status || "").toUpperCase();
    const paga = cobrancaPaga(status);
    return {
      id: c.id,
      status,
      valor: Number(c.value) || 0,
      valorLiquido: c.netValue != null && Number.isFinite(Number(c.netValue)) ? Number(c.netValue) : null,
      vencimento: soDia(c.dueDate),
      pagoEm: paga ? soDia(c.confirmedDate) || soDia(c.paymentDate) || soDia(c.clientPaymentDate) || soDia(c.dueDate) : null,
    };
  });
  const pagas = mensalidades.filter((m) => m.pagoEm && m.vencimento);
  const estornos = mensalidades.filter((m) => ESTORNO.includes(m.status));

  const ultimaPaga = pagas.map((m) => m.vencimento!).sort().pop() || null;
  const pagoAte = ultimaPaga ? fimDoDia(maisUmMes(ultimaPaga)) : null;
  const primeiraPaga = pagas.map((m) => m.pagoEm!).sort()[0] || null;

  const atrasadas = validas
    .filter((c) => {
      const s = String(c.status || "").toUpperCase();
      const venc = soDia(c.dueDate);
      if (!venc || cobrancaPaga(s) || ESTORNO.includes(s)) return false;
      const vencida = s === "OVERDUE" || (s === "PENDING" && venc < hoje);
      return vencida && (!ultimaPaga || venc > ultimaPaga);
    })
    .sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)));

  const removida = !assinatura || assinatura.deleted === true || ["INACTIVE", "EXPIRED"].includes(String(assinatura.status || "").toUpperCase());
  let status: StatusGravado;
  if (removida) status = assinatura ? "CANCELADO" : pagas.length ? "CANCELADO" : "AGUARDANDO";
  else if (atrasadas.length) status = "PENDENTE";
  else if (pagas.length) status = "ATIVO";
  else status = estornos.length ? "PENDENTE" : "AGUARDANDO";

  return {
    status,
    pagoAte,
    desde: primeiraPaga ? meioDoDia(primeiraPaga) : null,
    pagamentos: pagas.length,
    assinaturaId: assinatura?.id ?? null,
    mensalidades,
    emAtraso: atrasadas[0] ? { id: atrasadas[0].id, invoiceUrl: atrasadas[0].invoiceUrl ? String(atrasadas[0].invoiceUrl) : null } : null,
  };
}

/** Das assinaturas do cliente, a que vale: a ativa mais nova; senão a mais nova. */
export function assinaturaQueVale(lista: AssinaturaNoAsaas[]): AssinaturaNoAsaas | null {
  const vivas = lista.filter((a) => a && a.id);
  const ordem = (a: AssinaturaNoAsaas, b: AssinaturaNoAsaas) => String(b.dateCreated || "").localeCompare(String(a.dateCreated || ""));
  const ativas = vivas.filter((a) => !a.deleted && String(a.status || "ACTIVE").toUpperCase() === "ACTIVE").sort(ordem);
  return ativas[0] || vivas.sort(ordem)[0] || null;
}

// ── HTTP (chave da loja) ────────────────────────────────────────────────────

/** Erro do Asaas que pode ser da URL de volta (domínio do site da conta). */
const erroDaVolta = (erro: string | null) => /callback|success|url|dom[ií]nio|site|redirec/i.test(String(erro || ""));

/**
 * O cliente do sócio no Asaas da loja: um por sócio, achado pela referência.
 * Sem notificação do Asaas (cada uma é cobrada da loja); o app mostra o status.
 */
export async function clienteDoSocio(
  chave: string,
  s: { assinanteId: string; nome: string; cpf: string; telefone: string },
): Promise<RespostaAsaas<{ id: string }>> {
  const ref = referenciaDoClube(s.assinanteId);
  const busca = await asaasDaLoja(chave, `/customers?externalReference=${encodeURIComponent(ref)}&limit=5`);
  const existente = busca.ok ? (busca.dados?.data || []).find((c: any) => c?.id && !c.deleted) : null;
  if (existente) return { ok: true, status: 200, dados: { id: String(existente.id) }, erro: null };
  const celular = String(s.telefone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const r = await asaasDaLoja(chave, "/customers", {
    method: "POST",
    body: {
      name: s.nome.slice(0, 100) || "Sócio do clube",
      cpfCnpj: s.cpf.replace(/\D/g, ""),
      ...(celular.length >= 10 ? { mobilePhone: celular } : {}),
      notificationDisabled: true,
      externalReference: ref,
      observations: "Sócio do clube do aplicativo (FireHub). Sem notificações do Asaas.",
    },
  });
  if (!r.ok || !r.dados?.id) return { ok: false, status: r.status, dados: null, erro: r.erro || "O Asaas não devolveu o cliente." };
  return { ok: true, status: 200, dados: { id: String(r.dados.id) }, erro: null };
}

/**
 * Cria o checkout da assinatura. A volta ao cardápio é obrigatória no
 * checkout; se o Asaas recusar o endereço (domínio fora do site da conta),
 * tenta com o site cadastrado na conta.
 */
export async function criarCheckout(
  chave: string,
  ambiente: Ambiente,
  o: Parameters<typeof corpoDoCheckout>[0] & { siteDaConta?: string | null },
): Promise<RespostaAsaas<{ id: string; link: string }>> {
  let r = await asaasDaLoja(chave, "/checkouts", { method: "POST", body: corpoDoCheckout(o) });
  if (!r.ok && erroDaVolta(r.erro) && o.siteDaConta && /^https:\/\//i.test(o.siteDaConta)) {
    r = await asaasDaLoja(chave, "/checkouts", { method: "POST", body: corpoDoCheckout({ ...o, voltarPara: o.siteDaConta }) });
  }
  const link = linkDoCheckout(r.dados, ambiente);
  if (!r.ok || !r.dados?.id || !link) return { ok: false, status: r.status, dados: null, erro: r.erro || "O Asaas não devolveu o checkout." };
  return { ok: true, status: 200, dados: { id: String(r.dados.id), link }, erro: null };
}

/** A assinatura que vale deste cliente e as cobranças dela. */
export async function lerAssinaturaDoSocio(
  chave: string,
  s: { clienteId: string | null; assinaturaId: string | null },
): Promise<RespostaAsaas<{ assinatura: AssinaturaNoAsaas | null; cobrancas: CobrancaNoAsaas[] }>> {
  let assinatura: AssinaturaNoAsaas | null = null;
  if (s.clienteId) {
    const l = await asaasDaLoja(chave, `/subscriptions?customer=${encodeURIComponent(s.clienteId)}&limit=20`);
    if (!l.ok) return { ok: false, status: l.status, dados: null, erro: l.erro };
    assinatura = assinaturaQueVale(Array.isArray(l.dados?.data) ? l.dados.data : []);
  }
  // Sem uma ativa na lista (a removida some dela): lê também a guardada pelo id.
  const ativa = assinatura && !assinatura.deleted && String(assinatura.status || "").toUpperCase() === "ACTIVE";
  if (!ativa && s.assinaturaId && assinatura?.id !== s.assinaturaId) {
    const g = await asaasDaLoja(chave, `/subscriptions/${encodeURIComponent(s.assinaturaId)}`);
    if (g.ok && g.dados?.id) assinatura = assinaturaQueVale([assinatura, g.dados].filter(Boolean) as AssinaturaNoAsaas[]);
    else if (!g.ok && g.status !== 404) return { ok: false, status: g.status, dados: null, erro: g.erro };
  }
  if (!assinatura) return { ok: true, status: 200, dados: { assinatura: null, cobrancas: [] }, erro: null };
  const c = await asaasDaLoja(chave, `/subscriptions/${encodeURIComponent(assinatura.id)}/payments?limit=100`);
  if (!c.ok) return { ok: false, status: c.status, dados: null, erro: c.erro };
  return { ok: true, status: 200, dados: { assinatura, cobrancas: Array.isArray(c.dados?.data) ? c.dados.data : [] }, erro: null };
}

/** Remove a assinatura: "a remoção encerra definitivamente a recorrência" (docs.asaas.com/docs/faq-assinaturas). */
export async function cancelarNoAsaas(chave: string, assinaturaId: string) {
  return asaasDaLoja(chave, `/subscriptions/${encodeURIComponent(assinaturaId)}`, { method: "DELETE" });
}
