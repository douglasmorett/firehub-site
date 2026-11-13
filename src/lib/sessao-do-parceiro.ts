/**
 * A SESSÃO DO PORTAL DO PARCEIRO SÓ VALE NO PORTAL (pedido do Douglas,
 * 12/11/2026: "cuidado para meus vendedores só terem acesso aos números da
 * carteira deles e sobre eles, e não sobre tudo").
 *
 * A sessão do portal (role AMBASSADOR) carrega o id e o E-MAIL do parceiro. As
 * rotas da loja (/api/store/*, /api/customer-order/*, /api/cash-session…, ~200
 * arquivos) acham a loja por `session.user.email` sem olhar o role: um
 * parceiro com o mesmo e-mail de uma loja abria os dados dela sem a senha da
 * loja. Em vez de mexer rota por rota, o proxy (src/proxy.ts) tira o cookie da
 * sessão de toda requisição de parceiro FORA do portal — a rota recebe como
 * anônima: a pública segue funcionando, a da loja dá 401.
 *
 * "Loja e portal no mesmo login" (lib/paineis-do-dono.ts) continua: trocar de
 * painel passa por /api/auth e regrava a sessão com a identidade da loja.
 *
 * Funções puras: o proxy usa e scripts/teste-sessao-do-parceiro.ts confere.
 */

/** Onde a sessão do parceiro vale: o portal, o login e as APIs que o portal chama. */
const CAMINHOS_DO_PARCEIRO = [
  "/vendedor",
  "/embaixador",
  "/login",
  "/api/auth",
  "/api/me", // o /login pergunta o role depois de entrar; /api/me/paineis é a troca de painel
  "/api/vendedor",
  "/api/embaixador",
  "/api/crm", // contatos e agenda do vendedor (lib/crm/acesso.ts filtra pelo id da sessão)
];

export function sessaoDoParceiroVale(pathname: string): boolean {
  return CAMINHOS_DO_PARCEIRO.some((c) => pathname === c || pathname.startsWith(`${c}/`));
}

/** O cookie da sessão do NextAuth, com ou sem o prefixo __Secure- e em pedaços (.0, .1…). */
export function ehCookieDeSessao(nome: string): boolean {
  return /(^|[-_.])next-auth\.session-token(\.\d+)?$/.test(nome);
}

/** O cabeçalho Cookie sem o cookie da sessão (null quando não sobra nenhum). */
export function cookiesSemSessao(cabecalho: string | null): string | null {
  const resto = String(cabecalho || "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !ehCookieDeSessao(p.split("=")[0].trim()));
  return resto.length ? resto.join("; ") : null;
}
