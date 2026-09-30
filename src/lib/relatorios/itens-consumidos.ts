/**
 * O relatório "Itens consumidos" — o da Saipos (Relatórios → Estoque), o CMV
 * teórico: quanto de cada INSUMO saiu pelas vendas do período, pela ficha
 * técnica, e quanto isso custa perto do que a loja faturou.
 *
 * ── De onde sai o consumo ───────────────────────────────────────────────────
 *
 * Das baixas que o estoque JÁ GRAVOU (StockTransaction), não de uma conta nova
 * de vendas × ficha. Quem baixa é lib/stock.ts:
 *
 * - `deductStockForOrder` grava uma linha "SALE" por (pedido, insumo), com
 *   quantidade NEGATIVA, `sourceRef` "sale:<pedido>:<insumo>" e a nota
 *   "Baixa automática - Pedido #xxxxxx (id: <pedido>)";
 * - `restoreStockForOrder` (pedido cancelado, lançamento de mesa cancelado,
 *   pedido editado pela tela de pedidos) devolve com uma linha "INPUT" de nota
 *   "Devolução por cancelamento - … (cancel id: <pedido>)" — e APAGA o
 *   `sourceRef` da baixa que desfez (para o pedido reaceito poder baixar de
 *   novo). Por isso o pedido da baixa sai do `sourceRef` OU da nota: a baixa
 *   já devolvida só tem a nota.
 *
 * Usar a baixa gravada, e não refazer a conta pela ficha de hoje, é de
 * propósito: é a ficha do MOMENTO da venda (a mesma que tirou o saldo do
 * estoque), e o combo já vem resolvido opção por opção, do jeito que só a
 * baixa sabe fazer. O preço disso: ficha cadastrada hoje não refaz as vendas de
 * ontem — o relatório diz isso em vez de mostrar um CMV baixo e bonito.
 *
 * ── O que entra, e em que dia ───────────────────────────────────────────────
 *
 * Consumo líquido de cada (pedido, insumo): baixas − devoluções, TODAS as do
 * pedido, e ele conta no dia do PEDIDO — o mesmo dia em que o faturamento dele
 * conta (pedidosDoRelatorio). Custo e faturamento saem do mesmo conjunto de
 * pedidos; é isso que faz o CMV ser uma divisão honesta.
 *
 * O período era o da hora da baixa, e isso quebrava o CMV. Um pedido do dia 19
 * editado no dia 20 (devolve 300 g e baixa 100 g) deixava, no relatório do dia
 * 20, mussarela −200 g e custo −R$ 10, de um pedido que nem estava no
 * faturamento daquele dia. E o pedido das 4h58 baixado às 5h02 caía com o
 * custo num dia e o faturamento no outro. Por isso a rota busca as
 * movimentações até DIAS_DE_FOLGA depois do fim do período: a edição e o
 * reaceite chegam depois do pedido.
 *
 * - Pedido editado pela tela de pedidos (devolve tudo e baixa de novo):
 *   baixa 1 − devolução + baixa 2 = baixa 2, a versão que valeu.
 * - Lançamento de mesa editado pelo painel de mesas (tirar item, mudar a
 *   quantidade) NÃO passa pelo estoque — api/store/table-sessions/[id]/orders/
 *   [orderId] só devolve quando o lançamento inteiro é cancelado. A baixa do
 *   que saiu continua valendo, e o total do lançamento já caiu: o consumo e o
 *   CMV dessa mesa ficam maiores que o vendido. O relatório não tem como
 *   perceber (nada grava a edição), então diz isso no rodapé.
 * - Pedido cancelado: fica de fora inteiro, pelo STATUS do pedido — não é
 *   venda. Olhar só a devolução não bastava: cancelado amanhã teria a baixa
 *   no relatório de hoje e a devolução no de amanhã.
 * - Cancelado e reaceito: baixa 1 − devolução + baixa 2 = uma baixa.
 * - Perda, entrada de nota e saída manual NÃO entram: não são consumo de venda.
 *
 * ── Os filtros ──────────────────────────────────────────────────────────────
 *
 * A movimentação de estoque não tem tipo de venda, canal, marca nem horário.
 * Eles valem pelo PEDIDO que gerou a baixa (sourceRef/nota → pedido → a régua
 * de lib/relatorios/servidor.ts): "quanto de mussarela saiu pelo iFood" é a
 * pergunta que o filtro responde. O período também é o do pedido, no dia
 * operacional da loja (vira às 5h).
 *
 * ── Mesa ────────────────────────────────────────────────────────────────────
 *
 * Cada lançamento de mesa é um pedido, que baixa na hora do lançamento
 * (api/store/table-sessions/[id]/add-order) e devolve quando é cancelado — o
 * consumo da mesa entra como qualquer outro (com a ressalva da edição parcial,
 * acima). No faturamento, o que conta é o `totalAmount` do lançamento (o valor
 * dos itens), NÃO o `totalPaid` da TableSession: os 10% de serviço e a gorjeta
 * não são venda de produto (vão para o garçom) e inflariam o denominador — o
 * CMV da mesa sairia menor do que é.
 *
 * ── E o que a Saipos não mostra ─────────────────────────────────────────────
 *
 * - O CMV só das vendas que BAIXARAM estoque. Se só metade do que foi vendido
 *   baixou, "custo ÷ faturamento" dá a metade do CMV de verdade. O relatório
 *   mostra a cobertura (quanto do vendido baixou estoque) e o CMV só dessa
 *   parte. A cobertura sai da baixa, não do cadastro de hoje: o custo é o da
 *   ficha da hora da venda, e o cadastro de hoje dizia "tem ficha" para a
 *   venda de segunda de um produto cadastrado na quarta — a venda entrava na
 *   base sem custo nenhum, e a loja que está começando a cadastrar (a única
 *   situação que existe hoje) via cobertura verde e um CMV diluído.
 * - A lista dos produtos mais vendidos SEM ficha, para cadastrar — com o aviso
 *   do item de iFood/99 que não tem produto de mesmo nome no cardápio (a baixa
 *   procura a ficha pelo nome; sem o nome, não há onde cadastrar).
 * - Pedido com item de ficha e sem baixa nenhuma: ficha cadastrada depois da
 *   venda, pedido ainda não aceito, ou baixa que falhou.
 *
 * Puro (sem banco): o servidor busca, esta conta soma. Testado em
 * scripts/teste-itens-consumidos.ts. A tela importa daqui SÓ tipos: o
 * `chaveDoNome` vem de lib/categoria-do-item.ts, que importa o prisma — em
 * código de navegador isso puxaria o cliente do banco para o bundle. Por isso
 * o conselho de cada produto sem ficha (`oQueFazer`) já vai pronto no JSON.
 */
import { chaveDoNome } from "@/lib/categoria-do-item";
import { ehProdutoEspelho } from "@/lib/itens-do-relatorio";
import { nomeDoProduto } from "@/lib/relatorios/itens-vendidos";
import { normalizarUnidade } from "@/lib/unidades";
import { STATUS_FORA_DA_VENDA, c2, diasNoPeriodo, ehCancelado, naLoja, somarDias } from "@/lib/relatorios/base";

// ── A MOVIMENTAÇÃO E O PEDIDO DELA ──────────────────────────────────────────

export type MovimentoDeEstoque = {
  stockItemId: string;
  /** "SALE" (baixa de venda), "INPUT" (entrada; a devolução é uma delas), "OUTPUT", "WASTE". */
  type: string;
  quantity: number;
  notes?: string | null;
  sourceRef?: string | null;
  createdAt: Date | string;
};

const REF_DA_BAIXA = /^sale:([^:]+):/;
// "(id: X)" — o parêntese colado no "id:" separa da devolução, que é "(cancel id: X)".
const PEDIDO_NA_NOTA_DA_BAIXA = /\(id:\s*([^)\s]+)\)/;
const PEDIDO_NA_NOTA_DA_DEVOLUCAO = /cancel id:\s*([^)\s]+)/;

/**
 * De qual pedido é a movimentação, e se é baixa ou devolução. `null` = não é
 * consumo de venda (nota de entrada, perda, ajuste manual).
 */
export function pedidoDoMovimento(m: Pick<MovimentoDeEstoque, "type" | "notes" | "sourceRef">): { pedidoId: string; tipo: "baixa" | "devolucao" } | null {
  const tipo = String(m.type || "").toUpperCase();
  if (tipo === "SALE") {
    const id = REF_DA_BAIXA.exec(String(m.sourceRef || ""))?.[1] || PEDIDO_NA_NOTA_DA_BAIXA.exec(String(m.notes || ""))?.[1];
    return id ? { pedidoId: id, tipo: "baixa" } : null;
  }
  if (tipo === "INPUT") {
    const id = PEDIDO_NA_NOTA_DA_DEVOLUCAO.exec(String(m.notes || ""))?.[1];
    return id ? { pedidoId: id, tipo: "devolucao" } : null;
  }
  return null;
}

/** O que o pedido de origem de uma baixa é, para o relatório. */
export type SituacaoDoPedido = "venda" | "cancelado" | "foraDaVenda" | "antesDoPeriodo" | "foraDoFiltro" | "semPedido";

/**
 * A situação do pedido pela régua única (lib/relatorios/base.ts): cancelado e
 * "fora da venda" (totem esperando pagamento, rascunho do robô) não são
 * venda; `noPeriodo` diz se o pedido foi feito dentro do período (o consumo
 * conta no dia do pedido: a edição, hoje, de um pedido de ontem é de ontem);
 * `passaNosFiltros` é o resultado de `filtrarPedidos` (tipo, canal, marca,
 * horário).
 */
export function situacaoDoPedido(pedido: { status: string | null } | null | undefined, passaNosFiltros: boolean, noPeriodo = true): SituacaoDoPedido {
  if (!pedido) return "semPedido";
  if (ehCancelado(pedido.status)) return "cancelado";
  if (STATUS_FORA_DA_VENDA.includes(String(pedido.status || "").toUpperCase())) return "foraDaVenda";
  if (!noPeriodo) return "antesDoPeriodo";
  return passaNosFiltros ? "venda" : "foraDoFiltro";
}

/**
 * Quantos dias depois do fim do período a rota ainda lê movimentações. O
 * consumo de um pedido conta no dia dele, mas a correção chega depois: a
 * edição pela tela de pedidos (devolve e baixa de novo), o reaceite de um
 * cancelado, o agendado aceito no dia da entrega. Sem a folga, o pedido
 * editado no dia seguinte contaria a versão antiga. Sete dias cobrem esses
 * casos com sobra e custam pouco: o que é de pedido de outro período é
 * descartado por `separarMovimentos`.
 */
export const DIAS_DE_FOLGA = 7;

/**
 * Das movimentações lidas (período + folga), as que o relatório usa: TODAS as
 * dos pedidos vendidos no período (inclusive as da folga), e as de outros
 * pedidos só quando caem dentro do período — essas não entram na conta, mas
 * dizem no rodapé por que ficaram de fora (cancelado, fora do filtro, pedido
 * de antes do período). As da folga de pedidos do período seguinte são dele,
 * e somem daqui. `pedidosParaClassificar` são os que o servidor precisa
 * buscar para dar a situação.
 */
export function separarMovimentos<M extends MovimentoDeEstoque>(
  movimentos: M[],
  pedidosVendidos: Set<string>,
  fimDoPeriodo: Date,
): { movimentos: M[]; pedidosParaClassificar: string[] } {
  const usados: M[] = [];
  const classificar = new Set<string>();
  for (const m of movimentos) {
    const origem = pedidoDoMovimento(m);
    if (!origem) continue;
    if (pedidosVendidos.has(origem.pedidoId)) { usados.push(m); continue; }
    const quando = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt);
    if (quando.getTime() >= fimDoPeriodo.getTime()) continue;
    usados.push(m);
    classificar.add(origem.pedidoId);
  }
  return { movimentos: usados, pedidosParaClassificar: [...classificar] };
}

// ── A FICHA TÉCNICA DE CADA ITEM VENDIDO ────────────────────────────────────

export type InsumoDoCadastro = {
  id: string;
  nome: string;
  unidade: string;
  /** StockItem.unitCost: o custo do ÚLTIMO recebimento — o atual, não o do dia da venda. */
  custoUnitario: number | null;
  ativo?: boolean;
};

/** O cadastro que diz se um item vendido baixa estoque — a mesma busca de `deductStockForOrder`. */
export type FichasDoCadastro = {
  /** Produtos (MenuProduct.id) com ficha técnica própria. */
  produtosComFicha: Set<string>;
  /**
   * Por loja: o nome (minúsculo) de produto ATIVO, fora do espelho `ifood-`,
   * que tem ficha. É onde a baixa procura a ficha do item que não tem uma
   * própria — o espelho do iFood/99 pega a do produto de mesmo nome.
   */
  nomesComFichaDe: (lojaId: string) => Set<string>;
  /** Por loja: os nomes (minúsculos) dos produtos ativos de verdade do cardápio, com ou sem ficha. */
  nomesNoCardapioDe: (lojaId: string) => Set<string>;
  /**
   * Produto-combo → as chaves das opções dele que têm ficha (id da opção no
   * grupo, id do produto da opção, nome da opção; minúsculas). O combo quase
   * nunca tem ficha própria: quem consome são as opções escolhidas.
   */
  opcoesComFicha: Map<string, Set<string>>;
  /** Produtos com grupo de opção (combo, pizza de sabores): a baixa deles vem das opções escolhidas. */
  produtosComOpcoes: Set<string>;
  /** Por loja: os nomes (minúsculos) dos produtos do cardápio que têm grupo de opção. */
  nomesComOpcoesDe: (lojaId: string) => Set<string>;
};

/** Monta as fichas a partir do que o servidor leu. */
export function montarFichas(
  produtosAtivos: Array<{ id: string; name: string; franchiseeId: string | null; category?: string | null; active?: boolean | null }>,
  idsComFicha: Iterable<string>,
  opcoesComFicha: Array<{ id: string; menuProductId: string; produtoDoComboId: string; nomeDaOpcao: string | null }>,
  produtosComOpcoes: Iterable<string> = [],
): FichasDoCadastro {
  const produtosComFicha = new Set(idsComFicha);
  const comOpcoes = new Set(produtosComOpcoes);
  const comFicha = new Map<string, Set<string>>();
  const noCardapio = new Map<string, Set<string>>();
  const nomesComOpcoes = new Map<string, Set<string>>();
  const juntar = (mapa: Map<string, Set<string>>, loja: string, nome: string) => {
    if (!mapa.has(loja)) mapa.set(loja, new Set());
    mapa.get(loja)!.add(nome);
  };
  for (const p of produtosAtivos) {
    if (p.active === false) continue;
    const loja = String(p.franchiseeId || "");
    const nome = String(p.name || "").toLowerCase();
    if (!nome) continue;
    // Réplica do `findFirst` da baixa: ativo, não começa com "ifood-", tem ficha.
    if (produtosComFicha.has(p.id) && !p.id.startsWith("ifood-")) juntar(comFicha, loja, nome);
    if (!ehProdutoEspelho({ id: p.id, active: true, category: p.category })) {
      juntar(noCardapio, loja, nome);
      if (comOpcoes.has(p.id)) juntar(nomesComOpcoes, loja, nome);
    }
  }
  const opcoes = new Map<string, Set<string>>();
  for (const o of opcoesComFicha) {
    if (!opcoes.has(o.produtoDoComboId)) opcoes.set(o.produtoDoComboId, new Set());
    const chaves = opcoes.get(o.produtoDoComboId)!;
    for (const c of [o.id, o.menuProductId, o.nomeDaOpcao]) {
      const k = String(c || "").trim().toLowerCase();
      if (k) chaves.add(k);
    }
  }
  const vazio = new Set<string>();
  return {
    produtosComFicha,
    nomesComFichaDe: (loja) => comFicha.get(loja) || vazio,
    nomesNoCardapioDe: (loja) => noCardapio.get(loja) || vazio,
    opcoesComFicha: opcoes,
    produtosComOpcoes: comOpcoes,
    nomesComOpcoesDe: (loja) => nomesComOpcoes.get(loja) || vazio,
  };
}

/**
 * As chaves das escolhas de um item, como `normalizarEscolhasDoCombo`
 * (lib/stock.ts) as lê: no formato do cardápio `{ grupo: { opção: qtd } }` a
 * chave é a opção; no do PDV/mesa/marketplace `[{ name, … }]` valem os ids e o
 * nome; no texto antigo, "2x Esfirra" é "Esfirra" (o "x" é obrigatório).
 */
export function chavesDasEscolhas(comboSelections: unknown): string[] {
  let dados: any = comboSelections;
  if (!dados) return [];
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return []; }
  }
  const saida: string[] = [];
  const guardar = (v: unknown) => { const k = String(v ?? "").trim().toLowerCase(); if (k) saida.push(k); };
  if (Array.isArray(dados)) {
    for (const e of dados) {
      if (typeof e === "string") {
        const m = e.trim().match(/^(\d+)\s*x\s+(.+)$/i);
        guardar(m ? m[2] : e);
      } else if (e && typeof e === "object") {
        if (!(Number(e.quantity ?? e.qty ?? 0) > 0)) continue;
        for (const c of [e.comboGroupItemId, e.optionId, e.menuProductId, e.productId, e.id, e.name ?? e.productName]) guardar(c);
      }
    }
    return saida;
  }
  if (typeof dados === "object") {
    for (const grupo of Object.values(dados as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo)) if (Number(qtd) > 0) guardar(nome);
    }
  }
  return saida;
}

export type ItemVendido = {
  quantity: number;
  price: number;
  productName?: string | null;
  menuProductId?: string | null;
  comboSelections?: unknown;
  menuProduct?: { id?: string | null; name?: string | null; category?: string | null; active?: boolean | null } | null;
};

/** Como o item baixa estoque: ficha própria, a do produto de mesmo nome, a das opções escolhidas, ou nada. */
export type ComoBaixa = "propria" | "peloNome" | "opcoes" | "sem";

/**
 * A mesma sequência de `deductStockForOrder`: a ficha do produto; sem ela, a
 * do produto ativo de MESMO NOME da loja (o espelho do marketplace); e, somada,
 * a das opções escolhidas no combo. O item "sem" não tira nada do estoque.
 */
export function fichaDoItem(item: ItemVendido, lojaId: string, fichas: FichasDoCadastro): ComoBaixa {
  const produtoId = item.menuProduct?.id || item.menuProductId || "";
  if (produtoId && fichas.produtosComFicha.has(produtoId)) return "propria";
  const rotulo = String(item.menuProduct?.name || item.productName || "").toLowerCase();
  if (rotulo && fichas.nomesComFichaDe(lojaId).has(rotulo)) return "peloNome";
  const opcoes = produtoId ? fichas.opcoesComFicha.get(produtoId) : undefined;
  if (opcoes && opcoes.size && chavesDasEscolhas(item.comboSelections).some((k) => opcoes.has(k))) return "opcoes";
  return "sem";
}

// ── O QUE ENTRA E O QUE SAI ─────────────────────────────────────────────────

export type PedidoVendido = {
  id: string;
  franchiseeId: string;
  createdAt: Date | string;
  totalAmount: number;
  /** Chave do canal (lib/relatorios/base.ts, canalDoRelatorio). */
  canal: string;
  items: ItemVendido[];
};

export type LinhaDeInsumo = {
  chave: string;
  nome: string;
  unidade: string;
  quantidade: number;
  /** O custo unitário ATUAL; a média ponderada quando junta o mesmo insumo de duas lojas. null = sem custo. */
  custoUnitario: number | null;
  /** null = o insumo não tem custo cadastrado (não entra no total). */
  custo: number | null;
  /** Participação no custo total, 0 a 100. */
  pct: number;
  /** Em quantos pedidos saiu. */
  pedidos: number;
  ativo: boolean;
};

export type ProdutoSemFicha = {
  chave: string;
  nome: string;
  quantidade: number;
  valor: number;
  /** "cardapio": produto do cardápio; "integracao": espelho de iFood/99/Wabiz…; "removido": o produto não existe mais. */
  origem: "cardapio" | "integracao" | "removido";
  /** Integração/removido: existe produto ativo de mesmo nome no cardápio (é nele que a ficha vai)? */
  temNoCardapio: boolean;
  canais: string[];
  produtoId: string | null;
  /**
   * O produto do cardápio tem grupos de opção (combo, sabores, borda). A baixa
   * SOMA a ficha do produto e a de cada opção escolhida: o combo de esfihas
   * com a receita inteira no combo baixaria a esfiha do cadastro, não a
   * escolhida; a pizza com a borda na própria ficha baixaria borda até no
   * pedido sem borda. O conselho para ele é outro.
   */
  temOpcoes: boolean;
  /** Alguma venda veio de integração (iFood, 99, Wabiz…) — lá a opção escolhida não baixa. */
  vemDeIntegracao: boolean;
  /** O conselho da linha, pronto (a tela e a planilha dizem o mesmo). `alerta` = a ficha sozinha não resolve. */
  oQueFazer: string;
  alerta: boolean;
};

/**
 * O que o lojista faz com o produto vendido sem ficha. Segue o caminho da
 * baixa (lib/stock.ts): o espelho do marketplace acha a ficha pelo NOME
 * EXATO de um produto ativo do cardápio, e as opções escolhidas nele NÃO
 * baixam — o espelho não tem grupos cadastrados, e a baixa só resolve opção
 * pelo grupo do produto do pedido. No "Combo 1" da NIK pelo iFood (40 em
 * 17–23/09/2026), só a ficha do próprio combo baixaria; as esfihas
 * escolhidas lá, não.
 */
export function oQueFazerSemFicha(p: Pick<ProdutoSemFicha, "origem" | "temNoCardapio" | "temOpcoes" | "vemDeIntegracao">): { texto: string; alerta: boolean } {
  if (p.origem === "cardapio") {
    if (!p.temOpcoes) return { texto: "Cadastre a ficha técnica deste produto.", alerta: false };
    return {
      texto: "Tem opções: a baixa soma a ficha do produto (o que vai sempre nele, como massa ou embalagem) e a de cada opção escolhida (sabor, borda, item do combo)."
        + (p.vemDeIntegracao ? " Nas vendas de iFood/99/Wabiz só a ficha do próprio produto baixa: as opções escolhidas lá não." : ""),
      alerta: false,
    };
  }
  if (!p.temNoCardapio) {
    return p.origem === "removido"
      ? { texto: "Produto apagado e sem outro de mesmo nome no cardápio: a baixa não tem onde achar a ficha.", alerta: true }
      : { texto: "Nenhum produto ativo do cardápio tem este nome: a baixa não tem onde achar a ficha.", alerta: true };
  }
  if (p.temOpcoes) {
    return { texto: "A baixa usa a ficha do produto de mesmo nome do cardápio, e só a dele: as opções escolhidas no parceiro não baixam.", alerta: true };
  }
  return { texto: "A ficha vai no produto de mesmo nome do cardápio — a baixa acha por ele.", alerta: false };
}

export type DiaDoConsumo = { dia: string; custo: number; faturamento: number; cmvPct: number | null };

export type ResultadoDoConsumo = {
  insumos: LinhaDeInsumo[];
  total: { custo: number; insumos: number; insumosSemCusto: number; pedidosComBaixa: number };
  /**
   * O total dos itens em três partes que fecham: valorComBaixa +
   * valorComFichaSemBaixa + semFicha.valor = totalDosItens.
   */
  vendas: {
    pedidos: number;
    /** Σ totalAmount — o "total das vendas". */
    faturamento: number;
    /** Σ preço × quantidade dos itens (sem taxa de entrega e desconto). */
    totalDosItens: number;
    /**
     * Os itens que BAIXARAM estoque — a base do "CMV das vendas com baixa". A
     * baixa é gravada por (pedido, insumo), sem dizer de qual item saiu: no
     * pedido que baixou, contam os itens que têm ficha hoje; se nenhum tem
     * (ficha apagada ou trocada depois da venda), conta o pedido inteiro —
     * o custo dele está no numerador, o valor tem de estar no denominador.
     */
    valorComBaixa: number;
    /** Itens com ficha HOJE em pedido que não baixou nada: ficha cadastrada depois da venda, pedido ainda não aceito, baixa que falhou. */
    valorComFichaSemBaixa: number;
    /** valorComBaixa ÷ totalDosItens, 0 a 100; null sem venda no período (não é "0% coberto"). */
    coberturaPct: number | null;
    /** Pedidos com item de ficha que não tiveram baixa nenhuma. */
    pedidosComFichaSemBaixa: number;
    /** Pedidos que baixaram estoque sem nenhum item com ficha hoje: ficha apagada ou trocada depois da venda. */
    pedidosComBaixaSemFichaHoje: number;
  };
  /** Percentuais 0 a 100; null quando não há base. */
  cmv: { sobreFaturamento: number | null; sobreItens: number | null; sobreItensComBaixa: number | null };
  semFicha: { produtos: ProdutoSemFicha[]; quantidade: number; valor: number };
  /** Baixas feitas no período que não entraram, por quê (em pedidos). */
  foraDaConta: { cancelados: number; foraDaVenda: number; antesDoPeriodo: number; foraDosFiltros: number; semPedido: number };
  porDia: DiaDoConsumo[];
};

const q3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (parte: number, todo: number): number | null => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : null);

const comoData = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/**
 * O relatório. `vendas` são os pedidos do período já filtrados
 * (lib/relatorios/servidor.ts, sem cancelados) — a base do CMV % e o conjunto
 * de pedidos cujo consumo conta. `movimentos` são as baixas e devoluções que
 * `separarMovimentos` deixou: todas as desses pedidos, mais as de outros
 * pedidos feitas no período, que só entram no "por que ficou de fora" pela
 * `situacaoDe` (ausente = pedido não encontrado).
 */
export function itensConsumidos(entrada: {
  movimentos: MovimentoDeEstoque[];
  insumos: InsumoDoCadastro[];
  situacaoDe: Map<string, SituacaoDoPedido>;
  vendas: PedidoVendido[];
  fichas: FichasDoCadastro;
  tz: string;
  periodo?: { de: string; ate: string };
}): ResultadoDoConsumo {
  const { movimentos, situacaoDe, vendas, fichas, tz } = entrada;
  const insumoPorId = new Map(entrada.insumos.map((i) => [i.id, i]));
  // O dia de cada pedido vendido: é nele que o consumo do pedido conta, junto
  // com o faturamento — a edição de amanhã corrige o dia do pedido.
  const diaDoPedido = new Map(vendas.map((p) => [p.id, naLoja(comoData(p.createdAt), tz).dia]));

  // ── 1. O consumo líquido de cada (pedido, insumo) ──
  type Liquido = { pedidoId: string; insumoId: string; quantidade: number };
  const liquidos = new Map<string, Liquido>();
  const foraPorSituacao: Record<Exclude<SituacaoDoPedido, "venda">, Set<string>> = {
    cancelado: new Set(), foraDaVenda: new Set(), antesDoPeriodo: new Set(), foraDoFiltro: new Set(), semPedido: new Set(),
  };
  for (const m of movimentos) {
    const origem = pedidoDoMovimento(m);
    if (!origem) continue;
    if (!diaDoPedido.has(origem.pedidoId)) {
      const situacao = situacaoDe.get(origem.pedidoId) || "semPedido";
      // "venda" que não está em `vendas` é o pedido que entrou entre a leitura
      // das vendas e a das baixas (o relatório de hoje, com a loja aberta): nem
      // o faturamento dele está aqui. Aparece no próximo recarregar.
      if (situacao !== "venda") foraPorSituacao[situacao].add(origem.pedidoId);
      continue;
    }
    if (!insumoPorId.has(m.stockItemId)) continue;
    // A baixa grava negativo e a devolução positivo; o módulo protege do
    // registro gravado com o sinal trocado à mão (a mesma defesa de lib/stock.ts).
    const qtd = Math.abs(Number(m.quantity) || 0) * (origem.tipo === "baixa" ? 1 : -1);
    if (!qtd) continue;
    const chave = `${origem.pedidoId}|${m.stockItemId}`;
    let l = liquidos.get(chave);
    if (!l) { l = { pedidoId: origem.pedidoId, insumoId: m.stockItemId, quantidade: 0 }; liquidos.set(chave, l); }
    l.quantidade += qtd;
  }

  // ── 2. Por insumo: o mesmo nome e unidade de duas lojas vira uma linha ──
  type Acumulado = {
    chave: string; nome: string; unidade: string; quantidade: number; custo: number;
    /** A parte da quantidade que tem custo — a base do custo unitário médio. */
    quantidadeComCusto: number;
    semCusto: boolean; comCusto: boolean; pedidos: Set<string>; ativo: boolean; custosUnitarios: Set<number>;
  };
  const porInsumo = new Map<string, Acumulado>();
  const pedidosComBaixa = new Set<string>();
  const custoPorDia = new Map<string, number>();
  for (const l of liquidos.values()) {
    // Com todas as movimentações do pedido juntas, o líquido só fica negativo
    // se falta a baixa que a devolução desfez (gravada fora da janela lida, ou
    // apagada). Não existe consumo negativo: o pedido devolveu tudo, e o
    // que falta não se inventa. Zero também não é consumo (tirou a borda na
    // edição) — a linha zerada só poluiria a tabela.
    if (l.quantidade <= 1e-9) continue;
    const insumo = insumoPorId.get(l.insumoId)!;
    const unidade = normalizarUnidade(insumo.unidade) || String(insumo.unidade || "un");
    const chave = `${chaveDoNome(insumo.nome) || insumo.id}|${unidade}`;
    let a = porInsumo.get(chave);
    if (!a) {
      a = { chave, nome: insumo.nome, unidade, quantidade: 0, custo: 0, quantidadeComCusto: 0, semCusto: false, comCusto: false, pedidos: new Set(), ativo: false, custosUnitarios: new Set() };
      porInsumo.set(chave, a);
    }
    const custoUnitario = Number(insumo.custoUnitario);
    const temCusto = Number.isFinite(custoUnitario) && custoUnitario > 0;
    a.quantidade += l.quantidade;
    a.ativo = a.ativo || insumo.ativo !== false;
    if (temCusto) {
      a.custo += l.quantidade * custoUnitario;
      a.quantidadeComCusto += l.quantidade;
      a.comCusto = true;
      a.custosUnitarios.add(custoUnitario);
      const dia = diaDoPedido.get(l.pedidoId)!;
      custoPorDia.set(dia, (custoPorDia.get(dia) || 0) + l.quantidade * custoUnitario);
    } else {
      a.semCusto = true;
    }
    a.pedidos.add(l.pedidoId);
    pedidosComBaixa.add(l.pedidoId);
  }

  const acumulados = [...porInsumo.values()].filter((a) => a.quantidade > 1e-9);
  const custoTotal = acumulados.reduce((s, a) => s + (a.comCusto ? a.custo : 0), 0);
  const insumos: LinhaDeInsumo[] = acumulados
    .map((a) => {
      const custo = a.comCusto ? c2(a.custo) : null;
      // Um custo só: ele mesmo. Mais de um (o mesmo insumo em duas lojas, a
      // custos diferentes): a média ponderada pelo que saiu de cada uma.
      const custoUnitario = !a.comCusto ? null
        : a.custosUnitarios.size === 1 ? [...a.custosUnitarios][0]
        : a.quantidadeComCusto ? Math.round((a.custo / a.quantidadeComCusto) * 10000) / 10000 : null;
      return {
        chave: a.chave, nome: a.nome, unidade: a.unidade, quantidade: q3(a.quantidade),
        custoUnitario, custo,
        pct: custoTotal > 0 && a.comCusto ? Math.round((a.custo / custoTotal) * 10000) / 100 : 0,
        pedidos: a.pedidos.size, ativo: a.ativo,
      };
    })
    .sort((x, y) => (y.custo ?? -1) - (x.custo ?? -1) || y.quantidade - x.quantidade || x.nome.localeCompare(y.nome, "pt-BR"));

  // ── 3. As vendas: faturamento, o que baixou, o que tem ficha e quem ficou sem ──
  // O custo é da ficha da HORA DA VENDA; o "tem ficha?" do cadastro é de HOJE.
  // Quem decide se a venda entra na base do CMV é a baixa: a Esfiha Carne
  // vendida segunda e terça, com a ficha cadastrada na quarta, tem ficha hoje e
  // não tem custo — na base, ela dava cobertura de 100% e um CMV de 3,33% onde
  // a única venda que baixou tinha 10%.
  let faturamento = 0, totalDosItens = 0, valorComBaixa = 0, valorComFichaSemBaixa = 0;
  let pedidosComFichaSemBaixa = 0, pedidosComBaixaSemFichaHoje = 0;
  const faturamentoPorDia = new Map<string, number>();
  const semFicha = new Map<string, Omit<ProdutoSemFicha, "oQueFazer" | "alerta"> & { canaisSet: Set<string> }>();
  let qtdSemFicha = 0, valorSemFicha = 0;
  for (const p of vendas) {
    const total = Number(p.totalAmount) || 0;
    faturamento += total;
    const dia = diaDoPedido.get(p.id)!;
    faturamentoPorDia.set(dia, (faturamentoPorDia.get(dia) || 0) + total);
    const itens = (p.items || [])
      .map((item) => {
        const qtd = Number(item.quantity) || 0;
        return { item, qtd, valor: (Number(item.price) || 0) * qtd, como: fichaDoItem(item, p.franchiseeId, fichas) };
      })
      .filter((i) => i.qtd > 0);
    const baixou = pedidosComBaixa.has(p.id);
    const algumComFicha = itens.some((i) => i.como !== "sem");
    if (baixou && !algumComFicha) pedidosComBaixaSemFichaHoje++;
    if (!baixou && algumComFicha) pedidosComFichaSemBaixa++;
    for (const { item, qtd, valor, como } of itens) {
      totalDosItens += valor;
      // Pedido que baixou: o item com ficha hoje é o que baixou. Se nenhum tem
      // ficha hoje (apagada, ou a receita saiu do combo e foi para opções que
      // este pedido não escolheu), a baixa é de algum deles e não dá para
      // dizer qual — o pedido inteiro entra, senão o custo ficaria sem venda.
      if (baixou && (como !== "sem" || !algumComFicha)) { valorComBaixa += valor; continue; }
      if (como !== "sem") { valorComFichaSemBaixa += valor; continue; }
      qtdSemFicha += qtd;
      valorSemFicha += valor;
      const nome = nomeDoProduto(item);
      const origem: ProdutoSemFicha["origem"] = !item.menuProduct ? "removido" : ehProdutoEspelho(item.menuProduct) ? "integracao" : "cardapio";
      const rotulo = String(item.menuProduct?.name || item.productName || "").toLowerCase();
      // A linha é o NOME EXATO (sem caixa) que a baixa procura — não o
      // `chaveDoNome` do Itens vendidos, que junta "6 Esfihas … 1,5L" (Wabiz)
      // com "6 Esfihas … 1,5l por R$59,90" (iFood). Juntos, a linha dizia "tem
      // produto de mesmo nome no cardápio" por causa do da Wabiz, e os 43 do
      // iFood (NIK, 17 a 23/09/2026) continuariam sem baixa depois da ficha
      // cadastrada. Cada nome é uma ação diferente para o lojista.
      const chave = rotulo || chaveDoNome(nome) || nome.toLowerCase();
      let s = semFicha.get(chave);
      if (!s) {
        s = { chave, nome, quantidade: 0, valor: 0, origem, temNoCardapio: false, canais: [], canaisSet: new Set(), produtoId: null, temOpcoes: false, vemDeIntegracao: false };
        semFicha.set(chave, s);
      }
      // O mesmo "Combo 1" chega do balcão (produto do cardápio) e do iFood
      // (espelho). Basta UMA venda pelo cardápio para a linha apontar para o
      // produto de verdade — é nele que o lojista cadastra a ficha, e o
      // espelho de mesmo nome passa a baixar por ela.
      if (origem === "cardapio" && s.origem !== "cardapio") {
        s.origem = "cardapio";
        s.nome = nome;
      }
      if (origem === "cardapio" && !s.produtoId) {
        s.produtoId = item.menuProduct?.id || item.menuProductId || null;
        s.temOpcoes = s.temOpcoes || Boolean(s.produtoId && fichas.produtosComOpcoes.has(s.produtoId));
      }
      s.temNoCardapio = s.temNoCardapio || origem === "cardapio" || fichas.nomesNoCardapioDe(p.franchiseeId).has(rotulo);
      if (origem === "integracao") {
        s.vemDeIntegracao = true;
        // O espelho herda a ficha do produto de mesmo nome — e, se ele tem
        // opções, o espelho herda o problema das opções que não baixam.
        if (fichas.nomesComOpcoesDe(p.franchiseeId).has(rotulo)) s.temOpcoes = true;
      }
      if (s.origem === "removido" && origem === "integracao") s.origem = "integracao";
      s.quantidade += qtd;
      s.valor += valor;
      if (p.canal) s.canaisSet.add(p.canal);
    }
  }

  // ── 4. Por dia (o dia operacional do pedido: o da 1h da manhã é de ontem) ──
  const dias = new Set<string>([...custoPorDia.keys(), ...faturamentoPorDia.keys()]);
  if (entrada.periodo && diasNoPeriodo(entrada.periodo.de, entrada.periodo.ate) <= 400) {
    for (let d = entrada.periodo.de; d <= entrada.periodo.ate; d = somarDias(d, 1)) dias.add(d);
  }
  const porDia: DiaDoConsumo[] = [...dias].sort().map((dia) => {
    const custo = custoPorDia.get(dia) || 0;
    const fat = faturamentoPorDia.get(dia) || 0;
    // Dia sem baixa nenhuma não tem CMV de 0%: tem ficha faltando (ou loja
    // fechada). A MESMA regra do CMV do período (custo > 0), para o dia e o
    // cartão não dizerem coisas diferentes.
    return { dia, custo: c2(custo), faturamento: c2(fat), cmvPct: custo > 0 ? pct(custo, fat) : null };
  });

  return {
    insumos,
    total: {
      custo: c2(custoTotal),
      insumos: insumos.length,
      insumosSemCusto: insumos.filter((i) => i.custo === null).length,
      pedidosComBaixa: pedidosComBaixa.size,
    },
    vendas: {
      pedidos: vendas.length,
      faturamento: c2(faturamento),
      totalDosItens: c2(totalDosItens),
      valorComBaixa: c2(valorComBaixa),
      valorComFichaSemBaixa: c2(valorComFichaSemBaixa),
      // Sem venda, não há cobertura: "0%" em vermelho afirmaria que nada tem
      // ficha, na loja com tudo cadastrado que abriu o "Hoje" antes do 1º pedido.
      coberturaPct: pct(valorComBaixa, totalDosItens),
      pedidosComFichaSemBaixa,
      pedidosComBaixaSemFichaHoje,
    },
    // Sem baixa nenhuma não existe CMV para mostrar: "0,0%" num cartão leria
    // como "a comida sai de graça", quando o que falta é a ficha técnica.
    cmv: custoTotal > 0 ? {
      sobreFaturamento: pct(custoTotal, faturamento),
      sobreItens: pct(custoTotal, totalDosItens),
      sobreItensComBaixa: pct(custoTotal, valorComBaixa),
    } : { sobreFaturamento: null, sobreItens: null, sobreItensComBaixa: null },
    semFicha: {
      produtos: [...semFicha.values()]
        .map(({ canaisSet, ...s }): ProdutoSemFicha => {
          const acao = oQueFazerSemFicha(s);
          return { ...s, quantidade: q3(s.quantidade), valor: c2(s.valor), canais: [...canaisSet].sort(), oQueFazer: acao.texto, alerta: acao.alerta };
        })
        .sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR")),
      quantidade: q3(qtdSemFicha),
      valor: c2(valorSemFicha),
    },
    foraDaConta: {
      cancelados: foraPorSituacao.cancelado.size,
      foraDaVenda: foraPorSituacao.foraDaVenda.size,
      antesDoPeriodo: foraPorSituacao.antesDoPeriodo.size,
      foraDosFiltros: foraPorSituacao.foraDoFiltro.size,
      semPedido: foraPorSituacao.semPedido.size,
    },
    porDia,
  };
}
