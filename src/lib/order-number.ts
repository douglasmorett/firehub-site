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
 * O período do contador é o que vai de um FECHAMENTO DE CAIXA ao próximo (ver
 * chaveDoContador), e ele é semeado com o último número já usado nesse período
 * — então números já impressos nunca são reaproveitados nem reindexados.
 */

/**
 * Último número já em uso no período. Usado só para SEMEAR o contador na
 * primeira chamada — para ele nunca começar atrás de um pedido já impresso.
 *
 * Os ÚLTIMOS pedidos, e não o maior número desde o início do período: na troca
 * da regra (27/09/2026) a loja sem caixa tinha a contagem por dia, e o maior
 * número de todos os tempos seria o de algum sábado de meses atrás — o #45 de
 * hoje pularia para o #301. Os 30 mais recentes dizem onde a contagem está,
 * inclusive com o rascunho do robô que ganha número depois de criado.
 */
async function calcularSemente(db: ClientePrisma, franchiseeId: string, desde: Date): Promise<number> {
  const recentes = await db.customerOrder.findMany({
    where: {
      franchiseeId,
      createdAt: { gte: desde },
      dailyOrderNumber: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { dailyOrderNumber: true },
  });
  return recentes.reduce((maior, p) => Math.max(maior, p.dailyOrderNumber || 0), 0);
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

/**
 * QUEM DECIDE QUANDO A CONTAGEM RECOMEÇA É O CAIXA, NÃO O RELÓGIO.
 *
 * A numeração era por dia de calendário em São Paulo, e à meia-noite voltava
 * ao 1. Para a loja que vira a noite isso é no meio do expediente: o Frangoso
 * estava atendendo e o painel começou a recontar (19/09/2026). O turno dele
 * não acabou à meia-noite — acaba quando ele fecha o caixa.
 *
 * REGRA DO DONO (27/09/2026): "a numeração zera só quando fecha o caixa.
 * Horário nenhum é para zerar. Se o cliente nunca fechar o caixa, continua
 * contando sem parar."
 *
 * Então o período do contador é o que vai do ÚLTIMO FECHAMENTO DE CAIXA até o
 * próximo. Não importa se há caixa aberto agora nem que horas são: fechou o
 * caixa, o próximo pedido é o #1; não fechou, soma. A loja que nunca fechou um
 * caixa conta desde sempre. O caixa só fecha pela mão de alguém — no botão de
 * fechar ou ao abrir um novo por cima (api/cash-session) —, nunca pelo relógio.
 *
 * Até esta data havia duas travas que contrariavam a regra: sem caixa aberto a
 * contagem voltava ao 1 à meia-noite, e o caixa novo aberto no mesmo dia
 * continuava do maior número do dia em vez de começar do 1. Número repetido no
 * mesmo dia (fechou às 15h, reabriu às 18h) é aceito pelo dono; o QR do
 * motoboy já desempata pelo pedido que ainda dá para puxar.
 */
export async function chaveDoContador(
  db: ClientePrisma,
  franchiseeId: string,
  // O instante não decide mais o período; fica na assinatura por quem chama.
  _ref?: Date
): Promise<{ dateKey: string; desde: Date }> {
  try {
    const fechado = await db.cashSession.findFirst({
      where: { franchiseeId, status: "CLOSED", closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
      select: { id: true, closedAt: true },
    });
    if (fechado?.closedAt) return { dateKey: `fechamento:${fechado.id}`, desde: fechado.closedAt };
  } catch {
    // Sem a tabela de caixa (ou erro de leitura) a numeração não pode parar:
    // segue o contador de sempre, que também não olha o relógio.
  }
  return { dateKey: "sempre", desde: new Date(0) };
}

/** Mesma numeração, porém usando o client da transação em andamento. */
export async function generateDailyOrderNumberTx(
  db: ClientePrisma,
  franchiseeId: string,
  ref: Date = new Date()
): Promise<number> {
  const { dateKey, desde: startOfDay } = await chaveDoContador(db, franchiseeId, ref);
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
