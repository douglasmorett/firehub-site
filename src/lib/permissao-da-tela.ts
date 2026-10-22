/**
 * lib/permissao-da-tela.ts — qual caixinha da Equipe libera cada tela do painel.
 *
 * ── A barreira que só existia na tela de cadastro ───────────────────────────
 *
 * Frangoso, 24/09/2026: o dono cadastrou um funcionário para o caixa, marcou
 * só Pedidos, KDS, Balcão, Cardápio, Motoboys e Impressoras — e o funcionário
 * abria Financeiro, Relatórios, Minha Loja, Integrações, tudo. As caixinhas de
 * "Equipe & permissões" eram gravadas em `User.permissions` desde julho, mas
 * NENHUMA tela lia o que estava lá (só `editar_pedidos`, em
 * lib/edicao-de-pedido.ts). O dono achava que tinha fechado a porta.
 *
 * Esta é a lista que faltava. Quem usa:
 *   - proxy.ts manda o funcionário para uma tela dele quando abre outra;
 *   - lib/menu-do-painel.ts esconde do menu o que ele não abre.
 *
 * ── Tela nova no painel ─────────────────────────────────────────────────────
 *
 * Funcionário NÃO abre tela que não esteja aqui. É de propósito: tela nova
 * nasce fechada para quem não é dono, e alguém decide a caixinha dela. O
 * contrário — nascer aberta — é como o caixa da Frangoso viu o financeiro.
 */

/** As caixinhas de components/customer/StoreTeamManager.tsx (STORE_MODULES). */
type Permissao =
  | "dashboard"
  | "orders"
  | "kds"
  | "venda_presencial"
  | "cardapio"
  | "estoque"
  | "motoboys"
  | "financeiro"
  | "relatorios"
  | "ifood"
  | "impressoras"
  | "minha_loja"
  | "dados_sensiveis";

/** Livre para qualquer funcionário: a conta dele mesmo (senha, nome). */
const LIVRE = "livre" as const;

/**
 * Prefixo da rota → caixinhas que abrem (qualquer uma basta).
 * O prefixo mais longo vence; "/store" sozinho só casa com a Início.
 */
const TELAS: Array<{ prefixo: string; abre: Array<Permissao> | typeof LIVRE }> = [
  // Início mostra o faturamento do dia.
  { prefixo: "/store", abre: ["dashboard", "financeiro"] },

  { prefixo: "/store/pedidos-clientes", abre: ["orders"] },
  { prefixo: "/store/orders", abre: ["orders"] },
  { prefixo: "/store/kds", abre: ["kds"] },
  // A TV de senhas é de quem cuida do salão e da cozinha; a troca da
  // numeração dos pedidos, lá dentro, pede "Minha loja" (api/store/painel-de-senhas).
  { prefixo: "/store/painel-de-senhas", abre: ["kds", "orders", "venda_presencial", "minha_loja"] },
  { prefixo: "/store/venda-presencial", abre: ["venda_presencial"] },
  { prefixo: "/store/mesas", abre: ["venda_presencial"] },
  { prefixo: "/store/caixa", abre: ["venda_presencial"] },
  { prefixo: "/store/roteirizacao", abre: ["motoboys"] },
  { prefixo: "/store/motoboys", abre: ["motoboys"] },

  { prefixo: "/store/cardapio", abre: ["cardapio"] },

  { prefixo: "/store/financeiro", abre: ["financeiro"] },
  // Indique e ganhe: a explicação abre para qualquer funcionário; o link e os
  // números vêm de /api/store/indique-e-ganhe, que segue a regra do Financeiro.
  { prefixo: "/store/indique-e-ganhe", abre: LIVRE },
  // A cozinha consulta todo dia o que deixar pronto (Douglas, 18/10/2026). Só
  // quantidade de lanche — nada de valor.
  { prefixo: "/store/antecipacao", abre: ["kds", "relatorios", "financeiro"] },
  { prefixo: "/store/fiscal", abre: ["financeiro"] },
  { prefixo: "/store/funcionarios", abre: ["financeiro"] },
  { prefixo: "/store/notas-compras", abre: ["financeiro"] },
  { prefixo: "/store/relatorios", abre: ["relatorios", "financeiro"] },
  // CMV real, CMO e folha: só com a caixinha própria, que nasce desmarcada
  // (lib/cmv/acesso.ts). Quem tem Financeiro não ganha isto de carona.
  { prefixo: "/store/dados-sensiveis", abre: ["dados_sensiveis"] },

  { prefixo: "/store/estoque", abre: ["estoque"] },
  { prefixo: "/store/etiquetas", abre: ["estoque"] },
  { prefixo: "/store/compras", abre: ["estoque"] },
  { prefixo: "/store/cart", abre: ["estoque"] },

  { prefixo: "/store/impressoras", abre: ["impressoras"] },

  { prefixo: "/store/integracoes", abre: ["ifood"] },
  { prefixo: "/store/ifood", abre: ["ifood"] },
  { prefixo: "/store/ifood-status", abre: ["ifood"] },
  { prefixo: "/store/extensao-ifood", abre: ["ifood"] },

  // Configuração da loja e o que só o dono decide.
  { prefixo: "/store/minha-loja", abre: ["minha_loja"] },
  { prefixo: "/store/totem", abre: ["minha_loja"] },
  { prefixo: "/store/marketing", abre: ["minha_loja"] },
  // A base de clientes e o saldo de cashback: dar saldo é dar dinheiro.
  { prefixo: "/store/clientes", abre: ["minha_loja", "financeiro"] },
  { prefixo: "/store/chatbot", abre: ["minha_loja"] },
  // Bill, seu assessor: liga um serviço pago e lança no financeiro — o dono decide.
  { prefixo: "/store/bill", abre: ["minha_loja"] },
  { prefixo: "/store/meta-ads", abre: ["minha_loja"] },
  { prefixo: "/store/trafego", abre: ["minha_loja"] },
  { prefixo: "/store/garcons", abre: ["minha_loja"] },
  { prefixo: "/store/firecheck", abre: ["minha_loja"] },
  { prefixo: "/store/contingencia", abre: ["minha_loja"] },
  // Aplicativo próprio da loja: contratar é do dono (a API também só atende o dono).
  { prefixo: "/store/aplicativo", abre: ["minha_loja"] },
  // Multimarcas: montar as marcas é trabalho de cardápio; contratar continua
  // só do dono (a API barra o funcionário no liga/desliga: lib/multimarcas/sessao.ts).
  { prefixo: "/store/multimarcas", abre: ["minha_loja", "cardapio"] },
  // Tablet na mesa: ligar cobra no boleto, é do dono (a API também só atende o dono).
  { prefixo: "/store/tablet-na-mesa", abre: ["minha_loja"] },
  // Meu aplicativo (base de clientes do app e notificação push): a tela e a
  // API só atendem o dono; a caixinha aqui só evita o proxy mandar o
  // funcionário para outra tela antes de a página explicar.
  { prefixo: "/store/meu-aplicativo", abre: ["minha_loja"] },

  { prefixo: "/store/perfil", abre: LIVRE },
  { prefixo: "/store/profile", abre: LIVRE },
  // /store/admin não está aqui: é do ADMIN, nunca de funcionário.
];

/** Para onde vai o funcionário que abriu uma tela fechada — a primeira que ele abre. */
const ORDEM_DE_CHEGADA = [
  "/store/pedidos-clientes",
  "/store/venda-presencial",
  "/store/kds",
  "/store/mesas",
  "/store/cardapio",
  "/store/motoboys",
  "/store/estoque",
  "/store/impressoras",
  "/store",
];

const lista = (csv: string | null | undefined) =>
  new Set(String(csv ?? "").split(",").map((p) => p.trim()).filter(Boolean));

function regraDa(pathname: string) {
  const p = pathname.replace(/\/+$/, "") || "/";
  let achada: (typeof TELAS)[number] | null = null;
  for (const t of TELAS) {
    const casa = t.prefixo === "/store" ? p === "/store" : p === t.prefixo || p.startsWith(`${t.prefixo}/`);
    if (casa && (!achada || t.prefixo.length > achada.prefixo.length)) achada = t;
  }
  return achada;
}

/**
 * O funcionário com estas permissões (CSV de `User.permissions`) abre esta
 * tela? Só para `role === "STAFF"` — dono e admin não passam por aqui.
 * Hash e query não contam: "/store/minha-loja#equipe" é "/store/minha-loja".
 */
export function funcionarioAbre(pathname: string, permissoesCsv: string | null | undefined): boolean {
  const semHash = String(pathname || "").split(/[?#]/)[0];
  const regra = regraDa(semHash);
  if (!regra) return false;
  if (regra.abre === LIVRE) return true;
  const tem = lista(permissoesCsv);
  return regra.abre.some((p) => tem.has(p));
}

/** A tela para onde mandar o funcionário barrado. Sem nenhuma, a conta dele. */
export function primeiraTelaDoFuncionario(permissoesCsv: string | null | undefined): string {
  return ORDEM_DE_CHEGADA.find((t) => funcionarioAbre(t, permissoesCsv)) ?? "/store/perfil";
}
