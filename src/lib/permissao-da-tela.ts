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
  | "minha_loja";

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
  { prefixo: "/store/venda-presencial", abre: ["venda_presencial"] },
  { prefixo: "/store/mesas", abre: ["venda_presencial"] },
  { prefixo: "/store/caixa", abre: ["venda_presencial"] },
  { prefixo: "/store/roteirizacao", abre: ["motoboys"] },
  { prefixo: "/store/motoboys", abre: ["motoboys"] },

  { prefixo: "/store/cardapio", abre: ["cardapio"] },

  { prefixo: "/store/financeiro", abre: ["financeiro"] },
  { prefixo: "/store/antecipacao", abre: ["financeiro"] },
  { prefixo: "/store/fiscal", abre: ["financeiro"] },
  { prefixo: "/store/funcionarios", abre: ["financeiro"] },
  { prefixo: "/store/notas-compras", abre: ["financeiro"] },
  { prefixo: "/store/relatorios", abre: ["relatorios", "financeiro"] },

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
  { prefixo: "/store/chatbot", abre: ["minha_loja"] },
  { prefixo: "/store/meta-ads", abre: ["minha_loja"] },
  { prefixo: "/store/trafego", abre: ["minha_loja"] },
  { prefixo: "/store/garcons", abre: ["minha_loja"] },
  { prefixo: "/store/firecheck", abre: ["minha_loja"] },

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
