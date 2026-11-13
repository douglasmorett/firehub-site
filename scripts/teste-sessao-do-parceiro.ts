/**
 * scripts/teste-sessao-do-parceiro.ts — a sessão do portal do parceiro só vale
 * no portal (lib/sessao-do-parceiro.ts + src/proxy.ts).
 *
 * Douglas (12/11/2026): "cuidado para meus vendedores só terem acesso aos
 * números da carteira deles e sobre eles, e não sobre tudo". As rotas da loja
 * acham a loja por session.user.email sem olhar o role: um vendedor com o
 * e-mail de uma loja abria os dados dela. O proxy tira o cookie da sessão do
 * parceiro fora do portal.
 *
 * 1. As regras puras (caminhos, nome do cookie, cabeçalho sem a sessão).
 * 2. O proxy de verdade, com um token assinado: parceiro em rota da loja segue
 *    sem o cookie; no portal, com ele; loja logada não muda; /store volta ao portal.
 * 3. Nenhuma rota que acha a loja por e-mail fica dentro do portal, e toda rota
 *    do portal confere o role/vendedor da sessão.
 *
 *   npx tsx scripts/teste-sessao-do-parceiro.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { cookiesSemSessao, ehCookieDeSessao, sessaoDoParceiroVale } from "../src/lib/sessao-do-parceiro";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

async function main() {
  console.log("— Onde a sessão do parceiro vale —");
  for (const c of ["/vendedor", "/embaixador", "/embaixador/curso/abc", "/login", "/api/auth/session", "/api/me", "/api/me/paineis",
    "/api/vendedor/carteira", "/api/vendedor/carteira/x/linha-do-tempo", "/api/embaixador/curso", "/api/crm/contatos/x"]) {
    confere(`vale em ${c}`, sessaoDoParceiroVale(c), true);
  }
  for (const c of ["/store", "/store/caixa", "/api/store/settings", "/api/customer-order/abc", "/api/cash-session", "/api/admin/projecao",
    "/api/admin/menu-products", "/api/chatbot/config", "/api/ifood/merchant", "/api/vendedorx", "/api/meus-dados", "/vendedores", "/admin", "/pdv"]) {
    confere(`não vale em ${c}`, sessaoDoParceiroVale(c), false);
  }

  console.log("\n— O cookie da sessão —");
  for (const n of ["next-auth.session-token", "__Secure-next-auth.session-token", "__Secure-next-auth.session-token.0", "next-auth.session-token.1"]) {
    confere(`${n} é sessão`, ehCookieDeSessao(n), true);
  }
  for (const n of ["next-auth.csrf-token", "__Host-next-auth.csrf-token", "next-auth.callback-url", "loja_ativa", "session-token"]) {
    confere(`${n} não é`, ehCookieDeSessao(n), false);
  }
  confere("tira só a sessão", cookiesSemSessao("a=1; __Secure-next-auth.session-token=xyz; next-auth.csrf-token=k; __Secure-next-auth.session-token.1=w"), "a=1; next-auth.csrf-token=k");
  confere("só a sessão: cabeçalho some", cookiesSemSessao("next-auth.session-token=xyz"), null);
  confere("sem cookie: nada", cookiesSemSessao(null), null);

  console.log("\n— O proxy de verdade —");
  process.env.NEXTAUTH_SECRET = "segredo-do-teste-da-sessao-do-parceiro";
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL;
  const { proxy } = await import("../src/proxy");
  const token = async (role: string) => encode({ token: { id: "id-1", sub: "id-1", role, email: "dono@loja.com" }, secret: process.env.NEXTAUTH_SECRET! });
  const chamar = async (caminho: string, role: string | null) => {
    const headers: Record<string, string> = { host: "localhost:3000", cookie: "outro=1" };
    if (role) headers.cookie = `outro=1; next-auth.session-token=${await token(role)}`;
    const res = await proxy(new NextRequest(`http://localhost:3000${caminho}`, { headers }));
    const sobrescritos = (res.headers.get("x-middleware-override-headers") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cookieRepassado = sobrescritos.includes("cookie") ? res.headers.get("x-middleware-request-cookie") : "(original)";
    return { status: res.status, location: res.headers.get("location"), cookieRepassado };
  };

  const parceiroNaLoja = await chamar("/api/store/settings", "AMBASSADOR");
  confere("parceiro em /api/store: segue sem o cookie da sessão", parceiroNaLoja.cookieRepassado, "outro=1");
  const parceiroNoPedido = await chamar("/api/customer-order/abc", "AMBASSADOR");
  confere("parceiro em /api/customer-order: sem a sessão", parceiroNoPedido.cookieRepassado, "outro=1");
  const parceiroNoAdmin = await chamar("/api/admin/menu-products", "AMBASSADOR");
  confere("parceiro em /api/admin: 401 no proxy", parceiroNoAdmin.status, 401);
  const parceiroNoPainel = await chamar("/store/caixa", "AMBASSADOR");
  confere("parceiro em /store: volta para o portal", [parceiroNoPainel.status, parceiroNoPainel.location?.endsWith("/embaixador")], [307, true]);
  const parceiroNoPortal = await chamar("/api/vendedor/carteira", "AMBASSADOR");
  confere("parceiro no portal: sessão intacta", parceiroNoPortal.cookieRepassado, "(original)");
  const parceiroNoCrm = await chamar("/api/crm/agenda", "AMBASSADOR");
  confere("parceiro no CRM: sessão intacta", parceiroNoCrm.cookieRepassado, "(original)");
  const lojaNaLoja = await chamar("/api/store/settings", "FRANCHISEE");
  confere("loja logada em /api/store: nada muda", lojaNaLoja.cookieRepassado, "(original)");
  const adminNoAdmin = await chamar("/api/admin/projecao", "ADMIN");
  confere("admin em /api/admin: nada muda", [adminNoAdmin.status, adminNoAdmin.cookieRepassado], [200, "(original)"]);
  const anonimo = await chamar("/api/store/settings", null);
  confere("anônimo: nada muda", anonimo.cookieRepassado, "(original)");

  console.log("\n— As rotas —");
  const RAIZ = join(__dirname, "..");
  const API = join(RAIZ, "src", "app", "api");
  const rotas: string[] = [];
  const andar = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else if (n === "route.ts") rotas.push(p);
    }
  };
  andar(API);
  const caminhoDa = (arq: string) => "/api/" + relative(API, arq).split(sep).slice(0, -1).join("/");
  const porEmail = /email:\s*\(?session[^\n]*\.user[^\n]*\.email/;
  // "Acha a loja": o e-mail da sessão vai num `where` do banco (o /api/me só devolve o próprio e-mail).
  const achaLojaPorEmail = (s: string) => porEmail.test(s) && /prisma\./.test(s);
  const lojaPorEmailNoPortal = rotas.filter((r) => achaLojaPorEmail(readFileSync(r, "utf8")) && sessaoDoParceiroVale(caminhoDa(r)));
  confere("o teste enxerga as rotas que acham a loja pelo e-mail", rotas.filter((r) => achaLojaPorEmail(readFileSync(r, "utf8"))).length > 100, true);
  confere("nenhuma rota que acha a loja pelo e-mail da sessão fica dentro do portal", lojaPorEmailNoPortal.map(caminhoDa), []);
  const doPortal = rotas.filter((r) => /^\/api\/(vendedor|crm)\//.test(caminhoDa(r)));
  const semConferir = doPortal.filter((r) => !/vendedorDaSessao\(|quemEsta\(|role !== "AMBASSADOR"/.test(readFileSync(r, "utf8")));
  confere(`as ${doPortal.length} rotas do vendedor/CRM conferem quem é pela sessão`, semConferir.map(caminhoDa), []);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
