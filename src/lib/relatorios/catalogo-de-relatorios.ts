/**
 * O menu de relatórios — a lista do que existe, por seção, como o menu da
 * Saipos (Relatórios / Dashboards / Financeiro / Estoque), com busca.
 *
 * O lojista que vem da Saipos procura pelo NOME que conhece ("Itens
 * vendidos", "Vendas por forma de pagamento"). Os nomes aqui são os deles
 * sempre que o relatório responde a mesma pergunta; `busca` guarda os
 * sinônimos que ele pode digitar.
 *
 * `href` aponta para a tela; relatórios que já existiam em outro lugar do
 * painel (mesas, motoboys, caixa, DRE, notas fiscais) entram com o endereço
 * de lá — o menu é o índice de tudo, não só do que é novo.
 */

export type SecaoDeRelatorio = "Vendas" | "Operação" | "Financeiro" | "Fiscal" | "Estoque";

export type RelatorioDoMenu = {
  slug: string;
  titulo: string;
  descricao: string;
  secao: SecaoDeRelatorio;
  href: string;
  busca?: string;
  /** Ainda não disponível: o cartão aparece sem link, com este aviso. */
  emBreve?: string;
};

export const RELATORIOS: RelatorioDoMenu[] = [
  // ── Vendas ──
  { slug: "painel", secao: "Vendas", titulo: "Painel de vendas", href: "/store/relatorios/painel",
    descricao: "Faturamento, ranking de produtos, plataformas, tempos e cancelamentos num lugar só.",
    busca: "visão geral dashboard acompanhamento ranking produto campeão" },
  { slug: "itens-vendidos", secao: "Vendas", titulo: "Itens vendidos", href: "/store/relatorios/itens-vendidos",
    descricao: "Quantos de cada produto, sabor, borda e adicional — por categoria, com Excel.",
    busca: "produtos mais vendidos sabores bordas opções adicionais curva abc" },
  { slug: "vendas", secao: "Vendas", titulo: "Vendas por período", href: "/store/relatorios/vendas",
    descricao: "Todos os pedidos do período com totais, ticket médio por tipo, taxas e descontos.",
    busca: "pedidos histórico lista ticket médio cancelados total dos itens" },
  { slug: "faturamento-por-dia", secao: "Vendas", titulo: "Faturamento por dia", href: "/store/relatorios/faturamento-por-dia",
    descricao: "Dia a dia com acumulado do mês, ticket médio e comparação com o período anterior.",
    busca: "meta mensal acumulado diário dia da semana" },
  { slug: "formas-de-pagamento", secao: "Vendas", titulo: "Vendas por forma de pagamento", href: "/store/relatorios/formas-de-pagamento",
    descricao: "Quanto entrou em dinheiro, Pix, crédito, débito, vale e pago online.",
    busca: "pix dinheiro cartão crédito débito voucher pagamento" },
  { slug: "data-hora", secao: "Vendas", titulo: "Vendas por dia e hora", href: "/store/relatorios/data-hora",
    descricao: "O mapa de calor da semana: o melhor horário e o melhor dia de vendas.",
    busca: "horário de pico mapa de calor movimento dia da semana hora" },
  { slug: "areas-de-entrega", secao: "Vendas", titulo: "Vendas por área de entrega", href: "/store/relatorios/areas-de-entrega",
    descricao: "Qual bairro ou área pede mais, em valor, quantidade e ticket.",
    busca: "bairro região delivery zona taxa de entrega" },
  { slug: "descontos", secao: "Vendas", titulo: "Cupons e descontos", href: "/store/relatorios/descontos",
    descricao: "Quanto de desconto foi dado, por quem (loja ou plataforma) e em qual cupom.",
    busca: "cupom cupons gerados promoção cashback desconto" },
  // ── Operação ──
  { slug: "tempos", secao: "Operação", titulo: "Tempo por status e produção", href: "/store/relatorios/tempos",
    descricao: "Quanto o pedido fica em cada etapa, os atrasados e o tempo de preparo por produto.",
    busca: "tempo de produção cozinha kds atraso entrega preparo" },
  { slug: "atendentes", secao: "Operação", titulo: "Desempenho por atendente", href: "/store/relatorios/atendentes",
    descricao: "Quem lançou quantos pedidos e quanto vendeu, com as categorias.",
    busca: "atendente funcionário operador caixa ranking vendedor",
    // O pedido ainda não grava QUEM o lançou (levantamento de 24/09/2026): a
    // coluna nova só vale dali para frente, e o relatório nasce vazio.
    emBreve: "Em breve: o sistema passa a registrar quem lançou cada pedido." },
  { slug: "mesas", secao: "Operação", titulo: "Mesas e garçons", href: "/store/garcons",
    descricao: "Taxa de serviço por garçom e vendas por origem (mesa, balcão, delivery).",
    busca: "garçom garçons taxa de serviço acerto de garçons salão" },
  // ── Financeiro ──
  { slug: "motoboys", secao: "Financeiro", titulo: "Acerto de entregadores", href: "/store/motoboys",
    descricao: "Quanto pagar a cada motoboy: diária, taxas por entrega e prestação de contas.",
    busca: "motoboy entregador acerto diária" },
  { slug: "caixas", secao: "Financeiro", titulo: "Histórico de caixas", href: "/store/caixa/historico",
    descricao: "Os caixas fechados: esperado, contado e diferença por forma de pagamento.",
    busca: "fechamento de caixa sangria diferença turno frente de caixa" },
  { slug: "dre", secao: "Financeiro", titulo: "DRE e resultado", href: "/store/financeiro?tab=dre",
    descricao: "Receita, CMV, taxas, custos fixos e lucro do período.",
    busca: "dre lucro resultado financeiro despesas" },
  // ── Fiscal ──
  { slug: "notas", secao: "Fiscal", titulo: "Notas fiscais (NFC-e)", href: "/store/fiscal",
    descricao: "Notas emitidas, canceladas e com erro, e o pacote de XMLs do contador.",
    busca: "cupons fiscais nfce nota fiscal xml contador sefaz" },
  // ── Estoque ──
  { slug: "itens-consumidos", secao: "Estoque", titulo: "Itens consumidos", href: "/store/relatorios/itens-consumidos",
    descricao: "Quanto de cada insumo saiu pelas vendas (ficha técnica), com custo — o CMV teórico.",
    busca: "insumos ingredientes ficha técnica cmv consumo estoque" },
];

export const SECOES: SecaoDeRelatorio[] = ["Vendas", "Operação", "Financeiro", "Fiscal", "Estoque"];

/** Busca sem acento e sem caixa, no título, na descrição e nos sinônimos. */
export function buscarRelatorios(termo: string): RelatorioDoMenu[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(termo.trim());
  if (!t) return RELATORIOS;
  return RELATORIOS.filter((r) => norm(`${r.titulo} ${r.descricao} ${r.busca || ""}`).includes(t));
}

export function relatorioPorSlug(slug: string): RelatorioDoMenu | undefined {
  return RELATORIOS.find((r) => r.slug === slug);
}
