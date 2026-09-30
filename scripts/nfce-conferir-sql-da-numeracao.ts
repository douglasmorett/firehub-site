/**
 * Confere o SQL da numeração do emissor próprio (lib/nfce/numeracao) num
 * Postgres DE VERDADE — SÓ LENDO:
 *
 *  1. a leitura dos números (`sqlDosNumeros`) sobre um VALUES de fiscalInfos
 *     de exemplo (números em texto e em número, valores tortos, listas, JSON
 *     null...) dá o MESMO que a leitura de referência em TypeScript
 *     (`numerosDoFiscalInfo`) — é ela que o banco falso dos testes usa;
 *  2. o maior número (`sqlDoMaiorNumero`) idem, por série/ambiente;
 *  3. as gravações (UPDATE) e a trava passam pelo planejador (EXPLAIN, que
 *     NÃO executa) com os parâmetros como o Prisma manda;
 *  4. o custo da consulta de verdade na loja com mais pedidos (EXPLAIN
 *     ANALYZE de um SELECT).
 *
 * Tudo numa transação READ ONLY (o Postgres recusaria qualquer escrita).
 *
 *   npx tsx scripts/nfce-conferir-sql-da-numeracao.ts
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

async function main() {
  const n = await import("../src/lib/nfce/numeracao");
  const { sqlAnexarInutilizacao } = await import("../src/lib/nfce/inutilizacao-da-loja");
  const { sqlMesclarNoEmissorDaLoja } = await import("../src/lib/nfce/emissao-da-loja");
  const prisma = new PrismaClient();

  const em = "2026-09-20T15:00:00.000Z";
  const amostras: Array<{ id: string; fs: string | null; j: unknown }> = [
    { id: "a01", fs: "EMITTED", j: { nfceNumber: 12, serie: 7, ambiente: 1, emittedAt: em } },
    { id: "a02", fs: "EMITTED", j: { nfceNumber: "13", serie: "7", ambiente: "2", emittedAt: em } },
    { id: "a03", fs: "EMITTED", j: { nfceNumber: 12.5, serie: 7, ambiente: 1 } },
    { id: "a04", fs: "EMITTED", j: { nfceNumber: 0, serie: 7, ambiente: 1 } },
    { id: "a05", fs: "EMITTED", j: { nfceNumber: 1000000000, serie: 7, ambiente: 1 } },
    { id: "a06", fs: "FAILED", j: { nfceNumber: true, serie: 7, ambiente: 1 } },
    { id: "a07", fs: "FAILED", j: { numeroReservado: { numero: 20, serie: 7, ambiente: 1, em, emissaoEmCurso: em }, provedor: "sefaz" } },
    { id: "a08", fs: "FAILED", j: { numeroReservado: "x" } },
    { id: "a09", fs: "FAILED", j: { numeroReservado: [1, 2] } },
    { id: "a10", fs: "PENDING", j: { processando: true, envioSefaz: { chave: "5".repeat(44), numero: 21, serie: 7, ambiente: 1, em } } },
    { id: "a11", fs: "EMITTED", j: { nfceNumber: 40, serie: 7, ambiente: 1, numeroTentado: { numero: 22, serie: 7, ambiente: 1, desde: em, situacao: "a_conferir" } } },
    { id: "a12", fs: "EMITTED", j: { numeroDeContingencia: { numero: 23, serie: 7, ambiente: 1, em } } },
    { id: "a13", fs: "EMITTED", j: { notasAnteriores: [{ nfceNumber: 24, serie: 7, ambiente: 1, emittedAt: em }, 5, null, { nfceNumber: "25", serie: 7, ambiente: 2 }] } },
    { id: "a14", fs: "FAILED", j: { numerosQueimados: [{ numero: 26, serie: 7, ambiente: 1, em, motivo: "539: outra chave" }] } },
    { id: "a15", fs: "EMITTED", j: { notasAnteriores: "não é lista", numerosQueimados: { numero: 1 } } },
    { id: "a16", fs: null, j: null },
    { id: "a17", fs: "EMITTED", j: { nfceNumber: 30, serie: 8, ambiente: 1 } },
    { id: "a18", fs: "EMITTED", j: { nfceNumber: 31, serie: 7, ambiente: 3 } },
    { id: "a19", fs: "EMITTED", j: { nfceNumber: 32, serie: 7 } },
    { id: "a20", fs: "EMITTED", j: { nfceNumber: "0033", serie: "007", ambiente: "1" } },
    { id: "a21", fs: "EMITTED", j: { nfceNumber: " 34", serie: 7, ambiente: 1 } },
    { id: "a22", fs: "EMITTED", j: { nfceNumber: { a: 1 }, serie: 7, ambiente: 1 } },
    { id: "a23", fs: "EMITTED", j: [1, 2, 3] },
    { id: "a24", fs: "CANCELED", j: { nfceNumber: 41, serie: 7, ambiente: 1, emittedAt: em, numeroReservado: { numero: 42, serie: 7, ambiente: 1 } } },
  ];
  const fonte = Prisma.sql`SELECT * FROM (VALUES ${Prisma.join(
    amostras.map((a) => Prisma.sql`(${a.id}::text, ${a.fs}::text, ${JSON.stringify(a.j)}::jsonb)`)
  )}) AS v(id, fs, j)`;
  const ordem = (l: Array<Record<string, any>>) =>
    l.map((t) => [t.pedido, t.papel, t.numero, t.serie, t.ambiente, t.em, t.situacao, t.fiscalStatus]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

      console.log("\n— 1. A leitura dos números: SQL = TypeScript —");
      const linhas = (await tx.$queryRaw(n.sqlDosNumeros(fonte))) as Array<Record<string, unknown>>;
      const doSql = n.lerLinhasDosNumeros(linhas);
      const doJs = amostras.flatMap((a) => n.numerosDoFiscalInfo({ id: a.id, fiscalStatus: a.fs, fiscalInfo: a.j }));
      confere(`os mesmos ${doJs.length} números, papel a papel`, ordem(doSql), ordem(doJs));

      console.log("\n— 2. O maior número por série/ambiente —");
      for (const [serie, ambiente] of [[7, 1], [7, 2], [8, 1], [9, 1]] as const) {
        const [l] = (await tx.$queryRaw(n.sqlDoMaiorNumero("qualquer", serie, ambiente, fonte))) as Array<{ maior: unknown }>;
        const js = doJs.filter((t) => t.serie === serie && t.ambiente === ambiente).map((t) => t.numero);
        confere(`série ${serie}, ambiente ${ambiente}`, l.maior == null ? null : Number(l.maior), js.length ? Math.max(...js) : null);
      }

      console.log("\n— 3. Gravações e trava: o planejador aceita (EXPLAIN não executa) —");
      const planos: Array<[string, Prisma.Sql]> = [
        ["trava", n.sqlDaTrava(n.chaveDaTrava("loja-de-conferencia", 7, 1))],
        ["mesclar no fiscalInfo (com remoção)", n.sqlMesclarNoFiscalInfo(["id-que-nao-existe"], { numeroReservado: { numero: 1 } }, ["numeroReservado"])],
        ["mesclar no fiscalInfo (sem remoção)", n.sqlMesclarNoFiscalInfo(["id-que-nao-existe"], { a: 1 })],
        ["registrar o envio", n.sqlMarcarEmEmissao(["id-que-nao-existe", "outro"], { processando: true })],
        ["soltar a reserva (com data)", n.sqlLiberarReserva("id-que-nao-existe", { numero: 3, serie: 7, ambiente: 1, em }, { reservaLiberada: { numero: 3 } })],
        ["soltar a reserva (sem data)", n.sqlLiberarReserva("id-que-nao-existe", { numero: 3, serie: 7, ambiente: 1, em: null }, { reservaLiberada: { numero: 3 } })],
        ["anexar inutilização", sqlAnexarInutilizacao("id-que-nao-existe", { serie: 7, numeroInicial: 3, numeroFinal: 4 })],
        ["mesclar no bloco sefaz", sqlMesclarNoEmissorDaLoja("id-que-nao-existe", { ultimoTeste: { ok: true } })],
        ["maior número (loja)", n.sqlDoMaiorNumero("id-que-nao-existe", 7, 1)],
        ["maior número recente (loja)", n.sqlDoMaiorNumeroRecente("id-que-nao-existe", 7, 1, new Date(Date.now() - n.JANELA_DA_NUMERACAO_MS))],
        ["marca de maior número (GREATEST)", n.sqlMarcarMaiorNumero("id-que-nao-existe", 7, 1, 9)],
        ["números da loja", n.sqlDosNumerosDaLoja("id-que-nao-existe")],
      ];
      for (const [nome, sql] of planos) {
        try {
          const plano = (await tx.$queryRaw(Prisma.sql`EXPLAIN ${sql}`)) as Array<Record<string, string>>;
          confere(`${nome}: planejado`, plano.length > 0, true);
        } catch (e: any) {
          confere(`${nome}: planejado`, String(e?.message ?? e).slice(0, 300), "ok");
        }
      }

      console.log("\n— 4. A consulta de verdade (só leitura) —");
      const maiores = (await tx.$queryRaw(
        Prisma.sql`SELECT "franchiseeId" AS loja, count(*)::int AS pedidos, count("fiscalInfo")::int AS "comFiscal" FROM "CustomerOrder" GROUP BY 1 ORDER BY 2 DESC LIMIT 3`
      )) as Array<{ loja: string; pedidos: number; comFiscal: number }>;
      const nik = (await tx.$queryRaw(
        Prisma.sql`SELECT "id" AS loja, "storeName" AS nome FROM "User" WHERE "storeName" ILIKE ${"%nik%"} ORDER BY "createdAt" LIMIT 3`
      )) as Array<{ loja: string; nome: string }>;
      for (const alvo of [...maiores.map((m) => ({ loja: m.loja, nome: `${m.pedidos} pedidos, ${m.comFiscal} com fiscalInfo` })), ...nik]) {
        const plano = (await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${n.sqlDoMaiorNumero(alvo.loja, 1, 1)}`)) as Array<Record<string, string>>;
        const texto = plano.map((p) => Object.values(p)[0]).join("\n");
        const tempo = /Execution Time: ([\d.]+) ms/.exec(texto)?.[1];
        const indice = /Index|Bitmap/.test(texto);
        const [m] = (await tx.$queryRaw(n.sqlDoMaiorNumero(alvo.loja, 1, 1))) as Array<{ maior: unknown }>;
        const desde = new Date(Date.now() - n.JANELA_DA_NUMERACAO_MS);
        const planoRecente = ((await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${n.sqlDoMaiorNumeroRecente(alvo.loja, 1, 1, desde)}`)) as Array<Record<string, string>>)
          .map((p) => Object.values(p)[0])
          .join("\n");
        const tempoRecente = /Execution Time: ([\d.]+) ms/.exec(planoRecente)?.[1];
        // O planejador escolhe o índice pela estatística (franchiseeId+createdAt, ou
        // só franchiseeId quando a loja tem poucas linhas): vale ser índice e ser rápido.
        const indiceRecente = /Index (?:Only )?Scan using "?(\w+)"?|Bitmap Index Scan on "?(\w+)"?/.exec(planoRecente);
        const nomeDoIndice = indiceRecente?.[1] ?? indiceRecente?.[2] ?? null;
        console.log(`     consulta rápida (32 dias): ${tempoRecente} ms, índice: ${nomeDoIndice ?? "NENHUM"}`);
        confere(`loja ${alvo.loja.slice(0, 10)}…: a consulta rápida usa índice e roda em menos de 200 ms`, [Boolean(nomeDoIndice), Number(tempoRecente) < 200], [true, true]);
        const linhasDaLoja = (await tx.$queryRaw(n.sqlDosNumerosDaLoja(alvo.loja))) as unknown[];
        console.log(`   loja ${alvo.loja} (${alvo.nome}): maior nº de produção = ${m.maior ?? "nenhum"}, números gravados = ${linhasDaLoja.length}, ${tempo} ms, índice por franchiseeId: ${indice ? "sim" : "NÃO"}`);
        confere(`loja ${alvo.loja.slice(0, 10)}…: a consulta usa índice e roda em menos de 2 s`, [indice, Number(tempo) < 2000], [true, true]);
      }

      // Hoje nenhuma loja tem fiscalInfo (ninguém emite): o custo de verdade
      // aparece com notas gravadas. 20 mil notas sintéticas (generate_series,
      // sem tabela), cada uma com reserva e uma nota anterior — o pior caso
      // de uma loja com anos de NFC-e.
      console.log("\n— 5. O custo com 20 mil notas gravadas (sintético) —");
      const sintetico = Prisma.sql`SELECT 'p' || g AS id, 'EMITTED'::text AS fs,
        jsonb_build_object('nfceNumber', g, 'serie', 7, 'ambiente', 1, 'emittedAt', '2026-09-20T15:00:00Z',
          'numeroReservado', jsonb_build_object('numero', g, 'serie', 7, 'ambiente', 1),
          'notasAnteriores', jsonb_build_array(jsonb_build_object('nfceNumber', g, 'serie', 7, 'ambiente', 1))) AS j
        FROM generate_series(1, 20000) g`;
      // MATERIALIZED: como numa tabela, o JSON existe pronto (sem isso o Postgres
      // refaz o jsonb_build_object a cada acesso e mede outra coisa).
      const materializado = (sql: Prisma.Sql) => Prisma.sql`WITH s AS MATERIALIZED (${sintetico}) ${sql}`;
      const base = (await tx.$queryRaw(Prisma.sql`EXPLAIN ANALYZE ${materializado(Prisma.sql`SELECT count(*) FROM s`)}`)) as Array<Record<string, string>>;
      const tempoBase = Number(/Execution Time: ([\d.]+) ms/.exec(base.map((p) => Object.values(p)[0]).join("\n"))?.[1]);
      const plano = (await tx.$queryRaw(Prisma.sql`EXPLAIN ANALYZE ${materializado(n.sqlDoMaiorNumero("x", 7, 1, Prisma.sql`SELECT * FROM s`))}`)) as Array<Record<string, string>>;
      const tempo = Number(/Execution Time: ([\d.]+) ms/.exec(plano.map((p) => Object.values(p)[0]).join("\n"))?.[1]);
      const [m] = (await tx.$queryRaw(materializado(n.sqlDoMaiorNumero("x", 7, 1, Prisma.sql`SELECT * FROM s`)))) as Array<{ maior: unknown }>;
      console.log(`   20.000 notas: maior = ${m.maior}, ${tempo} ms (dos quais ${tempoBase} ms só de montar as linhas)`);
      confere("20 mil notas: o maior certo e em menos de 1 s", [Number(m.maior), tempo < 1000], [20000, true]);
    },
    { maxWait: 20_000, timeout: 120_000 }
  );
  await prisma.$disconnect();
  console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ exceção:", e);
  process.exit(1);
});
