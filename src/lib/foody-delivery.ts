/**
 * FOODY DELIVERY (e a VOE DELIVERY, que é o mesmo sistema com outra marca):
 * a loja chama o motoboy terceirizado a partir do pedido do FireHub, sem
 * redigitar nada no painel da Foody.
 *
 * Pedido da Peperonata Pizzeria Napoletana (Criciúma, 15/10/2026): a loja usa a
 * Voe Delivery (voedelivery.entregas.io) e digitava cada entrega duas vezes.
 * A Voe roda na plataforma da Foody — o token que o lojista copia no painel
 * dele (Menu ➡ Minha Conta ➡ APIs e Hooks) fala com a mesma API.
 *
 * ── O QUE MORA AQUI ─────────────────────────────────────────────────────────
 *
 * Só regra, sem banco e sem rede: o JSON que vai para a Foody a partir do
 * pedido, o mapeamento de pagamento e de status, e QUANDO cada mudança de
 * status do FireHub vira uma chamada lá. É o que scripts/teste-foody-delivery.ts
 * testa. O HTTP fica em lib/foody-api.ts; o banco e o gatilho em
 * lib/foody-no-banco.ts.
 *
 * Referência: Foody Delivery API v1.2 (help.foodydelivery.com, lida em
 * 15/10/2026). Campos e valores conferidos no artigo; o header
 * `SoftwareCompanyPartnerToken` aparece só num exemplo do FAQ e não é exigido
 * pela especificação — não usamos.
 *
 * ── NUNCA INVENTAR ENDEREÇO ─────────────────────────────────────────────────
 *
 * O endereço sai da mesma régua do papel (lib/endereco-impresso.ts), que só
 * separa rua/número/bairro quando nenhuma palavra some nem aparece. Não
 * separou: vai o texto original no `address` (o único campo obrigatório), sem
 * coordenadas — a Foody exige rua, número, cidade e UF quando recebe o ponto,
 * e mandar o ponto com rua inventada é mandar o motoboy para o lugar errado.
 */
import { enderecoImpresso } from "@/lib/endereco-impresso";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { chaveDoCanal, canalDoPedido } from "@/lib/canal-do-pedido";
import { cobrancaNaEntrega, ehPagoOnline, formaCanonica } from "@/lib/pagamento-na-entrega";
import { pontoNoMapa, telefoneDoCliente, observacaoLimpa } from "@/lib/app-motoboy/pedido-no-app";
import { parseComboSelections } from "@/lib/parse-combo";
import { nomeDoItem } from "@/lib/nome-do-item";

// ── Tipos da API ────────────────────────────────────────────────────────────

export type StatusFoody =
  | "open" | "ready" | "dispatched" | "accepted" | "onGoing"
  | "delivered" | "closed" | "cancelled" | "rejected";

export type PagamentoFoody = "money" | "card" | "online" | "on_credit" | "pix" | "e_wallet";

export type PedidoFoody = {
  id: string;
  status: "open" | "ready";
  deliveryFee?: number;
  paymentMethod?: PagamentoFoody;
  notes?: string;
  orderTotal?: number;
  orderDetails?: string;
  date?: string;
  deliveryDueDate?: string;
  ifoodLocalizer?: string;
  deliveryPoint: {
    address: string;
    street?: string;
    houseNumber?: string;
    city?: string;
    region?: string;
    country?: string;
    postalCode?: string;
    complement?: string;
    coordinates?: { lat: number; lng: number };
  };
  customer?: { customerName?: string; customerPhone?: string; customerEmail?: string };
};

/** Quando a loja quer que o FireHub chame o motoboy sozinho. */
export type GatilhoFoody = "ACEITO" | "PRONTO" | "MANUAL";

export const GATILHOS: { valor: GatilhoFoody; rotulo: string }[] = [
  { valor: "ACEITO", rotulo: "Quando o pedido de entrega for aceito (a Foody já vê o pedido em preparo)" },
  { valor: "PRONTO", rotulo: "Quando o pedido ficar pronto (a Foody chama o motoboy para coletar)" },
  { valor: "MANUAL", rotulo: "Só quando eu clicar em \"Chamar motoboy\" no pedido" },
];

export function lerGatilho(v: unknown): GatilhoFoody {
  const s = String(v || "").toUpperCase();
  return s === "ACEITO" || s === "PRONTO" ? s : "MANUAL";
}

// ── Token ───────────────────────────────────────────────────────────────────

/**
 * O token como o lojista cola: às vezes com aspas, espaço, quebra de linha, ou
 * com o "Authorization:" do exemplo junto. A doc não mostra prefixo nenhum
 * (nem Bearer), então o que sobra depois da limpeza vai cru no header.
 */
export function normalizarToken(bruto: string | null | undefined): string | null {
  let t = String(bruto || "").trim();
  t = t.replace(/^authorization\s*:\s*/i, "").replace(/^bearer\s+/i, "");
  t = t.replace(/[\s"'`]/g, "");
  if (t.length < 16 || t.length > 512) return null;
  return t;
}

// ── Quem pode ir para a Foody ───────────────────────────────────────────────

/**
 * Só ENTREGA da própria loja. Retirada não tem motoboy, mesa também não, e o
 * pedido que o iFood/99 entrega com o entregador DELES já tem quem leve — a
 * regra de quem entrega é a mesma do painel e da comanda (lib/entrega-parceira.ts).
 * Pedido do iFood com entrega própria PODE ir: é a loja que leva.
 */
export function podeIrParaFoody(pedido: any): { pode: boolean; motivo?: string } {
  if (!pedido) return { pode: false, motivo: "Pedido não encontrado." };
  if (String(pedido.deliveryType || "").toUpperCase() !== "DELIVERY") {
    return { pode: false, motivo: "Só pedido de entrega chama motoboy." };
  }
  if (String(pedido.status || "").toUpperCase().startsWith("CANCEL")) {
    return { pode: false, motivo: "Pedido cancelado." };
  }
  const info = infoDaEntrega(pedido);
  if (info.parceira) {
    return { pode: false, motivo: `Este pedido é entregue pelo entregador do ${info.parceiro === "IFOOD" ? "iFood" : info.parceiro}.` };
  }
  if (!String(pedido.customerAddress || "").trim()) {
    return { pode: false, motivo: "Pedido sem endereço de entrega." };
  }
  return { pode: true };
}

/**
 * Pedido de canal da própria loja (site, robô, balcão): é o único que o
 * acompanhamento pode dar por ENTREGUE sozinho. Pedido de marketplace com
 * entrega própria fecha no parceiro pelo caminho de sempre (painel/app do
 * motoboy), que sabe avisar o iFood, o 99 e a Brendi.
 */
export function ehCanalDaLoja(pedido: any): boolean {
  return !canalDoPedido(pedido).ehMarketplace;
}

// ── O id que aparece no mapa da Foody ───────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * O `id` da Foody é texto de no máximo 10 caracteres e é o que o operador vê
 * no mapa dela. O número do dia (#123) sozinho repete todo dia, então vai com
 * o dia e o mês da loja: "123-1510". A partir da segunda tentativa no mesmo
 * pedido (a primeira foi cancelada ou recusada lá) entra uma letra: "123-1510B".
 *
 * Sem número do dia (pedido antigo, rascunho), o fim do id do pedido.
 */
export function idCurtoDoPedido(
  pedido: { id: string; dailyOrderNumber?: number | null; createdAt?: Date | string | null },
  fuso: string,
  tentativa = 1,
): string {
  const criado = pedido.createdAt ? new Date(pedido.createdAt) : new Date();
  const p = partesNoFuso(criado, fuso);
  const dia = `${pad2(p.dia)}${pad2(p.mes)}`;
  const letra = tentativa > 1 ? String.fromCharCode(64 + Math.min(tentativa, 26)) : "";
  const num = pedido.dailyOrderNumber != null && pedido.dailyOrderNumber > 0 ? String(pedido.dailyOrderNumber) : "";
  let id = num ? `${num}-${dia}${letra}` : "";
  if (!id || id.length > 10) {
    const cauda = String(pedido.id || "").replace(/[^A-Za-z0-9]/g, "").slice(-(10 - dia.length - letra.length));
    id = `${dia}${cauda}${letra}`;
  }
  return id.slice(0, 10);
}

// ── Datas no fuso da loja ───────────────────────────────────────────────────

function partesNoFuso(instante: Date, fuso: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso || "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const v: Record<string, number> = {};
  for (const parte of fmt.formatToParts(instante)) {
    if (parte.type !== "literal") v[parte.type] = Number(parte.value);
  }
  return { ano: v.year, mes: v.month, dia: v.day, hora: v.hour % 24, minuto: v.minute, segundo: v.second };
}

/**
 * `yyyy-MM-dd'T'HH:mm:ssXXX` no relógio da loja: "2026-10-15T21:30:01-03:00".
 * O deslocamento é calculado para AQUELE instante (fuso com horário de verão
 * muda o número ao longo do ano).
 */
export function dataFoody(instante: Date | string | number, fuso: string): string {
  const d = new Date(instante);
  const p = partesNoFuso(d, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const segundosInteiros = Math.floor(d.getTime() / 1000) * 1000;
  const minutos = Math.round((comoUtc - segundosInteiros) / 60000);
  const sinal = minutos < 0 ? "-" : "+";
  const abs = Math.abs(minutos);
  return `${p.ano}-${pad2(p.mes)}-${pad2(p.dia)}T${pad2(p.hora)}:${pad2(p.minuto)}:${pad2(p.segundo)}${sinal}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// ── Telefone ────────────────────────────────────────────────────────────────

/**
 * "+5548991234567". O 0800 com localizador do iFood não é telefone do cliente
 * (é a central do iFood): não vai — o localizador vai no campo próprio.
 * Número curto demais para ter DDD também não vai: a Foody discaria errado.
 */
export function telefoneFoody(bruto: string | null | undefined): string | undefined {
  const t = telefoneDoCliente(bruto);
  if (!t || t.discar.startsWith("0800")) return undefined;
  let d = t.discar.replace(/^0+/, "");
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith("55")) return undefined;
    return `+${d}`;
  }
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  return undefined;
}

/** O localizador de 8 dígitos do iFood ("0800... ID: 12345678"). */
export function localizadorIfood(bruto: string | null | undefined): string | undefined {
  const id = telefoneDoCliente(bruto)?.id;
  return id && /^\d{8}$/.test(id) ? id : undefined;
}

// ── Pagamento ───────────────────────────────────────────────────────────────

/**
 * A forma de pagamento como a Foody entende. A leitura do texto é a mesma do
 * papel e do app do motoboy (lib/pagamento-na-entrega.ts): pago online →
 * `online`; fiado → `on_credit`; o resto é o que o entregador recebe na porta.
 * Texto que não diz nada cai em `card` — a Foody mostra ao motoboy que há o
 * que cobrar, que é o lado seguro do erro (mesma regra de "na dúvida, cobra").
 */
export function pagamentoFoody(pedido: { paymentMethod?: string | null; gatewayPaymentId?: string | null; totalAmount?: number | null; deliveryType?: string | null }): PagamentoFoody {
  const texto = String(pedido.paymentMethod || "");
  if (/fiado|anotad|caderneta/i.test(texto)) return "on_credit";
  if (ehPagoOnline(pedido)) return "online";
  const forma = formaCanonica(texto);
  if (forma === "Dinheiro") return "money";
  if (forma === "Pix") return "pix";
  return "card";
}

const reais = (v: number) => `R$ ${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")}`;

// ── Itens em texto ──────────────────────────────────────────────────────────

/** "2x Pizza Margherita\n  + Borda de catupiry\n  Obs: sem cebola". */
export function itensEmTexto(itens: any[] | null | undefined): string {
  const linhas: string[] = [];
  for (const item of itens || []) {
    const qtd = Number(item?.quantity || 1);
    linhas.push(`${qtd}x ${nomeDoItem(item)}`);
    for (const sub of parseComboSelections(item?.comboSelections, 1)) {
      if (!sub?.name) continue;
      linhas.push(`  + ${sub.quantity > 1 ? `${sub.quantity}x ` : ""}${sub.name}`);
    }
    const obs = String(item?.notes || "").trim();
    if (obs) linhas.push(`  Obs: ${obs}`);
  }
  return linhas.join("\n").slice(0, 4000);
}

// ── UF da loja ──────────────────────────────────────────────────────────────

const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]);

/** A UF escrita no endereço da loja ("..., Criciúma - SC"), ou undefined. */
export function ufDoTexto(texto: string | null | undefined): string | undefined {
  const achados = String(texto || "").toUpperCase().match(/(?:^|[\s,\-\/])([A-Z]{2})(?=$|[\s,.\-\/]|\d)/g) || [];
  for (let i = achados.length - 1; i >= 0; i--) {
    const uf = achados[i].replace(/[^A-Z]/g, "");
    if (UFS.has(uf)) return uf;
  }
  return undefined;
}

// ── O pedido inteiro ────────────────────────────────────────────────────────

export type LojaParaFoody = {
  storeTimezone?: string | null;
  city?: string | null;
  storeAddress?: string | null;
};

/**
 * O JSON do POST /orders.
 *
 * `status`: "ready" quando o pedido já está pronto (a Foody despacha na hora),
 * "open" quando ainda está na cozinha (a Foody já vê e se programa).
 */
export function montarPedidoFoody(
  pedido: any,
  loja: LojaParaFoody,
  opcoes: { status: "open" | "ready"; tentativa?: number },
): PedidoFoody {
  const fuso = loja.storeTimezone || "America/Sao_Paulo";
  const e = enderecoImpresso(pedido, { cidadeDaLoja: loja.city });
  const de = (r: string) => e.linhas.find((l) => l.rotulo === r)?.valor;

  const rua = de("Rua");
  const numero = de("Número");
  const bairro = de("Bairro");
  const cidade = de("Cidade") || (e.separado ? loja.city || undefined : undefined);
  const cep = de("CEP");
  const complemento = [de("Complemento"), de("Referência") ? `Ref: ${de("Referência")}` : ""].filter(Boolean).join(" - ");

  // `address`: logradouro, número, bairro — como a doc pede. Sem separação,
  // o texto como o cliente escreveu (melhor que nada inventado).
  const address = e.separado && rua
    ? [numero ? `${rua}, ${numero}` : rua, bairro].filter(Boolean).join(" - ")
    : e.original;

  const deliveryPoint: PedidoFoody["deliveryPoint"] = { address: address.slice(0, 300), country: "BR" };
  if (e.separado && rua) deliveryPoint.street = rua;
  if (e.separado && numero) deliveryPoint.houseNumber = numero;
  if (cidade) deliveryPoint.city = cidade;
  const uf = ufDoTexto(loja.storeAddress);
  if (uf) deliveryPoint.region = uf;
  if (cep) {
    const d = cep.replace(/\D/g, "");
    if (d.length === 8) deliveryPoint.postalCode = `${d.slice(0, 5)}-${d.slice(5)}`;
  }
  if (complemento) deliveryPoint.complement = complemento.slice(0, 200);

  // O ponto só vai quando a Foody aceita (rua, número, cidade e UF juntos) e
  // quando é a porta do cliente — centro de bairro não serve para entregar.
  const ponto = pontoNoMapa(pedido.customerLatLng);
  if (ponto && !ponto.aproximado && deliveryPoint.street && deliveryPoint.houseNumber && deliveryPoint.city && deliveryPoint.region) {
    deliveryPoint.coordinates = { lat: ponto.lat, lng: ponto.lng };
  }

  // ── Observação para o entregador: o que cobrar, troco, e a nota do cliente.
  const cobranca = cobrancaNaEntrega(pedido);
  const notas: string[] = [];
  const canal = canalDoPedido(pedido);
  if (canal.ehMarketplace) notas.push(`${canal.nome}${canal.referencia ? ` #${canal.referencia}` : ""}`);
  if (cobranca.cobrar) {
    notas.push(`COBRAR ${reais(cobranca.valor)} (${cobranca.metodo})`);
    if (cobranca.trocoPara) notas.push(`Troco para ${reais(cobranca.trocoPara)} — levar ${reais(cobranca.levarDeTroco || 0)}`);
  } else if (pagamentoFoody(pedido) === "online") {
    notas.push("PAGO — não cobrar");
  }
  const obs = observacaoLimpa(pedido.notes);
  if (obs) notas.push(obs);

  const corpo: PedidoFoody = {
    id: idCurtoDoPedido(pedido, fuso, opcoes.tentativa ?? 1),
    status: opcoes.status,
    deliveryFee: arred(Number(pedido.deliveryFee || 0)),
    paymentMethod: pagamentoFoody(pedido),
    orderTotal: arred(Number(pedido.totalAmount || 0)),
    orderDetails: itensEmTexto(pedido.items),
    date: dataFoody(pedido.createdAt || new Date(), fuso),
    deliveryPoint,
  };
  if (notas.length) corpo.notes = notas.join(" | ").slice(0, 1000);

  const prazo = prazoDaEntrega(pedido);
  if (prazo) corpo.deliveryDueDate = dataFoody(prazo, fuso);

  if (chaveDoCanal(pedido) === "IFOOD") {
    const loc = localizadorIfood(pedido.customerPhone);
    if (loc) corpo.ifoodLocalizer = loc;
  }

  const customer: NonNullable<PedidoFoody["customer"]> = {};
  const nome = String(pedido.customerName || "").trim();
  if (nome) customer.customerName = nome.slice(0, 120);
  const fone = telefoneFoody(pedido.customerPhone);
  if (fone) customer.customerPhone = fone;
  if (Object.keys(customer).length) corpo.customer = customer;

  return corpo;
}

const arred = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

/** Agendado: a hora marcada. Senão, o tempo de entrega prometido, se houver. */
function prazoDaEntrega(pedido: any): Date | null {
  if (pedido.scheduledDatetime && pedido.agendado) return new Date(pedido.scheduledDatetime);
  const min = Number(pedido.tempoEntregaMin || 0);
  if (min > 0 && pedido.createdAt) return new Date(new Date(pedido.createdAt).getTime() + min * 60000);
  return null;
}

// ── Status ──────────────────────────────────────────────────────────────────

export const ROTULO_DO_STATUS: Record<StatusFoody, string> = {
  open: "Aguardando o pedido ficar pronto",
  ready: "Pronto — procurando motoboy",
  dispatched: "Oferecido aos motoboys",
  accepted: "Motoboy a caminho da loja",
  onGoing: "Saiu para entrega",
  delivered: "Entregue",
  closed: "Encerrado",
  cancelled: "Cancelado",
  rejected: "Recusado pela Foody",
};

export function rotuloDoStatus(status: string | null | undefined): string {
  return ROTULO_DO_STATUS[status as StatusFoody] || (status ? String(status) : "Enviando…");
}

/** Ainda em curso: o acompanhamento continua perguntando à Foody. */
export const STATUS_EM_ANDAMENTO: StatusFoody[] = ["open", "ready", "dispatched", "accepted", "onGoing"];

export function emAndamento(status: string | null | undefined): boolean {
  return STATUS_EM_ANDAMENTO.includes(status as StatusFoody);
}

/** Acabou lá sem entregar: pode chamar de novo. */
export function podeChamarDeNovo(status: string | null | undefined): boolean {
  return status === "cancelled" || status === "rejected";
}

const STATUS_ACEITO = new Set(["CONFIRMADO", "ACEITO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO"]);
const STATUS_PRONTO = new Set(["PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA"]);
const STATUS_CANCELADO = new Set(["CANCELADO", "CANCELLED", "CANCELED"]);

export type AcaoNaFoody = "CRIAR_OPEN" | "CRIAR_READY" | "MARCAR_READY" | "CANCELAR" | null;

/**
 * O que fazer na Foody quando o status do pedido muda no FireHub.
 *
 *   - Gatilho ACEITO: entrou em produção → cria `open`; ficou pronto → a
 *     entrega que já existe vira `ready` (é o sinal para o motoboy vir).
 *   - Gatilho PRONTO: ficou pronto → cria já `ready`.
 *   - MANUAL: nunca cria sozinho, mas a entrega que o lojista chamou com o
 *     pedido ainda na cozinha (open) também vira `ready` quando ele fica pronto.
 *   - Cancelou no FireHub: a entrega em curso é cancelada lá. A Foody só
 *     aceita `updatestatus` em open/ready — depois disso o cancelamento é com
 *     o operador da Foody, e quem chama avisa.
 *
 * "Saiu para entrega" conta como pronto: há loja que pula o PRONTO.
 */
export function acaoDoStatus(
  statusFireHub: string | null | undefined,
  gatilho: GatilhoFoody,
  entrega: { status?: string | null } | null,
): AcaoNaFoody {
  const s = String(statusFireHub || "").toUpperCase();
  const temEntrega = Boolean(entrega) && !podeChamarDeNovo(entrega?.status);
  if (STATUS_CANCELADO.has(s)) {
    return temEntrega && emAndamento(entrega?.status) ? "CANCELAR" : null;
  }
  if (STATUS_PRONTO.has(s)) {
    if (temEntrega) return entrega?.status === "open" ? "MARCAR_READY" : null;
    // Só a PRIMEIRA chamada é automática: entrega cancelada ou recusada lá
    // volta pela mão do lojista, que sabe por que caiu.
    if (entrega) return null;
    // Gatilho ACEITO também cria aqui: o pedido que pulou a produção (ou cuja
    // chamada no aceite falhou) não pode ficar sem motoboy.
    return gatilho === "PRONTO" || gatilho === "ACEITO" ? "CRIAR_READY" : null;
  }
  if (STATUS_ACEITO.has(s)) {
    if (entrega) return null;
    return gatilho === "ACEITO" ? "CRIAR_OPEN" : null;
  }
  return null;
}

/** O status com que a chamada MANUAL cria a entrega, pelo status do pedido agora. */
export function statusDaChamadaManual(statusFireHub: string | null | undefined): "open" | "ready" {
  return STATUS_PRONTO.has(String(statusFireHub || "").toUpperCase()) ? "ready" : "open";
}

/** Status que entra no gatilho (para a extensão do Prisma não acordar à toa). */
export function statusInteressaAFoody(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const s = status.toUpperCase();
  return STATUS_ACEITO.has(s) || STATUS_PRONTO.has(s) || STATUS_CANCELADO.has(s);
}

// ── Resposta da Foody ───────────────────────────────────────────────────────

export type EntregaLida = {
  uid: string | null;
  status: StatusFoody | null;
  orderTrackerUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
};

/** Lê o que importa de qualquer resposta de pedido da Foody (POST, GET). */
export function lerEntregaDaResposta(dados: any): EntregaLida {
  const d = dados && typeof dados === "object" ? dados : {};
  const status = typeof d.status === "string" ? (d.status as StatusFoody) : null;
  const url = typeof d.orderTrackerUrl === "string" && /^https?:\/\//i.test(d.orderTrackerUrl) ? d.orderTrackerUrl : null;
  return {
    uid: d.uid ? String(d.uid) : null,
    status,
    orderTrackerUrl: url,
    courierName: d.courier?.courierName ? String(d.courier.courierName).slice(0, 120) : null,
    courierPhone: d.courier?.courierPhone ? String(d.courier.courierPhone).slice(0, 40) : null,
  };
}

/** O formato de `checkupdates`: [{ uid, updateDate, status }]. */
export function lerAtualizacoes(dados: unknown): { uid: string; status: StatusFoody; updateDate: string | null }[] {
  if (!Array.isArray(dados)) return [];
  const saida: { uid: string; status: StatusFoody; updateDate: string | null }[] = [];
  for (const r of dados) {
    if (!r || typeof r !== "object") continue;
    const uid = (r as any).uid;
    const status = (r as any).status;
    if (!uid || typeof status !== "string") continue;
    saida.push({ uid: String(uid), status: status as StatusFoody, updateDate: (r as any).updateDate ? String((r as any).updateDate) : null });
  }
  return saida;
}
