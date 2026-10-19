/**
 * A vez (src/lib/vez.ts) e os seus usos com UM servidor — contra um banco
 * FALSO em memória com a mesma regra do INSERT … ON CONFLICT … WHERE. A
 * corrida de verdade (dois processos, Postgres real) é
 * scripts/teste-duas-instancias-pg.ts.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-vez.ts
 *
 * O que trava:
 *  - o SQL: compare-and-set num comando, relógio do banco, folga só contra outro dono;
 *  - pegar / renovar / outro dono barrado / vencida → outro assume / soltar só o próprio;
 *  - banco fora: `seFalhar` decide (padrão: seguir, como antes da vez existir);
 *  - Open Delivery saída: com um servidor, o 2º ciclo simultâneo da mesma loja
 *    sai vazio (como o CICLOS_NO_AR) e a vez é devolvida no fim;
 *  - alerta do monitor: o mesmo tipo sai uma vez por intervalo no cluster.
 */
import { Prisma } from "@prisma/client";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const vez = new Map<string, { dono: string; ate: number }>();
let bancoFora = false;
let relogio = 1_000_000;
const prismaFalso: any = {
  async $queryRaw(q: Prisma.Sql) {
    if (bancoFora) throw new Error("Can't reach database server");
    if (!q.sql.includes("fh:pegar-vez")) return [];
    const [chave, dono, ms, folga] = q.values as [string, string, number, number];
    const atual = vez.get(chave);
    if (!atual || atual.ate < relogio - folga || atual.dono === dono) {
      vez.set(chave, { dono, ate: relogio + ms });
      return [{ ok: 1 }];
    }
    return [];
  },
  async $executeRaw(q: Prisma.Sql) {
    if (bancoFora) throw new Error("Can't reach database server");
    if (q.sql.includes("fh:soltar-vez")) {
      const [chave, dono] = q.values as [string, string];
      if (vez.get(chave)?.dono === dono) vez.delete(chave);
    }
    return 1;
  },
  async $executeRawUnsafe() { return 0; },
  async $queryRawUnsafe() { return []; },
};
(globalThis as any).prisma = prismaFalso;

async function main() {
  const V = await import("../src/lib/vez");
  const { idDaInstancia } = await import("../src/lib/instancia");

  console.log("\no SQL");
  const q = V.sqlPegarVez("k", "eu", 5000, 20000);
  conferir("compare-and-set num comando, com o relógio do banco", [
    /INSERT INTO "Vez"/.test(q.sql), /ON CONFLICT \("chave"\) DO UPDATE/.test(q.sql),
    /WHERE "Vez"\."ate" < now\(\) - /.test(q.sql), /OR "Vez"\."dono" = EXCLUDED\."dono"/.test(q.sql), /RETURNING 1/.test(q.sql),
  ], [true, true, true, true, true]);
  conferir("parâmetros: chave, dono, validade, folga", q.values, ["k", "eu", 5000, 20000]);
  conferir("soltar só apaga a linha do próprio dono", /WHERE "chave" = \$1 AND "dono" = \$2/.test(V.sqlSoltarVez("k", "eu").text), true);

  console.log("\npegar, renovar, vencer");
  conferir("pega a vez livre (dono padrão = esta instância)", [await V.pegarVez("job:x", 24_000), vez.get("job:x")?.dono], [true, idDaInstancia()]);
  relogio += 10_000;
  conferir("o mesmo dono renova antes de vencer", [await V.pegarVez("job:x", 24_000), vez.get("job:x")?.ate], [true, relogio + 24_000]);
  conferir("outro dono é barrado enquanto vale", await V.pegarVez("job:x", 24_000, { dono: "outro" }), false);
  relogio += 24_001;
  conferir("venceu: o outro assume", [await V.pegarVez("job:x", 24_000, { dono: "outro" }), vez.get("job:x")?.dono], [true, "outro"]);
  relogio += 24_001;
  conferir("com folga, o outro só assume depois da folga", await V.pegarVez("job:x", 24_000, { folgaMs: 20_000 }), false);
  relogio += 20_000;
  conferir("… passada a folga, assume", await V.pegarVez("job:x", 24_000, { folgaMs: 20_000 }), true);
  await V.soltarVez("job:x", "outro");
  conferir("soltar com o dono errado não solta", vez.has("job:x"), true);
  await V.soltarVez("job:x");
  conferir("soltar com o dono certo solta", vez.has("job:x"), false);

  console.log("\nbanco fora");
  bancoFora = true;
  conferir("seFalhar padrão: segue (como antes da vez existir)", await V.pegarVez("job:y", 1000), true);
  conferir("seFalhar: false fica de fora", await V.pegarVez("job:y", 1000, { seFalhar: false }), false);
  let lancou = false;
  try { await V.soltarVez("job:y"); } catch { lancou = true; }
  conferir("soltar nunca lança", lancou, false);
  bancoFora = false;

  console.log("\nOpen Delivery saída com UM servidor");
  // O ciclo é a função de verdade; varrer/enviar falham sem banco e viram log.
  const E = await import("../src/lib/open-delivery-saida/eventos");
  const integ: any = { id: "integ-1", franchiseeId: "loja-1" };
  const [a, b] = await Promise.all([E.cicloDaLoja(integ), E.cicloDaLoja(integ)]);
  conferir("o 2º ciclo simultâneo da mesma loja sai vazio", [a.length > 0, b], [true, []]);
  conferir("… e a vez da loja é devolvida no fim", vez.has("od-saida:integ-1"), false);
  vez.set("od-saida:integ-1", { dono: "outro-servidor#1", ate: relogio + 60_000 });
  conferir("com outro servidor no ciclo desta loja: sai vazio", await E.cicloDaLoja(integ), []);
  vez.clear();

  console.log("\nalerta do monitor uma vez no cluster");
  const enviados: string[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => { enviados.push(JSON.parse(init.body).text); return new Response("{}"); };
  process.env.EVOLUTION_API_KEY = "x";
  const M = await import("../src/lib/server-monitor");
  // Outro servidor acabou de avisar a falha do iFood.
  vez.set("alerta:integracao_iFood", { dono: "outro#1", ate: relogio + 5 * 60_000 });
  await M.alertarFalhaDeIntegracao("iFood", "Loja X", "timeout");
  conferir("o outro servidor já avisou: este não repete", enviados.length, 0);
  await M.alertarFalhaDeIntegracao("99Food", "Loja X", "timeout");
  conferir("tipo novo: avisa (os dois números)", enviados.length, 2);
  conferir("… e pegou a vez do alerta", vez.has("alerta:integracao_99Food"), true);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
