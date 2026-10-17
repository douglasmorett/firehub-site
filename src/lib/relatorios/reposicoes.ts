/**
 * RELATÓRIO DE REPOSIÇÕES — o "Faltou item" e o "Veio errado (troca)" do
 * Ver pedido (lib/reposicao.ts): quantos foram, quanto isso representa nas
 * vendas e quanto custou refazer e entregar de novo.
 *
 * Pedido do dono (Douglas, 16/10/2026): "Nos relatórios eu tenho que conseguir
 * ver isso: relatório de itens 'troca' ou 'veio errado', saber quantos foram,
 * quanto isso representa e quanto custo de refazer e de entrega me gerou."
 *
 * Puro (sem banco): quem busca é api/store/relatorios/reposicoes. Testado em
 * scripts/teste-relatorio-de-reposicoes.ts.
 *
 * ── Como a reposição está gravada ───────────────────────────────────────────
 *
 * É um pedido NOVO de R$ 0,00 (`totalAmount` 0, itens com `price` 0) com
 * `reposicao` = { pedidoId do original, numero, motivo }. Os itens apontam
 * para o produto do cardápio; o item que era uma OPÇÃO de combo ("1x Esfiha de
 * Nevada" do combo de 11) vira item próprio, ligado ao produto de MESMO NOME —
 * e, quando o nome não existe no cardápio, a rota deixa o produto do COMBO
 * (é o que dá a categoria no KDS). Reposição cancelada não conta.
 *
 * ── O que é prejuízo (o dono, 16/10/2026) ───────────────────────────────────
 *
 * "Se não foi feita, só o custo da entrega de novo; se refez, o custo é do
 * primeiro e do segundo."
 *
 *  • FALTOU ITEM: o item não tinha sido feito. Ele é feito agora pela primeira
 *    vez, e o custo dele JÁ está no CMV da venda do pedido original. Custo de
 *    produto a mais = R$ 0,00; o prejuízo é só a corrida de novo.
 *  • VEIO ERRADO (TROCA): o errado já entrou no CMV pela venda original; o
 *    refeito é custo A MAIS — no relatório (custo de refazer) e no CMV do DRE
 *    (`custoDasReposicoesPorDia`, linha "Reposições (troca)").
 *  • A ENTREGA, nos dois: o acerto do motoboy já a paga (e o DRE já a lança
 *    em "Entregadores"); o relatório só a mostra.
 *  • Reposição não é venda em lugar nenhum (lib/relatorios/sem-reposicao.ts).
 *
 * ── As réguas ───────────────────────────────────────────────────────────────
 *
 *  • CUSTO DE REFAZER (só TROCA): a mesma régua do CMV do DRE (lib/financeiro/custo-pela-ficha.ts):
 *    ficha técnica × custo do insumo NO DIA da reposição; combo pela ficha
 *    das opções; sem ficha, o custo digitado no produto (`MenuProduct.cost`).
 *    Sem nada disso o item fica SEM CUSTO — não entra na soma e a tela conta
 *    quantos ficaram de fora (regra da casa: sem custo não se inventa custo).
 *    A opção de combo cujo nome não existe no cardápio NÃO leva o custo do
 *    combo inteiro (`itemParaCusto`): fica sem custo, pelo nome.
 *  • VALOR DE VENDA (referência, "quanto vale o que foi dado de novo"): o
 *    preço do produto no cardápio × quantidade. Sem preço, fica de fora e é
 *    contado.
 *  • CUSTO DA ENTREGA (`custoDaEntrega`): o que o acerto paga ao motoboy pela
 *    corrida — a mesma conta do Painel e do Acerto (lib/ganho-do-entregador.ts,
 *    `ganhoDoPedido`). Desde 15/10/2026 (commit e472f649) a reposição grava a
 *    taxa do original em `entregaGratis` ("Reposição do #N"); a anterior não
 *    tem, e a taxa do original entra como ESTIMADA. Sem motoboy marcado, vale
 *    a taxa da corrida. Retirada, balcão e mesa não têm entrega.
 *  • "% DAS VENDAS": pedidos que precisaram de reposição ÷ vendas do período
 *    (a régua única, lib/relatorios/regua-da-venda.ts, SEM as próprias
 *    reposições — são pedidos de R$ 0,00, não venda nova). "% DO FATURAMENTO":
 *    custo total ÷ valor vendido.
 */
import { taxaDaCorrida, ganhoDoPedido, ROTULO_DA_ORIGEM, type AcertoLimpo, type PedidoParaGanho } from "@/lib/ganho-do-entregador";
import { lerEntregaGratis } from "@/lib/entrega-gratis";
import { lerEscolhas, type CustoDoItem, type ItemParaCusto, type MotivoSemCusto } from "@/lib/financeiro/custo-pela-ficha";
import type { RegraDeRepasse } from "@/lib/repasse-do-entregador";
import { lerReposicao, type MotivoDaReposicao } from "@/lib/reposicao";
import { c2, naLoja } from "@/lib/relatorios/base";
import { atendimentosDaVenda, entraNaVenda, situacaoDoPedido, type PedidoDaRegua } from "@/lib/relatorios/regua-da-venda";

export const MOTIVOS: MotivoDaReposicao[] = ["FALTOU", "TROCA"];

/** Os nomes das abas do Ver pedido, que é como o lojista conhece. */
export const ROTULO_NO_RELATORIO: Record<MotivoDaReposicao, string> = {
  FALTOU: "Faltou item",
  TROCA: "Veio errado (troca)",
};

const cent = (v: number) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => Math.round(c) / 100;
const pct = (parte: number, todo: number): number | null => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : null);
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const hhmm = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

// ── O ITEM ──────────────────────────────────────────────────────────────────

/** O item da reposição como o banco devolve. */
export type ItemGravado = {
  menuProductId: string | null;
  productName: string | null;
  quantity: number;
  notes?: string | null;
  comboSelections?: unknown;
  /** O produto do cardápio (nome e preço de hoje). */
  menuProduct?: { name: string | null; price?: number | null } | null;
};

/**
 * Como o item entra na régua de custo. O caso que pede cuidado: a OPÇÃO de
 * combo reposta sozinha cujo nome não existe no cardápio. A rota grava o
 * produto do combo (`menuProductId` do combo, a nota "do <combo>") — passar o
 * id adiante daria o custo do COMBO INTEIRO a uma esfiha. Aí o produto sai e o
 * custo é procurado só pelo nome (que não casa: fica sem custo).
 */
export function itemParaCusto(item: ItemGravado): { item: ItemParaCusto; opcaoSemProduto: boolean } {
  const nome = String(item.productName || item.menuProduct?.name || "Item").trim();
  const cadastrado = item.menuProduct?.name ? String(item.menuProduct.name) : "";
  const opcaoSemProduto = Boolean(
    item.menuProductId && cadastrado
      && /^do\s/i.test(String(item.notes || "").trim())
      && lerEscolhas(item.comboSelections).length === 0
      && normalizar(cadastrado) !== normalizar(nome),
  );
  return {
    item: {
      produtoId: opcaoSemProduto ? null : item.menuProductId,
      nome,
      quantidade: Number(item.quantity) || 0,
      preco: 0,
      escolhas: item.comboSelections ?? null,
    },
    opcaoSemProduto,
  };
}

/** O preço do cardápio × quantidade, ou nulo (sem preço, ou opção sem produto). */
export function valorDeVendaDoItem(item: ItemGravado): number | null {
  if (itemParaCusto(item).opcaoSemProduto) return null;
  const preco = Number(item.menuProduct?.price);
  const q = Number(item.quantity) || 0;
  if (!(preco > 0) || !(q > 0)) return null;
  return c2(preco * q);
}

const ROTULO_DA_FALTA: Record<MotivoSemCusto, string> = {
  SEM_FICHA: "sem ficha técnica e sem custo no produto",
  INSUMO_SEM_CUSTO: "insumo da ficha sem custo",
  NOME_NAO_CASA: "o nome não está no cardápio",
  OPCAO_SEM_FICHA: "opção do combo sem ficha nem custo",
};

/** O que falta para o item ter custo, em português de lojista. */
export function textoDasFaltas(c: CustoDoItem): string {
  const porMotivo = new Map<MotivoSemCusto, string[]>();
  for (const f of c.faltas) {
    if (!porMotivo.has(f.motivo)) porMotivo.set(f.motivo, []);
    if (!porMotivo.get(f.motivo)!.includes(f.nome)) porMotivo.get(f.motivo)!.push(f.nome);
  }
  return [...porMotivo].map(([m, nomes]) =>
    m === "SEM_FICHA" || m === "NOME_NAO_CASA" ? ROTULO_DA_FALTA[m] : `${ROTULO_DA_FALTA[m]}: ${nomes.join(", ")}`,
  ).join("; ") || "sem custo cadastrado";
}

// ── A ENTREGA ───────────────────────────────────────────────────────────────

export type OrigemDaEntrega =
  /** Motoboy marcado: o que o acerto dele paga pela corrida. */
  | "ACERTO"
  /** Sem motoboy marcado: a taxa da corrida (a do original). */
  | "TAXA_DA_CORRIDA"
  /** Entrega sem taxa nenhuma para medir. */
  | "SEM_TAXA"
  /** Retirada, balcão, mesa: ninguém rodou. */
  | "SEM_ENTREGA";

export type EntregaDaReposicao = {
  valor: number;
  origem: OrigemDaEntrega;
  /** A reposição é anterior a 15/10/2026 e o valor saiu da taxa do pedido original. */
  estimado: boolean;
  /** De onde saiu o valor, para a tela. */
  detalhe: string;
};

export type PedidoDaEntrega = PedidoParaGanho & { deliveryType?: string | null };

/**
 * O custo da corrida da reposição.
 *
 *   1. Não é entrega (retirada, balcão, mesa): R$ 0,00, sem corrida.
 *   2. A taxa: a gravada na reposição (`entregaGratis` desde 15/10/2026). Sem
 *      ela, a do original (`taxaDaCorrida`) — ESTIMADA.
 *   3. Com motoboy marcado: o que o acerto dele paga (`ganhoDoPedido`, a conta
 *      do Painel e do Acerto). Só diária = R$ 0,00 a mais. A estimativa só
 *      conta quando o acerto usou a taxa (pela taxa do cliente ou pela tabela
 *      da loja); quem paga por faixa, km ou valor fixo não depende dela.
 *   4. Sem motoboy: a taxa da corrida.
 */
export function custoDaEntrega(args: {
  reposicao: PedidoDaEntrega;
  original: PedidoParaGanho | null;
  acerto?: AcertoLimpo | null;
  regraDaLoja?: RegraDeRepasse | null;
  zonas?: unknown;
}): EntregaDaReposicao {
  const { reposicao, original, acerto, regraDaLoja, zonas } = args;
  if (String(reposicao.deliveryType || "DELIVERY").toUpperCase() !== "DELIVERY") {
    return { valor: 0, origem: "SEM_ENTREGA", estimado: false, detalhe: "sem entrega (retirada, balcão ou mesa)" };
  }
  let pedido: PedidoParaGanho = reposicao;
  let estimou = false;
  if (!(Number(reposicao.deliveryFee) > 0) && !lerEntregaGratis(reposicao.entregaGratis)) {
    const doOriginal = original ? taxaDaCorrida(original) : 0;
    if (doOriginal > 0) {
      pedido = { ...reposicao, entregaGratis: { valor: doOriginal, motivo: "Estimada pela taxa do pedido original" } };
      estimou = true;
    }
  }
  if (acerto) {
    const g = ganhoDoPedido({ acerto, pedido, regraDaLoja, zonas, ehMarketplace: false });
    const usouATaxa = g.origem === "TAXA_DO_CLIENTE" || g.origem === "REGRA_DA_LOJA";
    const estimado = estimou && usouATaxa;
    return {
      valor: c2(g.valor), origem: "ACERTO", estimado,
      detalhe: `acerto do motoboy: ${ROTULO_DA_ORIGEM[g.origem]}${estimado ? " (taxa do pedido original, estimada)" : ""}`,
    };
  }
  const v = c2(taxaDaCorrida(pedido));
  if (v <= 0) return { valor: 0, origem: "SEM_TAXA", estimado: false, detalhe: "entrega sem taxa para medir" };
  return {
    valor: v, origem: "TAXA_DA_CORRIDA", estimado: estimou,
    detalhe: estimou ? "sem motoboy marcado: taxa do pedido original (estimada)" : "sem motoboy marcado: taxa da corrida",
  };
}

// ── MONTAR CADA REPOSIÇÃO ───────────────────────────────────────────────────

/** A reposição como o banco devolve (o `select` da rota). */
export type PedidoDeReposicao = PedidoDaEntrega & {
  id: string;
  franchiseeId: string;
  createdAt: Date | string;
  status?: string | null;
  dailyOrderNumber?: number | null;
  customerName?: string | null;
  motoboyId?: string | null;
  reposicao: unknown;
  items: ItemGravado[];
};

/** O pedido original, com o que a conta usa. */
export type PedidoOriginal = PedidoParaGanho & {
  id: string;
  dailyOrderNumber?: number | null;
  ifoodReference?: string | null;
  openDeliveryReference?: string | null;
};

export type ItemDaReposicaoMontado = {
  nome: string;
  quantidade: number;
  /**
   * O custo A MAIS de refazer. TROCA: o custo do refeito (nulo = sem custo
   * cadastrado, fora da soma). FALTOU: 0 — o item já estava na venda original.
   */
  custo: number | null;
  fonte: CustoDoItem["fonte"];
  /** FALTOU: o item já estava na venda do pedido original; só a entrega é prejuízo. */
  jaNaVenda: boolean;
  /** O que falta para ter custo ("sem ficha técnica…"). */
  semCustoPorque: string | null;
  valorDeVenda: number | null;
};

export type ReposicaoMontada = {
  id: string;
  franchiseeId: string;
  criadaEm: string;
  dia: string;
  hora: string;
  numero: string;
  motivo: MotivoDaReposicao;
  original: { id: string; numero: string };
  cliente: string;
  tipo: string;
  motoboy: string | null;
  itens: ItemDaReposicaoMontado[];
  entrega: EntregaDaReposicao;
};

export type ContextoDaMontagem = {
  tz: string;
  /** A régua do DRE (lib/financeiro/cmv-do-financeiro.ts, `prepararCustoDosItens`), por loja. */
  custoDoItem: (lojaId: string, item: ItemParaCusto, dia: string) => CustoDoItem;
  originais: Map<string, PedidoOriginal>;
  motoboys: Map<string, { nome: string; acerto: AcertoLimpo | null }>;
  regraDaLoja?: (lojaId: string) => { regra: RegraDeRepasse | null; zonas: unknown } | null;
};

/** Cada reposição com os itens custeados e a corrida. Pedido sem `reposicao` válida fica de fora. */
export function montarReposicoes(pedidos: PedidoDeReposicao[], ctx: ContextoDaMontagem): ReposicaoMontada[] {
  const saida: ReposicaoMontada[] = [];
  for (const p of pedidos) {
    const r = lerReposicao(p.reposicao);
    if (!r) continue;
    const quando = new Date(p.createdAt);
    const onde = naLoja(quando, ctx.tz);
    const original = ctx.originais.get(r.pedidoId) || null;
    const itens: ItemDaReposicaoMontado[] = [];
    for (const i of p.items || []) {
      if (!((Number(i.quantity) || 0) > 0)) continue;
      const { item } = itemParaCusto(i);
      if (r.motivo === "FALTOU") {
        // Feito agora pela primeira vez: o custo já está no CMV da venda original.
        itens.push({ nome: item.nome || "Item", quantidade: item.quantidade, custo: 0, fonte: null, jaNaVenda: true, semCustoPorque: null, valorDeVenda: valorDeVendaDoItem(i) });
        continue;
      }
      const c = ctx.custoDoItem(p.franchiseeId, item, onde.dia);
      itens.push({
        nome: item.nome || "Item",
        quantidade: item.quantidade,
        custo: c.custo,
        fonte: c.fonte,
        jaNaVenda: false,
        semCustoPorque: c.custo == null ? textoDasFaltas(c) : null,
        valorDeVenda: valorDeVendaDoItem(i),
      });
    }
    const mb = p.motoboyId ? ctx.motoboys.get(p.motoboyId) : undefined;
    const loja = ctx.regraDaLoja?.(p.franchiseeId) || null;
    saida.push({
      id: p.id,
      franchiseeId: p.franchiseeId,
      criadaEm: quando.toISOString(),
      dia: onde.dia,
      hora: hhmm(onde.minutos),
      numero: p.dailyOrderNumber ? String(p.dailyOrderNumber) : p.id.slice(-6).toUpperCase(),
      motivo: r.motivo,
      original: { id: r.pedidoId, numero: r.numero || (original?.dailyOrderNumber ? String(original.dailyOrderNumber) : r.pedidoId.slice(-6).toUpperCase()) },
      cliente: String(p.customerName || "Cliente"),
      tipo: String(p.deliveryType || "DELIVERY").toUpperCase(),
      motoboy: mb?.nome || null,
      itens,
      entrega: custoDaEntrega({ reposicao: p, original, acerto: mb?.acerto ?? null, regraDaLoja: loja?.regra, zonas: loja?.zonas }),
    });
  }
  return saida.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id));
}

// ── O RELATÓRIO ─────────────────────────────────────────────────────────────

/** A base do "quanto isso representa": as vendas do mesmo recorte, sem as reposições. */
export type VendasDoPeriodo = { vendas: number; valorVendido: number };

/**
 * Vendas e valor vendido pela régua única (regua-da-venda.ts: a mesa conta uma
 * vez, o acréscimo não abre venda, cancelado e valor impossível ficam fora),
 * TIRANDO os próprios pedidos de reposição: eles são R$ 0,00 e não são cliente
 * novo — contados, a reposição baixaria o próprio percentual.
 */
export function vendasSemReposicoes(pedidos: (PedidoDaRegua & { reposicao?: unknown })[]): VendasDoPeriodo {
  const vendas = pedidos.filter((p) => !lerReposicao(p.reposicao));
  let c = 0;
  for (const p of vendas) if (entraNaVenda(p)) c += cent(Number(p.totalAmount) || 0);
  return { vendas: atendimentosDaVenda(vendas).vendas, valorVendido: reais(c) };
}

export type TotaisDasReposicoes = {
  reposicoes: number;
  /** Pedidos originais diferentes (dois papéis para o mesmo pedido contam uma vez). */
  pedidosAfetados: number;
  /** Unidades refeitas. */
  itens: number;
  /** Soma do custo dos itens COM custo. */
  custoRefazer: number;
  /** Unidades sem custo cadastrado (fora da soma). */
  itensSemCusto: number;
  /** Preço de cardápio × quantidade dos itens COM preço. */
  valorDeVenda: number;
  itensSemPreco: number;
  /** Reposições que foram de entrega. */
  entregas: number;
  custoEntrega: number;
  /** Corridas cujo valor saiu da taxa do original (anteriores a 15/10/2026). */
  entregasEstimadas: number;
  valorEstimado: number;
  custoTotal: number;
};

export type LinhaDoMotivo = TotaisDasReposicoes & { motivo: MotivoDaReposicao; rotulo: string };

export type LinhaDoProduto = {
  chave: string;
  nome: string;
  /** Em quantas reposições apareceu. */
  vezes: number;
  quantidade: number;
  faltou: number;
  troca: number;
  /** Soma do custo das unidades com custo; nulo = nenhuma tinha custo. */
  custo: number | null;
  quantidadeSemCusto: number;
  semCustoPorque: string | null;
  valorDeVenda: number;
};

export type LinhaDaReposicao = {
  id: string;
  dia: string;
  hora: string;
  numero: string;
  original: string;
  cliente: string;
  motivo: MotivoDaReposicao;
  rotulo: string;
  tipo: string;
  itens: string;
  /** Soma do custo dos itens com custo; nulo = nenhum tinha custo. */
  custoRefazer: number | null;
  itensSemCusto: number;
  valorDeVenda: number;
  custoEntrega: number;
  entregaEstimada: boolean;
  entregaDetalhe: string;
  custoTotal: number;
  motoboy: string | null;
};

export type ItemSemCusto = { nome: string; porque: string; quantidade: number };

export type DiaDasReposicoes = { dia: string; reposicoes: number; custoTotal: number };

export type ResultadoDasReposicoes = {
  resumo: TotaisDasReposicoes & {
    vendas: number;
    valorVendido: number;
    /** Pedidos afetados ÷ vendas, 0 a 100. Nulo sem venda. */
    pctDasVendas: number | null;
    /** Custo total ÷ valor vendido, 0 a 100. Nulo sem venda. */
    pctDoFaturamento: number | null;
    /** Custo médio por reposição. */
    custoMedio: number;
  };
  porMotivo: LinhaDoMotivo[];
  porProduto: LinhaDoProduto[];
  porDia: DiaDasReposicoes[];
  semCusto: ItemSemCusto[];
  lista: LinhaDaReposicao[];
};

function somar(reps: ReposicaoMontada[]): TotaisDasReposicoes {
  let cRefazer = 0, cVenda = 0, cEntrega = 0, cEstimado = 0;
  let itens = 0, semCusto = 0, semPreco = 0, entregas = 0, estimadas = 0;
  const originais = new Set<string>();
  for (const r of reps) {
    originais.add(r.original.id);
    for (const i of r.itens) {
      itens += i.quantidade;
      if (i.custo == null) semCusto += i.quantidade; else cRefazer += cent(i.custo);
      if (i.valorDeVenda == null) semPreco += i.quantidade; else cVenda += cent(i.valorDeVenda);
    }
    if (r.entrega.origem !== "SEM_ENTREGA") entregas++;
    cEntrega += cent(r.entrega.valor);
    if (r.entrega.estimado) { estimadas++; cEstimado += cent(r.entrega.valor); }
  }
  return {
    reposicoes: reps.length,
    pedidosAfetados: originais.size,
    itens,
    custoRefazer: reais(cRefazer),
    itensSemCusto: semCusto,
    valorDeVenda: reais(cVenda),
    itensSemPreco: semPreco,
    entregas,
    custoEntrega: reais(cEntrega),
    entregasEstimadas: estimadas,
    valorEstimado: reais(cEstimado),
    custoTotal: reais(cRefazer + cEntrega),
  };
}

const descricaoDosItens = (r: ReposicaoMontada) => r.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(", ");

export function relatorioDeReposicoes(reps: ReposicaoMontada[], vendas: VendasDoPeriodo): ResultadoDasReposicoes {
  const total = somar(reps);

  const porMotivo: LinhaDoMotivo[] = MOTIVOS.map((m) => ({ motivo: m, rotulo: ROTULO_NO_RELATORIO[m], ...somar(reps.filter((r) => r.motivo === m)) }));

  // ── Por produto: o nome sem acento e sem caixa junta "Esfiha de Nevada" e "esfiha de nevada".
  type Acc = { nome: string; vezes: Set<string>; q: number; faltou: number; troca: number; c: number; comCusto: boolean; semCusto: number; porque: Set<string>; cVenda: number };
  const produtos = new Map<string, Acc>();
  const semCustoMap = new Map<string, ItemSemCusto>();
  for (const r of reps) {
    for (const i of r.itens) {
      const chave = normalizar(i.nome);
      let a = produtos.get(chave);
      if (!a) { a = { nome: i.nome, vezes: new Set(), q: 0, faltou: 0, troca: 0, c: 0, comCusto: false, semCusto: 0, porque: new Set(), cVenda: 0 }; produtos.set(chave, a); }
      a.vezes.add(r.id);
      a.q += i.quantidade;
      if (r.motivo === "TROCA") a.troca += i.quantidade; else a.faltou += i.quantidade;
      if (i.custo == null) {
        a.semCusto += i.quantidade;
        if (i.semCustoPorque) a.porque.add(i.semCustoPorque);
        const k = `${chave}|${i.semCustoPorque || ""}`;
        const s = semCustoMap.get(k) || { nome: i.nome, porque: i.semCustoPorque || "sem custo cadastrado", quantidade: 0 };
        s.quantidade += i.quantidade;
        semCustoMap.set(k, s);
      } else { a.c += cent(i.custo); a.comCusto = true; }
      if (i.valorDeVenda != null) a.cVenda += cent(i.valorDeVenda);
    }
  }
  const porProduto: LinhaDoProduto[] = [...produtos].map(([chave, a]) => ({
    chave, nome: a.nome, vezes: a.vezes.size, quantidade: a.q, faltou: a.faltou, troca: a.troca,
    custo: a.comCusto ? reais(a.c) : null, quantidadeSemCusto: a.semCusto,
    semCustoPorque: a.porque.size ? [...a.porque].join("; ") : null, valorDeVenda: reais(a.cVenda),
  })).sort((x, y) => y.vezes - x.vezes || y.quantidade - x.quantidade || (y.custo ?? -1) - (x.custo ?? -1) || x.nome.localeCompare(y.nome, "pt-BR"));

  const dias = new Map<string, { n: number; c: number }>();
  const lista: LinhaDaReposicao[] = reps.map((r) => {
    const comCusto = r.itens.filter((i) => i.custo != null);
    const cRefazer = comCusto.reduce((s, i) => s + cent(i.custo!), 0);
    const cEntrega = cent(r.entrega.valor);
    const d = dias.get(r.dia) || { n: 0, c: 0 };
    d.n++; d.c += cRefazer + cEntrega;
    dias.set(r.dia, d);
    return {
      id: r.id, dia: r.dia, hora: r.hora, numero: r.numero, original: r.original.numero, cliente: r.cliente,
      motivo: r.motivo, rotulo: ROTULO_NO_RELATORIO[r.motivo], tipo: r.tipo, itens: descricaoDosItens(r),
      custoRefazer: comCusto.length ? reais(cRefazer) : null,
      itensSemCusto: r.itens.filter((i) => i.custo == null).reduce((s, i) => s + i.quantidade, 0),
      valorDeVenda: reais(r.itens.reduce((s, i) => s + cent(i.valorDeVenda ?? 0), 0)),
      custoEntrega: reais(cEntrega), entregaEstimada: r.entrega.estimado, entregaDetalhe: r.entrega.detalhe,
      custoTotal: reais(cRefazer + cEntrega), motoboy: r.motoboy,
    };
  }).reverse(); // mais recentes primeiro

  const porDia = [...dias].map(([dia, d]) => ({ dia, reposicoes: d.n, custoTotal: reais(d.c) })).sort((a, b) => a.dia.localeCompare(b.dia));
  const semCusto = [...semCustoMap.values()].sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    resumo: {
      ...total,
      vendas: vendas.vendas,
      valorVendido: c2(vendas.valorVendido),
      pctDasVendas: pct(total.pedidosAfetados, vendas.vendas),
      pctDoFaturamento: pct(total.custoTotal, vendas.valorVendido),
      custoMedio: total.reposicoes ? reais(Math.round(cent(total.custoTotal) / total.reposicoes)) : 0,
    },
    porMotivo,
    porProduto,
    porDia,
    semCusto,
    lista,
  };
}

// ── O CUSTO DAS REPOSIÇÕES NO CMV DO DRE ────────────────────────────────────

/** O que as reposições de um dia operacional põem no CMV (lib/financeiro/dre.ts). */
export type ReposicoesNoCmvDoDia = {
  /** Custo dos itens refeitos nas TROCAS (com custo cadastrado). */
  custoDasTrocas: number;
  trocas: number;
  /** Unidades refeitas em troca sem custo cadastrado — fora da soma. */
  trocasSemCusto: number;
  trocasSemCustoNomes: string[];
  /** Reposições de FALTOU ITEM: só contadas (o custo já estava na venda). */
  faltou: number;
};

export type PedidoDeReposicaoNoDre = {
  createdAt: Date | string;
  status?: string | null;
  reposicao: unknown;
  items: ItemGravado[];
};

/**
 * O custo de PRODUTO das reposições, por dia operacional, para o CMV do DRE e
 * do Financeiro. Só a TROCA soma (o refeito é o segundo custo do mesmo item);
 * o FALTOU ITEM só conta (o item é feito pela primeira vez e o custo já está
 * na venda do original). Reposição cancelada não entra. Item de troca sem
 * custo cadastrado fica fora da soma, com o nome — nada é inventado.
 */
export function custoDasReposicoesPorDia(
  pedidos: PedidoDeReposicaoNoDre[],
  custoDoItem: (item: ItemParaCusto, dia: string) => CustoDoItem,
  tz: string,
): Map<string, ReposicoesNoCmvDoDia> {
  const porDia = new Map<string, ReposicoesNoCmvDoDia & { c: number }>();
  for (const p of pedidos) {
    const r = lerReposicao(p.reposicao);
    if (!r || situacaoDoPedido(p.status) !== "venda") continue;
    const dia = naLoja(new Date(p.createdAt), tz).dia;
    let d = porDia.get(dia);
    if (!d) { d = { custoDasTrocas: 0, trocas: 0, trocasSemCusto: 0, trocasSemCustoNomes: [], faltou: 0, c: 0 }; porDia.set(dia, d); }
    if (r.motivo === "FALTOU") { d.faltou++; continue; }
    d.trocas++;
    for (const i of p.items || []) {
      if (!((Number(i.quantity) || 0) > 0)) continue;
      const c = custoDoItem(itemParaCusto(i).item, dia);
      if (c.custo != null) d.c += cent(c.custo);
      else {
        d.trocasSemCusto += Number(i.quantity) || 0;
        if (!d.trocasSemCustoNomes.includes(c.nome)) d.trocasSemCustoNomes.push(c.nome);
      }
    }
  }
  return new Map([...porDia].map(([dia, { c, ...d }]) => [dia, { ...d, custoDasTrocas: reais(c) }]));
}
