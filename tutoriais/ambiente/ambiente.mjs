// Ambientes de gravação numerados: cada um tem o SEU banco descartável e o SEU
// painel, para vários tutoriais serem gravados ao mesmo tempo sem um apagar a
// loja do outro (toda gravação recomeça o banco do zero).
//
//   node tutoriais/ambiente/ambiente.mjs subir 1      sobe (ou confirma) o ambiente 1
//   node tutoriais/ambiente/ambiente.mjs variaveis 1  mostra as variáveis para usar com produzir.mjs
//   node tutoriais/ambiente/ambiente.mjs parar 1
//
// Ambiente N: banco PGlite na porta 5460+N, painel (next start, a build de
// produção desta pasta) na porta 3130+N. A build é uma só — `npx next build`
// antes — e serve a todos: o que muda por ambiente são só as variáveis.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const BASE_FORA = process.env.TUTORIAL_PASTA || "C:/Users/Micro/tutoriais-teste";
const raiz = process.cwd();

export function ambiente(n) {
  const portaDoBanco = 5460 + Number(n), portaDoPainel = 3130 + Number(n);
  // O PGlite local aceita qualquer usuário e senha; o padrão é o usuário do próprio Postgres.
  // (Vem de variável para não haver credencial escrita no código, nem a de um banco de brinquedo.)
  const usuario = process.env.TUTORIAL_PG_USUARIO || "postgres";
  const acesso = [usuario, process.env.TUTORIAL_PG_SENHA || usuario].join(":");
  const url = `postgresql://${acesso}@127.0.0.1:${portaDoBanco}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`;
  return {
    n: Number(n), portaDoBanco, portaDoPainel,
    dados: path.join(BASE_FORA, `dados-${n}`),
    variaveis: {
      DATABASE_URL: url, DIRECT_URL: url,
      // "https" de propósito, embora o acesso seja http://localhost: na build de produção o cookie
      // de sessão se chama __Secure-…, e o painel só procura esse nome quando o endereço configurado
      // é https. O Chrome aceita cookie seguro em localhost, e o login navega por caminho relativo.
      NEXTAUTH_SECRET: "tutoriais-local", NEXTAUTH_URL: `https://localhost:${portaDoPainel}`,
      COTACAO_SECRET: "tutoriais-local", TUTORIAL_BASE: `http://localhost:${portaDoPainel}`,
    },
  };
}

const escutando = (porta) => new Promise((ok) => {
  const s = net.connect({ port: porta, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); ok(true); });
  s.once("error", () => ok(false));
});
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

function soltar(script, args, env, log) {
  const saida = fs.openSync(log, "a");
  spawn(process.execPath, [script, ...args], { cwd: raiz, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", saida, saida], windowsHide: true }).unref();
}

async function subir(n) {
  const a = ambiente(n);
  if (!(await escutando(a.portaDoBanco))) {
    const novo = !fs.existsSync(a.dados);
    soltar(path.join(BASE_FORA, "node_modules/@electric-sql/pglite-socket/dist/scripts/server.js"),
      [`--db=${a.dados}`, `--port=${a.portaDoBanco}`, "--max-connections=10"], {}, path.join(BASE_FORA, `pglite-${n}.log`));
    for (let i = 0; i < 60 && !(await escutando(a.portaDoBanco)); i++) await dormir(500);
    if (!(await escutando(a.portaDoBanco))) throw new Error(`O banco do ambiente ${n} não subiu (veja pglite-${n}.log).`);
    if (novo) {
      execFileSync(process.execPath, [path.join(raiz, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--accept-data-loss"],
        { cwd: raiz, env: { ...process.env, ...a.variaveis }, stdio: "ignore" });
    }
  }
  if (!(await escutando(a.portaDoPainel))) {
    if (!fs.existsSync(path.join(raiz, ".next", "BUILD_ID"))) throw new Error("Falta a build: rode `npx next build` nesta pasta antes.");
    soltar(path.join(raiz, "node_modules/next/dist/bin/next"), ["start", "-p", String(a.portaDoPainel)], a.variaveis, path.join(BASE_FORA, `painel-${n}.log`));
    for (let i = 0; i < 120 && !(await escutando(a.portaDoPainel)); i++) await dormir(500);
    if (!(await escutando(a.portaDoPainel))) throw new Error(`O painel do ambiente ${n} não subiu (veja painel-${n}.log).`);
  }
  // o login responde? (a primeira resposta também prova que o boot do banco terminou)
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`http://localhost:${a.portaDoPainel}/login`).catch(() => null);
    if (r && r.status === 200) return a;
    await dormir(1000);
  }
  throw new Error(`O painel do ambiente ${n} não respondeu em /login.`);
}

function parar(n) {
  const a = ambiente(n);
  for (const porta of [a.portaDoPainel, a.portaDoBanco]) {
    const linhas = execFileSync("netstat", ["-ano"], { encoding: "utf8" }).split(/\r?\n/).filter((l) => /LISTENING/.test(l) && new RegExp(`:${porta}\\s`).test(l));
    for (const pid of new Set(linhas.map((l) => l.trim().split(/\s+/).pop()))) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" }); } catch {}
    }
  }
}

const [acao, n] = process.argv.slice(2);
if (acao === "subir") {
  const a = await subir(n);
  console.log(`ambiente ${a.n} no ar: painel http://localhost:${a.portaDoPainel} · banco ${a.portaDoBanco}`);
} else if (acao === "variaveis") {
  console.log(Object.entries(ambiente(n).variaveis).map(([k, v]) => `export ${k}='${v}'`).join("\n"));
} else if (acao === "parar") {
  parar(n);
  console.log(`ambiente ${n} parado`);
} else if (acao) {
  console.error("Uso: node tutoriais/ambiente/ambiente.mjs subir|variaveis|parar <n>");
  process.exit(2);
}
