/**
 * Cashback da loja — a regra, sem banco (provada em scripts/teste-cashback.ts).
 *
 * ── Por que o saldo é CALCULADO, e não um contador ──────────────────────────
 *
 * Até 02/10/2026 o cashback era só vitrine: o cardápio anunciava "ganhe 5% de
 * volta" e nada creditava. A rota que somava saldo (/api/cashback) não tinha
 * quem a chamasse, e o saldo que existia (`StoreCustomer.cashbackBalance`) é
 * GLOBAL — um só por telefone, para todas as lojas da plataforma. Ligado do
 * jeito que estava, o cashback ganho na pizzaria seria gasto na hamburgueria.
 *
 * Então o saldo sai dos PEDIDOS daquela loja, como o prêmio da Trilha Premiada
 * (lib/premio-no-pedido.ts) e o estoque disponível: cada pedido grava quanto
 * gera (`cashbackEarned`) e quanto usou (`cashbackUsed`). Disso segue sozinho:
 * - só a loja que deu o cashback deixa gastar;
 * - pedido cancelado não gera, e o que ele tinha usado volta;
 * - o crédito vence pela data em que entrou, sem rotina de limpeza.
 *
 * ── Quando o cashback entra ─────────────────────────────────────────────────
 *
 * Só quando o pedido é CONCLUÍDO (entregue). Creditar na criação deixaria
 * fazer o pedido, usar o saldo em outro e cancelar o primeiro.
 *
 * ── Onde vale ───────────────────────────────────────────────────────────────
 *
 * Nos dois canais da própria loja em que o cliente se identifica pelo
 * telefone: o site e o robô do WhatsApp. Desde 05/10/2026 o robô confere o
 * saldo, pergunta se o cliente quer usar e grava as mesmas duas colunas que o
 * checkout do site (lib/chatbot-ai.ts). O rascunho do robô (CRIANDO_IA) não
 * conta: ainda não é pedido. Balcão, mesa e aplicativos não geram nem consomem.
 */

import { chaveDoCanal } from "./canal-do-pedido";

type PedidoParaCanal = NonNullable<Parameters<typeof chaveDoCanal>[0]>;

export type RegraDoCashback = {
  ativo: boolean;
  /** % do valor dos produtos que volta como saldo. */
  taxa: number;
  /** Valor mínimo dos produtos para o pedido gerar cashback. */
  minimo: number;
  /** Até quanto do valor dos produtos o saldo pode pagar, em %. */
  maxResgatePct: number;
  /** Dias até o crédito vencer, contados de quando entrou. 0 = não vence. */
  validadeDias: number;
  /** Bônus dos níveis VIP, somado à taxa. `null` = níveis desligados. */
  vip: { bronze: number; prata: number; prataMinimo: number; ouro: number; ouroMinimo: number } | null;
};

const num = (v: unknown, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};

/** Lê a configuração gravada em `User.storeLoyalty`, com os mesmos padrões da tela. */
export function lerCashback(storeLoyalty: unknown): RegraDoCashback {
  const l = (storeLoyalty && typeof storeLoyalty === "object" ? storeLoyalty : {}) as Record<string, unknown>;
  const taxa = Math.max(0, num(l.rate, 0));
  return {
    // Mesma leitura do cardápio (CustomerStorePage): só `true` liga.
    ativo: l.cashbackActive === true && taxa > 0,
    taxa,
    minimo: Math.max(0, num(l.minOrderValue, 0)),
    maxResgatePct: Math.min(100, Math.max(0, num(l.maxRedeemPercent, 50))),
    validadeDias: Math.max(0, Math.floor(num(l.expiresInDays, 0))),
    vip: l.vipActive === true
      ? {
          bronze: Math.max(0, num(l.bronzeCashback, 0)),
          prata: Math.max(0, num(l.silverCashback, 1)),
          prataMinimo: Math.max(0, num(l.silverMinSpend, 150)),
          ouro: Math.max(0, num(l.goldCashback, 2)),
          ouroMinimo: Math.max(0, num(l.goldMinSpend, 350)),
        }
      : null,
  };
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** A taxa deste cliente: a da loja mais o bônus do nível VIP pelo que gastou em 30 dias. */
export function taxaDoCliente(regra: RegraDoCashback, gastoEm30Dias: number): number {
  if (!regra.vip) return regra.taxa;
  const v = regra.vip;
  const bonus =
    v.ouroMinimo > 0 && gastoEm30Dias >= v.ouroMinimo ? v.ouro
    : v.prataMinimo > 0 && gastoEm30Dias >= v.prataMinimo ? v.prata
    : v.bronze;
  return regra.taxa + bonus;
}

/**
 * Quanto um pedido gera. `produtos` é a soma dos itens antes de qualquer
 * desconto (é com ela que se compara o mínimo, como o cardápio mostra);
 * `pago` é o que o cliente pagou pelos produtos depois de cupom, prêmio e do
 * próprio cashback usado — o cashback incide sobre dinheiro de verdade, nunca
 * sobre desconto. A taxa de entrega fica fora dos dois.
 */
export function cashbackDoPedido(regra: RegraDoCashback, produtos: number, pago: number, taxa: number): number {
  if (!regra.ativo || produtos <= 0 || produtos < regra.minimo) return 0;
  return centavos(Math.max(0, pago) * (taxa / 100));
}

/** Até quanto o saldo paga neste pedido. */
export function resgateMaximo(regra: RegraDoCashback, saldo: number, produtosAPagar: number): number {
  if (!regra.ativo || saldo <= 0 || produtosAPagar <= 0) return 0;
  return centavos(Math.min(saldo, (Math.max(0, produtosAPagar) * regra.maxResgatePct) / 100));
}

export type PedidoDoCashback = PedidoParaCanal & {
  id: string;
  status?: string | null;
  deliveryType?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  cashbackEarned?: number | null;
  cashbackUsed?: number | null;
};

const CANCELADO = new Set(["CANCELADO", "CANCELED", "RECUSADO", "REJEITADO"]);
const CONCLUIDO = new Set(["ENTREGUE", "ENCERRADO", "CONCLUIDO", "FINALIZADO", "DELIVERED", "CONCLUDED"]);

const statusDe = (p: { status?: string | null }) => String(p.status || "").toUpperCase().trim();

/** O pedido foi feito pelo site da loja. */
export function pedidoDoSite(p: PedidoParaCanal): boolean {
  return chaveDoCanal(p) === "SITE";
}

/** O pedido gera e consome cashback: site, ou robô do WhatsApp já fechado (rascunho não). */
export function pedidoComCashback(p: PedidoParaCanal & { status?: string | null }): boolean {
  const canal = chaveDoCanal(p);
  if (canal === "SITE") return true;
  return canal === "WHATSAPP_IA" && statusDe(p) !== "CRIANDO_IA";
}

/**
 * O pedido já terminou, e o cashback dele pode entrar. Retirada que ficou em
 * "Pronto" conta: muita loja não aperta "Entregue" para quem buscou no balcão.
 */
export function pedidoConcluido(p: { status?: string | null; deliveryType?: string | null }): boolean {
  const s = statusDe(p);
  if (CONCLUIDO.has(s)) return true;
  return s === "PRONTO" && String(p.deliveryType || "").toUpperCase() !== "DELIVERY";
}

const quando = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);

export type SaldoDoCashback = {
  saldo: number;
  /** O próximo crédito a vencer, para o cardápio avisar. */
  proximoVencimento: { valor: number; em: string } | null;
};

/**
 * Lançamento feito À MÃO pela loja (aba Clientes do painel): positivo é
 * crédito, negativo é débito. Existe porque a loja que chega de outro sistema
 * traz clientes com saldo na carteira de lá (Showrrascão, vinda do Gama em
 * 03/10/2026) — e porque cortesia ("o pedido atrasou, ganhou R$ 10") e
 * correção também são do dia a dia.
 *
 * O crédito manual entra como um lote igual ao do pedido entregue: vence pela
 * validade da loja, contada do lançamento, a não ser que a loja marque que
 * ele não vence. O débito consome os lotes mais velhos, como o uso no pedido.
 */
export type AjusteDoCashback = {
  id?: string;
  valor: number;
  createdAt: Date | string;
  semVencimento?: boolean | null;
  motivo?: string | null;
  criadoPor?: string | null;
};

export type MovimentoDoCashback = {
  em: string;
  tipo: "ganho" | "uso" | "credito_manual" | "debito_manual" | "vencido";
  /** Positivo entrou, negativo saiu. */
  valor: number;
  saldoDepois: number;
  pedidoId?: string;
  pedidoNumero?: number | null;
  motivo?: string | null;
  criadoPor?: string | null;
};

export type ExtratoDoCashback = SaldoDoCashback & {
  /** Do mais novo para o mais velho. */
  movimentos: MovimentoDoCashback[];
  /** Cashback de pedido (site ou robô) que ainda não foi entregue: entra quando for. */
  aReceber: number;
};

type PedidoComNumero = PedidoDoCashback & { dailyOrderNumber?: number | null };

/**
 * O caminho único do saldo: créditos viram lotes (valor, entrou em, vence em)
 * e cada uso consome os mais antigos primeiro — é o que faz o vencimento
 * justo: o que vence é o que sobrou de um lote velho, não o saldo inteiro.
 */
function simular(regra: RegraDoCashback, pedidos: PedidoComNumero[], ajustes: AjusteDoCashback[], agora: Date): ExtratoDoCashback {
  const diaMs = 86_400_000;
  type Origem = Omit<MovimentoDoCashback, "em" | "valor" | "saldoDepois">;
  type Evento = { t: number; tipo: "credito" | "uso"; valor: number; semVencimento?: boolean; origem: Origem };
  const eventos: Evento[] = [];
  let aReceber = 0;
  for (const p of pedidos) {
    if (!pedidoComCashback(p)) continue;
    if (CANCELADO.has(statusDe(p))) continue;
    const doPedido = { pedidoId: p.id, pedidoNumero: p.dailyOrderNumber ?? null };
    const usado = Number(p.cashbackUsed) || 0;
    if (usado > 0) eventos.push({ t: quando(p.createdAt), tipo: "uso", valor: usado, origem: { tipo: "uso", ...doPedido } });
    const ganho = Number(p.cashbackEarned) || 0;
    if (ganho > 0 && pedidoConcluido(p)) {
      const t = [quando(p.deliveredAt), quando(p.updatedAt), quando(p.createdAt)].find((x) => Number.isFinite(x))!;
      eventos.push({ t, tipo: "credito", valor: ganho, origem: { tipo: "ganho", ...doPedido } });
    } else if (ganho > 0) {
      aReceber += ganho;
    }
  }
  for (const a of ajustes) {
    const valor = Number(a.valor) || 0;
    const t = quando(a.createdAt);
    if (!valor || !Number.isFinite(t)) continue;
    const quem = { motivo: a.motivo ?? null, criadoPor: a.criadoPor ?? null };
    eventos.push(
      valor > 0
        ? { t, tipo: "credito", valor, semVencimento: a.semVencimento === true, origem: { tipo: "credito_manual", ...quem } }
        : { t, tipo: "uso", valor: -valor, origem: { tipo: "debito_manual", ...quem } },
    );
  }
  // Na mesma hora, o crédito vem antes do uso.
  eventos.sort((a, b) => a.t - b.t || (a.tipo === b.tipo ? 0 : a.tipo === "credito" ? -1 : 1));

  const lotes: { resto: number; vence: number }[] = [];
  const venceEm = (t: number) => (regra.validadeDias > 0 ? t + regra.validadeDias * diaMs : Infinity);
  const saldoAgora = () => lotes.reduce((t, l) => t + (l.resto > 0 ? l.resto : 0), 0);
  const movimentos: MovimentoDoCashback[] = [];
  // O lote que venceu até `t` sai do saldo, e o extrato mostra a saída na data
  // do vencimento. Pedido entregue vence na ordem em que entrou; o crédito
  // manual "não vence" fura essa ordem, por isso a busca é em todos os lotes.
  const vencerAte = (t: number) => {
    const vencidos = lotes.filter((l) => l.resto > 0.004 && l.vence <= t).sort((a, b) => a.vence - b.vence);
    for (const l of vencidos) {
      const valor = l.resto;
      l.resto = 0;
      movimentos.push({ em: new Date(l.vence).toISOString(), tipo: "vencido", valor: -centavos(valor), saldoDepois: centavos(saldoAgora()) });
    }
  };
  for (const e of eventos) {
    vencerAte(e.t);
    if (e.tipo === "credito") {
      lotes.push({ resto: e.valor, vence: e.semVencimento ? Infinity : venceEm(e.t) });
    } else {
      let falta = e.valor;
      for (const l of lotes) {
        if (falta <= 0) break;
        if (l.vence <= e.t || l.resto <= 0) continue;
        const tira = Math.min(l.resto, falta);
        l.resto -= tira;
        falta -= tira;
      }
      // Uso maior que o saldo (pedido feito com saldo que depois foi cancelado
      // na origem) não deixa saldo negativo: o que faltou simplesmente some.
    }
    movimentos.push({
      ...e.origem,
      em: new Date(e.t).toISOString(),
      valor: centavos(e.tipo === "credito" ? e.valor : -e.valor),
      saldoDepois: centavos(saldoAgora()),
    });
  }
  vencerAte(agora.getTime());

  const vivos = lotes.filter((l) => l.resto > 0.004 && l.vence > agora.getTime());
  const saldo = centavos(vivos.reduce((t, l) => t + l.resto, 0));
  const proximo = vivos.filter((l) => Number.isFinite(l.vence)).sort((a, b) => a.vence - b.vence)[0];
  return {
    saldo,
    proximoVencimento: proximo ? { valor: centavos(proximo.resto), em: new Date(proximo.vence).toISOString() } : null,
    movimentos: movimentos.reverse(),
    aReceber: centavos(aReceber),
  };
}

/** O saldo de cashback deste cliente nesta loja, lendo os pedidos dele e os lançamentos da loja. */
export function saldoDoCashback(
  regra: RegraDoCashback,
  pedidos: PedidoDoCashback[],
  agora = new Date(),
  ajustes: AjusteDoCashback[] = [],
): SaldoDoCashback {
  const { saldo, proximoVencimento } = simular(regra, pedidos, ajustes, agora);
  return { saldo, proximoVencimento };
}

/** O saldo e o caminho até ele, para o painel mostrar ao lojista. */
export function extratoDoCashback(
  regra: RegraDoCashback,
  pedidos: PedidoComNumero[],
  ajustes: AjusteDoCashback[],
  agora = new Date(),
): ExtratoDoCashback {
  return simular(regra, pedidos, ajustes, agora);
}

/** O que o cliente gastou na loja nos últimos 30 dias (para o nível VIP), sem os cancelados. */
export function gastoEm30Dias(pedidos: { status?: string | null; createdAt: Date | string; totalAmount?: number | null }[], agora = new Date()): number {
  const desde = agora.getTime() - 30 * 86_400_000;
  return centavos(
    pedidos
      .filter((p) => !CANCELADO.has(statusDe(p)) && quando(p.createdAt) >= desde)
      .reduce((t, p) => t + (Number(p.totalAmount) || 0), 0),
  );
}
