/**
 * A senha nova da principal vale nas filiais (lib/senha-do-grupo.ts, F143) e
 * quem cadastra motoboy (api/motoboys POST).
 *
 * Banco falso em globalThis.prisma, sessão falsa no getServerSession:
 *
 *   • o dono troca a senha (changePassword, updatePassword, esqueci a senha,
 *     reset do admin): a filial com o mesmo hash recebe o novo, a filial com
 *     senha própria não; a sessão da filial cai (conferirSessao);
 *   • a filial que troca a própria senha só muda ela mesma, como antes;
 *   • cadastro de motoboy: caixa só com KDS leva 403; com Motoboys passa; quem
 *     despacha pelos Pedidos passa; o dono passa.
 *
 *   npx tsx scripts/teste-senha-do-grupo.ts
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
type Linha = Record<string, any>;
const db: { user: Linha[]; motoboy: Linha[] } = { user: [], motoboy: [] };
const casaCampo = (valor: any, filtro: any): boolean =>
  filtro && typeof filtro === "object" && !(filtro instanceof Date)
    ? Object.entries(filtro).every(([op, v]) => (op === "gt" ? valor > (v as any) : op === "not" ? valor !== v : op === "equals" ? valor === v : false))
    : (valor ?? null) === filtro;
const casa = (l: Linha, where: Linha = {}): boolean =>
  Object.entries(where).every(([k, v]) => (k === "OR" ? (v as Linha[]).some((w) => casa(l, w)) : casaCampo(l[k], v)));
const recorta = (u: any, select?: any) => (u && select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k] ?? null])) : u ? { ...u } : null);
let transacoes = 0;
const fake: any = {
  user: {
    findUnique: async ({ where, select }: any) => recorta(db.user.find((u) => casa(u, where)), select),
    findFirst: async ({ where, select }: any) => recorta(db.user.find((u) => casa(u, where)), select),
    findMany: async ({ where, select }: any = {}) => db.user.filter((u) => casa(u, where)).map((u) => recorta(u, select)),
    update: async ({ where, data }: any) => { const u = db.user.find((x) => casa(x, where)); if (!u) throw new Error("update"); Object.assign(u, data); return { ...u }; },
    updateMany: async ({ where, data }: any) => { const us = db.user.filter((x) => casa(x, where)); us.forEach((u) => Object.assign(u, data)); return { count: us.length }; },
  },
  motoboy: {
    create: async ({ data }: any) => { const m = { id: `moto-${db.motoboy.length + 1}`, active: true, ...data }; db.motoboy.push(m); return { ...m }; },
  },
  $transaction: async (ops: Promise<any>[]) => (transacoes++, Promise.all(ops)),
};
(globalThis as any).prisma = fake;

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = null;
stub("next-auth/next", { getServerSession: async () => sessao });
const POTE = new Map<string, string>();
stub("next/headers", { cookies: async () => ({ get: (n: string) => (POTE.has(n) ? { value: POTE.get(n) } : undefined), set: (n: string, v: string) => POTE.set(n, v) }) });
stub("../src/lib/pedido-de-app-no-banco", { gravarPedidoDeApp: async () => {} });

async function main() {
  const bcrypt = (await import("bcryptjs")).default;
  const { conferirSessao, marcaDaSenha } = await import("../src/lib/sessao-conferida");
  const { changePassword } = await import("../src/app/actions/changePassword");
  const { updatePassword } = await import("../src/app/actions/updatePassword");

  const hashDe = (s: string) => bcrypt.hash(s, 4);
  const senhaDe = (id: string) => db.user.find((u) => u.id === id)!.password;
  const loja = (id: string, password: string, extra: Linha = {}) =>
    db.user.push({ id, email: `${id}@x`, name: id, role: "FRANCHISEE", ownerId: null, accountGroupId: null, permissions: null, password, ...extra });

  const antiga = await hashDe("senha-antiga");
  const daFilial = await hashDe("senha-da-filial");
  loja("dono", antiga);
  loja("filial1", antiga, { accountGroupId: "dono", email: "filial1.dono00@stores.firehub.app" });
  loja("filial2", daFilial, { accountGroupId: "dono" });
  loja("outro", antiga); // outra conta com a mesma senha, fora do grupo
  db.user.push({ id: "caixa", email: "caixa@x", role: "STAFF", ownerId: "dono", accountGroupId: null, permissions: "kds", password: antiga });

  // Sessões abertas antes da troca, cada uma com a marca da senha de então.
  const tokenDa = (id: string) => ({ sub: id, id, role: "FRANCHISEE", marcaDaSenha: marcaDaSenha(senhaDe(id)) });
  const sessaoFilial1 = tokenDa("filial1");
  const sessaoFilial2 = tokenDa("filial2");
  for (const t of [sessaoFilial1, sessaoFilial2]) await conferirSessao(t); // põe na memória de 60 s

  // ── 1. O dono troca a senha (Meu perfil) ──────────────────────────────────
  console.log("\n— 1. changePassword na principal —");
  sessao = { user: { email: "dono@x" } };
  await changePassword("senha-antiga", "senha-nova-1");
  const nova1 = senhaDe("dono");
  confere("a principal tem a senha nova", await bcrypt.compare("senha-nova-1", nova1), true);
  confere("a filial com a mesma senha recebe o MESMO hash novo", senhaDe("filial1") === nova1, true);
  confere("a filial com senha própria fica como estava", senhaDe("filial2"), daFilial);
  confere("conta fora do grupo não muda", senhaDe("outro"), antiga);
  confere("funcionário da loja não muda", senhaDe("caixa"), antiga);
  confere("tudo numa transação", transacoes, 1);
  confere("a senha antiga não abre mais a filial", await bcrypt.compare("senha-antiga", senhaDe("filial1")), false);
  confere("a senha nova abre a filial", await bcrypt.compare("senha-nova-1", senhaDe("filial1")), true);
  confere("a sessão na filial cai (sem esperar os 60 s)", await conferirSessao(sessaoFilial1), null);
  confere("a sessão na filial de senha própria segue", (await conferirSessao(sessaoFilial2))?.id, "filial2");

  // ── 2. updatePassword (a outra tela de perfil) ────────────────────────────
  console.log("\n— 2. updatePassword na principal —");
  await updatePassword("senha-nova-1", "senha-nova-2");
  confere("a filial acompanha de novo", senhaDe("filial1") === senhaDe("dono") && (await bcrypt.compare("senha-nova-2", senhaDe("filial1"))), true);
  confere("a de senha própria segue própria", senhaDe("filial2"), daFilial);

  // ── 3. A filial troca a própria senha: só ela, como antes ─────────────────
  console.log("\n— 3. changePassword logado na filial —");
  const transacoesAntes = transacoes;
  const doDono = senhaDe("dono");
  sessao = { user: { email: "filial1.dono00@stores.firehub.app" } };
  await changePassword("senha-nova-2", "senha-so-da-filial1");
  confere("a filial muda", await bcrypt.compare("senha-so-da-filial1", senhaDe("filial1")), true);
  confere("a principal não muda", senhaDe("dono"), doDono);
  confere("sem transação de grupo", transacoes, transacoesAntes);

  // ── 4. Esqueci a senha (token por e-mail) ─────────────────────────────────
  console.log("\n— 4. forgot-password na principal —");
  const { NextRequest } = await import("next/server");
  const { POST: esqueci } = await import("../src/app/api/auth/forgot-password/route");
  loja("filial3", doDono, { accountGroupId: "dono" });
  const sessaoFilial3 = tokenDa("filial3");
  const token = "a".repeat(64);
  Object.assign(db.user.find((u) => u.id === "dono")!, { resetToken: token, resetTokenExp: new Date(Date.now() + 60_000) });
  const r = await esqueci(new NextRequest("http://x/api/auth/forgot-password", {
    method: "POST", body: JSON.stringify({ token, newPassword: "senha-recuperada" }),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
  }));
  confere("200", r.status, 200);
  confere("a filial com a senha do dono recebe a recuperada", await bcrypt.compare("senha-recuperada", senhaDe("filial3")), true);
  confere("o token de recuperação some da principal", db.user.find((u) => u.id === "dono")!.resetToken, null);
  confere("a filial que já tinha senha própria não muda", await bcrypt.compare("senha-so-da-filial1", senhaDe("filial1")), true);
  confere("a sessão na filial cai", await conferirSessao(sessaoFilial3), null);

  // ── 5. Reset do admin ─────────────────────────────────────────────────────
  console.log("\n— 5. reset-password do admin na principal —");
  const { POST: resetar } = await import("../src/app/api/admin/users/reset-password/route");
  db.user.push({ id: "adm", email: "adm@firehub", role: "ADMIN", ownerId: null, accountGroupId: null, password: "x" });
  sessao = { user: { email: "adm@firehub", role: "ADMIN" } };
  const logOriginal = console.log;
  console.log = () => {};
  const rr = await resetar(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "dono", confirmacao: "redefinir" }) }) as any);
  console.log = logOriginal;
  const { senha } = await rr.json();
  confere("a senha sorteada abre a principal e a filial que acompanhava", [await bcrypt.compare(senha, senhaDe("dono")), await bcrypt.compare(senha, senhaDe("filial3"))], [true, true]);
  confere("a resposta não leva hash", JSON.stringify(await (await resetar(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "dono", confirmacao: "redefinir" }) }) as any)).json()).includes("$2"), false);

  // ── 6. Cadastro de motoboy ────────────────────────────────────────────────
  console.log("\n— 6. POST /api/motoboys —");
  const { POST: cadastrar } = await import("../src/app/api/motoboys/route");
  const pessoa = (id: string, permissions: string) =>
    db.user.push({ id, email: `${id}@x`, role: "STAFF", ownerId: "dono", accountGroupId: null, permissions, password: "x" });
  pessoa("so-kds", "kds");
  pessoa("com-motoboys", "kds,motoboys");
  pessoa("despacha", "orders");
  const cadastra = async (email: string) => {
    sessao = { user: { email } };
    return (await cadastrar(new Request("http://x/api/motoboys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Zé", phone: "22999990000" }) }))).status;
  };
  const motoboysAntes = db.motoboy.length;
  confere("caixa só com KDS: 403", await cadastra("so-kds@x"), 403);
  confere("…e nada é gravado", db.motoboy.length, motoboysAntes);
  confere("funcionário com Motoboys: 201", await cadastra("com-motoboys@x"), 201);
  confere("quem despacha pelos Pedidos (roteirização): 201", await cadastra("despacha@x"), 201);
  confere("o dono: 201", await cadastra("dono@x"), 201);
  confere("o motoboy é da loja do dono", db.motoboy.every((m) => m.franchiseeId === "dono"), true);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ estourou:", e);
  process.exit(1);
});
