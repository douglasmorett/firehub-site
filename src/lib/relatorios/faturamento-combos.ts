/**
 * O relatório "Faturamento de combos" — por dia operacional: quantas vendas
 * levaram combo, a % das vendas com combo, quanto os combos venderam, e o
 * ticket da venda COM combo contra a SEM combo. Embaixo, os combos que mais
 * venderam. Trazido do SWFast a pedido do Douglas (07/11/2026).
 *
 * ── O que é combo aqui ──────────────────────────────────────────────────────
 *
 * No SWF o combo é uma regra de desconto que o carrinho aplica; no FireHub é
 * um PRODUTO montado (MenuProduct com `isCombo`, perguntas em comboGroups).
 * O `comboSelections` do item NÃO serve de sinal: o hambúrguer com
 * "adicionais" e a pizza meio a meio também têm. Um item é combo quando
 * (`ehItemDeCombo`, a régua de lib/antecipacao.ts):
 *
 * - o produto do cardápio está marcado como combo (`isCombo`); ou
 * - o NOME é o de um combo do cardápio — o iFood e o 99 chegam com produto
 *   espelho, sem a marca de combo ("Hakim Kids", lib/antecipacao.ts); ou
 * - o nome do item ou a categoria do produto dizem "combo".
 *
 * Diferente da antecipação, "kit" NÃO conta: na hamburgueria o "Milkshake de
 * Kit Kat" virava combo.
 *
 * ── A régua ─────────────────────────────────────────────────────────────────
 *
 * Vendas, valor e ticket são os do Faturamento por dia
 * (lib/relatorios/regua-da-venda.ts): a mesa é UMA venda, no dia do primeiro
 * lançamento; o valor fica no dia de cada pedido. A venda "tem combo" quando
 * QUALQUER pedido dela tem — a mesa que pediu o combo na segunda rodada é uma
 * venda com combo (`vendaDe` da régua). Então, em todo dia:
 *
 *   vendas com combo + vendas sem combo = vendas do Faturamento por dia
 *   valor com combo  + valor sem combo  = valor do Faturamento por dia
 *
 * VALOR DOS COMBOS é preço × quantidade dos itens que são combo (com as
 * opções cobradas dentro deles), no dia do pedido — sem entrega e antes do
 * desconto do pedido, como o Itens vendidos.
 *
 * Puro: recebe os pedidos já buscados e filtrados
 * (api/store/relatorios/faturamento-combos). Testado em
 * scripts/teste-faturamento-combos.ts.
 */
import { chaveDoNome } from "@/lib/categoria-do-item";
import { diasNoPeriodo, naLoja, somarDias } from "@/lib/relatorios/base";
import { atendimentosDaVenda, cent, entraNaVenda, reais, type PedidoDaRegua } from "@/lib/relatorios/regua-da-venda";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ItemParaCombo = {
  quantity: number | null;
  price: number | null;
  productName?: string | null;
  menuProduct?: { isCombo?: boolean | null; name?: string | null; category?: string | null } | null;
};

export type PedidoParaCombos = Omit<PedidoDaRegua, "items"> & { createdAt: Date | string; items?: ItemParaCombo[] | null };

const FALA_DE_COMBO = /\bcombos?\b/;

/** O nome do item como o relatório mostra: o do cardápio, senão o gravado no pedido (sem o " | opções"). */
export function nomeDoItem(item: ItemParaCombo): string {
  return (item.menuProduct?.name || String(item.productName || "").split(" | ")[0] || "Produto removido").trim();
}

/** O item é combo? `nomesDeCombo` são os nomes (chaveDoNome) dos produtos marcados como combo no cardápio. */
export function ehItemDeCombo(item: ItemParaCombo, nomesDeCombo: Set<string>): boolean {
  if (item.menuProduct?.isCombo === true) return true;
  const nome = chaveDoNome(nomeDoItem(item));
  if (nomesDeCombo.has(nome) || FALA_DE_COMBO.test(nome)) return true;
  return FALA_DE_COMBO.test(chaveDoNome(item.menuProduct?.category));
}

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type EstadoDoDiaDeCombo = "fechado" | "hoje" | "futuro";

export type SomaDeCombos = {
  vendas: number;
  vendasComCombo: number;
  /** Fração (0,25 = 25%). null sem venda. */
  pctComCombo: number | null;
  /** Valor das vendas (o do Faturamento por dia). */
  valor: number;
  valorComCombo: number;
  valorSemCombo: number;
  /** Unidades de combo vendidas. */
  combos: number;
  /** Preço × quantidade dos combos. */
  valorDosCombos: number;
  /** Fração do valor das vendas que veio dos combos. */
  pctDoValor: number | null;
  ticketComCombo: number | null;
  ticketSemCombo: number | null;
};

export type DiaDeCombos = SomaDeCombos & { dia: string; diaSemana: number; estado: EstadoDoDiaDeCombo };

export type ComboVendido = { nome: string; quantidade: number; valor: number; /** Vendas em que apareceu. */ vendas: number };

export type ResultadoDosCombos = {
  dias: DiaDeCombos[];
  total: SomaDeCombos;
  /** Do mais vendido (em R$) para o menos. */
  ranking: ComboVendido[];
  /** Quanto a venda com combo gasta a mais (ou a menos) que a sem combo. null sem um dos dois lados. */
  diferencaDoTicket: { reais: number; pct: number | null } | null;
};

type Centavos = { vendas: number; vendasComCombo: number; valor: number; valorComCombo: number; combos: number; valorDosCombos: number };

const zerado = (): Centavos => ({ vendas: 0, vendasComCombo: 0, valor: 0, valorComCombo: 0, combos: 0, valorDosCombos: 0 });

const fracao = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : null);
const ticket = (valor: number, vendas: number) => (vendas > 0 ? reais(Math.round(valor / vendas)) : null);

function emReais(c: Centavos): SomaDeCombos {
  const valorSemCombo = c.valor - c.valorComCombo;
  const vendasSemCombo = c.vendas - c.vendasComCombo;
  return {
    vendas: c.vendas,
    vendasComCombo: c.vendasComCombo,
    pctComCombo: fracao(c.vendasComCombo, c.vendas),
    valor: reais(c.valor),
    valorComCombo: reais(c.valorComCombo),
    valorSemCombo: reais(valorSemCombo),
    combos: c.combos,
    valorDosCombos: reais(c.valorDosCombos),
    pctDoValor: fracao(c.valorDosCombos, c.valor),
    ticketComCombo: ticket(c.valorComCombo, c.vendasComCombo),
    ticketSemCombo: ticket(valorSemCombo, vendasSemCombo),
  };
}

/** O relatório. Pedidos já filtrados por loja, janela, tipo, canal, marca e horário. */
export function faturamentoDeCombos(e: {
  de: string;
  ate: string;
  tz: string;
  hoje: string;
  pedidos: PedidoParaCombos[];
  /** Nomes dos produtos marcados como combo no cardápio das lojas (o nome cru; aqui vira chaveDoNome). */
  nomesDeCombo: Iterable<string>;
}): ResultadoDosCombos {
  const nomes = new Set([...e.nomesDeCombo].map(chaveDoNome).filter(Boolean));
  const mapa = new Map<string, Centavos & { dia: string; diaSemana: number; estado: EstadoDoDiaDeCombo }>();
  const n = Math.max(0, diasNoPeriodo(e.de, e.ate));
  for (let i = 0; i < n; i++) {
    const dia = somarDias(e.de, i);
    mapa.set(dia, {
      dia, diaSemana: new Date(`${dia}T12:00:00Z`).getUTCDay(),
      estado: dia > e.hoje ? "futuro" : dia === e.hoje ? "hoje" : "fechado",
      ...zerado(),
    });
  }

  const diaDe = new Map<string, string>();
  const validos = e.pedidos.filter((p) => {
    if (!entraNaVenda(p)) return false;
    const dia = naLoja(p.createdAt, e.tz).dia;
    diaDe.set(p.id, dia);
    return mapa.has(dia);
  });
  const at = atendimentosDaVenda(validos);

  // 1ª passada: quais vendas têm combo (o combo pode estar em qualquer rodada).
  const comCombo = new Set<string>();
  const combosDoPedido = new Map<string, ItemParaCombo[]>();
  for (const p of validos) {
    const combos = (p.items || []).filter((i) => (Number(i.quantity) || 0) > 0 && ehItemDeCombo(i, nomes));
    if (!combos.length) continue;
    combosDoPedido.set(p.id, combos);
    comCombo.add(at.vendaDe.get(p.id) as string);
  }

  // 2ª passada: as somas do dia, e o ranking.
  const ranking = new Map<string, { nome: string; quantidade: number; valor: number; vendas: Set<string> }>();
  for (const p of validos) {
    const d = mapa.get(diaDe.get(p.id) as string)!;
    const venda = at.vendaDe.get(p.id) as string;
    const valor = cent(p.totalAmount);
    d.valor += valor;
    if (comCombo.has(venda)) d.valorComCombo += valor;
    if (at.abre.has(p.id)) { d.vendas++; if (comCombo.has(venda)) d.vendasComCombo++; }
    for (const i of combosDoPedido.get(p.id) || []) {
      const q = Number(i.quantity) || 0;
      const c = Math.round((Number(i.price) || 0) * q * 100);
      d.combos += q;
      d.valorDosCombos += c;
      const nome = nomeDoItem(i);
      const chave = chaveDoNome(nome) || nome;
      const r = ranking.get(chave) || { nome, quantidade: 0, valor: 0, vendas: new Set<string>() };
      r.quantidade += q; r.valor += c; r.vendas.add(venda);
      ranking.set(chave, r);
    }
  }

  const todos = [...mapa.values()];
  const soma = zerado();
  for (const d of todos) for (const k of Object.keys(soma) as (keyof Centavos)[]) soma[k] += d[k];
  const total = emReais(soma);

  return {
    dias: todos.map((d) => ({ dia: d.dia, diaSemana: d.diaSemana, estado: d.estado, ...emReais(d) })),
    total,
    ranking: [...ranking.values()]
      .map((r) => ({ nome: r.nome, quantidade: r.quantidade, valor: reais(r.valor), vendas: r.vendas.size }))
      .sort((a, b) => b.valor - a.valor || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR")),
    diferencaDoTicket: total.ticketComCombo !== null && total.ticketSemCombo !== null
      ? { reais: reais(cent(total.ticketComCombo) - cent(total.ticketSemCombo)), pct: fracao(cent(total.ticketComCombo) - cent(total.ticketSemCombo), cent(total.ticketSemCombo)) }
      : null,
  };
}
