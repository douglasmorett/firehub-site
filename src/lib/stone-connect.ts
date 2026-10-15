/**
 * FireHub — Connect Stone 2.0 (cobrança pela nuvem na maquininha Stone)
 *
 * A Stone pareada à conta da loja recebe o pedido pela nuvem da Pagar.me, sem
 * app do FireHub dentro dela. É o mesmo desenho do Mercado Pago Point:
 *
 *   FireHub  ->  api.pagar.me (pedido com poi_payment_settings)  ->  POS Stone
 *
 * Docs conferidas em connect-stone.stone.com.br (out/2026):
 *  - Criar:     POST  https://api.pagar.me/core/v5/orders
 *  - Consultar: GET   https://api.pagar.me/core/v5/orders/{id}
 *  - Fechar:    PATCH https://api.pagar.me/core/v5/orders/{id}/closed  { status: paid|canceled|failed }
 *  - Auth:      Authorization: Basic base64("<sk_ da loja>:")  +  header ServiceRefererName
 *               (id do PARCEIRO FireHub no Stone Partner Program; sem ele o
 *               pedido "pode não ser roteado" para as POS).
 *
 * Regras que vêm dos docs e mandam neste arquivo:
 *  - Pedido aberto NÃO expira e cada POS aceita no máximo 30 abertos. Todo
 *    pedido que nasce aqui tem que morrer aqui: fechado como "paid" depois do
 *    pagamento provado, ou "canceled" quando o cliente desiste/abandona.
 *  - Fechar o pedido NÃO estorna cobrança já aprovada. Por isso, depois de
 *    cancelar, quem chama reconsulta: o cartão pode ter passado no meio.
 *  - Não existe estorno pela API: é na própria POS ou no portal Stone.
 *  - "Obter pedido" é rota de resiliência e tem limite de consultas: a via
 *    principal é o webhook (charge.paid). Quem consulta em laço precisa
 *    espaçar (ver `podeConsultarAgora`).
 *
 * A secret key SEMPRE vem por parâmetro: a maquininha é da loja e o dinheiro
 * cai na conta dela. Nenhuma função lança para o chamador: erro volta como
 * { ok: false } com o motivo.
 */

export const STONE_API = "https://api.pagar.me/core/v5";

const TIMEOUT_MS = 15_000;

export type ResultadoStone<T> =
  | { ok: true; dados: T }
  | { ok: false; status: number; erro: string };

/** Tipos aceitos em payment_setup.type (pedido direto). */
export const TIPOS_DIRETOS = ["credit", "debit", "voucher", "pix"] as const;
export type TipoDireto = (typeof TIPOS_DIRETOS)[number];

export function ehTipoDireto(t: unknown): t is TipoDireto {
  return (TIPOS_DIRETOS as readonly string[]).includes(String(t));
}

/** Uma passada de cartão (charge) dentro do pedido. */
export interface CobrancaStone {
  id: string;
  status: string;             // paid | failed | canceled | pending | processing ...
  valorPagoCentavos: number;
  nsu?: string;               // data.code no charge = NSU da adquirente
  autorizacao?: string;
  bandeira?: string;
  tipo?: string;              // "Credit" | "Debit" | "Prepaid" | "pix" ...
  parcelas?: string;
  serial?: string;            // terminal_serial_number
}

export interface PedidoStone {
  id: string;                 // "or_..." — grava em CustomerOrder.posOrderId
  status: string;             // pending | paid | canceled | failed
  fechado: boolean;
  referencia?: string;        // o que NÓS mandamos em code / metadata.firehub_ref
  valorCentavos: number;
  criadoEm?: string;
  cobrancas: CobrancaStone[];
  /** Soma das cobranças com status "paid". */
  pagoCentavos: number;
  /** Pago com prova: cobranças pagas cobrem o valor do pedido. */
  pago: boolean;
  /** Teve tentativa recusada e nenhuma aprovada. */
  recusado: boolean;
  bruto: any;
}

/** O ServiceRefererName é do PARCEIRO (FireHub), não da loja. */
export function serviceRefererName(): string {
  return (process.env.STONE_CONNECT_SERVICE_REFERER_NAME || "").trim();
}

export function cabecalhosStone(chave: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${chave}:`).toString("base64")}`,
    ServiceRefererName: serviceRefererName(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function extrairErro(corpo: any, texto: string, status: number): string {
  if (corpo?.errors && typeof corpo.errors === "object") {
    // Pagar.me v5: { message, errors: { "campo": ["motivo"] } }
    const partes = Object.entries(corpo.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    if (partes.length) return `${corpo.message ? `${corpo.message} — ` : ""}${partes.join(" | ")}`;
  }
  if (corpo?.message) return String(corpo.message);
  return texto.slice(0, 500) || `HTTP ${status} sem corpo`;
}

async function chamarStone(
  caminho: string,
  init: { metodo: "GET" | "POST" | "PATCH"; chave: string; corpo?: any },
): Promise<ResultadoStone<any>> {
  if (!init.chave) return { ok: false, status: 0, erro: SEM_CHAVE };
  if (!serviceRefererName()) return { ok: false, status: 0, erro: SEM_PARCEIRO };

  let res: Response;
  let texto: string;
  try {
    res = await fetch(`${STONE_API}${caminho}`, {
      method: init.metodo,
      headers: cabecalhosStone(init.chave),
      body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    texto = await res.text();
  } catch (err: any) {
    const motivo =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `Stone não respondeu em ${TIMEOUT_MS / 1000}s`
        : `Falha de rede ao falar com a Stone: ${err?.message || err}`;
    console.error(`[Stone Connect] ${init.metodo} ${caminho} — ${motivo}`);
    return { ok: false, status: 0, erro: motivo };
  }

  let corpo: any = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }
  if (!res.ok) {
    console.error(`[Stone Connect] ${init.metodo} ${caminho} -> HTTP ${res.status}`, texto.slice(0, 2000));
    return { ok: false, status: res.status, erro: extrairErro(corpo, texto, res.status) };
  }
  if (texto && corpo === null) {
    console.error(`[Stone Connect] ${init.metodo} ${caminho} -> ${res.status} com corpo não-JSON`, texto.slice(0, 2000));
    return { ok: false, status: res.status, erro: "Stone respondeu em formato inesperado." };
  }
  return { ok: true, dados: corpo ?? {} };
}

const SEM_CHAVE = "Loja sem a chave da Stone (Connect) — cadastre em Totem > Maquininhas.";
const SEM_PARCEIRO =
  "Servidor sem STONE_CONNECT_SERVICE_REFERER_NAME (id de parceiro FireHub na Stone) — avise o suporte.";

function texto(v: unknown): string | undefined {
  return v == null || v === "" ? undefined : String(v);
}

function normalizarCobranca(c: any): CobrancaStone {
  const m = c?.metadata || {};
  return {
    id: String(c?.id ?? ""),
    status: String(c?.status ?? "").toLowerCase(),
    valorPagoCentavos: Math.round(Number(c?.paid_amount ?? (String(c?.status).toLowerCase() === "paid" ? c?.amount : 0)) || 0),
    nsu: texto(c?.code),
    autorizacao: texto(m.authorization_code ?? m.authorizationCode),
    bandeira: texto(m.scheme_name ?? m.schemeName),
    tipo: texto(m.account_funding_source ?? m.accountFundingSource ?? (String(c?.payment_method) === "pix" ? "pix" : undefined)),
    parcelas: texto(m.installment_quantity ?? m.installmentQuantity),
    serial: texto(m.terminal_serial_number ?? m.terminalSerialNumber),
  };
}

export function normalizarPedidoStone(d: any): PedidoStone {
  const cobrancas: CobrancaStone[] = Array.isArray(d?.charges) ? d.charges.map(normalizarCobranca) : [];
  const valorCentavos = Math.round(Number(d?.amount) || 0);
  const pagas = cobrancas.filter((c) => c.status === "paid");
  const pagoCentavos = pagas.reduce((s, c) => s + c.valorPagoCentavos, 0);
  // Pago = cobranças aprovadas cobrindo o valor. NÃO vale `order.status ===
  // "paid"` sozinho: fechar um pedido com o PATCH /closed sem status grava
  // "paid" por padrão, mesmo sem cartão nenhum — seria pagamento de mentira.
  const pago = pagas.length > 0 && valorCentavos > 0 && pagoCentavos >= valorCentavos;
  const recusado = !pago && pagas.length === 0 && cobrancas.some((c) => c.status === "failed");
  return {
    id: String(d?.id ?? ""),
    status: String(d?.status ?? "").toLowerCase(),
    fechado: d?.closed === true,
    referencia: texto(d?.metadata?.firehub_ref) ?? texto(d?.code),
    valorCentavos,
    criadoEm: texto(d?.created_at),
    cobrancas,
    pagoCentavos,
    pago,
    recusado,
    bruto: d,
  };
}

/** A cobrança aprovada que serve de comprovante (a maior, se forem várias). */
export function cobrancaAprovada(p: PedidoStone): CobrancaStone | null {
  const pagas = p.cobrancas.filter((c) => c.status === "paid");
  if (!pagas.length) return null;
  return pagas.sort((a, b) => b.valorPagoCentavos - a.valorPagoCentavos)[0];
}

/**
 * Pedido ainda vivo na POS: aberto e sem pagamento. Pedido recusado continua
 * aberto do lado da Stone — quem chama decide se derruba e manda outro.
 */
export function pedidoVivo(p: PedidoStone): boolean {
  return !p.fechado && !p.pago && !["canceled", "failed", "paid"].includes(p.status);
}

/** Corpo do POST /orders. Separado para o teste conferir sem rede. */
export function montarCorpoDoPedido(params: {
  serial: string;
  referencia: string;
  valorEmCentavos: number;
  descricao: string;
  nomeNaTela: string;
  nomeDoCliente?: string;
  tipo?: TipoDireto | null;
}): any {
  const { serial, referencia, valorEmCentavos, descricao, nomeNaTela, tipo } = params;
  const corpo: any = {
    // customer é obrigatório no Pagar.me v5. Cliente de totem/mesa é anônimo:
    // um e-mail fixo do FireHub evita criar um "customer" por venda com lixo.
    customer: {
      name: (params.nomeDoCliente || "Cliente FireHub").slice(0, 64),
      email: "cliente-maquininha@firehubfood.com.br",
    },
    items: [
      {
        amount: Math.round(valorEmCentavos),
        description: (descricao || "Pedido").slice(0, 256),
        quantity: 1,
        code: referencia.slice(0, 52),
      },
    ],
    closed: false,
    // Nossa referência vai em dois lugares: `code` (campo do pedido no
    // Pagar.me, máx. 52) e `metadata`. A reconsulta confere que o pedido da
    // Stone é deste pedido/mesa antes de dar baixa.
    code: referencia.slice(0, 52),
    metadata: { firehub_ref: referencia },
    poi_payment_settings: {
      visible: true,
      display_name: nomeNaTela.slice(0, 40),
      // A loja já imprime a comanda; a POS imprimir "nota" gastaria bobina.
      print_order_receipt: false,
      devices_serial_number: [serial],
    },
  };
  // Sem payment_setup = pedido LISTADO: aparece na lista da POS e quem está na
  // frente dela escolhe crédito/débito/pix. Com ele = pedido DIRETO: a POS já
  // abre a tela de pagamento naquele tipo. Qual dos dois a loja usa é definido
  // no credenciamento da Stone (por conta), por isso é configuração da loja.
  if (tipo) {
    corpo.poi_payment_settings.payment_setup = {
      type: tipo,
      installments: 1,
      installment_type: "merchant",
    };
  }
  return corpo;
}

export async function criarPedidoStone(params: {
  chave: string;
  serial: string;
  referencia: string;
  valorEmCentavos: number;
  descricao: string;
  nomeNaTela: string;
  nomeDoCliente?: string;
  tipo?: TipoDireto | null;
}): Promise<ResultadoStone<PedidoStone>> {
  if (!params.serial) return { ok: false, status: 0, erro: "Maquininha Stone sem número de série." };
  if (!params.referencia) return { ok: false, status: 0, erro: "Cobrança sem referência." };
  if (!Number.isFinite(params.valorEmCentavos) || Math.round(params.valorEmCentavos) <= 0) {
    return { ok: false, status: 0, erro: `Valor inválido para a maquininha: ${params.valorEmCentavos}` };
  }
  const r = await chamarStone("/orders", { metodo: "POST", chave: params.chave, corpo: montarCorpoDoPedido(params) });
  if (!r.ok) return r;
  const pedido = normalizarPedidoStone(r.dados);
  if (!pedido.id) {
    console.error("[Stone Connect] POST /orders sem id", JSON.stringify(r.dados).slice(0, 2000));
    return { ok: false, status: 200, erro: "A Stone aceitou o pedido mas não devolveu o id." };
  }
  return { ok: true, dados: pedido };
}

export async function consultarPedidoStone(chave: string, id: string): Promise<ResultadoStone<PedidoStone>> {
  if (!id) return { ok: false, status: 0, erro: "Pedido da Stone sem id." };
  marcarConsulta(id);
  const r = await chamarStone(`/orders/${encodeURIComponent(id)}`, { metodo: "GET", chave });
  if (!r.ok) return r;
  return { ok: true, dados: normalizarPedidoStone(r.dados) };
}

/**
 * Fecha o pedido. `canceled` tira da POS (em até ~1 min, ou no X vermelho);
 * `paid` é o fechamento obrigatório depois do pagamento confirmado — pedido
 * pago deixado aberto conta nos 30 da POS e ela para de mostrar pedidos novos.
 */
export async function fecharPedidoStone(
  chave: string,
  id: string,
  status: "canceled" | "paid" | "failed",
): Promise<ResultadoStone<PedidoStone>> {
  if (!id) return { ok: false, status: 0, erro: "Pedido da Stone sem id." };
  const r = await chamarStone(`/orders/${encodeURIComponent(id)}/closed`, { metodo: "PATCH", chave, corpo: { status } });
  if (!r.ok) return r;
  return { ok: true, dados: normalizarPedidoStone(r.dados) };
}

/**
 * Valida a chave sem efeito colateral: lista 1 pedido da conta. 401/403 é
 * chave errada; qualquer outra falha não prova nada sobre a chave.
 */
export async function testarChaveStone(chave: string): Promise<ResultadoStone<true>> {
  const r = await chamarStone("/orders?page=1&size=1", { metodo: "GET", chave });
  if (!r.ok) return r;
  return { ok: true, dados: true };
}

// ── Espaçar as consultas ────────────────────────────────────────────────────
// "Obter pedido" tem limite de consultas. A tela do totem pergunta o status a
// cada 2s; reconsultar a Stone em todas seria pedir para ser bloqueado. Em
// memória basta: o pior caso de um restart é UMA consulta a mais.
const ultimaConsulta = new Map<string, number>();

function marcarConsulta(id: string) {
  ultimaConsulta.set(id, Date.now());
  if (ultimaConsulta.size > 5000) {
    const limite = Date.now() - 10 * 60_000;
    for (const [k, t] of ultimaConsulta) if (t < limite) ultimaConsulta.delete(k);
  }
}

export function podeConsultarAgora(id: string, intervaloMs = 10_000): boolean {
  const t = ultimaConsulta.get(id);
  return !t || Date.now() - t >= intervaloMs;
}

/** Id de pedido Pagar.me/Stone ("or_...") — o do Point é "ORD01...". */
export function ehIdDePedidoStone(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("or_");
}

/** Minutos até um pedido aberto e não pago ser derrubado da POS. */
export const MINUTOS_ATE_ABANDONAR_TOTEM = 15;
export const MINUTOS_ATE_ABANDONAR_MESA = 30;

export function idadeEmMinutos(p: PedidoStone, agora = Date.now()): number {
  const t = p.criadoEm ? Date.parse(p.criadoEm) : NaN;
  return Number.isFinite(t) ? (agora - t) / 60_000 : 0;
}

/** Id do pedido ("or_...") e a referência que nós mandamos, se o corpo trouxer. */
export function pedidoDoEventoStone(corpo: any): { pedidoId: string | null; referencia: string | null; tipo: string } {
  const tipo = String(corpo?.type || "");
  const data = corpo?.data || {};
  if (tipo.startsWith("order.")) {
    return {
      pedidoId: data?.id ? String(data.id) : null,
      referencia: data?.metadata?.firehub_ref ? String(data.metadata.firehub_ref) : data?.code ? String(data.code) : null,
      tipo,
    };
  }
  const ordem = data?.order || {};
  return {
    pedidoId: ordem?.id ? String(ordem.id) : null,
    referencia: ordem?.metadata?.firehub_ref ? String(ordem.metadata.firehub_ref) : ordem?.code ? String(ordem.code) : null,
    tipo,
  };
}
