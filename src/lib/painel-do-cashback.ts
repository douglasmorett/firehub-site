/**
 * O PAINEL DO CASHBACK — a aba "Cashback Automático" de Minha loja › Fidelidade
 * mostrando quem tem saldo, quanto a loja deve, o que vence e se o programa
 * traz cliente melhor. Sem banco: a rota (api/store/clientes/cashback/painel)
 * busca, isto conta, e scripts/teste-painel-do-cashback.ts prova.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Douglas, 07/11/2026: "na aba cashback já conseguir ver os clientes que usam
 * e têm crédito, tudo necessário lá". O cashback estava espalhado — a
 * configuração na Fidelidade, o uso em Relatórios › Cupons e descontos, o
 * saldo em Clientes — e o Alan perguntou onde ver. O concorrente (SWFast) tem
 * fidelidade por período, dias a expirar, extrato e o comparativo cliente do
 * programa × fora dele; aqui fica tudo numa tela.
 *
 * ── Nenhuma régua nova ──────────────────────────────────────────────────────
 *
 * - SALDO, extrato e vencimento: o MESMO caminho do cardápio e da aba Clientes
 *   (lib/cashback.ts, `extratoDoCashback`/`saldoDoCashback`). O "vence em 7
 *   dias" é o saldo de hoje menos o saldo que sobraria daqui a 7 dias sem
 *   nenhum pedido novo — a própria simulação de lotes responde, sem uma
 *   segunda conta de vencimento que um dia discordaria da primeira.
 * - GERADO e USADO no período: os movimentos do extrato que caem na janela —
 *   o ganho na data em que ENTROU no saldo (pedido entregue), o uso na data do
 *   pedido. Por isso pode diferir do Cupons e descontos, que conta o cashback
 *   pela data do pedido (inclusive o que ainda não foi entregue).
 * - TICKET e FREQUÊNCIA: a régua da venda (lib/relatorios/regua-da-venda.ts) —
 *   `entraNaVenda`, `atendimentosDaVenda`, `ticketMedio` — sobre os pedidos do
 *   período que a rota busca por `pedidosDoRelatorio` (dia vira às 5h, fuso da
 *   loja). O cliente é a chave da aba Clientes (DDD + 8 últimos dígitos).
 */
import {
  extratoDoCashback,
  saldoDoCashback,
  type AjusteDoCashback,
  type CreditosExtras,
  type MovimentoDoCashback,
  type PedidoDoCashback,
  type RegraDoCashback,
} from "./cashback";
import { atendimentosDaVenda, cent, entraNaVenda, reais, ticketMedio, type PedidoDaRegua } from "./relatorios/regua-da-venda";
import { chaveDoCliente, telefoneDoCliente } from "./clientes-da-loja-regras";

const DIA_MS = 86_400_000;
const c2 = (n: number) => Math.round(n * 100) / 100;

/** O que a rota junta de UM cliente (pela chave do saldo): os pedidos com cashback, os lançamentos e as indicações. */
export type GrupoDoCashback = {
  pedidos: (PedidoDoCashback & { dailyOrderNumber?: number | null })[];
  ajustes: AjusteDoCashback[];
  extras?: CreditosExtras;
};

export type Janela = { inicio: Date; fim: Date };

export type CashbackNoPainel = {
  saldo: number;
  /** Cashback de pedido ainda não entregue: entra quando for. */
  aReceber: number;
  proximoVencimento: { valor: number; em: string } | null;
  /** Desde sempre: o que entrou (pedido, lançamento, indicação), o que saiu (uso, débito) e o que venceu. */
  gerado: number;
  usado: number;
  vencido: number;
  /** Os mesmos, só dentro da janela. */
  geradoNoPeriodo: number;
  usadoNoPeriodo: number;
  vencidoNoPeriodo: number;
  /** Do saldo de hoje, quanto vence nos próximos 7 e 30 dias (sem pedido novo). */
  vence7: number;
  vence30: number;
};

const ENTRADAS = new Set<MovimentoDoCashback["tipo"]>(["ganho", "credito_manual", "indicacao"]);
const SAIDAS = new Set<MovimentoDoCashback["tipo"]>(["uso", "debito_manual"]);

/** O cashback de um cliente no painel, todo ele saído do extrato de lib/cashback.ts. */
export function cashbackNoPainel(regra: RegraDoCashback, g: GrupoDoCashback, janela: Janela, agora = new Date()): CashbackNoPainel {
  const extrato = extratoDoCashback(regra, g.pedidos, g.ajustes, agora, g.extras);
  let gerado = 0, usado = 0, vencido = 0, geradoNoPeriodo = 0, usadoNoPeriodo = 0, vencidoNoPeriodo = 0;
  const ini = janela.inicio.getTime(), fim = janela.fim.getTime();
  for (const m of extrato.movimentos) {
    const t = new Date(m.em).getTime();
    const dentro = t >= ini && t < fim;
    const v = Math.abs(m.valor);
    if (ENTRADAS.has(m.tipo)) { gerado += v; if (dentro) geradoNoPeriodo += v; }
    else if (SAIDAS.has(m.tipo)) { usado += v; if (dentro) usadoNoPeriodo += v; }
    else if (m.tipo === "vencido") { vencido += v; if (dentro) vencidoNoPeriodo += v; }
  }
  // Loja sem validade: nada vence, e a simulação no futuro só repetiria o saldo.
  const sobraEm = (dias: number) =>
    regra.validadeDias > 0 ? saldoDoCashback(regra, g.pedidos, new Date(agora.getTime() + dias * DIA_MS), g.ajustes, g.extras).saldo : extrato.saldo;
  return {
    saldo: extrato.saldo,
    aReceber: extrato.aReceber,
    proximoVencimento: extrato.proximoVencimento,
    gerado: c2(gerado), usado: c2(usado), vencido: c2(vencido),
    geradoNoPeriodo: c2(geradoNoPeriodo), usadoNoPeriodo: c2(usadoNoPeriodo), vencidoNoPeriodo: c2(vencidoNoPeriodo),
    vence7: c2(Math.max(0, extrato.saldo - sobraEm(7))),
    vence30: c2(Math.max(0, extrato.saldo - sobraEm(30))),
  };
}

export type ResumoDoPainel = {
  clientesComSaldo: number;
  /** O que a loja "deve": a soma dos saldos que o cliente pode usar hoje. */
  saldoEmAberto: number;
  aReceber: number;
  geradoNoPeriodo: number;
  usadoNoPeriodo: number;
  vencidoNoPeriodo: number;
  vence7: number;
  clientesQueVencem7: number;
  vence30: number;
  clientesQueVencem30: number;
};

/** Os cartões do topo: a soma das linhas, em centavos para fechar no centavo. */
export function resumoDoPainel(linhas: CashbackNoPainel[]): ResumoDoPainel {
  const soma = (f: (l: CashbackNoPainel) => number) => reais(linhas.reduce((t, l) => t + cent(f(l)), 0));
  return {
    clientesComSaldo: linhas.filter((l) => l.saldo > 0.004).length,
    saldoEmAberto: soma((l) => l.saldo),
    aReceber: soma((l) => l.aReceber),
    geradoNoPeriodo: soma((l) => l.geradoNoPeriodo),
    usadoNoPeriodo: soma((l) => l.usadoNoPeriodo),
    vencidoNoPeriodo: soma((l) => l.vencidoNoPeriodo),
    vence7: soma((l) => l.vence7),
    clientesQueVencem7: linhas.filter((l) => l.vence7 > 0.004).length,
    vence30: soma((l) => l.vence30),
    clientesQueVencem30: linhas.filter((l) => l.vence30 > 0.004).length,
  };
}

// ── O COMPARATIVO ───────────────────────────────────────────────────────────

/** Um pedido do período, com as colunas da régua e as que dizem quem é o cliente e se usou saldo. */
export type PedidoDoComparativo = PedidoDaRegua & {
  customerPhone?: string | null;
  ifoodOrderId?: string | null;
  cashbackUsed?: number | null;
};

export type GrupoDoComparativo = {
  clientes: number;
  vendas: number;
  valor: number;
  ticketMedio: number;
  /** Vendas por cliente no período. */
  frequencia: number;
};

export type ComparativoDoCashback = {
  /** Usou saldo de cashback em pelo menos um pedido do período. */
  usaram: GrupoDoComparativo;
  /** Pediu no período, identificado pelo telefone, e não usou saldo. */
  naoUsaram: GrupoDoComparativo;
  /** O valor vendido da loja no período (todos os pedidos da régua, mesa e iFood inclusive). */
  valorDaLoja: number;
  /** Quanto do valor vendido da loja veio de quem usou cashback, em %. */
  participacao: number;
};

/**
 * Quem usou cashback × quem não usou, no período. Só entra o cliente que a
 * loja reconhece pelo telefone — as mesmas exclusões da aba Clientes: mesa
 * (o nome é "Mesa 5") e iFood (o telefone é o 0800 do app). A venda de quem
 * usou conta INTEIRA no grupo dele, inclusive o pedido em que não usou: a
 * pergunta é se o cliente do programa compra mais, não se o pedido com
 * desconto é maior.
 */
export function comparativoDoCashback(pedidos: PedidoDoComparativo[]): ComparativoDoCashback {
  const validos = pedidos.filter(entraNaVenda);
  const porCliente = new Map<string, PedidoDoComparativo[]>();
  for (const p of validos) {
    if (p.tableSessionId || p.ifoodOrderId) continue;
    const chave = chaveDoCliente(p.customerPhone);
    if (!chave) continue;
    const lista = porCliente.get(chave);
    if (lista) lista.push(p); else porCliente.set(chave, [p]);
  }
  const usaram: PedidoDoComparativo[][] = [];
  const naoUsaram: PedidoDoComparativo[][] = [];
  for (const lista of porCliente.values()) {
    (lista.some((p) => (Number(p.cashbackUsed) || 0) > 0) ? usaram : naoUsaram).push(lista);
  }
  const grupo = (clientes: PedidoDoComparativo[][]): GrupoDoComparativo => {
    const todos = clientes.flat();
    const vendas = atendimentosDaVenda(todos).vendas;
    const valor = reais(todos.reduce((t, p) => t + cent(p.totalAmount), 0));
    return {
      clientes: clientes.length,
      vendas,
      valor,
      ticketMedio: ticketMedio(valor, vendas),
      frequencia: clientes.length ? Math.round((vendas / clientes.length) * 10) / 10 : 0,
    };
  };
  const g1 = grupo(usaram);
  const valorDaLoja = reais(validos.reduce((t, p) => t + cent(p.totalAmount), 0));
  return {
    usaram: g1,
    naoUsaram: grupo(naoUsaram),
    valorDaLoja,
    participacao: valorDaLoja > 0 ? Math.round((g1.valor / valorDaLoja) * 1000) / 10 : 0,
  };
}

// ── A MENSAGEM DO WHATSAPP ──────────────────────────────────────────────────

// Espaço comum depois do "R$": o `style: "currency"` põe um espaço especial
// (U+00A0) que vai junto no texto copiado.
const reaisBr = (n: number) => `R$ ${(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * O texto pronto para o lojista mandar ao cliente pelo WhatsApp DELE (link
 * wa.me — nunca disparo automático). Quando só parte do saldo vence, a
 * mensagem diz quanto: "R$ 30 de saldo, vence dia 15" assusta à toa se só
 * R$ 5 vencem. O link do cardápio vai sozinho na última linha — colado em
 * pontuação, o WhatsApp leva o "." junto e o link dá 404.
 */
export function mensagemDoCashback(d: {
  nome?: string | null;
  saldo: number;
  loja: string;
  proximoVencimento?: { valor: number; em: string } | null;
  fuso?: string | null;
  link?: string | null;
}): string {
  const primeiro = String(d.nome || "").trim().split(/\s+/)[0] || "";
  const oi = primeiro ? `Oi, ${primeiro}!` : "Oi!";
  let texto = `${oi} Você tem ${reaisBr(d.saldo)} de cashback na ${d.loja.trim() || "loja"}.`;
  const v = d.proximoVencimento;
  if (v && v.valor > 0.004) {
    const dia = new Date(v.em).toLocaleDateString("pt-BR", { timeZone: d.fuso || "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    texto += v.valor >= d.saldo - 0.004 ? ` Ele vence dia ${dia}.` : ` ${reaisBr(v.valor)} vence dia ${dia}.`;
  }
  texto += " Use no seu próximo pedido";
  const link = String(d.link || "").trim();
  return link ? `${texto}:\n${link}` : `${texto}!`;
}

/** O link wa.me com o texto pronto; null quando o telefone não é de cliente brasileiro. */
export function linkDoWhatsAppComTexto(telefone: string | null | undefined, texto: string): string | null {
  const t = telefoneDoCliente(telefone);
  return t ? `https://wa.me/55${t}?text=${encodeURIComponent(texto)}` : null;
}
