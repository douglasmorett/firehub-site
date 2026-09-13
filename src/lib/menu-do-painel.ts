/**
 * O menu do painel da loja, agrupado — uma lista só.
 *
 * ── Por que virou barra lateral ─────────────────────────────────────────────
 *
 * Eram 16 itens numa barra HORIZONTAL. Para caber, a fonte encolhia por degraus
 * de media query até 0,58rem em 900px — e mesmo assim a linha quebrava. O
 * lojista não lia o menu: procurava. Em pé, a lista cabe inteira, com espaço
 * para agrupar por assunto e para o nome do grupo dizer onde procurar.
 *
 * Os grupos são o que o dono já usa para falar do sistema: o que ele opera no
 * dia ("Operação"), o que ele vende ("Cardápio & vendas"), o que ele confere
 * depois ("Gestão"), quem trabalha com ele ("Equipe") e o que se configura uma
 * vez ("Configurações").
 */

export type ItemDoMenu = {
  href: string;
  label: string;
  /** Nome do ícone no lucide-react — resolvido na tela, para a lib ficar sem JSX. */
  icone: string;
  /** Selo curto ao lado do nome. */
  selo?: string;
  /** Bolinha de destaque (é por onde o pedido entra). */
  destaque?: boolean;
  /** Só aparece quando a loja tem o benefício ligado. */
  somenteCom?: "antecipacao" | "compras";
};

export type GrupoDoMenu = { titulo: string; itens: ItemDoMenu[] };

export const MENU_DO_PAINEL: GrupoDoMenu[] = [
  {
    titulo: "Operação",
    itens: [
      { href: "/store", label: "Início", icone: "Home" },
      { href: "/store/pedidos-clientes", label: "Pedidos", icone: "ClipboardList", destaque: true },
      { href: "/store/kds", label: "KDS da cozinha", icone: "Monitor" },
      { href: "/store/mesas", label: "Mesas", icone: "UtensilsCrossed" },
      { href: "/store/venda-presencial", label: "Balcão", icone: "ShoppingBag" },
      { href: "/store/roteirizacao", label: "Roteirização", icone: "MapPin" },
      { href: "/store/totem", label: "Totem", icone: "TabletSmartphone", selo: "EM TESTES" },
    ],
  },
  {
    titulo: "Cardápio & vendas",
    itens: [
      { href: "/store/cardapio", label: "Cardápio", icone: "BookOpen" },
      { href: "/store/marketing", label: "Marketing & cupons", icone: "Send" },
      { href: "/store/chatbot", label: "Chatbot IA", icone: "Bot", selo: "IA" },
      { href: "/store/meta-ads", label: "Tráfego pago", icone: "PieChart", selo: "EM TESTES" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/store/financeiro", label: "Financeiro", icone: "BarChart2" },
      { href: "/store/antecipacao", label: "Antecipação", icone: "Zap", somenteCom: "antecipacao" },
      { href: "/store/relatorios", label: "Relatórios", icone: "LineChart" },
      { href: "/store/fiscal", label: "Fiscal", icone: "Receipt" },
      { href: "/store/estoque", label: "Estoque", icone: "Package" },
      { href: "/store/etiquetas", label: "Validade & etiquetas", icone: "Tag" },
      { href: "/store/compras", label: "Compras", icone: "Truck", somenteCom: "compras" },
    ],
  },
  {
    titulo: "Equipe",
    itens: [
      { href: "/store/motoboys", label: "Motoboys", icone: "Bike" },
      { href: "/store/garcons", label: "Garçons", icone: "Users" },
      { href: "/store/funcionarios", label: "Fiado", icone: "Wallet" },
      { href: "/store/firecheck", label: "Checklist e ponto", icone: "CheckCircle2", selo: "FIRECHECK" },
    ],
  },
  {
    titulo: "Configurações",
    itens: [
      { href: "/store/minha-loja", label: "Minha loja", icone: "Store" },
      { href: "/store/impressoras", label: "Impressoras", icone: "Printer" },
      { href: "/store/integracoes", label: "Integrações", icone: "Puzzle" },
    ],
  },
];

/** O item que a rota atual está mostrando — o mais específico que casa. */
export function itemAtivo(pathname: string | null | undefined): ItemDoMenu | null {
  const p = String(pathname || "");
  let achado: ItemDoMenu | null = null;
  for (const grupo of MENU_DO_PAINEL) {
    for (const item of grupo.itens) {
      const casa = item.href === "/store" ? p === "/store" : p.startsWith(item.href);
      // O mais longo vence: /store/pedidos-clientes não pode perder para /store.
      if (casa && (!achado || item.href.length > achado.href.length)) achado = item;
    }
  }
  return achado;
}

/** O menu filtrado pelo que esta loja tem direito de ver. */
export function menuDaLoja(opcoes: { antecipacao?: boolean; compras?: boolean }): GrupoDoMenu[] {
  return MENU_DO_PAINEL.map((g) => ({
    titulo: g.titulo,
    itens: g.itens.filter((i) => !i.somenteCom || opcoes[i.somenteCom] === true),
  })).filter((g) => g.itens.length > 0);
}
