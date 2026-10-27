import { prisma } from "@/lib/prisma";

/**
 * Código curto de pareamento da maquininha: 8 números no lugar dos 64
 * caracteres do token, porque ninguém digita 64 caracteres num teclado de POS.
 *
 * O curto NÃO é credencial: ele só serve para o app buscar o token uma vez.
 * Por isso vale 10 minutos e morre no primeiro uso — 8 números (10⁸) que
 * existem por 10 minutos não dá para adivinhar, e o token de verdade continua
 * sendo os 64 caracteres que o app guarda no cofre.
 *
 * Tabela criada no 1º uso, como a CobrancaDaMesaNaMaquininha (schema.prisma
 * não muda).
 */

export const TAMANHO_DO_CODIGO_CURTO = 8;
export const MINUTOS_DE_VALIDADE_DO_CODIGO_CURTO = 10;

let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CodigoCurtoDaMaquininha" (
          "codigo"     TEXT PRIMARY KEY,
          "terminalId" TEXT NOT NULL,
          "expiraEm"   TIMESTAMPTZ NOT NULL,
          "usadoEm"    TIMESTAMPTZ
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CodigoCurto_terminal" ON "CodigoCurtoDaMaquininha" ("terminalId")`,
      );
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

function sortearCodigo(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 10 ** TAMANHO_DO_CODIGO_CURTO).padStart(TAMANHO_DO_CODIGO_CURTO, "0");
}

/** Gera o código curto do terminal. Um código novo derruba os anteriores dele. */
export async function criarCodigoCurto(terminalId: string): Promise<{ codigo: string; expiraEm: Date }> {
  await garantirTabela();
  const expiraEm = new Date(Date.now() + MINUTOS_DE_VALIDADE_DO_CODIGO_CURTO * 60_000);
  await prisma.$executeRawUnsafe(
    `DELETE FROM "CodigoCurtoDaMaquininha" WHERE "terminalId" = $1 OR "expiraEm" < now() - interval '1 day'`,
    terminalId,
  );
  // Colisão com outro código vivo é rara (poucos vivos em 10⁸), mas a chave
  // primária recusa; tenta de novo com outro número.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = sortearCodigo();
    const gravados = await prisma.$executeRawUnsafe(
      `INSERT INTO "CodigoCurtoDaMaquininha" ("codigo","terminalId","expiraEm") VALUES ($1,$2,$3)
       ON CONFLICT ("codigo") DO NOTHING`,
      codigo, terminalId, expiraEm,
    );
    if (gravados === 1) return { codigo, expiraEm };
  }
  throw new Error("Não consegui sortear um código curto livre.");
}

/**
 * Troca o código curto pelo token do terminal. Vale uma vez: o UPDATE marca o
 * uso e só devolve a linha se ela ainda estava livre e no prazo, então dois
 * aparelhos digitando o mesmo código ao mesmo tempo não levam os dois.
 */
export async function trocarCodigoCurto(codigo: string): Promise<string | null> {
  await garantirTabela();
  const usados = await prisma.$queryRawUnsafe<{ terminalId: string }[]>(
    `UPDATE "CodigoCurtoDaMaquininha" SET "usadoEm" = now()
     WHERE "codigo" = $1 AND "usadoEm" IS NULL AND "expiraEm" > now()
     RETURNING "terminalId"`,
    codigo,
  );
  if (!usados[0]) return null;
  const terminal = await prisma.posTerminal.findUnique({
    where: { id: usados[0].terminalId },
    select: { deviceToken: true },
  });
  return terminal?.deviceToken ?? null;
}
