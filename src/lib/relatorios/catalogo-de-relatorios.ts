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
  // Levantamento do SWFast (Alex/Hambúrgueria Avenida, 07/11/2026): o mês contra o mesmo mês do ano anterior e o peso dos combos.
  { slug: "faturamento-mensal", secao: "Vendas", titulo: "Faturamento mensal", href: "/store/relatorios/faturamento-mensal",
    descricao: "Os 12 meses do ano com o mesmo mês do ano anterior ao lado, a variação e a projeção do mês atual.",
    busca: "mensal mês a mês ano anterior ano passado comparação anual 12 meses projeção crescimento" },
  { slug: "faturamento-combos", secao: "Vendas", titulo: "Faturamento de combos", href: "/store/relatorios/faturamento-combos",
    descricao: "Quantas vendas levaram combo, quanto os combos venderam e o ticket com combo contra sem combo.",
    busca: "combo combos kit promoção ticket com combo porcentagem ranking de combos" },
  { slug: "ticket-medio", secao: "Vendas", titulo: "Ticket médio", href: "/store/relatorios/ticket-medio",
    descricao: "Ticket por atendimento e por pessoa e P.A. (produtos por atendimento), dia a dia e por garçom.",
    busca: "ticket médio por pessoa pessoas p.a. pa produtos por atendimento garçom operador cupons ranking de vendas" },
  { slug: "formas-de-pagamento", secao: "Vendas", titulo: "Vendas por forma de pagamento", href: "/store/relatorios/formas-de-pagamento",
    descricao: "Quanto entrou em dinheiro, Pix, crédito, débito, vale e pago online.",
    busca: "pix dinheiro cartão crédito débito voucher pagamento" },
  // Pedido do Douglas (27/10/2026): cada app por forma de pagamento e o repasse pela comissão cadastrada.
  { slug: "plataformas", secao: "Vendas", titulo: "Plataformas e repasses", href: "/store/relatorios/plataformas",
    descricao: "iFood, 99, Keeta, site e app da loja: crédito, débito, Pix e dinheiro de cada um, e quanto cada app tem que repassar.",
    busca: "ifood 99food keeta site app aplicativo repasse comissão marketplace plataforma detalhado cupom semanal" },
  { slug: "data-hora", secao: "Vendas", titulo: "Vendas por dia e hora", href: "/store/relatorios/data-hora",
    descricao: "O mapa de calor da semana: o melhor horário e o melhor dia de vendas.",
    busca: "horário de pico mapa de calor movimento dia da semana hora" },
  { slug: "areas-de-entrega", secao: "Vendas", titulo: "Vendas por área de entrega", href: "/store/relatorios/areas-de-entrega",
    descricao: "Qual bairro ou área pede mais, em valor, quantidade e ticket.",
    busca: "bairro região delivery zona taxa de entrega" },
  { slug: "descontos", secao: "Vendas", titulo: "Cupons e descontos", href: "/store/relatorios/descontos",
    descricao: "Quanto de desconto foi dado, por quem (loja ou plataforma) e em qual cupom.",
    busca: "cupom cupons gerados promoção cashback desconto operador quem deu desconto motivo do desconto desconto por funcionário" },
  // ── Operação ──
  { slug: "tempos", secao: "Operação", titulo: "Tempo por status e produção", href: "/store/relatorios/tempos",
    descricao: "Quanto o pedido fica em cada etapa, os atrasados e o tempo de preparo por produto.",
    busca: "tempo de produção cozinha kds atraso entrega preparo" },
  // Pedido do Douglas (16/10/2026): as abas "Faltou item" e "Veio errado
  // (troca)" do Ver pedido (lib/reposicao.ts) — quantas e quanto custaram.
  { slug: "reposicoes", secao: "Operação", titulo: "Reposições (faltou item e troca)", href: "/store/relatorios/reposicoes",
    descricao: "Quantas vezes faltou item ou veio errado, o % das vendas e o custo de refazer e da entrega a mais.",
    busca: "reposição reposicao troca trocas veio errado faltou item faltante erro refazer refeito reclamação custo de erro motoboy corrida extra" },
  // Levantamento do SWFast (07/11/2026): o salão e o controle do que se cancela e se dá de cortesia.
  { slug: "giro-de-mesas", secao: "Operação", titulo: "Giro de mesas", href: "/store/relatorios/giro-de-mesas",
    descricao: "Mesa a mesa: quantas vezes girou, faturamento, ticket por conta e por pessoa, permanência e R$ por hora — as que mais rendem e as paradas.",
    busca: "giro mesas salão rotatividade permanência ticket por pessoa pa p.a. produtos por atendimento mesa parada ranking de mesas ocupação" },
  { slug: "cancelamentos", secao: "Operação", titulo: "Cancelamentos e cortesias", href: "/store/relatorios/cancelamentos",
    descricao: "O que a loja cancelou (pedido, rodada, item) e deu de cortesia: quem fez, quando, motivo e valor, com os alertas do que conferir.",
    busca: "cancelamento cancelamentos cancelado item cancelado estorno operador funcionário caixa motivo fraude anti-fraude conferência cortesia cortesias brinde grátis por conta da casa auditoria" },
  { slug: "atendentes", secao: "Operação", titulo: "Desempenho por atendente", href: "/store/relatorios/atendentes",
    descricao: "Quem lançou quantos pedidos e quanto vendeu, com as categorias.",
    busca: "atendente funcionário operador caixa ranking vendedor",
    // O pedido ainda não grava QUEM o lançou (levantamento de 24/09/2026): a
    // coluna nova só vale dali para frente, e o relatório nasce vazio.
    emBreve: "Em breve: o sistema passa a registrar quem lançou cada pedido." },
  { slug: "mesas", secao: "Operação", titulo: "Mesas e garçons", href: "/store/garcons",
    descricao: "Taxa de serviço por garçom (esperada × cobrada, % atingido) e vendas por origem (mesa, balcão, delivery).",
    busca: "garçom garçons taxa de serviço acerto de garçons salão" },
  // ── Financeiro ──
  { slug: "ranking-de-entregadores", secao: "Operação", titulo: "Ranking de entregadores", href: "/store/relatorios/ranking-de-entregadores",
    descricao: "O melhor motoboy do período: entregas, cancelados com ele, tempo de entrega, no prazo, coleta e volta à loja.",
    busca: "motoboy motoboys entregador entregadores ranking melhor score prazo coleta volta desempenho" },
  { slug: "motoboys", secao: "Financeiro", titulo: "Acerto de entregadores", href: "/store/relatorios/acerto-de-entregadores",
    descricao: "Quanto pagar a cada motoboy, o dinheiro com ele e o saldo; custo por entrega, pódio e horários da equipe.",
    busca: "motoboy motoboys entregador entregadores acerto diária recibo custo por entrega escala" },
  { slug: "caixas", secao: "Financeiro", titulo: "Histórico de caixas", href: "/store/caixa/historico",
    descricao: "Os caixas fechados: esperado, contado e diferença por forma de pagamento.",
    busca: "fechamento de caixa sangria diferença turno frente de caixa" },
  // Levantamento do SWFast (07/11/2026): o dinheiro que vem, o que vai e o que o caixa conferiu.
  { slug: "fluxo-de-caixa", secao: "Financeiro", titulo: "Fluxo de caixa", href: "/store/relatorios/fluxo-de-caixa",
    descricao: "Quanto você vai ter na conta em cada dia: o que entra (cartão, Pix, repasse do app), o que sai (contas a pagar) e o aviso do dia em que o saldo fica negativo.",
    busca: "fluxo de caixa saldo previsto projeção a pagar a receber planejamento financeiro negativo capital de giro" },
  { slug: "contas-a-receber", secao: "Financeiro", titulo: "Contas a receber", href: "/store/relatorios/contas-a-receber",
    descricao: "O que as vendas já feitas ainda vão pôr na conta, por dia e por forma: bruto, taxa e líquido, num calendário do mês.",
    busca: "receitas recebíveis a receber cartão maquininha d+30 d+1 repasse ifood taxa líquido calendário antecipação" },
  { slug: "diferencas-de-caixa", secao: "Financeiro", titulo: "Diferenças de caixa", href: "/store/relatorios/diferencas-de-caixa",
    descricao: "Todos os caixas do período somados por operador, dia e forma: esperado, contado, falta e sobra.",
    busca: "diferença de caixa quebra de caixa falta sobra operador conciliação fechamento conferência formas por operador" },
  { slug: "sangrias-e-suprimentos", secao: "Financeiro", titulo: "Sangrias e suprimentos", href: "/store/relatorios/sangrias-e-suprimentos",
    descricao: "Toda sangria, retirada e suprimento do período, com quem lançou e o motivo.",
    busca: "sangria retirada suprimento reforço troco cofre movimentação de caixa" },
  { slug: "dre", secao: "Financeiro", titulo: "DRE e resultado", href: "/store/financeiro?tab=dre",
    descricao: "Receita, CMV, taxas, custos fixos e lucro do período.",
    busca: "dre lucro resultado financeiro despesas" },
  { slug: "dre-anual", secao: "Financeiro", titulo: "DRE do ano (mês a mês)", href: "/store/financeiro?tab=dre&visao=ano",
    descricao: "O DRE dos 12 meses lado a lado, com o total do ano.",
    busca: "balancete dre anual mensal mês a mês ano resultado lucro comparativo" },
  // CMV pela contagem (lib/cmv). Só abre com a caixinha "Dados sensíveis".
  { slug: "dados-sensiveis", secao: "Financeiro", titulo: "🔒 CMV real e CMO", href: "/store/dados-sensiveis",
    descricao: "CMV pela contagem de estoque e pelas compras, dia a dia, semana e mês; CMO e custo primário (prime cost).",
    busca: "cmv real cmo mão de obra custo primário prime cost primecost contagem estoque dados sensíveis ponteiro folha" },
  // ── Fiscal ──
  { slug: "notas", secao: "Fiscal", titulo: "Notas fiscais (NFC-e)", href: "/store/fiscal",
    descricao: "Notas emitidas, canceladas e com erro, e o pacote de XMLs do contador.",
    busca: "cupons fiscais nfce nota fiscal xml contador sefaz" },
  // ── Estoque ──
  { slug: "itens-consumidos", secao: "Estoque", titulo: "Itens consumidos", href: "/store/relatorios/itens-consumidos",
    descricao: "Quanto de cada insumo saiu pelas vendas (ficha técnica), com custo — o CMV teórico.",
    busca: "insumos ingredientes ficha técnica cmv consumo estoque" },
  // Levantamento do SWFast (07/11/2026): o que comprar, quanto vai sair, quanto sobra de cada produto.
  { slug: "sugestao-de-compras", secao: "Estoque", titulo: "Lista de compras", href: "/store/relatorios/sugestao-de-compras",
    descricao: "O que comprar, de qual fornecedor e quanto, pelo saldo e pelo gasto por dia — com o pedido pronto para o WhatsApp.",
    busca: "sugestao de compras lista de compras pedido fornecedor estoque ideal minimo reposicao whatsapp" },
  { slug: "previsao-de-insumos", secao: "Estoque", titulo: "Previsão de insumos da semana", href: "/store/relatorios/previsao-de-insumos",
    descricao: "Quanto de cada insumo vai sair em cada dia da próxima semana, com o custo previsto (média, −10% e +10%).",
    busca: "previsao de gastos insumos semana planejamento compras ficha tecnica consumo" },
  { slug: "margem-por-produto", secao: "Estoque", titulo: "Margem por produto", href: "/store/relatorios/margem-por-produto",
    descricao: "Quanto sobra de cada produto vendido, o markup e quais são estrela, vaca leiteira, quebra-cabeça e abacaxi.",
    busca: "cmv por produto margem markup lucro engenharia de cardapio estrela abacaxi custo ficha tecnica" },
  { slug: "historico-de-contagens", secao: "Estoque", titulo: "Histórico das contagens", href: "/store/relatorios/historico-de-contagens",
    descricao: "A diferença em R$ de cada contagem fechada e os insumos que mais somem.",
    busca: "inventario contagem diferenca furo estoque perda balanco" },
  { slug: "saidas-de-estoque", secao: "Estoque", titulo: "Saídas de estoque", href: "/store/relatorios/saidas-de-estoque",
    descricao: "Perdas, vencidos, quebras, consumo interno e cancelados já feitos, por motivo e com o custo.",
    busca: "saidas perdas desperdicio vencido quebra consumo interno descarte motivo" },
  { slug: "compras-por-fornecedor", secao: "Estoque", titulo: "Compras por fornecedor", href: "/store/relatorios/compras-por-fornecedor",
    descricao: "Quanto você comprou de cada fornecedor e insumo, o preço médio e o aviso de quem ficou mais caro.",
    busca: "compras fornecedor notas preco medio variacao de preco aumento insumo" },
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
