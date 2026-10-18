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
import { funcionarioAbre } from "@/lib/permissao-da-tela";

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
  somenteCom?: "antecipacao" | "compras" | "app";
  /**
   * Abre em outra guia. Vale para a tela que a loja usa AO LADO do painel,
   * não no lugar dele: a roteirização fica aberta no mapa enquanto o
   * atendente continua despachando pedidos na aba de origem.
   */
  novaAba?: boolean;
  /**
   * As telas de dentro. Abrem no próprio menu, para o lojista escolher
   * "Entrega" sem passar pela tela de cartões de Minha Loja.
   */
  filhos?: { href: string; label: string }[];
};

export type GrupoDoMenu = { titulo: string; itens: ItemDoMenu[] };

export const MENU_DO_PAINEL: GrupoDoMenu[] = [
  {
    titulo: "Operação",
    itens: [
      { href: "/store", label: "Início", icone: "Home" },
      { href: "/store/pedidos-clientes", label: "Pedidos", icone: "ClipboardList", destaque: true },
      { href: "/store/kds", label: "KDS da cozinha", icone: "Monitor" },
      // A TV do salão que chama a senha (lib/painel-de-senhas.ts).
      { href: "/store/painel-de-senhas", label: "Painel de senhas", icone: "Tv", selo: "NOVO" },
      { href: "/store/mesas", label: "Mesas", icone: "UtensilsCrossed" },
      { href: "/store/venda-presencial", label: "Balcão", icone: "ShoppingBag" },
      { href: "/store/roteirizacao", label: "Roteirização", icone: "MapPin", novaAba: true },
      { href: "/store/totem", label: "Totem", icone: "TabletSmartphone", selo: "EM TESTES" },
    ],
  },
  {
    titulo: "Cardápio & vendas",
    itens: [
      { href: "/store/cardapio", label: "Cardápio", icone: "BookOpen" },
      // Página das várias marcas da mesma cozinha (R$ 97/mês, lib/multimarcas — Douglas, 17/10/2026).
      { href: "/store/multimarcas", label: "Multimarcas", icone: "LayoutGrid", selo: "NOVO" },
      { href: "/store/clientes", label: "Clientes", icone: "Contact" },
      { href: "/store/marketing", label: "Marketing & cupons", icone: "Send" },
      // O app próprio da loja, depois que o admin ativa o plano
      // (lib/app-da-loja/plano.ts): base, ativos agora, notificação push.
      { href: "/store/meu-aplicativo", label: "Meu aplicativo", icone: "Smartphone", selo: "NOVO", somenteCom: "app" },
      { href: "/store/chatbot", label: "Chatbot IA", icone: "Bot", selo: "IA" },
      { href: "/store/meta-ads", label: "Tráfego pago", icone: "PieChart", selo: "EM TESTES" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      // Estoque, financeiro e cardápio pelo WhatsApp do dono (lib/assessor). O
      // menu de cima (StoreTopNav) tinha o item; este, que é o que o painel
      // mostra, não — achado no teste na Hakim, 15/10/2026.
      { href: "/store/bill", label: "Bill, seu assessor", icone: "Mic", selo: "NOVO" },
      { href: "/store/financeiro", label: "Financeiro", icone: "BarChart2" },
      { href: "/store/antecipacao", label: "Antecipação", icone: "Zap", somenteCom: "antecipacao" },
      { href: "/store/relatorios", label: "Relatórios", icone: "LineChart" },
      // CMV real, CMO e folha (lib/cmv). Funcionário só vê com a caixinha
      // "Dados sensíveis", que nasce desmarcada (lib/permissao-da-tela.ts).
      { href: "/store/dados-sensiveis", label: "Dados sensíveis", icone: "Gauge" },
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
      {
        href: "/store/minha-loja", label: "Minha loja", icone: "Store",
        // Os mesmos endereços que a própria tela já entende pelo # da URL
        // (HASH_TO_SECTION em MinhaLojaClient) — o menu não inventou rota
        // nova, só encurtou o caminho.
        filhos: [
          { href: "/store/cardapio", label: "Cardápio & produtos" },
          { href: "/store/minha-loja#info", label: "Informações da loja" },
          { href: "/store/minha-loja#horarios", label: "Horários" },
          { href: "/store/minha-loja#entrega", label: "Entrega" },
          { href: "/store/minha-loja#pagamento", label: "Pagamento" },
          { href: "/store/minha-loja#cupons", label: "Cupons" },
          { href: "/store/minha-loja#fidelidade", label: "Fidelidade & trilha" },
          { href: "/store/minha-loja#avaliacoes", label: "Avaliações" },
          { href: "/store/minha-loja#equipe", label: "Equipe & permissões" },
          // Só o dono grava (api/store-settings/senha-do-gerente); funcionário vê o aviso.
          { href: "/store/minha-loja#senha-do-gerente", label: "Senha do gerente" },
          { href: "/store/minha-loja#conta", label: "Minha conta" },
        ],
      },
      { href: "/store/impressoras", label: "Impressoras", icone: "Printer" },
      { href: "/store/integracoes", label: "Integrações", icone: "Puzzle" },
      // O Modo Contingência não mora aqui: é o botão roxo logo abaixo de
      // "Tutoriais em vídeo" (StoreSidebar). No fim de Configurações ninguém
      // achava (Douglas, 13/10/2026).
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

/**
 * O menu filtrado pelo que esta loja tem direito de ver — e, para
 * funcionário, pelo que o dono marcou em "Equipe & permissões".
 *
 * `permissoesDoFuncionario` é o CSV de `User.permissions`, e só vem para
 * `role === "STAFF"`; `null` (dono, admin) é o menu inteiro. Item que o
 * funcionário não abre sai do menu: o proxy já o mandaria de volta, e um
 * botão que não leva a lugar nenhum é pior que botão nenhum.
 */
export function menuDaLoja(opcoes: {
  antecipacao?: boolean;
  compras?: boolean;
  /** Plano do aplicativo próprio ligado (lib/app-da-loja/instalacoes.ts `appLigadoNaConta`). */
  app?: boolean;
  permissoesDoFuncionario?: string | null;
}): GrupoDoMenu[] {
  const funcionario = opcoes.permissoesDoFuncionario;
  const abre = (href: string) => funcionario == null || funcionarioAbre(href, funcionario);
  return MENU_DO_PAINEL.map((g) => ({
    titulo: g.titulo,
    itens: g.itens
      .filter((i) => !i.somenteCom || opcoes[i.somenteCom] === true)
      .filter((i) => abre(i.href))
      .map((i) => (i.filhos ? { ...i, filhos: i.filhos.filter((f) => abre(f.href)) } : i)),
  })).filter((g) => g.itens.length > 0);
}
