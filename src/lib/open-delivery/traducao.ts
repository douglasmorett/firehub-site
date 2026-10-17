/**
 * lib/open-delivery/traducao.ts — pedido Open Delivery → dados do CustomerOrder.
 *
 * A BASE Open Delivery do FireHub. Função pura: não lê banco, não chama rede,
 * não sorteia id. Quem grava é `lib/open-delivery/gravar.ts`.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * JotaJá e Brendi falam o mesmo contrato (Abrasel), mas foram escritos como
 * CÓPIAS um do outro (processJotajaEvent.ts → processBrendiEvent.ts), com a
 * tradução, a gravação e o status no mesmo arquivo de 1.400 linhas. Cada
 * conserto feito num ficava pendente no outro: o número do dia fora da
 * transação, o espelho com o nome do primeiro pedido, a opção lida só da
 * primeira lista. A Keeta é o primeiro canal que nasce daqui; o JotaJá e a
 * Brendi migram depois, um de cada vez, com o teste do tradutor provando que
 * nada mudou.
 *
 * ── O que esta base já nasce cumprindo (checklist em Projetos/FireHub.md) ──
 *
 *   - Espelho com nome BASE e id com a LOJA (`<canal>-<loja>-<item>`): o id de
 *     catálogo de um parceiro pode repetir entre lojas, e o `brendi-<id>` sem a
 *     loja deixaria uma loja conectar no produto da outra.
 *   - Opções de TODAS as listas, sem preço inventado: opção sem preço vale 0.
 *   - Quantidade de opção somada (repetição + campo).
 *   - Preço da opção gravado como UNITÁRIO (o iFood/99 gravam a linha e os
 *     relatórios multiplicaram de novo — preco-da-opcao-do-ifood-e-da-linha).
 *   - Mesa é MESA (INDOOR), retirada é RETIRADA, agendado tem prazo próprio.
 *   - Pagamento por mapa explícito: forma desconhecida é "Não informado", nunca
 *     "Cartão" (o caixa e a NFC-e leem o texto). Pago online só quando NADA
 *     está pendente.
 *   - Desconto com dono (loja × plataforma) pelos `sponsorshipValues`.
 *   - Total conferido contra a soma das partes: divergência vira AVISO, não
 *     conta inventada.
 *   - Endereço no formato que os relatórios já leem
 *     (`rua, nº - Comp: x - Ref: y - Bairro - Cidade`, lib/relatorios/areas-de-entrega.ts).
 */
import { isBeverageName } from "@/lib/beverage";
import { coordenadasDoParceiro } from "@/lib/coordenadas-do-parceiro";
import { dataHoraDaLoja } from "@/lib/fuso";

// ── Contrato (o que o Open Delivery 1.x declara; o resto é tolerado) ─────────

export type ValorOD = number | string | { value?: number | string | null; currency?: string | null } | null | undefined;

export type OpcaoOD = {
  id?: string | null;
  index?: number | null;
  name?: string | null;
  externalCode?: string | null;
  quantity?: number | string | null;
  unitPrice?: ValorOD;
  totalPrice?: ValorOD;
  specialInstructions?: string | null;
  options?: OpcaoOD[] | null;
  [k: string]: unknown;
};

export type ItemOD = OpcaoOD & {
  unit?: string | null;
  optionsPrice?: ValorOD;
};

export type PedidoOD = {
  id?: string | null;
  type?: string | null;
  displayId?: string | number | null;
  createdAt?: string | null;
  orderTiming?: string | null;
  preparationStartDateTime?: string | null;
  merchant?: { id?: string | null; name?: string | null } | null;
  items?: ItemOD[] | null;
  otherFees?: Array<{ name?: string | null; type?: string | null; receivedBy?: string | null; price?: ValorOD }> | null;
  discounts?: Array<{
    value?: ValorOD;
    amount?: ValorOD;
    target?: string | null;
    targetId?: string | null;
    sponsorshipValues?: Array<{ name?: string | null; value?: ValorOD; amount?: ValorOD; discountCode?: string | null }> | null;
    [k: string]: unknown;
  }> | null;
  total?: { itemsPrice?: ValorOD; otherFees?: ValorOD; discount?: ValorOD; orderAmount?: ValorOD } | null;
  payments?: {
    prepaid?: ValorOD;
    pending?: ValorOD;
    methods?: Array<{
      value?: ValorOD;
      currency?: string | null;
      type?: string | null;
      method?: string | null;
      brand?: string | null;
      methodInfo?: string | null;
      changeFor?: ValorOD;
      [k: string]: unknown;
    }> | null;
  } | null;
  customer?: {
    id?: string | null;
    name?: string | null;
    documentNumber?: string | null;
    phone?: { number?: string | null; extension?: string | null; localizer?: string | null } | string | null;
  } | null;
  schedule?: { scheduledDateTimeStart?: string | null; scheduledDateTimeEnd?: string | null } | null;
  delivery?: {
    deliveredBy?: string | null;
    pickupCode?: string | null;
    estimatedDeliveryDateTime?: string | null;
    deliveryDateTime?: string | null;
    deliveryAddress?: Record<string, any> | null;
    [k: string]: unknown;
  } | null;
  takeout?: { mode?: string | null; takeoutDateTime?: string | null } | null;
  indoor?: { mode?: string | null; place?: string | null; indoorDateTime?: string | null } | null;
  extraInfo?: string | null;
  [k: string]: unknown;
};

/** Quem é o canal: a base serve a todos, o canal só empresta nome e prefixo. */
export type CanalOD = {
  /** Gravado em `source` e `openDeliveryChannel` — o que lib/canal-do-pedido.ts lê. */
  chave: string;
  /** Como o lojista lê: "Keeta". */
  nome: string;
  /** Prefixo do espelho e do id do pedido: "keeta". */
  prefixo: string;
};

export type ContextoOD = {
  lojaId: string;
  fuso: string;
  autoAcceptOrders: boolean;
  canal: CanalOD;
  /** Para teste: o relógio de quando o pedido chegou. */
  agora?: Date;
};

export type EspelhoOD = { id: string; nome: string };

export type TraducaoOD = {
  dados: Record<string, any>;
  items: any[];
  /** Espelhos usados — o gravador corrige o nome dos que já existem. */
  espelhos: EspelhoOD[];
  /**
   * O que não fechou e o lojista (ou nós) precisa saber: total que não bate,
   * forma de pagamento desconhecida, item sem preço. Vai para o log e para o
   * payload cru; nunca muda a conta.
   */
  avisos: string[];
};

// ── Leitores pequenos ────────────────────────────────────────────────────────

const centavos = (n: number) => Math.round(n * 100);
export const reais = (n: number) => Math.round(n * 100) / 100;
export const texto = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * Texto que pode vir CIFRADO. A Keeta manda telefone, bairro, número,
 * complemento e endereço formatado com prefixo `ENC_` e só decifra (batchDecrypt)
 * na entrega da LOJA. O que continuou cifrado não vai para a comanda: "ENC_#MQ…"
 * no lugar do bairro é pior que bairro nenhum.
 */
export const claro = (v: unknown) => {
  const t = texto(v);
  return t.startsWith("ENC_") ? "" : t;
};

/**
 * O valor de um preço Open Delivery: número, texto numérico ou `{ value }`.
 * Booleano NÃO é preço — a Brendi manda `addition: true` onde outros mandam
 * valor, e `Number(true)` virou "+R$ 1,00" na comanda (19/09/2026).
 */
export function valor(p: ValorOD | unknown): number {
  const bruto = typeof p === "object" && p !== null ? (p as any).value : p;
  if (typeof bruto === "boolean" || bruto === "" || bruto == null) return 0;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 0;
}

/** Tem valor de verdade (para distinguir "não veio" de "veio zero"). */
function veio(p: ValorOD | unknown): boolean {
  const bruto = typeof p === "object" && p !== null ? (p as any).value : p;
  return bruto !== undefined && bruto !== null && bruto !== "" && typeof bruto !== "boolean" && Number.isFinite(Number(bruto));
}

function quantidade(v: unknown, padrao = 1): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function data(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

// ── Opções ───────────────────────────────────────────────────────────────────

/** Os nomes de lista que os originadores usam — todas são lidas (nunca a primeira só). */
const LISTAS_DE_OPCAO = ["options", "subItems", "garnishItems", "choices", "additions", "customizations", "toppings"] as const;

export type OpcaoLida = { id: string; nome: string; quantidade: number; precoUnitario: number; observacao: string | null };

/**
 * As opções de um item, achatadas e somadas.
 *
 * - Lê TODAS as listas: o bacon extra em `additions` ao lado da escolha em
 *   `options` sumia quando só a primeira era lida (Brendi, 19/09/2026).
 * - Opção com filhas entra pelas filhas (é o grupo "Molhos", não uma escolha).
 * - A mesma opção repetida soma a quantidade: "3x Esfiha Carne" em vez de três
 *   linhas iguais (Wabiz, 22/09/2026).
 * - Preço UNITÁRIO: `unitPrice`; sem ele, `totalPrice ÷ quantidade`. O Open
 *   Delivery declara `totalPrice = unitPrice × quantity`, e quem grava a linha
 *   no lugar do unitário faz os relatórios multiplicarem duas vezes.
 */
export function opcoesDoItem(item: OpcaoOD): OpcaoLida[] {
  const saida: OpcaoLida[] = [];
  const vistos = new Set<unknown>();

  const visitar = (o: OpcaoOD, multiplicador: number) => {
    if (!o || typeof o !== "object" || vistos.has(o)) return;
    vistos.add(o);
    const filhas = LISTAS_DE_OPCAO.flatMap((c) => (Array.isArray((o as any)[c]) ? ((o as any)[c] as OpcaoOD[]) : []));
    const qtd = quantidade(o.quantity);
    if (filhas.length > 0) {
      for (const f of filhas) visitar(f, multiplicador * qtd);
      return;
    }
    const nome = texto(o.name);
    if (!nome) return;
    const q = qtd * multiplicador;
    const unit = veio(o.unitPrice) ? valor(o.unitPrice) : veio(o.totalPrice) ? valor(o.totalPrice) / qtd : 0;
    const id = texto(o.id) || texto(o.externalCode) || slug(nome);
    const igual = saida.find((s) => s.id === id && s.nome === nome && centavos(s.precoUnitario) === centavos(unit));
    if (igual) {
      igual.quantidade += q;
      return;
    }
    saida.push({ id, nome, quantidade: q, precoUnitario: reais(unit), observacao: texto(o.specialInstructions) || null });
  };

  for (const lista of LISTAS_DE_OPCAO) {
    const ops = (item as any)?.[lista];
    if (Array.isArray(ops)) for (const o of ops) visitar(o, 1);
  }
  return saida;
}

// ── Pagamento ────────────────────────────────────────────────────────────────

/**
 * O nome de cada `method` do Open Delivery. O que não está aqui é "Não
 * informado" — o rótulo que o caixa (não identificado), o relatório e a NFC-e
 * (pede a forma antes de emitir) já entendem. "Cartão" como padrão foi o que
 * pôs pedido de forma desconhecida no crédito da maquininha.
 */
const NOME_DO_METODO: Record<string, string> = {
  CASH: "Dinheiro",
  CREDIT: "Crédito",
  DEBIT: "Débito",
  CREDIT_DEBIT: "Cartão",
  MEAL_VOUCHER: "Vale Refeição",
  FOOD_VOUCHER: "Vale Alimentação",
  PIX: "Pix",
  DIGITAL_WALLET: "Carteira digital",
  COUPON: "Cupom",
  REDEEM: "Resgate",
  PREPAID_REDEEM: "Resgate",
  OTHER: "Outro",
  // Fora do Open Delivery, mas formas reais do CardápioWeb (lib/cardapioweb/
  // traducao.ts). "Fiado" é a palavra que o caixa lê como fiado
  // (lib/relatorios/formas-de-pagamento.ts, formaDoTexto).
  BANK_TRANSFER: "Transferência",
  BANK_SLIP: "Boleto",
  PICPAY: "PicPay",
  DEBT_BOOK: "Fiado",
};

export type PagamentoLido = {
  /** Texto gravado em `paymentMethod`: "Pix (Pago Online)", "Dinheiro (Cobrar na Entrega)". */
  paymentMethod: string;
  pagoOnline: boolean;
  /** Nota com que o cliente paga em dinheiro (troco para), quando faz sentido. */
  changeAmount: number | null;
  /** O que foi pago no app, quando parte é cobrada na porta — vai para a observação. */
  parteOnline: number;
  avisos: string[];
};

/**
 * Pago online só quando NADA fica pendente. Na dúvida, cobra: comanda "Pago"
 * de pedido que ninguém pagou é prejuízo da loja; o contrário é uma pergunta do
 * motoboy. Mesmo raciocínio da Wabiz e da Brendi (onde `PREPAID` sozinho não
 * provou pagamento — 05/09/2026).
 */
export function lerPagamento(pedido: PedidoOD, totalDoPedido: number, nomeDoCanal: string): PagamentoLido {
  const avisos: string[] = [];
  const pag = pedido.payments || {};
  const metodos = Array.isArray(pag.methods) ? pag.methods.filter(Boolean) : [];

  const online = metodos.filter((m) => texto(m.type).toUpperCase() === "PREPAID");
  const naPorta = metodos.filter((m) => texto(m.type).toUpperCase() !== "PREPAID");
  const pendente = veio(pag.pending) ? valor(pag.pending) : naPorta.reduce((s, m) => s + valor(m.value), 0);

  const nomeDe = (m: (typeof metodos)[number]) => {
    const chave = texto(m.method).toUpperCase();
    const nome = NOME_DO_METODO[chave];
    if (!nome) {
      avisos.push(`forma de pagamento desconhecida: "${texto(m.method) || "(vazia)"}"`);
      return "Não informado";
    }
    const bandeira = texto(m.brand);
    return bandeira && /Crédito|Débito|Cartão/.test(nome) ? `${nome} ${bandeira}` : nome;
  };

  if (metodos.length === 0) {
    avisos.push("pedido sem forma de pagamento");
    return { paymentMethod: "Não informado", pagoOnline: false, changeAmount: null, parteOnline: 0, avisos };
  }

  const tudoOnline = naPorta.length === 0 && pendente <= 0.009;
  if (tudoOnline) {
    const nomes = Array.from(new Set(online.map(nomeDe)));
    // "Não informado (Pago Online)" diria que o caixa sabe a forma; não sabe.
    // Pago no app é o que importa ao caixa: o nome do canal basta.
    const rotulo = nomes.every((n) => n === "Não informado") ? `${nomeDoCanal} App` : nomes.join(" + ");
    return { paymentMethod: `${rotulo} (Pago Online)`, pagoOnline: true, changeAmount: null, parteOnline: 0, avisos };
  }

  const nomes = Array.from(new Set(naPorta.map(nomeDe)));
  const desconhecida = nomes.every((n) => n === "Não informado");
  // Troco: só em dinheiro e só quando a nota é MAIOR que o que se cobra (a
  // Brendi mandava o próprio valor como "troco para" e a comanda saía
  // "Troco p/ R$ 58,99" num pedido de R$ 58,99).
  let changeAmount: number | null = null;
  for (const m of naPorta) {
    if (texto(m.method).toUpperCase() !== "CASH") continue;
    const nota = valor(m.changeFor);
    const cobrado = valor(m.value) || pendente || totalDoPedido;
    if (nota > cobrado + 0.009) changeAmount = reais((changeAmount || 0) + nota);
  }
  const parteOnline = reais(online.reduce((s, m) => s + valor(m.value), 0));
  return {
    // Sem forma conhecida fica só "Não informado", sem parêntese: o "(Cobrar…)"
    // faria o caixa ler uma forma que ninguém disse qual é.
    paymentMethod: desconhecida ? "Não informado" : `${nomes.join(" + ")} (Cobrar na Entrega)`,
    pagoOnline: false,
    changeAmount,
    parteOnline,
    avisos,
  };
}

// ── Descontos ────────────────────────────────────────────────────────────────

export type DescontoLido = {
  total: number;
  loja: number;
  plataforma: number;
  detalhes: Array<{ target: string; value: number; merchant: number; platform: number; description: string | null }>;
};

/**
 * Cada real de desconto tem dono. `sponsorshipValues[].name` MERCHANT é da
 * loja; o resto (MARKETPLACE, LOGISTIC_SERVICES) é da plataforma. Sem
 * patrocínio declarado, é da loja — é a leitura que não infla o repasse.
 * O código do cupom vira a descrição SEM porcentagem: "Cupom X (-12%)"
 * calculado por pedido picava o mesmo cupom em 14 linhas no relatório.
 */
export function lerDescontos(pedido: PedidoOD): DescontoLido {
  const lista = Array.isArray(pedido.discounts) ? pedido.discounts.filter(Boolean) : [];
  const out: DescontoLido = { total: 0, loja: 0, plataforma: 0, detalhes: [] };
  for (const d of lista) {
    const v = valor(d.value ?? d.amount);
    const patrocinios = Array.isArray(d.sponsorshipValues) ? d.sponsorshipValues.filter(Boolean) : [];
    let loja = 0;
    let plataforma = 0;
    let codigo = "";
    for (const sp of patrocinios) {
      const quanto = valor(sp.value ?? sp.amount);
      // CHAIN é a rede/franquia da loja: sai do bolso do lado do lojista.
      if (["MERCHANT", "CHAIN"].includes(texto(sp.name).toUpperCase())) loja += quanto;
      else plataforma += quanto;
      if (!codigo && texto(sp.discountCode)) codigo = texto(sp.discountCode).toUpperCase();
    }
    if (patrocinios.length === 0) loja = v;
    out.total += v;
    out.loja += loja;
    out.plataforma += plataforma;
    out.detalhes.push({
      target: texto(d.target) || "CART",
      value: reais(v),
      merchant: reais(loja),
      platform: reais(plataforma),
      description: codigo ? `Cupom ${codigo}` : null,
    });
  }
  out.total = reais(out.total);
  out.loja = reais(out.loja);
  out.plataforma = reais(out.plataforma);
  return out;
}

// ── Endereço ─────────────────────────────────────────────────────────────────

/**
 * `rua, nº - Comp: x - Ref: y - Bairro - Cidade` — o formato do iFood, que
 * `bairroDoEndereco` (lib/relatorios/areas-de-entrega.ts) já sabe ler: a
 * última parte é a cidade, a anterior o bairro. Aceita as duas grafias que já
 * vimos: a da spec (`streetName`/`streetNumber`/`neighborhood`) e a real da
 * Brendi (`street`/`number`/`district`) — a comanda saía sem bairro quando só
 * uma era lida (05/09/2026).
 */
export function enderecoDoPedido(addr: Record<string, any> | null | undefined): string {
  if (!addr || typeof addr !== "object") return "";
  const rua = claro(addr.street ?? addr.streetName);
  const numero = claro(addr.number ?? addr.streetNumber);
  const complemento = claro(addr.complement);
  const referencia = claro(addr.reference);
  const bairro = claro(addr.district ?? addr.neighborhood);
  const cidade = claro(addr.city);
  const formatado = claro(addr.formattedAddress);
  const via = rua ? `${rua}${numero ? `, ${numero}` : ""}` : formatado;
  const partes = [
    via,
    complemento ? `Comp: ${complemento}` : "",
    referencia ? `Ref: ${referencia}` : "",
    bairro && !via.toLowerCase().includes(bairro.toLowerCase()) ? bairro : "",
    cidade,
  ].filter(Boolean);
  return partes.join(" - ");
}

// ── Tipo do pedido e prazo ───────────────────────────────────────────────────

export function tipoDoPedido(pedido: PedidoOD): "DELIVERY" | "RETIRADA" | "MESA" {
  const t = texto(pedido.type).toUpperCase();
  if (t === "DELIVERY") return "DELIVERY";
  if (t === "TAKEOUT" || t === "TOGO" || t === "PICKUP") return "RETIRADA";
  // ── MESA É MESA ───────────────────────────────────────────────────────────
  // Na Wabiz o pedido feito na mesa virava retirada, e o cliente sentado
  // recebia "pode retirar" no WhatsApp (22/09/2026).
  if (t === "INDOOR" || t === "DINE_IN" || t === "TABLE") return "MESA";
  // Tipo ausente: o objeto que veio decide; nada → entrega (pior caso: sai com
  // endereço vazio e o lojista vê; o contrário perde o motoboy).
  if (pedido.indoor) return "MESA";
  if (pedido.takeout && !pedido.delivery) return "RETIRADA";
  return "DELIVERY";
}

/**
 * Quando o cliente espera RECEBER. Agendado: o início da janela. Imediato: o
 * que o parceiro prometeu, se for plausível (mais de 5 min depois do pedido);
 * senão 50 min na entrega e 40 na retirada — a mesma régua dos outros canais.
 */
export function prazoDoPedido(pedido: PedidoOD, tipo: string, criadoEm: Date): { prazo: Date; agendado: boolean } {
  const agenda = pedido.schedule || {};
  const inicio = data(agenda.scheduledDateTimeStart) || data(agenda.scheduledDateTimeEnd);
  const agendado = texto(pedido.orderTiming).toUpperCase() === "SCHEDULED" || !!inicio;
  if (agendado && inicio) return { prazo: inicio, agendado: true };
  const plausivel = (v: unknown) => {
    const d = data(v);
    return d && d.getTime() > criadoEm.getTime() + 5 * 60_000 ? d : null;
  };
  const prometido =
    tipo === "DELIVERY"
      ? plausivel(pedido.delivery?.estimatedDeliveryDateTime) || plausivel(pedido.delivery?.deliveryDateTime)
      : tipo === "RETIRADA"
      ? plausivel(pedido.takeout?.takeoutDateTime)
      : plausivel(pedido.indoor?.indoorDateTime);
  return {
    prazo: prometido || new Date(criadoEm.getTime() + (tipo === "DELIVERY" ? 50 : 40) * 60_000),
    agendado,
  };
}

// ── A tradução ───────────────────────────────────────────────────────────────

/** O id que vai em `openDeliveryOrderId`: único no banco inteiro, então com o prefixo do canal. */
export function idDoPedidoNoBanco(canal: CanalOD, idNoParceiro: string): string {
  return `${canal.prefixo}_${idNoParceiro}`;
}

export function traduzirPedidoOpenDelivery(pedido: PedidoOD, ctx: ContextoOD): TraducaoOD {
  const { canal, lojaId, fuso } = ctx;
  const avisos: string[] = [];
  const idNoParceiro = texto(pedido.id);
  const numero = texto(pedido.displayId) || idNoParceiro.slice(-6);
  const criadoEm = data(pedido.createdAt) || ctx.agora || new Date();

  // ── Itens ─────────────────────────────────────────────────────────────────
  const espelhos: EspelhoOD[] = [];
  const notasDeItem: string[] = [];
  const items: any[] = [];
  let somaDosItens = 0;
  for (const item of Array.isArray(pedido.items) ? pedido.items : []) {
    if (!item || typeof item !== "object") continue;
    const nomeDoParceiro = texto(item.name) || `Item ${canal.nome}`;
    const qtdBruta = quantidade(item.quantity);
    // ── PESO NÃO É UNIDADE ──────────────────────────────────────────────────
    // A quantidade do item no banco é inteira; 0,5 kg de açaí gravado como
    // "1" com preço de 1 kg cobraria o dobro no relatório. Item por peso (ou
    // quantidade quebrada) entra como UMA linha com o preço da linha, e o peso
    // no nome — é o que a cozinha precisa ler.
    const unidade = texto(item.unit).toUpperCase();
    const porPeso = (unidade && unidade !== "UN") || !Number.isInteger(qtdBruta);
    const nome = nomeDoParceiro;
    const qtd = porPeso ? 1 : qtdBruta;
    const rotuloDoPeso = porPeso ? `${String(qtdBruta).replace(".", ",")} ${unidade || "UN"} ` : "";
    const opcoes = opcoesDoItem(item);
    const somaDasOpcoes = opcoes.reduce((s, o) => s + o.precoUnitario * o.quantidade, 0);

    // Preço de UMA unidade do item, com as opções: `totalPrice ÷ qtd` quando o
    // parceiro mandou (é o número que ele cobrou); senão unitário + opções.
    const precoUnidade = veio(item.totalPrice)
      ? valor(item.totalPrice) / qtd
      : (valor(item.unitPrice) + (veio(item.optionsPrice) ? valor(item.optionsPrice) : somaDasOpcoes)) * (porPeso ? qtdBruta : 1);
    if (!veio(item.totalPrice) && !veio(item.unitPrice)) avisos.push(`item "${nome}" sem preço`);
    somaDosItens += precoUnidade * qtd;

    const nomeCompleto = [rotuloDoPeso + nome, ...opcoes.map((o) => (o.quantidade > 1 ? `${o.quantidade}x ${o.nome}` : o.nome))].join(" | ");
    const codigo = texto(item.id) || texto(item.externalCode) || `nome-${slug(nome)}`;
    const idEspelho = `${canal.prefixo}-${lojaId}-${codigo}`.slice(0, 190);
    espelhos.push({ id: idEspelho, nome });

    const observacoes = [texto(item.specialInstructions), ...opcoes.map((o) => (o.observacao ? `${o.nome}: ${o.observacao}` : ""))].filter(Boolean);
    if (observacoes.length > 0) notasDeItem.push(`${nome}: ${observacoes.join(" | ")}`);

    items.push({
      price: reais(precoUnidade),
      quantity: qtd,
      productName: nomeCompleto,
      notes: observacoes.length > 0 ? observacoes.join(" | ") : null,
      comboSelections:
        opcoes.length > 0
          ? JSON.stringify(opcoes.map((o) => ({ id: o.id, name: o.nome, quantity: o.quantidade, price: o.precoUnitario })))
          : null,
      menuProduct: {
        connectOrCreate: {
          where: { id: idEspelho },
          create: {
            id: idEspelho,
            franchiseeId: lojaId,
            // Nome BASE: as opções deste pedido estão em comboSelections e o
            // nome do dia em productName (lib/espelho-do-parceiro.ts).
            name: nome,
            description: "",
            price: reais(veio(item.unitPrice) ? valor(item.unitPrice) : precoUnidade),
            // Categoria fixa do canal: o grupo do cardápio do parceiro como
            // categoria pôs pizza da Wabiz na tela das esfihas (22/09/2026).
            category: canal.nome,
            isBeverage: isBeverageName(nome),
            active: false,
          },
        },
      },
    });
  }
  if (items.length === 0) avisos.push("pedido sem itens");

  // ── Taxas, descontos, total ───────────────────────────────────────────────
  const taxas = Array.isArray(pedido.otherFees) ? pedido.otherFees.filter(Boolean) : [];
  const tipoDaTaxa = (f: (typeof taxas)[number]) => texto(f.type || f.name).toUpperCase();
  const ehEntrega = (f: (typeof taxas)[number]) => /DELIVERY|FRETE|ENTREGA/.test(tipoDaTaxa(f));
  const ehGorjeta = (f: (typeof taxas)[number]) => /TIP|GORJETA/.test(tipoDaTaxa(f));
  const taxaDeEntrega = reais(taxas.filter(ehEntrega).reduce((s, f) => s + valor(f.price), 0));
  const gorjeta = reais(taxas.filter(ehGorjeta).reduce((s, f) => s + valor(f.price), 0));
  // Complemento do pedido mínimo (MIN_ORDER_FEE): o cliente paga a diferença
  // até o mínimo. No 99 era o `meal_top_up` que sumia da conta do total.
  const ehMinimo = (f: (typeof taxas)[number]) => /MIN_ORDER/.test(tipoDaTaxa(f));
  const complementoDoMinimo = reais(taxas.filter(ehMinimo).reduce((s, f) => s + valor(f.price), 0));
  const outrasTaxas = taxas.filter((f) => !ehEntrega(f) && !ehGorjeta(f) && !ehMinimo(f));
  const taxaDeServico = reais(outrasTaxas.reduce((s, f) => s + valor(f.price), 0));
  // De quem é a taxa: `receivedBy: MERCHANT` é dinheiro da LOJA (a taxa
  // adicional e a da forma de pagamento do CardápioWeb). Sem `receivedBy`, ou
  // com outro dono (MARKETPLACE, LOGISTIC_SERVICES), continua sendo da
  // plataforma — a leitura de sempre, e o que a Keeta manda hoje.
  const ehDaLoja = (f: (typeof taxas)[number]) => texto(f.receivedBy).toUpperCase() === "MERCHANT";
  const taxasDaLoja = outrasTaxas.filter(ehDaLoja).filter((f) => valor(f.price) > 0);
  const taxaDaPlataforma = reais(taxaDeServico - taxasDaLoja.reduce((s, f) => s + valor(f.price), 0));

  const desconto = lerDescontos(pedido);
  const totalDeclarado = valor(pedido.total?.orderAmount);
  const totalPelasPartes = reais(somaDosItens + taxaDeEntrega + gorjeta + taxaDeServico + complementoDoMinimo - desconto.total);
  const total = veio(pedido.total?.orderAmount) ? reais(totalDeclarado) : totalPelasPartes;

  // ── A CONTA TEM DE FECHAR ────────────────────────────────────────────────
  // O total do 99 entrou "cheio" por meses porque um campo faltava e ninguém
  // somava as partes para conferir (99food-total-sem-real-pay-price). Aqui a
  // soma é sempre feita; se não bate, o aviso sai no log e no payload cru.
  if (veio(pedido.total?.orderAmount) && Math.abs(centavos(totalPelasPartes) - centavos(totalDeclarado)) > 1) {
    avisos.push(`total ${totalDeclarado.toFixed(2)} ≠ partes ${totalPelasPartes.toFixed(2)} (itens ${reais(somaDosItens).toFixed(2)} + entrega ${taxaDeEntrega.toFixed(2)} + serviço ${taxaDeServico.toFixed(2)} + mínimo ${complementoDoMinimo.toFixed(2)} + gorjeta ${gorjeta.toFixed(2)} − desconto ${desconto.total.toFixed(2)})`);
  }
  if (veio(pedido.total?.itemsPrice) && Math.abs(centavos(valor(pedido.total?.itemsPrice)) - centavos(somaDosItens)) > 1) {
    avisos.push(`itens ${valor(pedido.total?.itemsPrice).toFixed(2)} ≠ soma das linhas ${reais(somaDosItens).toFixed(2)}`);
  }

  // ── Pagamento ─────────────────────────────────────────────────────────────
  const pagamento = lerPagamento(pedido, total, canal.nome);
  avisos.push(...pagamento.avisos);

  // ── Entrega, cliente, prazo ───────────────────────────────────────────────
  const tipo = tipoDoPedido(pedido);
  const { prazo, agendado } = prazoDoPedido(pedido, tipo, criadoEm);
  const quemEntrega = texto(pedido.delivery?.deliveredBy).toUpperCase();
  // "LOGISTICS" é o que lib/entrega-parceira.ts reconhece como entregador da
  // plataforma (canal Open Delivery): o caixa não cobra da gaveta o que o
  // entregador do app recebeu, e a comanda leva o código de coleta.
  const deliveryBy = tipo === "DELIVERY" && quemEntrega && quemEntrega !== "MERCHANT" ? "LOGISTICS" : "MERCHANT";
  const codigoDeColeta = texto(pedido.delivery?.pickupCode) || null;

  const cliente = pedido.customer || {};
  const telefone = typeof cliente.phone === "string" ? claro(cliente.phone) : claro(cliente.phone?.number);
  const ramal = typeof cliente.phone === "object" && cliente.phone ? texto(cliente.phone.localizer ?? cliente.phone.extension) : "";

  const notes = [
    `Pedido ${canal.nome} #${numero}`,
    tipo === "MESA" ? `🍽️ MESA${texto(pedido.indoor?.place) ? ` ${texto(pedido.indoor?.place)}` : ""}` : null,
    agendado ? `📅 AGENDADO para ${dataHoraDaLoja(prazo, fuso)}` : null,
    ramal ? `📞 Código do telefone: ${ramal}` : null,
    desconto.total > 0
      ? `🏷️ ${desconto.detalhes.find((d) => d.description)?.description || "Desconto"}: -R$${desconto.total.toFixed(2)}` +
        (desconto.plataforma > 0 ? ` (${canal.nome}: R$${desconto.plataforma.toFixed(2)} | Loja: R$${desconto.loja.toFixed(2)})` : "")
      : null,
    taxaDaPlataforma > 0 ? `💳 Taxa de serviço ${canal.nome}: R$${taxaDaPlataforma.toFixed(2)} (fica com a plataforma)` : null,
    ...taxasDaLoja.map((f) => `💳 ${texto(f.name) || "Taxa adicional"}: R$${valor(f.price).toFixed(2)} (fica com a loja)`),
    complementoDoMinimo > 0 ? `🧾 Complemento do pedido mínimo: R$${complementoDoMinimo.toFixed(2)}` : null,
    gorjeta > 0 ? `💝 Gorjeta: R$${gorjeta.toFixed(2)}` : null,
    pagamento.parteOnline > 0 ? `💳 Já pago no app: R$${pagamento.parteOnline.toFixed(2)}` : null,
    texto(pedido.extraInfo) ? `📝 OBS: ${texto(pedido.extraInfo)}` : null,
    ...notasDeItem.map((n) => `📝 ${n}`),
  ]
    .filter(Boolean)
    .join("\n");

  const dados: Record<string, any> = {
    franchiseeId: lojaId,
    kdsStage: "PRODUCTION",
    kdsProductionAt: ctx.agora || new Date(),
    source: canal.chave,
    openDeliveryChannel: canal.chave,
    openDeliveryOrderId: idDoPedidoNoBanco(canal, idNoParceiro),
    // O número curto, o que o cliente e o entregador falam (o 99 imprimia o id
    // de 19 dígitos — firehub-99food-numero-do-pedido).
    openDeliveryReference: numero,
    openDeliveryPickupCode: deliveryBy === "LOGISTICS" ? codigoDeColeta : null,
    deliveryType: tipo,
    deliveryBy,
    scheduledDatetime: prazo,
    customerName: texto(cliente.name) || `Cliente ${canal.nome}`,
    customerPhone: telefone.replace(/\D/g, ""),
    customerCpfCnpj: texto(cliente.documentNumber) || null,
    customerAddress: tipo === "DELIVERY" ? enderecoDoPedido(pedido.delivery?.deliveryAddress) : "",
    customerLatLng: tipo === "DELIVERY" ? coordenadasDoParceiro(pedido.delivery?.deliveryAddress, pedido.delivery) : undefined,
    paymentMethod: pagamento.paymentMethod,
    changeAmount: pagamento.changeAmount,
    totalAmount: total,
    deliveryFee: taxaDeEntrega,
    discountTotal: desconto.total > 0 ? desconto.total : null,
    discountMerchant: desconto.loja > 0 ? desconto.loja : null,
    // `discountIfood` é a coluna da "parte da plataforma" em todos os canais
    // (o 99 já grava nela desde 18/09/2026 — desconto-tem-dono).
    discountIfood: desconto.plataforma > 0 ? desconto.plataforma : null,
    discountDetails: desconto.detalhes.length > 0 ? desconto.detalhes : undefined,
    status: ctx.autoAcceptOrders ? "ACEITO" : "NOVO",
    notes: notes || undefined,
    items: { create: items },
  };
  if (dados.customerLatLng === undefined) delete dados.customerLatLng;

  return { dados, items, espelhos, avisos };
}
