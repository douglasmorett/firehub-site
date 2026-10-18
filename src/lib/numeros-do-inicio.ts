/**
 * Os números da tela Início (/store), pela RÉGUA ÚNICA DE VENDA — puros, para
 * a tela (navegador), o servidor (src/lib/pedidos-do-inicio.ts) e o teste
 * (scripts/teste-inicio.ts) lerem igual. Nada aqui busca no banco.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * A auditoria de 11/10/2026 achou o Início contando de um jeito e os
 * Relatórios de outro, no MESMO instante (Ragnar Burger):
 *
 *   sábado 22h, "Hoje":    Início R$ 9.650,36 ↓21,3%   × Relatórios R$ 9.092,48 ↑12,4%
 *   domingo 01h30, "Hoje": Início R$ 1.103,86 ↓92,2%   × Relatórios R$ 14.642,88 ↑14,7%
 *   "7 dias":              Início R$ 79.225,10         × Relatórios R$ 62.353,80
 *   mês:                   1.968 "pedidos", ticket R$ 48,58 × 1.625 vendas, ticket R$ 58,84
 *
 * O dia era a meia-noite do NAVEGADOR (não as 5h da loja), o "Hoje" pela
 * metade era comparado com o ontem INTEIRO, o "7 dias" pegava 8 dias de
 * calendário e o anterior repetia o dia −7; "pedidos" e ticket contavam
 * lançamentos (a mesa de três rodadas eram três pedidos), a forma de pagamento
 * era adivinhada por pedaço de palavra (a mesa "N/A" caía em "Outros", o Pix
 * pago no app do iFood virava Pix da loja), "Retirada" era tudo que não fosse
 * entrega (773 lançamentos de mesa entre os 787 da Ragnar), "clientes únicos"
 * contava o 0800 do iFood com o localizador do pedido (um "cliente" por pedido)
 * e o "lucro líquido" era o faturamento — sem custo cadastrado, sem a taxa e
 * sem a comissão do app.
 *
 * Agora cada número sai da MESMA régua dos Relatórios:
 *   - o período é o DIA DE OPERAÇÃO da loja (vira às 5h, no fuso dela), pelos
 *     atalhos de lib/relatorios/base.ts (`periodoDoAtalho`);
 *   - valor vendido, vendas, lançamentos, ticket e tipos de venda saem de
 *     `resumoDeVendas` (lib/relatorios/vendas.ts) — o "Vendas por período";
 *   - o anterior é o de mesmo tamanho logo antes, CORTADO no mesmo horário
 *     quando o período chega até hoje (`anteriorAteEsteHorario`);
 *   - a forma de pagamento é a do relatório Formas de pagamento
 *     (`pagamentosDoPedido`: cascata do caixa, dividido em partes, pago online
 *     à parte); a mesa vai num grupo próprio, porque a forma dela está no
 *     fechamento da conta, que o Início não busca.
 */
import { inicioDoDiaDaLoja } from "@/lib/fuso";
import {
  HORA_DA_VIRADA, ROTULO_DO_TIPO, diasNoPeriodo, naLoja, periodoAnterior, periodoDoAtalho, somarDias, tipoDeVenda,
  type TipoDeVenda,
} from "@/lib/relatorios/base";
import { anteriorAteEsteHorario, atendimentosDaVenda, cent, entraNaVenda, reais } from "@/lib/relatorios/regua-da-venda";
import { resumoDeVendas, type PedidoParaVendas } from "@/lib/relatorios/vendas";
import { FORMAS, pagamentosDoPedido, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { telefoneCanonico, telefoneDeVerdade } from "@/lib/telefone";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** Mais que isto num "Período" é relatório: ver /store/relatorios. */
export const MAIOR_PERIODO_EM_DIAS = 93;

// ── O PEDIDO QUE A TELA RECEBE ──────────────────────────────────────────────

/**
 * O pedido como a Início o recebe (src/lib/pedidos-do-inicio.ts monta; a rota
 * /api/store/inicio devolve igual). As colunas da régua (mesa, acréscimo,
 * totem, canal, pagamento dividido, pago online) estão aqui porque sem elas a
 * tela não tem como contar venda, tipo e forma do jeito dos Relatórios.
 */
export type PedidoDaTelaInicio = {
  id: string;
  franchiseeId: string;
  totalAmount: number;
  status: string;
  deliveryType: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerLatLng?: unknown;
  paymentMethod?: string;
  /** Pagamento dividido do balcão: [{ method, amount }]. */
  paymentMethods?: unknown;
  paymentPaidAt?: string;
  gatewayProvider?: string;
  source?: string;
  notes?: string;
  tableSessionId?: string;
  parentOrderId?: string;
  totemLicenseId?: string;
  ifoodOrderId?: string;
  ifoodReference?: string;
  openDeliveryOrderId?: string;
  openDeliveryReference?: string;
  openDeliveryChannel?: string;
  dailyOrderNumber?: number;
  storeName?: string;
  storeSlug?: string;
  items: Array<{ id: string; quantity: number; price: number; name: string; cost: number | null; menuProduct: { name: string } }>;
};

/** O que os números leem — a tela e o teste montam só isto. */
export type PedidoDoInicio = Pick<PedidoDaTelaInicio, "id" | "totalAmount" | "status" | "createdAt"> &
  Partial<Omit<PedidoDaTelaInicio, "id" | "totalAmount" | "status" | "createdAt" | "items">> & {
    items?: Array<{ quantity: number; price: number; name?: string; cost?: number | null }>;
  };

// ── O DIA DE OPERAÇÃO ───────────────────────────────────────────────────────

/**
 * O instante em que começa o dia de operação `dia` ("YYYY-MM-DD") no fuso da
 * loja: as 5h. É `inicioOperacional` de lib/relatorios/servidor.ts, que não
 * pode vir para o navegador (aquele arquivo puxa o Prisma e a sessão) — o
 * teste confere que os dois dão o mesmo instante, dia a dia, em vários fusos.
 */
export function inicioDoDiaOperacional(dia: string, tz: string | null | undefined): Date {
  const meioDia = new Date(`${dia}T12:00:00-03:00`);
  return new Date(inicioDoDiaDaLoja(tz, meioDia).getTime() + HORA_DA_VIRADA * HORA_MS);
}

export type Janela = { inicio: Date; fim: Date };

/** A janela [inicio, fim) de "de" a "ate", inclusive, no dia de operação (a `janelaDoPeriodo` dos Relatórios). */
export function janelaDosDias(de: string, ate: string, tz: string | null | undefined): Janela {
  return { inicio: inicioDoDiaOperacional(de, tz), fim: new Date(inicioDoDiaOperacional(ate, tz).getTime() + DIA_MS) };
}

/** O pedido está na janela [inicio, fim)? A mesma comparação de `pedidosDoRelatorio`. */
export function naJanela(p: { createdAt: Date | string }, j: Janela): boolean {
  const t = new Date(p.createdAt).getTime();
  return t >= j.inicio.getTime() && t < j.fim.getTime();
}

// ── OS FILTROS DA TELA ──────────────────────────────────────────────────────

export type FiltroDoInicio = "hoje" | "ontem" | "semana" | "mes" | "custom";

/**
 * Os dias do filtro, pelos atalhos dos Relatórios. "7 dias" é hoje e os 6
 * anteriores (era "hoje − 7 até hoje": 8 dias de calendário). "Período" usa os
 * dias escolhidos; sem um deles, vale hoje.
 */
export function periodoDoFiltro(filtro: FiltroDoInicio, hoje: string, escolhido: { de?: string; ate?: string } = {}): { de: string; ate: string } {
  switch (filtro) {
    case "hoje": return periodoDoAtalho("hoje", hoje);
    case "ontem": return periodoDoAtalho("ontem", hoje);
    case "semana": return periodoDoAtalho("7d", hoje);
    case "mes": return periodoDoAtalho("mes", hoje);
    case "custom": {
      const dia = /^\d{4}-\d{2}-\d{2}$/;
      const de = dia.test(escolhido.de || "") ? String(escolhido.de) : hoje;
      const ate = dia.test(escolhido.ate || "") ? String(escolhido.ate) : hoje;
      return de <= ate ? { de, ate } : { de: ate, ate: de };
    }
  }
}

export type PeriodoDoInicio = {
  de: string;
  ate: string;
  dias: number;
  janela: Janela;
  /**
   * O período anterior de mesmo tamanho, logo antes — cortado no mesmo
   * horário de `agora` quando o período chega até hoje. Nulo quando o
   * período e o anterior juntos passam do teto da tela (o "Período" de 60
   * dias continua abrindo, só sem a comparação).
   */
  anterior: { de: string; ate: string; janela: Janela; ateEsteHorario: boolean } | null;
};

/**
 * O período e o anterior, como o "Vendas por período" compara: o anterior tem
 * o mesmo número de dias (`periodoAnterior`) e, com hoje dentro do período, vai
 * só até este mesmo horário (`anteriorAteEsteHorario`). `agora` é o instante
 * dos DADOS (quando o servidor respondeu), para o hoje e o anterior pararem no
 * mesmo minuto.
 */
export function periodoDoInicio(de: string, ate: string, hoje: string, tz: string | null | undefined, agora: number): PeriodoDoInicio {
  const dias = diasNoPeriodo(de, ate);
  const janela = janelaDosDias(de, ate, tz);
  if (2 * dias > MAIOR_PERIODO_EM_DIAS) return { de, ate, dias, janela, anterior: null };
  const ant = periodoAnterior(de, ate);
  const cortado = anteriorAteEsteHorario(janelaDosDias(ant.de, ant.ate, tz), { ate, hoje, recuo: dias, agora });
  return { de, ate, dias, janela, anterior: { de: ant.de, ate: ant.ate, janela: cortado.janela, ateEsteHorario: cortado.ateEsteHorario } };
}

/** Desde quando a tela precisa de pedidos para mostrar o período (e o anterior). */
export function precisaDesde(p: PeriodoDoInicio): Date {
  return p.anterior ? p.anterior.janela.inicio : p.janela.inicio;
}

// ── VENDAS ──────────────────────────────────────────────────────────────────

export type LinhaDoTipo = { tipo: TipoDeVenda; rotulo: string; vendas: number; lancamentos: number; valor: number; pct: number };

export type VendasDoInicio = {
  /** Valor vendido: Σ totalAmount do que é venda — o "Valor vendido" dos Relatórios. */
  valor: number;
  /** Vendas (atendimentos): a mesa conta uma vez. */
  vendas: number;
  /** Lançamentos: cada pedido que é venda (cada rodada de mesa é um). */
  lancamentos: number;
  /** Das vendas, quantas são contas de mesa. */
  mesas: number;
  /** Valor ÷ vendas. */
  ticket: number;
  cancelados: { pedidos: number; valor: number };
  /** Rascunho do robô e pedido esperando pagamento: nem venda, nem cancelamento. */
  naoConcluidos: number;
  porTipo: LinhaDoTipo[];
  /** Pedidos de R$ 1 milhão ou mais, fora de toda soma (regua-da-venda.ts). */
  valoresImpossiveis: number;
};

const comoPedidoDaRegua = (p: PedidoDoInicio): PedidoParaVendas => ({
  ...(p as any),
  franchiseeId: p.franchiseeId || "",
  items: (p.items || []).map((i) => ({ quantity: Number(i.quantity) || 0, price: Number(i.price) || 0 })),
});

/**
 * As vendas de pedidos JÁ recortados pela janela — pelo `resumoDeVendas` do
 * "Vendas por período", sem conta própria: o Início e o relatório só podem
 * dar o mesmo número se forem a mesma conta.
 */
export function vendasDoInicio(pedidos: PedidoDoInicio[]): VendasDoInicio {
  const r = resumoDeVendas(pedidos.map(comoPedidoDaRegua));
  return {
    valor: r.totalPedidos,
    vendas: r.atendimentos,
    lancamentos: r.pedidos,
    mesas: r.mesas,
    ticket: r.ticketMedio,
    cancelados: r.cancelados,
    naoConcluidos: r.naoConcluidos.pedidos,
    porTipo: r.porTipo.map((t) => ({ tipo: t.tipo, rotulo: t.rotulo, vendas: t.vendas, lancamentos: t.pedidos, valor: t.valor, pct: t.pct })),
    valoresImpossiveis: r.valoresImpossiveis,
  };
}

/** Variação em % (1 casa), ou null quando não há com o que comparar. */
export function variacao(atual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

// ── FORMAS DE PAGAMENTO ─────────────────────────────────────────────────────

export type ChaveDaFormaDoInicio = ChaveDaForma | "MESA";

export type LinhaDaFormaDoInicio = {
  chave: ChaveDaFormaDoInicio;
  rotulo: string;
  /** Em quantos pedidos (ou contas de mesa) a forma apareceu. */
  contas: number;
  valor: number;
  /** Da soma das linhas, 0 a 100. */
  pct: number;
};

/** A ordem do fechamento de caixa e do relatório: a linha não muda de lugar de um dia para o outro. */
const ORDEM_DAS_FORMAS: ChaveDaFormaDoInicio[] = ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VALE", "ONLINE", "MESA", "FIADO", "PROPRIA", "OUTROS"];

const ROTULO_DA_FORMA: Record<ChaveDaFormaDoInicio, string> = {
  ...(Object.fromEntries(FORMAS.map((f) => [f.chave, f.rotulo])) as Record<ChaveDaForma, string>),
  MESA: "Mesa (forma no fechamento da conta)",
};

export const rotuloDaFormaDoInicio = (chave: ChaveDaFormaDoInicio) => ROTULO_DA_FORMA[chave] || chave;

const comoPedidoDasFormas = (p: PedidoDoInicio) => ({
  ...(p as any),
  paymentMethod: p.paymentMethod ?? null,
  paymentMethods: p.paymentMethods,
  paymentPaidAt: p.paymentPaidAt ?? null,
  gatewayProvider: p.gatewayProvider ?? null,
  source: p.source ?? null,
  openDeliveryChannel: p.openDeliveryChannel ?? null,
});

/**
 * Como as vendas do recorte foram pagas, pela régua do relatório Formas de
 * pagamento (`pagamentosDoPedido`): o pedido pago no app ou no site é "Pago
 * online" (o Pix do iFood não é Pix da loja), o pagamento dividido entra em
 * cada forma pela parte dele, e o "Cartão Deb Master" da Wabiz é débito.
 *
 * A MESA vai numa linha própria, pelo valor lançado: a forma dela está nas
 * baixas da conta (TableSession), que o Início não busca — e o lançamento
 * grava "N/A". Antes ela caía em "Outros Meios / Balcão" (R$ 48.759,21 na
 * Ragnar em outubro). O relatório Formas de pagamento abre a mesa por forma.
 *
 * A soma das linhas é o valor vendido (menos os centavos de arredondamento de
 * um pagamento dividido, até 2 por pedido).
 */
export function formasDoInicio(pedidos: PedidoDoInicio[]): LinhaDaFormaDoInicio[] {
  const soma = new Map<ChaveDaFormaDoInicio, { centavos: number; contas: Set<string> }>();
  const somar = (chave: ChaveDaFormaDoInicio, centavos: number, conta: string) => {
    if (centavos <= 0) return;
    const s = soma.get(chave) || { centavos: 0, contas: new Set<string>() };
    s.centavos += centavos;
    s.contas.add(conta);
    soma.set(chave, s);
  };
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    if (p.tableSessionId) { somar("MESA", cent(p.totalAmount), `m:${p.tableSessionId}`); continue; }
    for (const parte of pagamentosDoPedido(comoPedidoDasFormas(p))) somar(parte.forma, parte.centavos, `p:${p.id}`);
  }
  const total = [...soma.values()].reduce((s, x) => s + x.centavos, 0);
  return ORDEM_DAS_FORMAS.filter((k) => soma.has(k)).map((chave) => {
    const s = soma.get(chave)!;
    return { chave, rotulo: rotuloDaFormaDoInicio(chave), contas: s.contas.size, valor: reais(s.centavos), pct: total > 0 ? Math.round((s.centavos / total) * 1000) / 10 : 0 };
  });
}

/** A forma de UM pedido, para a lista de últimos pedidos ("Crédito + Pix" no dividido). */
export function formaDoPedidoNaLista(p: PedidoDoInicio): string {
  if (p.tableSessionId) return "Na conta da mesa";
  const partes = pagamentosDoPedido(comoPedidoDasFormas(p));
  const formas = [...new Set(partes.map((x) => x.forma))];
  if (formas.length === 0) return lerPagamentos(p.paymentMethods).length ? "Dividido" : "—";
  return formas.map((f) => (f === "ONLINE" ? "Pago online" : rotuloDaFormaDoInicio(f))).join(" + ");
}

// ── CLIENTES ────────────────────────────────────────────────────────────────

/**
 * O telefone como chave do cliente: DDD + os 8 últimos dígitos (o nono sai),
 * a forma canônica de lib/telefone.ts — a mesma régua do "é o mesmo número?"
 * e do CRM. Só telefone DE VERDADE (`telefoneDeVerdade`): o 0800 do iFood com
 * o localizador do pedido ("0800 705 1020 ID: 32511427") e o "00000000000" do
 * balcão e da mesa não são cliente. O ramal que o 99Food pendura no número
 * real sai antes, como lá.
 */
export function chaveDoCliente(telefone: string | null | undefined): string | null {
  if (!telefoneDeVerdade(telefone)) return null;
  const semRamal = String(telefone || "")
    .replace(/\(\s*ramal[^)]*\)/gi, " ")
    .replace(/\bramal\s*:?\s*\d+/gi, " ")
    .replace(/\bID\s*:?\s*\d+/gi, " ");
  return telefoneCanonico(semRamal) || null;
}

export type ClientesDoInicio = {
  /** Telefones diferentes entre as vendas do recorte. */
  clientes: number;
  /** Quantas vendas trouxeram telefone de verdade. */
  vendasComTelefone: number;
  vendas: number;
};

/**
 * Clientes IDENTIFICADOS: telefones de verdade diferentes. O iFood esconde o
 * número do cliente (manda o 0800 dele com um localizador diferente a cada
 * pedido) — contado pelo texto cru, cada pedido do iFood era um "cliente" (a
 * Ragnar tinha 1.259 pedidos do iFood e 1.259 "clientes" deles); e as mesas,
 * todas com "00000000000", viravam UM cliente.
 */
export function clientesDoInicio(pedidos: PedidoDoInicio[]): ClientesDoInicio {
  const at = atendimentosDaVenda(pedidos.map(comoPedidoDaRegua));
  const chaves = new Set<string>();
  let vendasComTelefone = 0;
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    const chave = chaveDoCliente(p.customerPhone);
    if (!chave) continue;
    chaves.add(chave);
    if (at.abre.has(p.id)) vendasComTelefone++;
  }
  return { clientes: chaves.size, vendasComTelefone, vendas: at.vendas };
}

// ── VENDAS POR HORA ─────────────────────────────────────────────────────────

/** O eixo começa na virada do dia: 5h, 6h … 23h, 0h … 4h. */
export const HORAS_DO_DIA: number[] = Array.from({ length: 24 }, (_, i) => (HORA_DA_VIRADA + i) % 24);

export type HoraDoInicio = {
  hora: number;
  vendas: number;
  /** Em quantos dias do período esta hora já começou (até `agora`). */
  dias: number;
  /** Vendas ÷ dias: a média por dia (no período de um dia, as vendas). */
  media: number;
};

/**
 * Vendas por hora do relógio da loja, em MÉDIA POR DIA. A venda conta na hora
 * em que abriu (a mesa, no primeiro lançamento) — antes eram lançamentos
 * somados de todos os dias, e o "7 dias" mostrava a soma da semana como se
 * fosse o pico de um dia. A média de cada hora divide só pelos dias em que
 * aquela hora já chegou: às 14h de hoje, o 20h dos "7 dias" divide por 6.
 */
export function vendasPorHora(pedidos: PedidoDoInicio[], o: { de: string; ate: string; tz: string | null | undefined; agora: number }): HoraDoInicio[] {
  const at = atendimentosDaVenda(pedidos.map(comoPedidoDaRegua));
  const contagem = new Array(24).fill(0);
  for (const p of pedidos) if (at.abre.has(p.id)) contagem[naLoja(p.createdAt, o.tz).hora]++;
  const n = Math.max(1, diasNoPeriodo(o.de, o.ate));
  const inicioDosDias = Array.from({ length: n }, (_, i) => inicioDoDiaOperacional(somarDias(o.de, i), o.tz).getTime());
  return HORAS_DO_DIA.map((hora) => {
    const desloc = ((hora - HORA_DA_VIRADA + 24) % 24) * HORA_MS;
    const dias = inicioDosDias.filter((t) => t + desloc <= o.agora).length;
    const vendas = contagem[hora];
    return { hora, vendas, dias, media: dias > 0 ? vendas / dias : vendas };
  });
}

// ── PRODUTOS ────────────────────────────────────────────────────────────────

export type ProdutoDoInicio = { name: string; qty: number; total: number; cost: number };

/**
 * Os produtos mais vendidos do recorte: só pedido que é venda e só item com
 * quantidade (item tirado na edição fica com 0 e não conta — a régua do Itens
 * vendidos). `nomeDe` decide o nome (a tela tira o do combo).
 */
export function produtosDoInicio(pedidos: PedidoDoInicio[], nomeDe: (item: any) => string, limite = 8): ProdutoDoInicio[] {
  const mapa = new Map<string, { name: string; qty: number; c: number; custo: number }>();
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    for (const item of p.items || []) {
      const q = Number(item.quantity) || 0;
      if (q <= 0) continue;
      const name = nomeDe(item) || "Item (Integração)";
      const m = mapa.get(name) || { name, qty: 0, c: 0, custo: 0 };
      m.qty += q;
      m.c += Math.round((Number(item.price) || 0) * q * 100);
      m.custo += (Number(item.cost) || 0) * q;
      mapa.set(name, m);
    }
  }
  return [...mapa.values()]
    .map((m) => ({ name: m.name, qty: m.qty, total: reais(m.c), cost: m.custo }))
    .sort((a, b) => b.qty - a.qty || b.total - a.total)
    .slice(0, limite);
}

// ── O PEDIDO NA LISTA ───────────────────────────────────────────────────────

/** O tipo de venda do pedido ("Entrega", "Mesa"…), a mesma régua dos Relatórios. */
export function tipoDoPedidoNaLista(p: PedidoDoInicio): string {
  return ROTULO_DO_TIPO[tipoDeVenda(p as any)];
}

/** O número que a loja conhece: o do dia, o do app, ou o fim do id. */
export function numeroDoPedidoNaLista(p: PedidoDoInicio): string {
  if (p.dailyOrderNumber) return `#${p.dailyOrderNumber}`;
  const ref = p.ifoodReference || p.openDeliveryReference;
  if (ref) return `#${ref}`;
  return `#${String(p.id).slice(-6).toUpperCase()}`;
}

/** "20:15" no relógio da LOJA (não no do computador). */
export function horaNaLoja(instante: Date | string | number, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz || "America/Sao_Paulo" }).format(new Date(instante));
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(instante));
  }
}

// ── A ATUALIZAÇÃO ───────────────────────────────────────────────────────────

/**
 * Junta o que acabou de chegar do servidor ao que a tela já tinha: tudo que
 * foi criado desde `desde` é substituído pela versão nova (status, total e
 * cancelamento mudam); o que é mais antigo fica. Mais novos primeiro.
 */
export function juntarPedidos<P extends { id: string; createdAt: string }>(tinha: P[], novos: P[], desde: number): P[] {
  const ficam = tinha.filter((p) => new Date(p.createdAt).getTime() < desde);
  const vistos = new Set(novos.map((p) => p.id));
  return [...ficam.filter((p) => !vistos.has(p.id)), ...novos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Desde quando reler para atualizar a tela: o começo do dia de operação de
 * hoje — ou um pouco antes do último instante que o servidor já mandou, se for
 * mais cedo (a tela que ficou escondida de madrugada relê a virada das 5h
 * inteira). Nunca antes do que a tela tem carregado.
 */
export function desdeDaAtualizacao(o: { hoje: string; tz: string | null | undefined; cobertoAte: number; cobertoDesde: number }): number {
  const inicioDeHoje = inicioDoDiaOperacional(o.hoje, o.tz).getTime();
  return Math.max(o.cobertoDesde, Math.min(inicioDeHoje, o.cobertoAte - 10 * 60 * 1000));
}
