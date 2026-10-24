/**
 * A sessão depois da senha trocada (lib/sessao-conferida.ts, auditoria de
 * 23/10/2026: F122, F123, F145, F146).
 *
 * Chama os callbacks `jwt`/`session` de authOptions, o `authorize` e o
 * getServerSession de verdade, com banco falso em globalThis.prisma:
 *
 *   • senha trocada derruba; senha igual mantém;
 *   • token antigo (sem marca) mantém e passa a ter o role do banco;
 *   • conta apagada (ou role DELETED) derruba;
 *   • banco fora do ar mantém;
 *   • impersonação leva a marca da loja-alvo, e o "Voltar ao admin" recusa
 *     admin que trocou a senha;
 *   • sessão derrubada não serve de ponte para trocar de loja.
 *
 *   npx tsx scripts/teste-sessao-depois-da-senha.ts
 */
export {};

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.NEXTAUTH_URL ||= "http://localhost:3000";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Banco falso ──────────────────────────────────────────────────────────────
type Conta = { id: string; name: string; email: string; password: string; role: string; permissions: string | null; city: null; storeName: string; ownerId: string | null; accountGroupId: string | null };
const conta = (id: string, role = "FRANCHISEE", extra: Partial<Conta> = {}): Conta => ({
  id, name: id, email: `${id}@x`, password: `$2a$10$hash-de-${id}`, role, permissions: null, city: null, storeName: id, ownerId: null, accountGroupId: null, ...extra,
});
const USUARIOS = new Map<string, Conta>();
const PARCEIROS = new Map<string, { id: string; password: string | null }>();
let bancoFora = false;
let consultas = 0;
const recorta = (u: any, select?: any) => (u && select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k] ?? null])) : u);
(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where, select }: any) => {
      consultas++;
      if (bancoFora) throw new Error("banco fora do ar");
      return recorta(USUARIOS.get(where.id) ?? null, select);
    },
  },
  ambassador: {
    findUnique: async ({ where, select }: any) => {
      consultas++;
      if (bancoFora) throw new Error("banco fora do ar");
      return recorta(PARCEIROS.get(where.id) ?? null, select);
    },
  },
};

// Cookies da server action (renovarMarcaDaSessao): um pote falso no lugar de next/headers.
const POTE = new Map<string, string>();
{
  const arquivo = require.resolve("next/headers");
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, cookies: async () => ({ get: (n: string) => (POTE.has(n) ? { value: POTE.get(n) } : undefined), set: (n: string, v: string) => POTE.set(n, v) }) } } as any;
}

async function main() {
  const { authOptions, renovarMarcaDaSessao } = await import("../src/lib/auth");
  const { marcaDaSenha, esquecerConta } = await import("../src/lib/sessao-conferida");
  const { encode, decode } = await import("next-auth/jwt");
  const { getServerSession } = await import("next-auth/next");
  const jwt = authOptions.callbacks!.jwt! as any;
  const session = authOptions.callbacks!.session! as any;
  const authorize = (authOptions.providers[0] as any).options.authorize;

  const entrar = async (u: any) => jwt({ token: { sub: u.id, name: u.name, email: u.email }, user: u });
  const identidade = (c: Conta) => ({ id: c.id, name: c.name, email: c.email, role: c.role, city: null, storeName: c.storeName, permissions: c.permissions, marcaDaSenha: marcaDaSenha(c.password) });
  const vale = (t: any) => !!(t?.id || t?.sub);
  const cookie = async (t: any) => `next-auth.session-token=${await encode({ token: t, secret: process.env.NEXTAUTH_SECRET! })}`;
  const sessaoDoServidor = async (t: any) =>
    getServerSession({ headers: {}, cookies: { "next-auth.session-token": await encode({ token: t, secret: process.env.NEXTAUTH_SECRET! }) } } as any, { getHeader() {}, setHeader() {} } as any, authOptions);

  // ── Login grava a marca, nunca o hash ──────────────────────────────────────
  USUARIOS.set("loja1", conta("loja1"));
  const t1 = await entrar(identidade(USUARIOS.get("loja1")!));
  confere("login grava a marca da senha (12 caracteres)", t1.marcaDaSenha, marcaDaSenha(USUARIOS.get("loja1")!.password));
  confere("o token não carrega o hash", JSON.stringify(t1).includes("$2a$"), false);

  // ── Senha igual mantém; senha trocada derruba ──────────────────────────────
  confere("senha igual: sessão segue", vale(await jwt({ token: { ...t1 } })), true);
  confere("getServerSession com senha igual tem a loja", (await sessaoDoServidor(t1) as any)?.user?.id, "loja1");
  USUARIOS.get("loja1")!.password = "$2a$10$hash-novo";
  const antesDeVencer = await jwt({ token: { ...t1 } });
  confere("dentro dos 60 s de memória ainda vale (custo de banco)", vale(antesDeVencer), true);
  esquecerConta("loja1");
  const depois = await jwt({ token: { ...t1 } });
  confere("senha trocada: token vira vazio", depois, {});
  confere("session do token vazio é vazia", await session({ session: { user: { name: "x" }, expires: "x" }, token: depois }), {});
  confere("getServerSession dá null com a senha trocada", await sessaoDoServidor(t1), null);
  confere("token vazio segue vazio (não ressuscita)", vale(await jwt({ token: {} })), false);

  // ── Token antigo (sem marca): não cai, só ganha role/permissions do banco ──
  USUARIOS.set("caixa", conta("caixa", "STAFF", { ownerId: "loja1", permissions: "orders,kds" }));
  const antigo = { sub: "caixa", id: "caixa", email: "caixa@x", role: "FRANCHISEE", permissions: "orders,kds,finance" };
  const t2 = await jwt({ token: { ...antigo } });
  confere("token antigo sem marca: sessão segue", vale(t2), true);
  confere("token antigo passa a ter o role do banco", t2.role, "STAFF");
  confere("token antigo passa a ter as permissões do banco", t2.permissions, "orders,kds");
  confere("getServerSession do token antigo tem o role do banco", (await sessaoDoServidor(antigo) as any)?.user?.role, "STAFF");

  // ── Admin rebaixado: role do banco (F146/F91) ──────────────────────────────
  USUARIOS.set("adm2", conta("adm2", "ADMIN"));
  const tAdm2 = await entrar(identidade(USUARIOS.get("adm2")!));
  USUARIOS.get("adm2")!.role = "FRANCHISEE";
  esquecerConta("adm2");
  confere("admin rebaixado perde o ADMIN na próxima leitura", (await jwt({ token: { ...tAdm2 } })).role, "FRANCHISEE");

  // ── Conta apagada ou desativada derruba ────────────────────────────────────
  USUARIOS.set("func", conta("func", "STAFF", { ownerId: "loja1" }));
  const t3 = await entrar(identidade(USUARIOS.get("func")!));
  USUARIOS.delete("func");
  esquecerConta("func");
  confere("funcionário apagado: token vira vazio", await jwt({ token: { ...t3 } }), {});
  USUARIOS.set("func2", conta("func2", "STAFF", { ownerId: "loja1" }));
  const t4 = await jwt({ token: { sub: "func2", id: "func2", role: "STAFF" } });
  USUARIOS.get("func2")!.role = "DELETED";
  esquecerConta("func2");
  confere("soft-delete (role DELETED), mesmo em token antigo: token vira vazio", await jwt({ token: { ...t4 } }), {});

  // ── Banco fora do ar mantém ────────────────────────────────────────────────
  USUARIOS.set("loja2", conta("loja2"));
  const t5 = await entrar(identidade(USUARIOS.get("loja2")!));
  bancoFora = true;
  const errOriginal = console.error;
  console.error = () => {};
  const t5b = await jwt({ token: { ...t5 } });
  console.error = errOriginal;
  bancoFora = false;
  confere("banco fora do ar: sessão segue como estava", t5b, t5);

  // ── Portal do parceiro confere em Ambassador ───────────────────────────────
  PARCEIROS.set("amb1", { id: "amb1", password: "$2a$10$hash-amb" });
  const t6 = await entrar({ id: "amb1", name: "amb", email: "amb@x", role: "AMBASSADOR", city: null, storeName: "amb", permissions: "[]", marcaDaSenha: marcaDaSenha("$2a$10$hash-amb") });
  const t6b = await jwt({ token: { ...t6 } });
  confere("sessão do portal (id de Ambassador) segue", [vale(t6b), t6b.role], [true, "AMBASSADOR"]);
  PARCEIROS.get("amb1")!.password = "$2a$10$outra";
  esquecerConta("amb1");
  confere("senha do portal trocada: token vira vazio", await jwt({ token: { ...t6 } }), {});

  // ── Impersonação: marca da loja-alvo; volta recusa admin com senha nova ────
  USUARIOS.set("admin", conta("admin", "ADMIN"));
  USUARIOS.set("alvo", conta("alvo"));
  const tAdmin = await entrar(identidade(USUARIOS.get("admin")!));
  const imp = await authorize({ impersonateId: "alvo" }, { headers: { cookie: await cookie(tAdmin) } });
  const tImp = await entrar(imp);
  confere("impersonação leva a marca da loja-alvo", [tImp.id, tImp.marcaDaSenha], ["alvo", marcaDaSenha(USUARIOS.get("alvo")!.password)]);
  confere("impersonação segue valendo nas leituras", [vale(await jwt({ token: { ...tImp } })), tImp.impersonatedBy], [true, "admin"]);
  const volta = await authorize({ returnToAdmin: "true" }, { headers: { cookie: await cookie(tImp) } });
  confere("voltar ao admin com a mesma senha funciona", [volta?.id, volta?.marcaDaSenha], ["admin", marcaDaSenha(USUARIOS.get("admin")!.password)]);
  USUARIOS.get("admin")!.password = "$2a$10$senha-nova-do-admin";
  esquecerConta("admin");
  confere("admin trocou a senha: o cookie antigo não volta ao admin", await authorize({ returnToAdmin: "true" }, { headers: { cookie: await cookie(tImp) } }), null);
  confere("admin trocou a senha: o cookie antigo não entra em outra loja", await authorize({ impersonateId: "alvo" }, { headers: { cookie: await cookie(tAdmin) } }), null);

  // ── Sessão derrubada não é ponte para trocar de loja ───────────────────────
  USUARIOS.set("matriz", conta("matriz"));
  USUARIOS.set("filial", conta("filial", "FRANCHISEE", { accountGroupId: "matriz" }));
  const tMatriz = await entrar(identidade(USUARIOS.get("matriz")!));
  const troca = await authorize({ trocarLoja: "filial" }, { headers: { cookie: await cookie(tMatriz) } });
  confere("troca de loja leva a marca da filial", [troca?.id, troca?.marcaDaSenha], ["filial", marcaDaSenha(USUARIOS.get("filial")!.password)]);
  USUARIOS.get("matriz")!.password = "$2a$10$matriz-nova";
  esquecerConta("matriz");
  confere("senha da matriz trocada: o cookie antigo não troca de loja", await authorize({ trocarLoja: "filial" }, { headers: { cookie: await cookie(tMatriz) } }), null);

  // ── Quem troca a própria senha segue logado neste navegador ───────────────
  USUARIOS.set("loja4", conta("loja4"));
  const tAqui = await entrar(identidade(USUARIOS.get("loja4")!));
  const tOutroPc = { ...tAqui };
  POTE.set("next-auth.session-token", await encode({ token: tAqui, secret: process.env.NEXTAUTH_SECRET! }));
  USUARIOS.get("loja4")!.password = "$2a$10$loja4-nova";
  await renovarMarcaDaSessao("loja4", "$2a$10$loja4-nova");
  const regravado = await decode({ token: POTE.get("next-auth.session-token")!, secret: process.env.NEXTAUTH_SECRET! });
  confere("o cookie deste navegador ganha a marca nova", (regravado as any)?.marcaDaSenha, marcaDaSenha("$2a$10$loja4-nova"));
  confere("este navegador segue logado", vale(await jwt({ token: { ...regravado } })), true);
  confere("o outro computador cai na hora (sem esperar a memória)", await jwt({ token: tOutroPc }), {});

  // ── Custo: uma consulta por conta a cada 60 s ──────────────────────────────
  USUARIOS.set("loja3", conta("loja3"));
  const t7 = await entrar(identidade(USUARIOS.get("loja3")!));
  const antes = consultas;
  for (let i = 0; i < 50; i++) await jwt({ token: { ...t7 } });
  confere("50 leituras da mesma conta = 1 consulta ao banco", consultas - antes, 1);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ estourou:", e);
  process.exit(1);
});
