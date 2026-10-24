/**
 * SENHA SORTEADA no lugar do "123456" fixo (lib/senha-gerada.ts).
 *
 *   npx tsx scripts/teste-senha-gerada.ts
 *
 * Achados F45/F50/F76: motoboy novo nascia com "123456" e o reset do admin
 * punha "123456" na conta da loja. Sem banco: as rotas rodam contra um Prisma
 * em memória (o jeito de scripts/teste-motivo-do-cancelamento.ts).
 *
 *   1. Os geradores: tamanho, alfabeto, sem repetir.
 *   2. POST /api/motoboys: sem senha digitada sorteia, devolve uma vez, nunca 123456.
 *   3. PUT /api/motoboys/[id]: "Gerar senha nova" e campo em branco.
 *   4. Motoboy antigo na 123456 continua entrando (conferirSenha).
 *   5. POST /api/admin/users/reset-password: devolve a senha que confere com o bcrypt gravado, e ela não vai para o log.
 *   6. POST /api/motoboys/login de verdade: o novo entra com a sorteada, o antigo com 123456.
 */
import bcrypt from "bcryptjs";
import { ALFABETO_LEGIVEL, gerarSenhaDeNumeros, gerarSenhaLegivel } from "../src/lib/senha-gerada";
import { SENHA_PADRAO, conferirSenha, hashDeSenha } from "../src/lib/motoboy-senha";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Prisma em memória e stubs ────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; motoboy: Linha[] } = { user: [], motoboy: [] };
const casa = (l: Linha, where: Linha = {}): boolean =>
  Object.entries(where).every(([k, v]) => (k === "OR" ? (v as Linha[]).some((w) => casa(l, w)) : l[k] === v));
let proximo = 0;
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => db[modelo].find((x) => casa(x, a.where)) ?? null,
  findFirst: async (a: any) => db[modelo].find((x) => casa(x, a.where)) ?? null,
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)),
  create: async (a: any) => { const l = { id: `${modelo}-${++proximo}`, active: true, ...a.data }; db[modelo].push(l); return { ...l }; },
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo}`); Object.assign(l, a.data); return { ...l }; },
});
(globalThis as any).prisma = { user: delegado("user"), motoboy: delegado("motoboy") };

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = { user: { email: "dono@loja.teste" } };
stub("next-auth/next", { getServerSession: async () => sessao });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/fiado-do-motoboy", { renomearNoFiado: async () => {}, tirarDoFiado: async () => {} });
stub("../src/lib/pedido-de-app-no-banco", { gravarPedidoDeApp: async () => {} });

const corpo = (method: string, b: unknown) => new Request("http://t/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

// ── 1. Geradores ─────────────────────────────────────────────────────────────
function secaoGeradores() {
  console.log("\n— 1. Os geradores —");
  const numeros = Array.from({ length: 1000 }, () => gerarSenhaDeNumeros());
  confere("motoboy: sempre 6 dígitos", numeros.every((s) => /^\d{6}$/.test(s)), true);
  confere("motoboy: nunca sai 123456", numeros.includes(SENHA_PADRAO), false);
  // Em 10^6 combinações, 1000 sorteios têm ~0,5 colisão esperada por acaso
  // (aniversário): exigir zero seria um teste que falha sozinho às vezes.
  confere("motoboy: 1000 sorteios quase todos diferentes (≥ 990)", new Set(numeros).size >= 990, true);
  confere("motoboy: tamanho pedido é respeitado", gerarSenhaDeNumeros(8).length, 8);

  const legiveis = Array.from({ length: 1000 }, () => gerarSenhaLegivel());
  confere("admin: sempre 10 caracteres", legiveis.every((s) => s.length === 10), true);
  confere("admin: só o alfabeto legível", legiveis.every((s) => [...s].every((c) => ALFABETO_LEGIVEL.includes(c))), true);
  confere("admin: sem i, l, o, 0, 1", legiveis.some((s) => /[ilo01]/.test(s)), false);
  confere("admin: 1000 sorteios sem repetir", new Set(legiveis).size, 1000);
}

// ── 2. Cadastro do motoboy ───────────────────────────────────────────────────
async function secaoCadastro() {
  console.log("\n— 2. POST /api/motoboys —");
  db.user.push({ id: "loja1", email: "dono@loja.teste", ownerId: null, role: "FRANCHISEE" });
  const { POST } = await import("../src/app/api/motoboys/route");

  let r = await POST(corpo("POST", { name: "Zé da Moto", phone: "22999990000" }));
  let j = await r.json();
  const gravado = db.motoboy.find((m) => m.id === j.id)!;
  confere("sem senha digitada: 201", r.status, 201);
  confere("devolve a senha sorteada (6 dígitos)", /^\d{6}$/.test(j.senhaGerada || ""), true);
  confere("a resposta não traz o hash", "password" in j, false);
  confere("não fica com 123456", await bcrypt.compare(SENHA_PADRAO, gravado.password), false);
  confere("o hash gravado confere com a senha mostrada", await bcrypt.compare(j.senhaGerada, gravado.password), true);
  confere("não é marcado como senha padrão", j.senhaPadrao, false);

  r = await POST(corpo("POST", { name: "Maria", password: "  minhasenha  " }));
  j = await r.json();
  const comSenha = db.motoboy.find((m) => m.id === j.id)!;
  confere("senha digitada pelo dono: nada sorteado", j.senhaGerada, null);
  confere("…e o hash confere com o digitado", await bcrypt.compare("minhasenha", comSenha.password), true);

  // Motoboy novo entra com a senha sorteada (o mesmo conferirSenha do login).
  const zeSenha = (await (await POST(corpo("POST", { name: "Teste Login" }))).json()).senhaGerada;
  const ze = db.motoboy.find((m) => m.name === "Teste Login")!;
  confere("login com a senha sorteada passa", (await conferirSenha(ze.password, zeSenha)).ok, true);
  confere("login com 123456 é recusado", (await conferirSenha(ze.password, SENHA_PADRAO)).ok, false);
}

// ── 3. Redefinir pela loja ───────────────────────────────────────────────────
async function secaoRedefinir() {
  console.log("\n— 3. PUT /api/motoboys/[id] —");
  const { PUT } = await import("../src/app/api/motoboys/[id]/route");
  db.motoboy.push({ id: "antigo", franchiseeId: "loja1", name: "Antigo", password: await hashDeSenha(SENHA_PADRAO), active: true });
  const params = Promise.resolve({ id: "antigo" });

  let r = await PUT(corpo("PUT", { name: "Antigo", password: "" }), { params });
  let j = await r.json();
  confere("campo em branco: senha não muda", await bcrypt.compare(SENHA_PADRAO, db.motoboy.find((m) => m.id === "antigo")!.password), true);
  confere("…e nada sorteado", j.senhaGerada, undefined);

  r = await PUT(corpo("PUT", { gerarSenha: true }), { params: Promise.resolve({ id: "antigo" }) });
  j = await r.json();
  const hash = db.motoboy.find((m) => m.id === "antigo")!.password;
  confere("gerar senha nova: devolve 6 dígitos", /^\d{6}$/.test(j.senhaGerada || ""), true);
  confere("…que confere com o hash gravado", await bcrypt.compare(j.senhaGerada, hash), true);
  confere("…e deixa de ser a padrão", [j.senhaPadrao, await bcrypt.compare(SENHA_PADRAO, hash)], [false, false]);
  confere("…sem devolver o hash", "password" in j, false);
}

// ── 4. Quem já está na 123456 continua entrando ──────────────────────────────
async function secaoAntigos() {
  console.log("\n— 4. Motoboy antigo —");
  const hash123 = await hashDeSenha(SENHA_PADRAO);
  confere("hash de 123456: entra e pede troca", await conferirSenha(hash123, SENHA_PADRAO).then((c) => [c.ok, c.ehPadrao]), [true, true]);
  confere("sem senha gravada (legado): entra com 123456", (await conferirSenha(null, SENHA_PADRAO)).ok, true);
  confere("texto puro legado: entra", (await conferirSenha("4321", "4321")).ok, true);
}

// ── 5. Reset do admin ────────────────────────────────────────────────────────
async function secaoAdmin() {
  console.log("\n— 5. POST /api/admin/users/reset-password —");
  const { POST } = await import("../src/app/api/admin/users/reset-password/route");
  db.user.push({ id: "lojaX", email: "lojax@teste", storeName: "Loja X", role: "FRANCHISEE", password: "velho" });
  const chama = (b: unknown) => POST(new Request("http://t/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }) as any);

  sessao = { user: { email: "dono@loja.teste", role: "FRANCHISEE" } };
  confere("quem não é admin: 401", (await chama({ userId: "lojaX", confirmacao: "redefinir" })).status, 401);

  sessao = { user: { email: "admin@firehub.teste", role: "ADMIN" } };
  const logs: string[] = [];
  const logOriginal = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const r = await chama({ userId: "lojaX", confirmacao: "redefinir" });
  console.log = logOriginal;
  const j = await r.json();
  const alvo = db.user.find((u) => u.id === "lojaX")!;
  confere("admin: 200 ok", [r.status, j.ok], [200, true]);
  confere("devolve 10 caracteres do alfabeto legível", typeof j.senha === "string" && j.senha.length === 10 && [...j.senha].every((c: string) => ALFABETO_LEGIVEL.includes(c)), true);
  confere("não é 123456", j.senha === SENHA_PADRAO, false);
  confere("confere com o bcrypt gravado", await bcrypt.compare(j.senha, alvo.password), true);
  confere("a senha não vai para o log", logs.some((l) => l.includes(j.senha)), false);
  confere("…mas o log registra quem redefiniu", logs.some((l) => l.includes("admin@firehub.teste") && l.includes("lojax@teste")), true);
  const outra = (await (await chama({ userId: "lojaX", confirmacao: "redefinir" })).json()).senha;
  confere("cada reset sorteia outra senha", outra !== j.senha, true);
}

// ── 6. O login do app/página do motoboy ─────────────────────────────────────
async function secaoLogin() {
  console.log("\n— 6. POST /api/motoboys/login —");
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "segredo-so-do-teste";
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../src/app/api/motoboys/login/route");
  db.user.find((u) => u.id === "loja1")!.slug = "loja-um";
  const { POST: cadastrar } = await import("../src/app/api/motoboys/route");
  sessao = { user: { email: "dono@loja.teste" } };
  const senha = (await (await cadastrar(corpo("POST", { name: "Novo Login", phone: "22988887777" }))).json()).senhaGerada;
  let ip = 0;
  const entra = async (phone: string, password: string) => {
    const r = await POST(new NextRequest("http://t/api/motoboys/login", {
      method: "POST", body: JSON.stringify({ storeSlug: "loja-um", phone, password }),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
    }));
    return [r.status, (await r.json()).mustChangePassword];
  };
  confere("novo: entra com a senha sorteada, sem pedir troca", await entra("22988887777", senha), [200, false]);
  confere("novo: 123456 é recusado", (await entra("22988887777", SENHA_PADRAO))[0], 401);
  db.motoboy.push({ id: "velho", franchiseeId: "loja1", name: "Velho Antigo", phone: "22977776666", password: await hashDeSenha(SENHA_PADRAO), active: true });
  confere("antigo na 123456: continua entrando (e a tela pede troca)", await entra("22977776666", SENHA_PADRAO), [200, true]);
}

(async () => {
  secaoGeradores();
  await secaoCadastro();
  await secaoRedefinir();
  await secaoAntigos();
  await secaoAdmin();
  await secaoLogin();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
