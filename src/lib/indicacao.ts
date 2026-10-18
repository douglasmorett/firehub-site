/**
 * Indique e Ganhe do CLIENTE FINAL — a regra, sem banco (provada em
 * scripts/teste-indicacao.ts). O banco está em lib/indicacao-no-banco.ts.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Até 17/10/2026 era vitrine (descoberto na Point da Pizza): Fidelidade ›
 * Indique e Ganhe gravava `referralActive`, `friendDiscount`, `referrerReward`
 * e `referralMinOrder`, o cardápio anunciava "seus amigos ganham R$ X OFF e
 * você ganha R$ Y de saldo" e copiava um link `?ref=<telefone>` — e nenhuma
 * linha do servidor lia nada disso.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * 1. Cada telefone tem um CÓDIGO estável na loja (tabela CodigoDeIndicacao);
 *    o link do cardápio leva `?ref=<código>`. Link antigo com o telefone
 *    (`?ref=11999991234`) também vale.
 * 2. O AMIGO, no PRIMEIRO pedido na loja (o telefone dele sem pedido anterior
 *    que conte, em qualquer canal) e com produtos ≥ mínimo, ganha o desconto em
 *    R$ — só sobre os produtos que ainda faltam pagar (não abate entrega, não
 *    vira troco). Quem decide é o servidor; o corpo só traz o código.
 *    Indicar a si mesmo (mesmo telefone) não vale.
 *    NÃO SOMA com o cupom de PRIMEIRO PEDIDO da loja: os dois são o mesmo
 *    "bem-vindo". Com o cupom aplicado, o amigo fica com o cupom, a indicação
 *    é gravada com desconto zero e quem indicou ganha igual. Cupom comum,
 *    trilha, carimbos, % do Pix e cashback somam, como já somavam entre si.
 * 3. QUEM INDICOU ganha a recompensa como SALDO DE CASHBACK quando o pedido do
 *    amigo é CONCLUÍDO — a mesma régua do cashback (`pedidoConcluido`). O
 *    crédito é CALCULADO do pedido do amigo (coluna `indicacao`), como todo
 *    saldo do cashback: cancelado não credita, e se cancelar depois de
 *    entregue o crédito some sozinho. Um por amigo (o telefone do amigo).
 * 4. Loja com `referralActive` desligado: nada muda — o checkout nem lê o
 *    código. O que já foi creditado continua do cliente (é histórico).
 */

import { lerCashback, regraNoCanal, type CanaisDoCashback, type RegraDoCashback } from "./cashback";
import { finalDoTelefone } from "./pedidos-do-telefone";

export type RegraDaIndicacao = {
  ativo: boolean;
  /** R$ de desconto do amigo no primeiro pedido. */
  descontoDoAmigo: number;
  /** R$ de saldo para quem indicou, quando o pedido do amigo é concluído. */
  recompensa: number;
  /** Produtos a partir de quanto o primeiro pedido do amigo vale. */
  minimo: number;
};

const num = (v: unknown, padrao: number) => {
  if (v === undefined || v === null || v === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lê `User.storeLoyalty` com os mesmos padrões da tela (LoyaltyConfigForm). Zero vale zero. */
export function lerIndicacao(storeLoyalty: unknown): RegraDaIndicacao {
  const l = (storeLoyalty && typeof storeLoyalty === "object" ? storeLoyalty : {}) as Record<string, unknown>;
  const descontoDoAmigo = centavos(Math.max(0, num(l.friendDiscount, 10)));
  const recompensa = centavos(Math.max(0, num(l.referrerReward, 10)));
  return {
    ativo: l.referralActive === true && (descontoDoAmigo > 0 || recompensa > 0),
    descontoDoAmigo,
    recompensa,
    minimo: centavos(Math.max(0, num(l.referralMinOrder, 35))),
  };
}

/**
 * A regra para USAR o saldo neste canal. É a do cashback; mas a loja que só
 * ligou a indicação (sem cashback) precisa deixar o cliente gastar a
 * recompensa — senão o "você ganha R$ 10 de saldo" seria saldo que não se usa.
 * Nesse caso o SITE (onde a indicação vive) aceita o saldo, até o % de resgate
 * da tela do cashback, e nada gera (taxa zero, sem VIP).
 */
export function regraParaUsarOSaldo(storeLoyalty: unknown, canal: keyof CanaisDoCashback): RegraDoCashback {
  const regra = regraNoCanal(lerCashback(storeLoyalty), canal);
  if (regra.ativo) return regra;
  const indicacao = lerIndicacao(storeLoyalty);
  if (canal === "site" && indicacao.ativo && indicacao.recompensa > 0) return { ...regra, ativo: true, taxa: 0, vip: null };
  return regra;
}

// ── O código ────────────────────────────────────────────────────────────────

/** Sem 0/O, 1/I/L: o código é lido em voz alta e digitado no celular. */
export const ALFABETO_DO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_DO_CODIGO = 6;

/** Um código novo, com o sorteio que vier (o banco passa `crypto.randomInt`). */
export function gerarCodigo(sorteio: (max: number) => number = (max) => Math.floor(Math.random() * max)): string {
  let c = "";
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) c += ALFABETO_DO_CODIGO[sorteio(ALFABETO_DO_CODIGO.length)];
  return c;
}

export type ReferenciaDoLink = { tipo: "codigo"; codigo: string } | { tipo: "telefone"; final: string };

/**
 * O que veio no `?ref=`: um código, ou (link antigo, que o cardápio copiava
 * até 17/10/2026) o telefone de quem indicou. Lixo vira `null`.
 */
export function lerReferencia(bruto: unknown): ReferenciaDoLink | null {
  const s = String(bruto ?? "").trim();
  if (!s || s.length > 40) return null;
  const digitos = s.replace(/\D/g, "");
  if (/^[\d\s()+\-.]+$/.test(s) && digitos.length >= 10 && digitos.length <= 13) {
    const final = finalDoTelefone(digitos);
    return final ? { tipo: "telefone", final } : null;
  }
  const codigo = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (codigo.length < 4 || codigo.length > 12) return null;
  return { tipo: "codigo", codigo };
}

// ── O pedido do amigo ───────────────────────────────────────────────────────

/** Status que NÃO fazem do telefone um cliente: ninguém comprou. */
const NAO_CONTA_COMO_PEDIDO = new Set([
  "CANCELADO", "CANCELED", "CANCELLED", "RECUSADO", "REJEITADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO",
]);
const CANCELADO = new Set(["CANCELADO", "CANCELED", "CANCELLED", "RECUSADO", "REJEITADO"]);
const statusDe = (p: { status?: string | null }) => String(p.status || "").toUpperCase().trim();

/** Este pedido anterior faz do telefone um cliente da loja? (cancelado e Pix abandonado não) */
export function pedidoQueConta(p: { status?: string | null }): boolean {
  return !NAO_CONTA_COMO_PEDIDO.has(statusDe(p));
}

/** Quem indicou, como o banco achou pelo código. */
export type Indicador = { final: string; telefone: string | null; nome: string | null };

/** O que fica gravado em `CustomerOrder.indicacao` no primeiro pedido do amigo. */
export type ResgateDaIndicacao = {
  programa: "indicacao";
  /** O código do link (ou o telefone, no link antigo). */
  codigo: string;
  /** Os 8 últimos dígitos de quem indicou — a chave do crédito. */
  indicador: string;
  indicadorTelefone: string | null;
  indicadorNome: string | null;
  /** Os 8 últimos dígitos do amigo — um crédito por amigo. */
  amigo: string;
  /** O desconto que o amigo levou neste pedido (0 com o cupom de primeiro pedido). */
  desconto: number;
  /** O saldo que quem indicou recebe quando este pedido for concluído. */
  recompensa: number;
  /** Por que o desconto ficou zero, quando ficou. */
  semDesconto?: "cupom_de_primeiro_pedido";
};

export type MotivoSemIndicacao = "desligada" | "sem_indicador" | "a_si_mesmo" | "nao_e_primeiro" | "abaixo_do_minimo";

export const FRASE_SEM_INDICACAO: Record<MotivoSemIndicacao, string> = {
  desligada: "A loja não está com o Indique e Ganhe ligado.",
  sem_indicador: "Não achamos esse link de indicação.",
  a_si_mesmo: "O link é seu: a indicação vale para os amigos.",
  nao_e_primeiro: "A indicação vale só no primeiro pedido na loja, e este telefone já pediu aqui.",
  abaixo_do_minimo: "A indicação vale em pedidos a partir do valor mínimo.",
};

export type VeredictoDaIndicacao =
  | { ok: true; desconto: number; resgate: ResgateDaIndicacao }
  | { ok: false; motivo: MotivoSemIndicacao };

/**
 * O pedido do amigo leva a indicação? `pedidosAnteriores` são os pedidos do
 * telefone do amigo NESTA loja, em qualquer canal (sem o pedido que está
 * sendo gravado). `produtos` é a soma dos itens antes de desconto (é com ela
 * que se compara o mínimo, como no cashback); `produtosAPagar`, o que ainda
 * falta pagar dos produtos depois dos descontos que vieram antes.
 */
export function avaliarIndicacao(e: {
  regra: RegraDaIndicacao;
  codigo: string;
  telefoneDoAmigo: string;
  indicador: Indicador | null;
  pedidosAnteriores: { status?: string | null }[];
  produtos: number;
  produtosAPagar: number;
  comCupomDePrimeiroPedido?: boolean;
}): VeredictoDaIndicacao {
  if (!e.regra.ativo) return { ok: false, motivo: "desligada" };
  const amigo = finalDoTelefone(e.telefoneDoAmigo);
  if (!e.indicador || !e.indicador.final || !amigo) return { ok: false, motivo: "sem_indicador" };
  if (e.indicador.final === amigo) return { ok: false, motivo: "a_si_mesmo" };
  if (e.pedidosAnteriores.some(pedidoQueConta)) return { ok: false, motivo: "nao_e_primeiro" };
  if (!(e.produtos > 0) || e.produtos < e.regra.minimo) return { ok: false, motivo: "abaixo_do_minimo" };

  const comCupom = e.comCupomDePrimeiroPedido === true;
  const desconto = comCupom ? 0 : centavos(Math.min(e.regra.descontoDoAmigo, Math.max(0, e.produtosAPagar)));
  return {
    ok: true,
    desconto,
    resgate: {
      programa: "indicacao",
      codigo: e.codigo,
      indicador: e.indicador.final,
      indicadorTelefone: e.indicador.telefone,
      indicadorNome: e.indicador.nome,
      amigo,
      desconto,
      recompensa: e.regra.recompensa,
      ...(comCupom ? { semDesconto: "cupom_de_primeiro_pedido" as const } : {}),
    },
  };
}

/** Lê `CustomerOrder.indicacao`; qualquer outra coisa é `null`. */
export function lerResgateDaIndicacao(bruto: unknown): ResgateDaIndicacao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  if (r.programa !== "indicacao" || typeof r.indicador !== "string" || typeof r.amigo !== "string") return null;
  return {
    programa: "indicacao",
    codigo: String(r.codigo || ""),
    indicador: r.indicador,
    indicadorTelefone: typeof r.indicadorTelefone === "string" ? r.indicadorTelefone : null,
    indicadorNome: typeof r.indicadorNome === "string" ? r.indicadorNome : null,
    amigo: r.amigo,
    desconto: Math.max(0, Number(r.desconto) || 0),
    recompensa: Math.max(0, Number(r.recompensa) || 0),
    ...(r.semDesconto === "cupom_de_primeiro_pedido" ? { semDesconto: "cupom_de_primeiro_pedido" as const } : {}),
  };
}

/** O primeiro nome, para "Indicação de Maria" — a rota do cardápio é pública. */
export function primeiroNome(nome: string | null | undefined): string | null {
  const limpo = String(nome || "").replace(/\s+/g, " ").trim();
  if (!limpo || /^(cliente|consumidor|balc[aã]o|sem nome|n[aã]o informado)$/i.test(limpo)) return null;
  const primeiro = limpo.split(" ")[0];
  return primeiro.length > 1 ? primeiro.slice(0, 30) : null;
}

/** Quem indicou, como a comanda e o painel escrevem. */
export function nomeDeQuemIndicou(r: Pick<ResgateDaIndicacao, "indicadorNome" | "indicador">): string {
  return r.indicadorNome || `cliente final ${r.indicador.slice(-4)}`;
}

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** A linha da comanda e do painel: "[Indicação de Maria: -R$ 10,00]". */
export function etiquetaDaIndicacao(r: ResgateDaIndicacao): string {
  const quem = nomeDeQuemIndicou(r);
  if (r.desconto > 0) return `[Indicação de ${quem}: -${reais(r.desconto)}]`;
  return r.semDesconto === "cupom_de_primeiro_pedido"
    ? `[Indicação de ${quem} — não soma com o cupom de primeiro pedido]`
    : `[Indicação de ${quem}]`;
}

// ── O crédito de quem indicou ───────────────────────────────────────────────

export type PedidoIndicado = {
  id: string;
  status?: string | null;
  deliveryType?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  dailyOrderNumber?: number | null;
  customerName?: string | null;
  indicacao?: unknown;
};

export type IndicacaoFeita = {
  pedidoId: string;
  pedidoNumero: number | null;
  em: string;
  amigoNome: string | null;
  /** Os 4 últimos dígitos do amigo. */
  amigoFinal: string;
  desconto: number;
  recompensa: number;
  /** creditado = pedido concluído; a_receber = em andamento; cancelado = não credita. */
  situacao: "creditado" | "a_receber" | "cancelado";
  /** Quando virou saldo (o crédito no extrato). */
  creditadoEm: string | null;
};

const quando = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);

const CONCLUIDO = new Set(["ENTREGUE", "ENCERRADO", "CONCLUIDO", "FINALIZADO", "DELIVERED", "CONCLUDED"]);
/** A mesma régua de `pedidoConcluido` do cashback (retirada parada em Pronto conta). */
function concluido(p: { status?: string | null; deliveryType?: string | null }): boolean {
  const s = statusDe(p);
  if (CONCLUIDO.has(s)) return true;
  return s === "PRONTO" && String(p.deliveryType || "").toUpperCase() !== "DELIVERY";
}

/**
 * As indicações de UM telefone (os 8 últimos dígitos de quem indicou), a
 * partir dos pedidos que gravaram `indicacao` apontando para ele. Um crédito
 * por amigo: se o primeiro pedido do amigo foi cancelado e o seguinte voltou a
 * ser "primeiro", só um deles credita. Do mais velho para o mais novo.
 */
export function indicacoesDoIndicador(pedidos: PedidoIndicado[], finalDoIndicador: string): IndicacaoFeita[] {
  const porAmigo = new Map<string, IndicacaoFeita[]>();
  const ordenados = [...pedidos].sort((a, b) => quando(a.createdAt) - quando(b.createdAt));
  for (const p of ordenados) {
    const r = lerResgateDaIndicacao(p.indicacao);
    if (!r || r.indicador !== finalDoIndicador || r.amigo === finalDoIndicador) continue;
    const s = statusDe(p);
    if (s === "CRIANDO_IA" || s === "AGUARDANDO_PAGAMENTO") continue; // ainda não é pedido
    const situacao: IndicacaoFeita["situacao"] = CANCELADO.has(s) ? "cancelado" : concluido(p) ? "creditado" : "a_receber";
    const t = [quando(p.deliveredAt), quando(p.updatedAt), quando(p.createdAt)].find((x) => Number.isFinite(x));
    const lista = porAmigo.get(r.amigo) || [];
    lista.push({
      pedidoId: p.id,
      pedidoNumero: p.dailyOrderNumber ?? null,
      em: new Date(p.createdAt).toISOString(),
      amigoNome: primeiroNome(p.customerName),
      amigoFinal: r.amigo.slice(-4),
      desconto: r.desconto,
      recompensa: r.recompensa,
      situacao,
      creditadoEm: situacao === "creditado" && t !== undefined ? new Date(t).toISOString() : null,
    });
    porAmigo.set(r.amigo, lista);
  }
  const saida: IndicacaoFeita[] = [];
  for (const lista of porAmigo.values()) {
    // Vale o primeiro concluído; sem concluído, o primeiro em andamento; senão o cancelado (só para a ficha).
    const escolhido = lista.find((x) => x.situacao === "creditado") || lista.find((x) => x.situacao === "a_receber") || lista[lista.length - 1];
    saida.push(escolhido);
  }
  return saida.sort((a, b) => quando(a.em) - quando(b.em));
}

/** O que entra no saldo do cashback de quem indicou (lib/cashback.ts, `CreditoExtra`). */
export function creditosDaIndicacao(feitas: IndicacaoFeita[]): { creditos: CreditoDaIndicacao[]; aReceber: number } {
  const creditos: CreditoDaIndicacao[] = [];
  let aReceber = 0;
  for (const f of feitas) {
    if (f.recompensa <= 0) continue;
    if (f.situacao === "creditado" && f.creditadoEm) {
      creditos.push({
        em: f.creditadoEm,
        valor: f.recompensa,
        pedidoId: f.pedidoId,
        pedidoNumero: f.pedidoNumero,
        motivo: `Indicação: ${f.amigoNome || "amigo"} (final ${f.amigoFinal})`,
      });
    } else if (f.situacao === "a_receber") {
      aReceber += f.recompensa;
    }
  }
  return { creditos, aReceber: centavos(aReceber) };
}

export type CreditoDaIndicacao = { em: string; valor: number; pedidoId: string; pedidoNumero: number | null; motivo: string };
