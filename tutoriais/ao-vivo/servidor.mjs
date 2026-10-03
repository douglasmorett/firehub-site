// A loja fictícia na porta 3000 para as gravações ao vivo da extensão de prazo.
// A extensão (versão de desenvolvimento, firehub-ifood-extension/) só conhece
// firehubfood.com.br e localhost:3001/3000; a 3001 desta máquina é de outro
// servidor, então a loja de teste fica na 3000. Mesmo esquema dos ambientes
// numerados (tutoriais/ambiente/ambiente.mjs): banco PGlite descartável e a
// build de produção desta pasta.
//
//   node tutoriais/ao-vivo/servidor.mjs subir | parar
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { urlDoBanco } from "./banco.mjs";

const FORA = process.env.TUTORIAL_PASTA || "C:/Users/Micro/tutoriais-teste";
const raiz = process.cwd();
const PORTA_BANCO = 5470, PORTA_PAINEL = 3000;
const url = urlDoBanco(PORTA_BANCO);
export const VARIAVEIS = {
  DATABASE_URL: url, DIRECT_URL: url,
  NEXTAUTH_SECRET: "tutoriais-local", NEXTAUTH_URL: `https://localhost:${PORTA_PAINEL}`,
  COTACAO_SECRET: "tutoriais-local", TUTORIAL_BASE: `http://localhost:${PORTA_PAINEL}`,
};
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

if (process.argv[2] === "subir") {
  const dados = path.join(FORA, "dados-aovivo");
  if (!(await escutando(PORTA_BANCO))) {
    const novo = !fs.existsSync(dados);
    soltar(path.join(FORA, "node_modules/@electric-sql/pglite-socket/dist/scripts/server.js"), [`--db=${dados}`, `--port=${PORTA_BANCO}`, "--max-connections=10"], {}, path.join(FORA, "pglite-aovivo.log"));
    for (let i = 0; i < 60 && !(await escutando(PORTA_BANCO)); i++) await dormir(500);
    if (novo) execFileSync(process.execPath, [path.join(raiz, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--accept-data-loss"], { cwd: raiz, env: { ...process.env, ...VARIAVEIS }, stdio: "ignore" });
  }
  if (!(await escutando(PORTA_PAINEL))) {
    soltar(path.join(raiz, "node_modules/next/dist/bin/next"), ["start", "-p", String(PORTA_PAINEL)], VARIAVEIS, path.join(FORA, "painel-aovivo.log"));
    for (let i = 0; i < 120 && !(await escutando(PORTA_PAINEL)); i++) await dormir(500);
  }
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`http://localhost:${PORTA_PAINEL}/login`).catch(() => null);
    if (r && r.status === 200) { console.log(`loja de teste no ar: http://localhost:${PORTA_PAINEL} · banco ${PORTA_BANCO}`); process.exit(0); }
    await dormir(1000);
  }
  throw new Error("o painel da porta 3000 não respondeu");
}
if (process.argv[2] === "parar") {
  for (const porta of [PORTA_PAINEL, PORTA_BANCO]) {
    try {
      const pid = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${porta} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`]).toString().trim();
      if (pid) execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" });
    } catch {}
  }
  console.log("loja de teste parada");
}
