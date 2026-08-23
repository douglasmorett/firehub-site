import { prisma } from "@/lib/prisma";

/**
 * Gera o próximo dailyOrderNumber sequencial para uma loja.
 *
 * ── POR QUE ISTO FOI REESCRITO ──────────────────────────────────────────────
 * A versão anterior fazia:
 *
 *   prisma.$transaction(async (tx) => {
 *     const totalToday = await tx.customerOrder.count(...)      // leitura
 *     const maxOrder   = await tx.customerOrder.findFirst(...)  // leitura
 *     return Math.max(totalToday, maxExisting) + 1              // não escreve nada
 *   }, { isolationLevel: "Serializable" })
 *
 * A transação era 100% de LEITURA. O Serializable Snapshot Isolation do
 * PostgreSQL só aborta quando existe dependência de leitura-escrita entre as
 * transações; duas transações somente-leitura nunca conflitam. E o INSERT do
 * pedido acontecia DEPOIS, fora da transação. Resultado: dois pedidos
 * simultâneos liam o mesmo estado e recebiam o MESMO número.
 *
 * Aconteceu em produção em 22/08/2026: dois pedidos do iFood às 17:39 saíram
 * ambos como #16. Em seguida, com dois #16 no banco, totalToday virou 17 e
 * maxExisting continuou 16, então o próximo pedido foi para #18 — o 17 nunca
 * existiu. Duas comandas com o mesmo número fazem a cozinha entregar trocado.
 *
 * ── COMO FUNCIONA AGORA ─────────────────────────────────────────────────────
 * O número vem de um contador por (loja, dia) incrementado com
 * `UPDATE ... SET lastNumber = lastNumber + 1 RETURNING`. O PostgreSQL
 * serializa isso no lock da linha: duas chamadas concorrentes esperam uma pela
 * outra e recebem valores diferentes. Não há janela de corrida, e não depende
 * de nível de isolamento nem de retry.
 *
 * A REGRA DE NEGÓCIO É PRESERVADA: a sequência continua por dia de calendário
 * em America/Sao_Paulo, e o contador é semeado com o maior número já usado no
 * dia — então números já impressos nunca são reaproveitados nem reindexados.
 */

/** Data no fuso de São Paulo, no formato YYYY-MM-DD. */
function dateKeySP(ref: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
}

/**
 * Maior número já em uso no dia. Usado só para SEMEAR o contador na primeira
 * chamada do dia — mantém a mesma lógica da versão antiga, para o contador
 * nunca começar atrás de um pedido que já foi impresso.
 */
async function calcularSemente(db: ClientePrisma, franchiseeId: string, startOfDay: Date): Promise<number> {
  const [totalToday, maxOrder] = await Promise.all([
    db.customerOrder.count({
      where: {
        franchiseeId,
        createdAt: { gte: startOfDay },
        status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
      },
    }),
    db.customerOrder.findFirst({
      where: {
        franchiseeId,
        createdAt: { gte: startOfDay },
        dailyOrderNumber: { not: null },
      },
      orderBy: { dailyOrderNumber: "desc" },
      select: { dailyOrderNumber: true },
    }),
  ]);

  return Math.max(totalToday, maxOrder?.dailyOrderNumber || 0);
}

/**
 * Cliente do Prisma OU o cliente de uma transação em andamento.
 * Passar o de transação é o que permite o número ser DESFEITO junto com o
 * pedido quando a gravação falha — ver a nota sobre números queimados abaixo.
 */
type ClientePrisma = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * ⚠️ NÚMERO QUEIMADO: chamar isto FORA de uma transação e criar o pedido
 * depois deixa buraco na sequência sempre que a gravação falha — o contador
 * já subiu e ninguém devolve.
 *
 * Aconteceu em produção em 23/08/2026 na Hakim Centro: a sequência do dia foi
 * 93, 94, 96, 98 — os números 95 e 97 sumiram. O mesmo pedido do iFood chega
 * por dois caminhos (webhook e cron); os dois pegavam número e tentavam
 * gravar, um perdia na trava de ifoodOrderId único e o número dele evaporava.
 * O lojista lê isso como "meu pedido sumiu".
 *
 * Por isso prefira `generateDailyOrderNumberTx` dentro de $transaction junto
 * com o create. Esta versão sem transação continua válida para quem cria o
 * pedido logo em seguida sem chance de conflito.
 */
export async function generateDailyOrderNumber(
  franchiseeId: string,
  ref: Date = new Date()
): Promise<number> {
  return generateDailyOrderNumberTx(prisma, franchiseeId, ref);
}

/** Mesma numeração, porém usando o client da transação em andamento. */
export async function generateDailyOrderNumberTx(
  db: ClientePrisma,
  franchiseeId: string,
  ref: Date = new Date()
): Promise<number> {
  const dateKey = dateKeySP(ref);
  const startOfDay = new Date(`${dateKey}T00:00:00-03:00`);
  const chave = { franchiseeId_dateKey: { franchiseeId, dateKey } };

  // 1. Garante que o contador do dia existe, semeado com o maior número já usado.
  const jaExiste = await db.dailyOrderCounter.findUnique({
    where: chave,
    select: { franchiseeId: true },
  });

  if (!jaExiste) {
    const semente = await calcularSemente(db, franchiseeId, startOfDay);
    try {
      await db.dailyOrderCounter.create({
        data: { franchiseeId, dateKey, lastNumber: semente },
      });
    } catch (err: any) {
      // P2002 = outra requisição criou o contador entre o findUnique e o create.
      // É o resultado esperado numa corrida; o incremento abaixo resolve.
      if (err?.code !== "P2002") throw err;
    }
  }

  // 2. Incremento ATÔMICO. Vira UPDATE ... SET lastNumber = lastNumber + 1
  //    RETURNING, que o Postgres serializa no lock da linha.
  const linha = await db.dailyOrderCounter.update({
    where: chave,
    data: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });

  return linha.lastNumber;
}
