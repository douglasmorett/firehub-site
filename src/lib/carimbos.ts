/**
 * Cartão de carimbos — a regra, num lugar só (sem banco).
 *
 * Quem lê: o cardápio (o cartão que o cliente vê, contado no servidor em
 * api/store-customer), a ficha do cliente no painel (aba Clientes), o checkout
 * do site (api/customer-order) e o robô do WhatsApp (lib/chatbot-ai.ts), que
 * aplicam o prêmio. A parte que fala com o banco é lib/premio-no-pedido.ts.
 *
 * ── Desde 17/10/2026 o prêmio entra SOZINHO (aprovado pelo Douglas) ─────────
 *
 * Até ali o cartão só se mostrava: a loja dava o prêmio à mão. Agora funciona
 * como a Trilha Premiada (lib/trilha-premiada.ts):
 *
 * - O PROGRESSO não é guardado: é contado dos pedidos do telefone (o histórico,
 *   não os 10 de "Meus pedidos"). Pedido cancelado depois some da conta sozinho.
 * - O RESGATE é guardado no pedido que usou o prêmio
 *   (`CustomerOrder.carimboPremio`), como a trilha guarda em `trilhaPremio`.
 * - Prêmios a receber = cartelas completas − prêmios usados. Um por pedido, um
 *   por cartela completa. Pedido com prêmio que é CANCELADO devolve o prêmio:
 *   o cliente não recebeu a comida.
 * - Entra no pedido pelo SITE e pelo ROBÔ DO WHATSAPP — os dois canais em que o
 *   sistema monta a conta —, e só se a loja deixou o canal marcado. Balcão,
 *   mesa e marketplace não aplicam.
 * - O cliente pode GUARDAR o prêmio para a próxima: no site pela caixinha do
 *   checkout (`dispensarPremioDosCarimbos`), no robô pelo campo
 *   `guardarPremioDosCarimbos` da tag — e o rascunho do robô guarda a escolha
 *   em `carimboPremio` como `{ programa: "carimbos", guardado: true }`, que
 *   NÃO conta como prêmio usado.
 *
 * ── Quem ganha carimbo ───────────────────────────────────────────────────────
 *
 * O pedido que não foi cancelado/recusado, não é rascunho do robô nem Pix
 * esperando pagamento (o prêmio agora vale dinheiro: Pix não pago completando
 * cartela seria desconto de graça), veio de um canal que a LOJA marcou em
 * "Onde o cliente ganha carimbo" (`storeLoyalty.stampCanais`: site, WhatsApp,
 * balcão, mesa, totem — ausente = marcado, como o cashback; marketplace e canal
 * desconhecido nunca) e alcança o pedido mínimo.
 *
 * ── A configuração é a que a loja salvou ─────────────────────────────────────
 *
 * Até 17/10/2026 os `||` do cardápio trocavam o que a loja deixou em branco ou
 * zero por um padrão: mínimo 0 virava R$ 30 e prêmio 0 virava R$ 25 (a Point
 * da Pizza tem prêmio 0 e o cliente lia R$ 25). Agora o zero vale: mínimo 0 =
 * qualquer pedido, e prêmio em desconto 0 (ou produto sem produto escolhido)
 * = cartão FORA DO AR, porque não há prêmio a prometer. O padrão do formulário
 * (R$ 30 / R$ 25) só vale para o campo que nunca foi salvo.
 */

import { canalDaTrilha } from "./trilha-premiada";

/** Onde o cliente ganha carimbo (e, no site e no robô, onde o prêmio entra). Ausente = marcado. */
export type CanaisDosCarimbos = { site: boolean; whatsapp: boolean; balcao: boolean; mesa: boolean; totem: boolean };

export const CANAIS_DOS_CARIMBOS_PADRAO: CanaisDosCarimbos = { site: true, whatsapp: true, balcao: true, mesa: true, totem: true };

/** Os canais na ordem da tela, com o texto que o lojista lê. */
export const CANAIS_DOS_CARIMBOS: { chave: keyof CanaisDosCarimbos; nome: string; ajuda: string }[] = [
  { chave: "site", nome: "🌐 Site (cardápio digital)", ajuda: "Ganha carimbo, e o prêmio entra sozinho no checkout." },
  { chave: "whatsapp", nome: "🤖 WhatsApp (robô)", ajuda: "Ganha carimbo, e o robô aplica o prêmio (ou guarda, se o cliente pedir)." },
  { chave: "balcao", nome: "🧾 Balcão / PDV", ajuda: "Ganha carimbo quando o telefone do cliente vai no pedido. O prêmio não entra aqui." },
  { chave: "mesa", nome: "🍽️ Mesa", ajuda: "Ganha carimbo pela comanda da mesa com telefone. O prêmio não entra aqui." },
  { chave: "totem", nome: "🖥️ Totem", ajuda: "Ganha carimbo no autoatendimento com telefone. O prêmio não entra aqui." },
];

/** Lê `storeLoyalty.stampCanais`; o canal que não estiver lá vale marcado. */
export function lerCanaisDosCarimbos(storeLoyalty: unknown): CanaisDosCarimbos {
  const l = (storeLoyalty && typeof storeLoyalty === "object" ? storeLoyalty : {}) as Record<string, unknown>;
  const bruto = (l.stampCanais && typeof l.stampCanais === "object" ? l.stampCanais : {}) as Record<string, unknown>;
  const canais = { ...CANAIS_DOS_CARIMBOS_PADRAO };
  for (const chave of Object.keys(CANAIS_DOS_CARIMBOS_PADRAO) as (keyof CanaisDosCarimbos)[]) {
    if (typeof bruto[chave] === "boolean") canais[chave] = bruto[chave] as boolean;
  }
  return canais;
}

export type RegraDosCarimbos = {
  ativo: boolean;
  /** Carimbos para completar a cartela. */
  meta: number;
  /** Total mínimo do pedido (R$) para ganhar carimbo. 0 = qualquer pedido. */
  pedidoMinimo: number;
  premioTipo: "discount" | "product";
  /** Valor do desconto do prêmio (R$), quando o prêmio é desconto. */
  premioValor: number;
  /** O produto do prêmio, quando o prêmio é produto (`stampRewardProductId`). */
  premioProdutoId?: string;
  premioProdutoNome?: string;
  /** Onde o cliente ganha carimbo (`stampCanais`). */
  canais: CanaisDosCarimbos;
};

/** O padrão do formulário — só para o campo que a loja nunca salvou. */
const MINIMO_PADRAO = 30;
const PREMIO_PADRAO = 25;

function numeroSalvo(v: unknown, padrao: number): number {
  if (v === undefined || v === null || v === "") return v === "" ? 0 : padrao;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function lerCarimbos(storeLoyalty: unknown): RegraDosCarimbos {
  const l = (storeLoyalty && typeof storeLoyalty === "object" ? storeLoyalty : {}) as Record<string, any>;
  const meta = Number(l.stampGoal || 10);
  const premioTipo = l.stampRewardType === "product" ? "product" : "discount";
  return {
    ativo: Boolean(l.stampsActive),
    // A tela de configuração só oferece 5, 8, 10 ou 12; meta quebrada no banco
    // dividiria por zero (ou por NaN) e o cartão sairia "NaN / NaN".
    meta: Number.isInteger(meta) && meta >= 1 ? meta : 10,
    pedidoMinimo: numeroSalvo(l.stampMinOrder, MINIMO_PADRAO),
    premioTipo,
    premioValor: numeroSalvo(l.stampRewardValue, PREMIO_PADRAO),
    premioProdutoId: premioTipo === "product" ? String(l.stampRewardProductId || "").trim() || undefined : undefined,
    premioProdutoNome: premioTipo === "product" ? String(l.stampRewardProductName || "").trim() || undefined : undefined,
    canais: lerCanaisDosCarimbos(storeLoyalty),
  };
}

/**
 * O cartão está de pé? Ligado E com um prêmio de verdade. Prêmio R$ 0 ou
 * produto sem produto escolhido não vai ao ar: o cardápio não mostra cartão que
 * promete o que não existe (a mesma régua de `trilhaValida`).
 */
export function carimbosNoAr(regra: RegraDosCarimbos): boolean {
  if (!regra.ativo) return false;
  return regra.premioTipo === "product" ? !!regra.premioProdutoId : regra.premioValor > 0;
}

export type PedidoDoCarimbo = {
  id?: string;
  status?: string | null;
  totalAmount?: number | string | null;
  source?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  tableSessionId?: string | null;
  createdAt?: Date | string | null;
  /** O prêmio do cartão que este pedido usou (`CustomerOrder.carimboPremio`). */
  carimboPremio?: unknown;
};

/** Pedido que não ganha carimbo pelo status. */
const STATUS_SEM_CARIMBO = new Set([
  "CANCELADO", "CANCELLED", "CANCELED", "RECUSADO", "AGUARDANDO_PAGAMENTO", "CRIANDO_IA",
]);

/** Pedido cujo prêmio volta para o cliente: não foi feito. */
const STATUS_QUE_DEVOLVE_O_PREMIO = new Set(["CANCELADO", "CANCELLED", "CANCELED", "RECUSADO"]);

const statusDe = (p: PedidoDoCarimbo) => String(p.status || "").toUpperCase().trim();

/** O pedido ganha carimbo? */
export function ganhaCarimbo(p: PedidoDoCarimbo, regra: RegraDosCarimbos): boolean {
  if (STATUS_SEM_CARIMBO.has(statusDe(p))) return false;
  // O lanche da equipe (lib/lanche-da-equipe.ts) entra como balcão, mas não é venda.
  if (String(p.source || "").toUpperCase().trim() === "EQUIPE") return false;
  const canal = canalDaTrilha(p as any);
  if (canal === null || canal === "marketplace") return false;
  // Canal que a loja desmarcou em "Onde o cliente ganha carimbo".
  if (regra.canais[canal] !== true) return false;
  return !(regra.pedidoMinimo > 0) || Number(p.totalAmount) >= regra.pedidoMinimo;
}

// ── O resgate ───────────────────────────────────────────────────────────────

/** O que fica gravado em `CustomerOrder.carimboPremio` quando o pedido usa o prêmio. */
export type ResgateDosCarimbos = {
  /** A marca de que é prêmio do cartão de carimbos. */
  programa: "carimbos";
  /** Qual cartela foi paga (1ª, 2ª...), para a conferência com o cliente. */
  cartela: number;
  tipo: "discount" | "product";
  /** O desconto configurado (R$), quando é desconto. */
  valor?: number;
  produtoId?: string;
  produtoNome?: string;
  /** Quanto o prêmio custou à loja neste pedido, em reais. */
  valorAplicado: number;
  /** Como o prêmio aparece para o cliente e na comanda. */
  descricao: string;
  em: string;
};

export function lerResgateDosCarimbos(bruto: unknown): ResgateDosCarimbos | null {
  const r = bruto as any;
  // "Guardado para a próxima" (rascunho do robô) não é prêmio usado.
  if (!r || typeof r !== "object" || r.programa !== "carimbos" || r.guardado === true) return null;
  const cartela = Math.floor(Number(r.cartela));
  return {
    programa: "carimbos",
    cartela: Number.isFinite(cartela) && cartela >= 1 ? cartela : 1,
    tipo: r.tipo === "product" ? "product" : "discount",
    valor: Number.isFinite(Number(r.valor)) ? Number(r.valor) : undefined,
    produtoId: r.produtoId ? String(r.produtoId) : undefined,
    produtoNome: r.produtoNome ? String(r.produtoNome) : undefined,
    valorAplicado: Number(r.valorAplicado) || 0,
    descricao: String(r.descricao || ""),
    em: String(r.em || ""),
  };
}

/** O prêmio deste pedido conta como usado? Cancelado/recusado devolve. */
function premioUsadoNoPedido(p: PedidoDoCarimbo): boolean {
  return !!lerResgateDosCarimbos(p.carimboPremio) && !STATUS_QUE_DEVOLVE_O_PREMIO.has(statusDe(p));
}

// ── O cartão ────────────────────────────────────────────────────────────────

export type CartaoDeCarimbos = {
  /** Pedidos que ganharam carimbo. */
  validos: number;
  /** Carimbos no cartão atual (o que o cardápio mostra: "3 / 10"). */
  noCartao: number;
  /** Quantos faltam para completar o cartão atual. */
  faltam: number;
  /** Cartelas completas: pedidos que ganharam ÷ meta, para baixo. */
  completas: number;
  /** Prêmios já usados em pedidos (não cancelados). */
  usados: number;
  /** Prêmios ganhos e ainda não usados — entram, um por pedido, no próximo. */
  aReceber: number;
  /** Tem prêmio esperando: o cardápio diz "Você completou a cartela!". */
  acabouDeCompletar: boolean;
};

/** O cartão deste cliente, sobre o histórico de pedidos do telefone. */
export function contarCarimbos(regra: RegraDosCarimbos, pedidos: PedidoDoCarimbo[] | null | undefined): CartaoDeCarimbos {
  const lista = pedidos || [];
  const validos = lista.filter((p) => ganhaCarimbo(p, regra)).length;
  const noCartao = validos % regra.meta;
  const completas = Math.floor(validos / regra.meta);
  const usados = lista.filter(premioUsadoNoPedido).length;
  const aReceber = Math.max(0, completas - usados);
  return {
    validos,
    noCartao,
    faltam: Math.max(0, regra.meta - noCartao),
    completas,
    usados,
    aReceber,
    acabouDeCompletar: aReceber > 0,
  };
}

// ── O prêmio no pedido ──────────────────────────────────────────────────────

/** A observação do item grátis — é por ela que o robô reconhece o brinde. */
export const NOTA_DO_ITEM_DO_PREMIO = "Prêmio do Cartão de Carimbos";

/** Este item do pedido é o brinde do cartão? */
export function ehItemDoPremioDosCarimbos(item: { notes?: string | null; price?: number | string | null }): boolean {
  return String(item?.notes || "").trim() === NOTA_DO_ITEM_DO_PREMIO && !(Number(item?.price) > 0);
}

/** Os canais em que o prêmio entra sozinho. */
export type CanalDoPremio = "site" | "whatsapp";

/** O prêmio entra sozinho neste canal? Só site e robô, e só se a loja deixou marcado. */
export function premioEntraNoCanal(regra: RegraDosCarimbos, canal: string): boolean {
  return (canal === "site" || canal === "whatsapp") && regra.canais[canal] === true;
}

/** A marca que o rascunho do robô grava quando o cliente pede para guardar o prêmio. */
export function marcaDePremioGuardado(agora: Date = new Date()) {
  return { programa: "carimbos" as const, guardado: true as const, em: agora.toISOString() };
}

/** O pedido traz a marca de "guardar o prêmio para a próxima"? */
export function premioFoiGuardado(bruto: unknown): boolean {
  const r = bruto as any;
  return !!r && typeof r === "object" && r.programa === "carimbos" && r.guardado === true;
}

/**
 * O cliente do robô quer guardar o prêmio? O campo da tag decide; sem ele, vale
 * o que o rascunho já tinha (o modelo nem sempre repete o campo na finalização,
 * como no cashback). Sem nada: usa — o mesmo padrão do site.
 */
export function guardarNoRobo(daTag: unknown, carimboDoRascunho: unknown): boolean {
  if (daTag === true || daTag === "true") return true;
  if (daTag === false || daTag === "false") return false;
  return premioFoiGuardado(carimboDoRascunho);
}

/** "pelo site ou pelo WhatsApp" — onde o prêmio entra, do que a loja marcou. */
export function ondeEntraOPremio(regra: RegraDosCarimbos): string {
  const site = regra.canais.site, zap = regra.canais.whatsapp;
  if (site && zap) return "pelo site ou pelo WhatsApp";
  if (site) return "pelo site";
  if (zap) return "pelo WhatsApp";
  return "";
}

export type EfeitoDosCarimbos = {
  /** Quanto abater dos produtos, em reais. */
  descontoExtra: number;
  /** Produto a somar ao pedido com preço zero. */
  produtoGratis: { id: string; nome: string; preco: number } | null;
  /** O que gravar em `CustomerOrder.carimboPremio`. */
  resgate: ResgateDosCarimbos;
};

const arredondar = (n: number) => Math.round(Math.max(0, n) * 100) / 100;

/**
 * O prêmio cabe neste pedido? Se não couber, ele NÃO é consumido e espera o
 * próximo (o mesmo princípio de `efeitoDoPremio` da trilha).
 *
 * - Canal fora do site e do robô: não entra.
 * - Desconto: até o valor dos PRODUTOS que ainda falta pagar (`produtosAPagar`,
 *   depois de cupom e prêmio da trilha) — nunca sobre a entrega, nunca vira
 *   troco. Pedido de R$ 30 com prêmio de R$ 50 abate R$ 30 e gasta o prêmio.
 * - Produto: entra como item de preço zero; produto apagado ou desativado no
 *   cardápio deixa o prêmio guardado.
 */
export function efeitoDosCarimbos(
  regra: RegraDosCarimbos,
  cartao: CartaoDeCarimbos,
  conta: {
    canal: string;
    produtosAPagar: number;
    /** O produto do prêmio, como está HOJE no cardápio. */
    produto?: { id: string; name: string; price: number; active?: boolean } | null;
  },
  agora: Date = new Date(),
): EfeitoDosCarimbos | null {
  if (!carimbosNoAr(regra) || !(cartao.aReceber > 0)) return null;
  if (!premioEntraNoCanal(regra, conta.canal)) return null;
  const base = {
    programa: "carimbos" as const,
    cartela: cartao.usados + 1,
    em: agora.toISOString(),
  };

  if (regra.premioTipo === "discount") {
    const valor = arredondar(Math.min(regra.premioValor, Number(conta.produtosAPagar) || 0));
    if (!(valor > 0)) return null;
    return {
      descontoExtra: valor,
      produtoGratis: null,
      resgate: { ...base, tipo: "discount", valor: regra.premioValor, valorAplicado: valor, descricao: premioDosCarimbos(regra) },
    };
  }

  const p = conta.produto;
  if (!p || p.active === false || p.id !== regra.premioProdutoId) return null;
  const preco = arredondar(Number(p.price) || 0);
  return {
    descontoExtra: 0,
    produtoGratis: { id: p.id, nome: p.name, preco },
    resgate: { ...base, tipo: "product", produtoId: p.id, produtoNome: p.name, valorAplicado: preco, descricao: p.name },
  };
}

// ── Texto ───────────────────────────────────────────────────────────────────

const reais = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** O prêmio da cartela: "R$ 50,00 de desconto" ou o nome do produto. */
export function premioDosCarimbos(regra: RegraDosCarimbos): string {
  if (regra.premioTipo === "product") return regra.premioProdutoNome || "1 prêmio grátis";
  return `${reais(regra.premioValor)} de desconto`;
}

/** "pedido a partir de R$ 43,00" — o pedido mínimo que conta. */
export function minimoDosCarimbos(regra: RegraDosCarimbos): string {
  return Number.isFinite(regra.pedidoMinimo) && regra.pedidoMinimo > 0 ? `pedido a partir de ${reais(regra.pedidoMinimo)}` : "qualquer pedido";
}

/**
 * A etiqueta na observação do pedido (comanda e painel):
 * "[Cartão de Carimbos: -R$ 30,00]" ou "[Cartão de Carimbos: Guaraná 1L grátis]".
 */
export function etiquetaDoPremioDosCarimbos(r: ResgateDosCarimbos): string {
  return r.tipo === "product"
    ? `[Cartão de Carimbos: ${r.produtoNome || r.descricao} grátis]`
    : `[Cartão de Carimbos: -${reais(r.valorAplicado)}]`;
}

/** O resumo que o cardápio recebe do servidor — só contagem e prêmio. */
export type CarimbosDoCliente = {
  noCartao: number;
  meta: number;
  faltam: number;
  completas: number;
  aReceber: number;
  premio: string;
  /** "pelo site ou pelo WhatsApp"; vazio = nenhum canal com prêmio automático marcado. */
  ondeEntra: string;
};

export function carimbosDoCliente(regra: RegraDosCarimbos, cartao: CartaoDeCarimbos): CarimbosDoCliente {
  return {
    noCartao: cartao.noCartao,
    meta: regra.meta,
    faltam: cartao.faltam,
    completas: cartao.completas,
    aReceber: cartao.aReceber,
    premio: premioDosCarimbos(regra),
    ondeEntra: ondeEntraOPremio(regra),
  };
}
