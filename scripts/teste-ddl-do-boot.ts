/**
 * A DDL do boot com trava e sem repetir (src/lib/ddl-do-boot.ts) — contra um
 * banco FALSO em memória. A prova com Postgres de verdade (dois boots ao
 * mesmo tempo, trava estourando) é scripts/teste-duas-instancias-pg.ts.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-ddl-do-boot.ts
 *
 * O que trava:
 *  - grupo aplicado grava o hash; o mesmo grupo de novo é pulado sem rodar nada;
 *  - mudou o texto de uma instrução → roda o grupo inteiro outra vez;
 *  - cada instrução vai numa transação com SET LOCAL lock_timeout e a trava
 *    consultiva, NESTA ordem;
 *  - trava estourada (55P03) é tentada de novo; estourou 4 vezes → lança para
 *    o catch de quem chamou (que loga), e o hash não é gravado;
 *  - sem `porInstrucao`, a primeira falha para o laço (como antes); com ele,
 *    as outras rodam e o hash não é gravado;
 *  - BOOT_DDL_SEMPRE=1 e FIREHUB_LOCAL=1 nunca pulam;
 *  - sem as tabelas de coordenação, roda tudo como antes;
 *  - outro servidor com a vez do grupo: espera e pula quando ele grava o hash;
 *  - esquecerDDL tira o hash.
 */
import { Prisma } from "@prisma/client";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

// ── Banco falso ──────────────────────────────────────────────────────────────
const banco = {
  tabelas: new Set<string>(),
  bootddl: new Map<string, string>(),
  vez: new Map<string, { dono: string; ate: number }>(),
  executadas: [] as string[],
  transacoes: [] as string[][],
  /** sql → quantas vezes ainda estoura a trava */
  estourar: new Map<string, number>(),
  /** sql → erro comum */
  quebrar: new Map<string, string>(),
};
function zerar() {
  banco.tabelas = new Set(["BootDDL", "Vez"]);
  banco.bootddl.clear();
  banco.vez.clear();
  banco.executadas = [];
  banco.transacoes = [];
  banco.estourar.clear();
  banco.quebrar.clear();
}

function erroDeTrava() {
  // O formato do Prisma para erro do Postgres em SQL cru (P2010 + meta.code).
  return Object.assign(new Error("Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`"), {
    code: "P2010",
    meta: { code: "55P03", message: "canceling statement due to lock timeout" },
  });
}

function executar(sql: string, params: unknown[]): number {
  if (/^SET LOCAL lock_timeout/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return 0;
  if (/^CREATE TABLE IF NOT EXISTS "(BootDDL|Vez)"/.test(sql)) {
    banco.tabelas.add(sql.match(/"(BootDDL|Vez)"/)![1]);
    return 0;
  }
  if (sql.startsWith(`INSERT INTO "BootDDL"`)) {
    if (!banco.tabelas.has("BootDDL")) throw new Error(`relation "BootDDL" does not exist`);
    if (!banco.bootddl.has(params[0] as string)) banco.bootddl.set(params[0] as string, params[1] as string);
    return 1;
  }
  if (sql.startsWith(`DELETE FROM "BootDDL" WHERE "hash"`)) {
    return banco.bootddl.delete(params[0] as string) ? 1 : 0;
  }
  const n = banco.estourar.get(sql) ?? 0;
  if (n > 0) {
    banco.estourar.set(sql, n - 1);
    throw erroDeTrava();
  }
  const quebra = banco.quebrar.get(sql);
  if (quebra) throw new Error(quebra);
  banco.executadas.push(sql);
  return 0;
}

/** Igual ao PrismaPromise: só executa quando aguardado ou dentro do $transaction. */
class Preguicosa<T> {
  constructor(public sql: string, public params: unknown[], private fazer: () => T) {}
  private p?: Promise<T>;
  private rodar() { return (this.p ??= Promise.resolve().then(this.fazer)); }
  then<A, B>(a?: (v: T) => A, b?: (e: any) => B) { return this.rodar().then(a, b); }
  catch<B>(b: (e: any) => B) { return this.rodar().catch(b); }
}

const prismaFalso = {
  $executeRawUnsafe(sql: string, ...params: unknown[]) {
    return new Preguicosa(sql, params, () => executar(sql, params));
  },
  async $queryRawUnsafe(sql: string, ...params: unknown[]) {
    if (sql.includes("to_regclass")) return [{ boot: banco.tabelas.has("BootDDL"), vez: banco.tabelas.has("Vez") }];
    if (sql.startsWith(`SELECT 1 AS ok FROM "BootDDL"`)) {
      if (!banco.tabelas.has("BootDDL")) throw new Error(`relation "BootDDL" does not exist`);
      return banco.bootddl.has(params[0] as string) ? [{ ok: 1 }] : [];
    }
    throw new Error(`consulta inesperada: ${sql}`);
  },
  async $queryRaw(q: Prisma.Sql) {
    if (!q.sql.includes("fh:pegar-vez")) throw new Error(`consulta inesperada: ${q.sql}`);
    if (!banco.tabelas.has("Vez")) throw new Error(`relation "Vez" does not exist`);
    const [chave, dono, ms, folga] = q.values as [string, string, number, number];
    const agora = Date.now();
    const atual = banco.vez.get(chave);
    if (!atual || atual.ate < agora - folga || atual.dono === dono) {
      banco.vez.set(chave, { dono, ate: agora + ms });
      return [{ ok: 1 }];
    }
    return [];
  },
  async $executeRaw(q: Prisma.Sql) {
    if (!q.sql.includes("fh:soltar-vez")) throw new Error(`comando inesperado: ${q.sql}`);
    const [chave, dono] = q.values as [string, string];
    if (banco.vez.get(chave)?.dono === dono) banco.vez.delete(chave);
    return 1;
  },
  async $transaction(lista: Preguicosa<unknown>[]) {
    banco.transacoes.push(lista.map((x) => x.sql));
    for (const x of lista) executar(x.sql, x.params);
    return [];
  },
};
(globalThis as any).prisma = prismaFalso;

async function main() {
  const D = await import("../src/lib/ddl-do-boot");
  const A = [`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "a" TEXT`, `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "b" TEXT`];

  console.log("\ntabelas de coordenação");
  zerar();
  banco.tabelas.clear();
  conferir("1º boot num banco sem elas: cria BootDDL e Vez", [await D.garantirTabelasDeCoordenacao(), [...banco.tabelas].sort()], [true, ["BootDDL", "Vez"]]);
  conferir("… cada CREATE sob lock_timeout e a trava do cluster (a corrida do pg_type)", banco.transacoes.map((t) => t.slice(0, 2)), [
    ["SET LOCAL lock_timeout = '3s'", "SELECT pg_advisory_xact_lock(hashtext('firehub:ddl-do-boot'))"],
    ["SET LOCAL lock_timeout = '3s'", "SELECT pg_advisory_xact_lock(hashtext('firehub:ddl-do-boot'))"],
  ]);

  console.log("\npula o que já foi aplicado");
  zerar();
  let r = await D.executarDDL("g", A);
  conferir("1ª vez roda as duas, na ordem", [r.pulou, banco.executadas], [false, A]);
  conferir("grava o hash do grupo", [...banco.bootddl.values()], ["g"]);
  conferir("cada instrução na sua transação: lock_timeout, trava, instrução", banco.transacoes[0], [
    "SET LOCAL lock_timeout = '3s'",
    "SELECT pg_advisory_xact_lock(hashtext('firehub:ddl-do-boot'))",
    A[0],
  ]);
  conferir("a vez do grupo foi devolvida", banco.vez.size, 0);
  banco.executadas = [];
  r = await D.executarDDL("g", A);
  conferir("2ª vez pula sem rodar nada", [r.pulou, banco.executadas], [true, []]);
  const A2 = [A[0], `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "b" JSONB`];
  r = await D.executarDDL("g", A2);
  conferir("mudou uma instrução: roda o grupo inteiro de novo", [r.pulou, banco.executadas], [false, A2]);
  conferir("hash muda com o nome do grupo", D.hashDoGrupo("x", A) === D.hashDoGrupo("y", A), false);

  console.log("\nescapes");
  banco.executadas = [];
  process.env.BOOT_DDL_SEMPRE = "1";
  r = await D.executarDDL("g", A);
  conferir("BOOT_DDL_SEMPRE=1 roda mesmo aplicado", [r.pulou, banco.executadas.length], [false, 2]);
  delete process.env.BOOT_DDL_SEMPRE;
  banco.executadas = [];
  process.env.FIREHUB_LOCAL = "1";
  r = await D.executarDDL("g", A);
  conferir("computador da loja (FIREHUB_LOCAL=1) nunca pula", [r.pulou, banco.executadas.length], [false, 2]);
  delete process.env.FIREHUB_LOCAL;
  banco.executadas = [];
  await D.esquecerDDL("g", A);
  r = await D.executarDDL("g", A);
  conferir("esquecerDDL: o próximo roda de novo", [r.pulou, banco.executadas.length], [false, 2]);

  console.log("\nfalhas");
  zerar();
  banco.quebrar.set(A[0], `relation "Mesa" does not exist`);
  let lancou = "";
  try { await D.executarDDL("g", A); } catch (e: any) { lancou = e.message; }
  conferir("sem porInstrucao: a 1ª falha lança e para o laço (como antes)", [lancou, banco.executadas], [`relation "Mesa" does not exist`, []]);
  conferir("… e o hash não é gravado", banco.bootddl.size, 0);
  const vistas: string[] = [];
  r = await D.executarDDL("g", A, { porInstrucao: (sql) => vistas.push(sql) });
  conferir("com porInstrucao: a falha vai para o callback e a outra roda", [r.falhas.length, vistas, banco.executadas], [1, [A[0]], [A[1]]]);
  conferir("… e o hash não é gravado", banco.bootddl.size, 0);

  console.log("\ntrava estourada (lock_timeout)");
  zerar();
  banco.estourar.set(A[1], 2);
  let t0 = Date.now();
  r = await D.executarDDL("g", A);
  conferir("estourou 2 vezes, passou na 3ª (espera 1 s + 2 s)", [r.pulou, banco.executadas, Date.now() - t0 >= 2900], [false, A, true]);
  conferir("… e grava o hash", banco.bootddl.size, 1);
  zerar();
  banco.estourar.set(A[0], 99);
  t0 = Date.now();
  lancou = "";
  try { await D.executarDDL("g", A); } catch (e: any) { lancou = e?.meta?.code; }
  conferir("estourou 4 vezes: desiste e LANÇA para o catch de quem chamou", [lancou, banco.executadas, Date.now() - t0 >= 6900], ["55P03", [], true]);
  conferir("estourouATrava reconhece pelo código e pela mensagem", [
    D.estourouATrava({ meta: { code: "55P03" } }),
    D.estourouATrava(new Error("canceling statement due to lock timeout")),
    D.estourouATrava(new Error("relation does not exist")),
  ], [true, true, false]);

  console.log("\ncoordenação ausente");
  zerar();
  banco.tabelas.clear();
  r = await D.executarDDL("g", A);
  conferir("BootDDL/Vez sumiram depois do boot: roda tudo, não pula", [r.pulou, banco.executadas], [false, A]);
  banco.executadas = [];
  r = await D.executarDDL("g", A);
  conferir("… e roda de novo no próximo (nada gravado)", [r.pulou, banco.executadas.length], [false, 2]);

  console.log("\noutro servidor aplicando o mesmo grupo");
  zerar();
  const h = D.hashDoGrupo("g", A);
  banco.vez.set(`ddl:${h}`, { dono: "outro-servidor#1", ate: Date.now() + 120_000 });
  setTimeout(() => { banco.bootddl.set(h, "g"); banco.vez.delete(`ddl:${h}`); }, 800);
  t0 = Date.now();
  r = await D.executarDDL("g", A);
  conferir("espera o outro gravar o hash e PULA", [r.pulou, banco.executadas], [true, []]);
  conferir("… esperou ~0,8 s, não os 45 s", Date.now() - t0 < 3000, true);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
