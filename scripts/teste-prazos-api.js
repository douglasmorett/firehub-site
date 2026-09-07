/**
 * Regressao das rotas /api/prazos em PRODUCAO, com uma conta descartavel.
 *
 * Uso: node scripts/teste-prazos-api.js
 * Cobre: login e freio, tabela automatica e faixas manuais, regra do 99Food,
 * marcacao de lojas + cota do plano, liga/desliga do robo na conta, troca de
 * senha, relatorio e o corte por falta de pagamento (402).
 *
 * A URL do banco sai de scratch/check-pastel-paulista.js (os .env do repo sao
 * placeholders) — ver a memoria firehub-acesso-banco-producao.
 */
const fs = require("fs");
const REPO = "C:/Users/FINANCEIRO/Documents/firehub-site";
const origem = fs.readFileSync(REPO + "/scratch/check-pastel-paulista.js", "utf8");
const { neon } = require(REPO + "/node_modules/@neondatabase/serverless");
const bcrypt = require(REPO + "/node_modules/bcryptjs");
const sql = neon(origem.match(/neon\('([^']+)'\)/)[1]);
const BASE = "https://firehubfood.com.br";
const EMAIL = "harness-prazos@firehubfood.com.br";
const SENHA = "harness123";
const res = [];
const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };
const api = async (p, init) => { const r = await fetch(BASE + p, init); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const J = (o) => ({ method: o.m || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o.b || {}) });

(async () => {
  await sql`DELETE FROM "PrazoConta" WHERE email IN (${EMAIL}, 'teste-agrupado@firehubfood.com.br')`;
  const id = "pz_harness_" + Date.now();
  await sql`INSERT INTO "PrazoConta" (id, email, "senhaHash", "nomeLoja", status, motoboys, "lojasIncluidas", "criadoPor", "updatedAt")
            VALUES (${id}, ${EMAIL}, ${await bcrypt.hash(SENHA, 10)}, 'Loja Harness', 'ATIVO', 2, 2, 'harness', NOW())`;

  let r = await api("/api/prazos/login", J({ b: { email: EMAIL, senha: "errada" } }));
  ok("senha errada → 401", r.s === 401);
  r = await api("/api/prazos/login", J({ b: { email: EMAIL, senha: SENHA } }));
  ok("login → token, cota 2, robô desligado", r.s === 200 && r.d.token && r.d.conta.lojasIncluidas === 2 && r.d.conta.config.roboLigado === false);
  const token = r.d.token, q = "?token=" + encodeURIComponent(token);

  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 5 } }));
  ok("2 motoboys, 5 pedidos → 58 min", r.d.minutos === 58 && r.d.pausar === false, r.d.rotulo);
  ok("preparo 99 padrão = 58 − 15", r.d.preparo99 && r.d.preparo99.minutos === 43, r.d.preparo99 && r.d.preparo99.rotulo);
  ok("robô desligado chega na extensão", r.d.roboLigado === false);
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 99 } }));
  ok("estouro → 78 + pausar", r.d.minutos === 78 && r.d.pausar === true);

  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { motoboys: 4, modo: "manual", regrasManuais: [{ maxPedidos: 4, minutos: 35 }, { maxPedidos: 8, minutos: 50 }] } }));
  ok("config salva motoboys+faixas", r.s === 200 && r.d.conta.motoboys === 4);
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 6 } }));
  ok("faixa manual (6 ped → 50 min)", r.d.minutos === 50, r.d.rotulo);
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 20 } }));
  ok("acima da última faixa → pausar", r.d.pausar === true);

  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { preparo99: { modo: "faixas", regras: [{ maxPedidos: 3, minutos: 12 }, { maxPedidos: 9, minutos: 28 }] } } }));
  ok("regra do 99 em faixas salva", r.s === 200 && r.d.conta.config.preparo99.modo === "faixas");
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 2 } }));
  ok("preparo 99 por faixa (2 ped → 12)", r.d.preparo99.minutos === 12);

  const tres = [1, 2, 3].map((n) => ({ uuid: `0000000${n}-0000-4000-8000-00000000000${n}`, nome: "Loja " + n, ativa: true }));
  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { lojasIfood: tres } }));
  ok("3 lojas com plano de 2 → recusa com motivo", r.s === 400 && /plano inclui 2/.test(r.d.error || ""), r.d.error);
  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { lojasIfood: tres.map((l, i) => ({ ...l, ativa: i < 2 })) } }));
  ok("2 lojas marcadas + 1 desmarcada → salva", r.s === 200 && r.d.conta.config.lojasIfood.filter((l) => l.ativa).length === 2);
  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { lojasIfood: [{ uuid: "não-é-uuid", nome: "x", ativa: true }] } }));
  ok("uuid inválido é descartado", r.s === 200 && r.d.conta.config.lojasIfood.length === 0);

  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { roboLigado: true } }));
  ok("liga o robô na conta", r.s === 200 && r.d.conta.config.roboLigado === true);
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 1 } }));
  ok("calcular devolve robô ligado", r.d.roboLigado === true);

  r = await api("/api/prazos/senha" + q, J({ b: { senhaAtual: "errada", novaSenha: "novasenha1" } }));
  ok("trocar senha com atual errada → 401", r.s === 401);
  r = await api("/api/prazos/senha" + q, J({ b: { senhaAtual: SENHA, novaSenha: "abc" } }));
  ok("senha curta → 400", r.s === 400);
  r = await api("/api/prazos/senha" + q, J({ b: { senhaAtual: SENHA, novaSenha: "novasenha1" } }));
  ok("troca de senha", r.s === 200 && r.d.success);
  r = await api("/api/prazos/login", J({ b: { email: EMAIL, senha: "novasenha1" } }));
  ok("login com a senha nova", r.s === 200 && r.d.success);

  r = await api("/api/prazos/relatorio?dias=7&token=" + encodeURIComponent(token));
  ok("relatório responde com eventos", r.s === 200 && Array.isArray(r.d.eventos), (r.d.eventos || []).length + " evento(s)");

  await sql`UPDATE "PrazoConta" SET status = 'BLOQUEADO' WHERE email = ${EMAIL}`;
  r = await api("/api/prazos/calcular" + q, J({ b: { pedidos: 3 } }));
  ok("conta bloqueada → 402 no calcular", r.s === 402, r.d.error);
  r = await api("/api/prazos/config" + q, J({ m: "PUT", b: { motoboys: 3 } }));
  ok("conta bloqueada → 402 no config", r.s === 402);
  r = await api("/api/prazos/login", J({ b: { email: EMAIL, senha: "novasenha1" } }));
  ok("conta bloqueada → 402 no login", r.s === 402);
  r = await api("/api/prazos/estado" + q);
  ok("estado responde mesmo bloqueada (com motivo)", r.s === 200 && r.d.conta.podeUsar === false);
  r = await api("/api/prazos/estado?token=xxx.yyy");
  ok("token inválido → 401", r.s === 401);

  await sql`DELETE FROM "PrazoConta" WHERE email IN (${EMAIL}, 'teste-agrupado@firehubfood.com.br')`;
  const restantes = await sql`SELECT email FROM "PrazoConta"`;
  console.log(`\n${res.filter(Boolean).length}/${res.length} checagens passaram · contas no banco: ${restantes.map((x) => x.email).join(", ")}`);
})();
