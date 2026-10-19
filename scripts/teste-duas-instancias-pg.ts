/**
 * PROVA DE CONCORRÊNCIA com Postgres DE VERDADE — e só um Postgres LOCAL.
 *
 *   DATABASE_URL=<url do Postgres LOCAL> NEXTAUTH_SECRET=x npx tsx scripts/teste-duas-instancias-pg.ts
 *
 * (um Postgres descartável em 127.0.0.1 — ex.: o pacote npm embedded-postgres
 * numa pasta temporária, fora do projeto).
 *
 * O banco precisa do schema (`npx prisma db push` contra ele). Recusa
 * qualquer DATABASE_URL que não seja 127.0.0.1/localhost: isto apaga a
 * "BootDDL" e cria/derruba coluna de teste — NUNCA no Neon.
 *
 * Prova, com processos separados (cada um com o seu pool de conexões, como
 * dois servidores):
 *  (a) dois processos chamando pegarVez na MESMA hora → só um ganha, rodada a
 *      rodada; a vez vence → o outro assume;
 *  (b) dois boots simultâneos (src/instrumentation.ts → register) num banco
 *      sem hash nenhum → sem deadlock e sem erro, e o segundo pula pelo hash;
 *      um terceiro boot sozinho não roda DDL nenhuma;
 *  (c) trava estourada de verdade: tabela presa por outra transação → a
 *      instrução espera, tenta de novo e passa quando solta; presa demais →
 *      desiste com 55P03 reconhecido (vira log em quem chamou).
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const URL_DO_BANCO = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_DO_BANCO)) {
  console.error("Recuso: DATABASE_URL não é um Postgres local (127.0.0.1/localhost). Este teste apaga e cria coisas.");
  process.exit(2);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ateHora = (t: number) => espera(Math.max(0, t - Date.now()));

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

/** Roda este arquivo num processo novo e devolve a última linha JSON que ele imprimir. */
function filho(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "scripts/teste-duas-instancias-pg.ts", ...args], {
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    p.stdout.on("data", (c) => { saida += c; });
    p.stderr.on("data", (c) => { saida += c; });
    p.on("close", (codigo) => {
      const linha = saida.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      if (!linha) return reject(new Error(`filho ${args[0]} saiu ${codigo} sem JSON:\n${saida.slice(-2000)}`));
      resolve({ ...JSON.parse(linha), _log: saida });
    });
  });
}

// ── Modos dos processos filhos ───────────────────────────────────────────────
async function modoCorrida(dono: string, t0: number, rodadas: number, prefixo: string) {
  const { pegarVez } = await import("../src/lib/vez");
  await pegarVez("aquecer:" + dono, 1, { dono }); // abre a conexão antes da largada
  const ganhou: boolean[] = [];
  for (let i = 0; i < rodadas; i++) {
    await ateHora(t0 + i * 40);
    ganhou.push(await pegarVez(`${prefixo}:${i}`, 60_000, { dono, seFalhar: false }));
  }
  console.log(JSON.stringify({ dono, ganhou }));
}

async function modoVencer(dono: string, t0: number, passos: string) {
  const { pegarVez } = await import("../src/lib/vez");
  await pegarVez("aquecer:" + dono, 1, { dono });
  const r: boolean[] = [];
  for (const ms of passos.split(",").map(Number)) {
    await ateHora(t0 + ms);
    r.push(await pegarVez("vencer", 1_500, { dono, seFalhar: false }));
  }
  console.log(JSON.stringify({ dono, r }));
}

async function modoBoot(t0: number) {
  process.env.NEXT_RUNTIME = "nodejs";
  const p = new PrismaClient();
  let transacoes = 0;
  const original = p.$transaction.bind(p) as any;
  // Só as transações da DDL (SET LOCAL + trava + instrução); a do acerto das lojas extras é de dados.
  (p as any).$transaction = (...a: any[]) => { if (Array.isArray(a[0]) && a[0].length === 3) transacoes++; return original(...a); };
  (globalThis as any).prisma = p;
  await p.$queryRawUnsafe("SELECT 1"); // conexão aberta antes da largada
  const linhas: string[] = [];
  for (const nivel of ["log", "warn", "error"] as const) {
    const orig = console[nivel].bind(console);
    console[nivel] = (...a: any[]) => { linhas.push(a.map(String).join(" ")); orig(...a); };
  }
  const { register } = await import("../src/instrumentation");
  await ateHora(t0);
  const inicio = Date.now();
  await register();
  const ms = Date.now() - inicio;
  const erros = linhas.filter((l) => /🛑|❌|falhou|deadlock|concurrently|duplicate key/i.test(l));
  const pulosDoOutro = linhas.filter((l) => l.includes("aplicada pelo outro servidor")).length;
  const esperas = linhas.filter((l) => l.includes("espero ele terminar")).length;
  console.log(JSON.stringify({ ms, transacoes, erros, pulosDoOutro, esperas }));
  process.exit(0);
}

// ── O teste ──────────────────────────────────────────────────────────────────
async function principal() {
  const db = new PrismaClient();
  console.log(`Postgres local: ${URL_DO_BANCO.replace(/:[^:@/]+@/, ":***@")}`);
  // Tabelas de coordenação (o boot também cria; aqui para a corrida rodar sozinha).
  const { garantirTabelasDeCoordenacao, executarComTrava, estourouATrava } = await import("../src/lib/ddl-do-boot");
  await garantirTabelasDeCoordenacao();

  console.log("\n(a) dois processos disputando a mesma vez ao mesmo tempo");
  const RODADAS = 60;
  const prefixo = `corrida-${Date.now()}`;
  let t0 = Date.now() + 9_000;
  const [A, B] = await Promise.all([
    filho(["corrida", "A", String(t0), String(RODADAS), prefixo]),
    filho(["corrida", "B", String(t0), String(RODADAS), prefixo]),
  ]);
  const vencedores = A.ganhou.map((ga: boolean, i: number) => Number(ga) + Number(B.ganhou[i]));
  const umSo = vencedores.filter((n: number) => n === 1).length;
  console.log(`        ${RODADAS} rodadas: A ganhou ${A.ganhou.filter(Boolean).length}, B ganhou ${B.ganhou.filter(Boolean).length}, rodadas com exatamente 1 vencedor: ${umSo}`);
  conferir(`exatamente UM vencedor em cada uma das ${RODADAS} rodadas`, umSo, RODADAS);
  const linhas = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Vez" WHERE "chave" LIKE $1`, `${prefixo}:%`);
  conferir("uma linha por chave no banco", Number(linhas[0].n), RODADAS);

  await db.$executeRawUnsafe(`DELETE FROM "Vez" WHERE "chave" = 'vencer'`);
  t0 = Date.now() + 9_000;
  // A pega em t0; B tenta em t0+300 (barrado); B tenta em t0+2000 (venceu: assume); A tenta em t0+2300 (barrado).
  const [VA, VB] = await Promise.all([
    filho(["vencer", "A", String(t0), "0,2300"]),
    filho(["vencer", "B", String(t0), "300,2000"]),
  ]);
  conferir("vez de 1,5 s: A pega, B é barrado, venceu → B assume, A é barrado", [VA.r[0], VB.r[0], VB.r[1], VA.r[1]], [true, false, true, false]);

  console.log("\n(b) dois boots ao mesmo tempo num banco sem hash");
  await db.$executeRawUnsafe(`DELETE FROM "BootDDL"`);
  await db.$executeRawUnsafe(`DELETE FROM "Vez" WHERE "chave" LIKE 'ddl:%'`);
  t0 = Date.now() + 12_000;
  const [B1, B2] = await Promise.all([filho(["boot", String(t0)]), filho(["boot", String(t0)])]);
  for (const [n, b] of [["boot 1", B1], ["boot 2", B2]] as const) {
    console.log(`        ${n}: ${b.ms} ms, ${b.transacoes} instruções de DDL, ${b.esperas} esperas pelo outro, ${b.pulosDoOutro} grupos pulados porque o outro aplicou`);
  }
  conferir("nenhum erro nem deadlock nos dois boots", [...B1.erros, ...B2.erros], []);
  const [primeiro, segundo] = B1.transacoes >= B2.transacoes ? [B1, B2] : [B2, B1];
  conferir("o 2º pulou pelo hash (esperou e pulou grupos que o 1º aplicou)", segundo.pulosDoOutro > 0, true);
  conferir("… e rodou bem menos DDL que o 1º", segundo.transacoes < primeiro.transacoes / 2, true);
  const grupos = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "BootDDL"`);
  console.log(`        BootDDL: ${Number(grupos[0].n)} grupos gravados`);
  const B3 = await filho(["boot", String(Date.now())]);
  console.log(`        boot 3 (sozinho, tudo aplicado): ${B3.ms} ms, ${B3.transacoes} instruções de DDL`);
  conferir("3º boot: sem erro e sem DDL nenhuma (tudo pulado pelo hash)", [B3.erros, B3.transacoes], [[], 0]);

  console.log("\n(c) trava estourada de verdade (lock_timeout)");
  const avisos: string[] = [];
  const warn = console.warn.bind(console);
  console.warn = (...a: any[]) => { avisos.push(a.join(" ")); warn(...a); };
  const ALTER = `ALTER TABLE "Motoboy" ADD COLUMN IF NOT EXISTS "testeDaTrava" TEXT`;
  const prender = (ms: number) =>
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "Motoboy" IN ACCESS EXCLUSIVE MODE`);
      await espera(ms);
    }, { timeout: ms + 10_000, maxWait: 5_000 });
  let preso = prender(5_000);
  await espera(300);
  let t = Date.now();
  await executarComTrava(ALTER);
  await preso;
  const levou = Date.now() - t;
  console.log(`        tabela presa 5 s: a instrução passou em ${levou} ms, depois de ${avisos.length} tentativa(s) estourada(s)`);
  conferir("presa 5 s: estoura, tenta de novo e passa quando solta", [avisos.length >= 1, levou >= 4_500], [true, true]);
  avisos.length = 0;
  preso = prender(25_000);
  await espera(300);
  t = Date.now();
  let erro: any = null;
  try { await executarComTrava(ALTER); } catch (e) { erro = e; }
  const desistiu = Date.now() - t;
  await preso;
  console.log(`        tabela presa 25 s: desistiu em ${desistiu} ms, ${avisos.length} reenvios; erro: ${String(erro?.message || "").replace(/\s+/g, " ").slice(0, 110)}`);
  conferir("presa demais: desiste (4 tentativas) com o erro da trava reconhecido", [!!erro, estourouATrava(erro), avisos.length], [true, true, 3]);
  console.warn = warn;
  await db.$executeRawUnsafe(`ALTER TABLE "Motoboy" DROP COLUMN IF EXISTS "testeDaTrava"`);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  await db.$disconnect();
  process.exit(falhou ? 1 : 0);
}

const [modo, ...resto] = process.argv.slice(2);
const execucao =
  modo === "corrida" ? modoCorrida(resto[0], Number(resto[1]), Number(resto[2]), resto[3]).then(() => process.exit(0))
  : modo === "vencer" ? modoVencer(resto[0], Number(resto[1]), resto[2]).then(() => process.exit(0))
  : modo === "boot" ? modoBoot(Number(resto[0]))
  : principal();
execucao.catch((e) => { console.error(e); process.exit(1); });
