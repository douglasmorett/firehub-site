/**
 * RENOVAÇÃO DO TOKEN DO iFOOD, UMA SÓ — dois processos (dois servidores),
 * cada um com três chamadas ao mesmo tempo, todas achando o token vencido.
 * Antes: seis renovações com o mesmo refresh token (a segunda em diante pode
 * ser recusada pelo iFood e desconectar a loja). Agora: UMA, e as seis
 * chamadas saem com o token novo (lib/renovar-uma-vez.ts).
 *
 * E quando o iFood RECUSA o refresh (loja precisa reconectar): uma tentativa
 * só, e ninguém fica em fila repetindo a mesma tentativa recusada.
 *
 * O iFood é de mentira (fetch trocado no processo): conta as renovações e
 * demora 400 ms para responder, como a de verdade. Só Postgres LOCAL:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55502/painel NEXTAUTH_SECRET=x npx tsx scripts/teste-renovar-uma-vez.ts
 */
import { spawn } from "node:child_process";

const URL_DO_BANCO = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_DO_BANCO)) {
  console.error("Recuso: DATABASE_URL não é um Postgres local (127.0.0.1/localhost).");
  process.exit(2);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

async function filho(loja: string, t0: number, recusa: boolean) {
  process.env.IFOOD_CLIENT_ID_DISTRIBUTED = "id-de-teste";
  process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED = "segredo-de-teste";
  let renovacoes = 0;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (String(url).includes("/oauth/token")) {
      renovacoes++;
      const rt = new URLSearchParams(String(init?.body || "")).get("refreshToken");
      await espera(400);
      if (recusa) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      // O refresh token usado é trocado: reusar o velho seria recusado.
      return new Response(JSON.stringify({ accessToken: `novo-de-${rt}`, refreshToken: `${rt}+1`, expiresIn: 3600 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  const { getTokenDaLojaIfood } = await import("../src/lib/ifood-api");
  const { prisma } = await import("../src/lib/prisma");
  await prisma.$queryRawUnsafe("SELECT 1");
  await espera(Math.max(0, t0 - Date.now()));
  const inicio = Date.now();
  const tokens = await Promise.all([1, 2, 3].map(() => getTokenDaLojaIfood(loja)));
  console.log(JSON.stringify({ renovacoes, tokens, ms: Date.now() - inicio }));
  process.exit(0);
}

function rodarFilho(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "scripts/teste-renovar-uma-vez.ts", ...args], { shell: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    p.stdout.on("data", (c) => { saida += c; });
    p.stderr.on("data", (c) => { saida += c; });
    p.on("close", (codigo) => {
      const linha = saida.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      if (!linha) return reject(new Error(`filho saiu ${codigo} sem JSON:\n${saida.slice(-2000)}`));
      resolve(JSON.parse(linha));
    });
  });
}

async function principal() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const { garantirTabelasDeCoordenacao } = await import("../src/lib/ddl-do-boot");
  await garantirTabelasDeCoordenacao();
  const LOJA = `loja_token_${Date.now().toString(36)}`;
  const LOJA_RECUSADA = `${LOJA}_recusada`;
  for (const id of [LOJA, LOJA_RECUSADA]) {
    await db.user.create({
      data: {
        id, email: `${id}@teste.invalid`, name: id, password: "x",
        ifoodAccessToken: "velho", ifoodRefreshToken: "rt0", ifoodTokenExpiresAt: new Date(Date.now() - 60_000),
      } as any,
    });
  }
  try {
    let t0 = Date.now() + 9_000;
    const [a, b] = await Promise.all([rodarFilho(["filho", LOJA, String(t0), "0"]), rodarFilho(["filho", LOJA, String(t0), "0"])]);
    console.log(`        A renovou ${a.renovacoes}× (${a.ms} ms), B renovou ${b.renovacoes}× (${b.ms} ms) — tokens: ${[...a.tokens, ...b.tokens].join(", ")}`);
    conferir("6 chamadas ao mesmo tempo em 2 servidores: UMA renovação", a.renovacoes + b.renovacoes, 1);
    conferir("todas saem com o token novo", [...a.tokens, ...b.tokens].every((t: string) => t === "novo-de-rt0"), true);
    const u: any = await db.user.findUnique({ where: { id: LOJA } });
    conferir("o banco ficou com o par novo", [u.ifoodAccessToken, u.ifoodRefreshToken], ["novo-de-rt0", "rt0+1"]);

    console.log("\n    o iFood recusa o refresh");
    t0 = Date.now() + 9_000;
    const [ra, rb] = await Promise.all([rodarFilho(["filho", LOJA_RECUSADA, String(t0), "1"]), rodarFilho(["filho", LOJA_RECUSADA, String(t0), "1"])]);
    console.log(`        tentativas: A ${ra.renovacoes}, B ${rb.renovacoes}; A levou ${ra.ms} ms, B ${rb.ms} ms`);
    conferir("recusado: UMA tentativa no cluster (antes, seis)", ra.renovacoes + rb.renovacoes, 1);
    conferir("todas seguem com o que tinham, como antes", [...ra.tokens, ...rb.tokens].every((t: string) => t === "velho"), true);
    // A espera é a de UMA tentativa (+ os passos de 0,5 s de quem esperou),
    // nunca os 15 s do limite nem seis tentativas em fila.
    conferir("ninguém espera o limite de 15 s", Math.max(ra.ms, rb.ms) < 14_000, true);
  } finally {
    await db.user.deleteMany({ where: { id: { in: [LOJA, LOJA_RECUSADA] } } });
    await db.$disconnect();
  }
  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

const [modo, loja, t0, recusa] = process.argv.slice(2);
if (modo === "filho") filho(loja, Number(t0), recusa === "1").catch((e) => { console.error(e); process.exit(1); });
else principal().catch((e) => { console.error(e); process.exit(1); });
