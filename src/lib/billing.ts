/**
 * lib/billing.ts
 *
 * Motor de faturamento "Use First, Pay Later" — 100% automático.
 *
 * Regra:
 *   Taxa = 2% do faturamento mensal do franqueado (1% nas vendas até
 *   03/10/2026 — ver VIRADA_DOS_2_POR_CENTO em lib/firehub-billing.ts)
 *   Mínimo: R$100 · Máximo: R$400
 *
 * Base de cálculo: soma do valor BRUTO (totalAmount + discountTotal, ver
 * faturamentoBruto abaixo) do mês dos pedidos que são
 * venda de verdade (ver VENDAS_QUE_CONTAM abaixo). Isso inclui TODA origem
 * gravada como CustomerOrder —
 * cardápio digital, chatbot de WhatsApp, mesa, balcão, totem e os pedidos
 * importados das integrações de iFood, 99Food e Jotajá. Não existe filtro por
 * `source` aqui, e é intencional: o trato é 2% de tudo que passa pelo sistema.
 *
 * Fluxo:
 *   1. Pedido é confirmado (status ACEITO/ENTREGUE) → trackSaleForBilling()
 *      - Recalcula o totalSales e amountDue do ciclo do mês
 *      - Mostra pro franqueado quanto deve em tempo real
 *
 *   2. Ao final do mês → closeBillingCycle() (via API ou Asaas webhook)
 *      - Gera cobrança Asaas pelo valor ainda pendente
 *
 * Sem Pagar.me, sem ação manual do admin.
 */

import { prisma } from "@/lib/prisma";
import { calcMensalidade, FIREHUB_PLAN, percentualDoMes, percentualDaVenda, MES_DOS_2_POR_CENTO, VIRADA_DOS_2_POR_CENTO } from "@/lib/firehub-billing";
import { getAsaasKey } from "@/lib/asaas";
import { prepararAvisoDoBoleto } from "@/lib/aviso-do-boleto";
import { bloqueioDaMensalidade, bloqueioDoCiclo, JUROS_AO_MES_PCT, MULTA_POR_ATRASO_PCT, vencimentoDoBoleto } from "@/lib/prazo-da-mensalidade";
import { ganhaComoVendedor } from "@/lib/vendedores";
import { fimDoTeste } from "@/lib/fim-do-teste";

/**
 * Teto de comissão que pode sair de uma mensalidade, somando os dois níveis do
 * programa de embaixadores. O padrão do programa é 20% + 3% = 23%; a folga até
 * 40% existe para os casos negociados à mão (o Victor está em 30% + 3%). O
 * vendedor responsável (+3%) só entra em loja que não é indicação dele, então
 * ele não empilha em cima dos 30%. Acima
 * disso o boleto sai sem split e o erro vai para o log — é quase certo que
 * alguém errou o número no admin. O número mora em lib/parceiro/regras.ts: o
 * portal do parceiro avisa a loja que passaria do teto com a mesma conta.
 */
import { TETO_DE_SPLIT } from "@/lib/parceiro/regras";
import { aplicarCreditosNoCiclo, indiqueEGanheDaLoja, previsaoDoIndiqueEGanhe } from "@/lib/indique-e-ganhe-no-banco";
import { INDICADOS_PARA_ISENCAO } from "@/lib/indique-e-ganhe";

/**
 * ── O QUE CONTA COMO VENDA PARA A MENSALIDADE ───────────────────────────────
 *
 * A base era só `status != CANCELADO`, e isso engolia dois estados que não são
 * venda nenhuma:
 *
 *   AGUARDANDO_PAGAMENTO — o pedido do totem nasce assim, ANTES do cartão.
 *     Quem desiste na tela de pagamento, tem a cobrança recusada ou vai embora
 *     deixa o registro para trás: nada no sistema cancela esses pedidos (o
 *     /api/totem/payment/cancel cancela só a cobrança e não existe cron que os
 *     expire). Como a agregação recalcula o mês inteiro a cada pedido
 *     confirmado, cada abandono ficava somando 1% de uma venda que não houve —
 *     dinheiro saindo do bolso do lojista. Pior no período de teste: a isenção
 *     depende de `totalSales === 0`, então uma loja que ainda não vendeu nada e
 *     só tem carrinho abandonado de totem perdia a isenção inteira e tomava
 *     boleto cheio.
 *
 *   CRIANDO_IA — rascunho que o robô do WhatsApp ainda está montando; não é
 *     pedido, é intenção. Mesmo critério do KDS, da fila de impressão e da
 *     numeração do dia (src/lib/order-number.ts).
 *
 * O filtro do pendente é por status E ausência de pagamento, não só por status:
 * filtrar só pelo status apagaria da conta o pedido que JÁ foi pago e ainda não
 * trocou de estado. É a mesma exigência de prova que o DRE passou a fazer
 * depois do saldo fantasma de R$ 342,35 da Hakim Centro.
 */
/*
 * ── CANCELADO CONTA DESDE 04/10/2026 ────────────────────────────────────────
 *
 * Dono, 04/10/2026: "pedidos cancelados contam para a soma do valor pago da
 * mensalidade, pois passaram pelo sistema e geraram custo" (robô, impressão,
 * integração, servidor). Vale a partir da mesma virada dos 2%
 * (VIRADA_DOS_2_POR_CENTO), que é a data avisada nos Termos: cancelado de
 * antes dela continua fora — cobrar para trás uma regra que a loja não
 * aceitou é o que vira contestação. Rascunho do robô e totem abandonado
 * continuam fora: não chegaram a ser pedido.
 */
const VENDAS_QUE_CONTAM = {
  status: { notIn: ["CRIANDO_IA"] as string[] },
  NOT: { status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
  OR: [
    { status: { not: "CANCELADO" } },
    { createdAt: { gte: VIRADA_DOS_2_POR_CENTO } },
  ],
};

/**
 * Base de cálculo da mensalidade = valor BRUTO do pedido que entrou, não o
 * que o cliente pagou.
 *
 * `totalAmount` é líquido: já vem descontado o cupom da loja e o cupom do
 * marketplace (iFood/99Food). Cobrar 1% sobre o líquido abria uma guerra
 * pelo teto — bastava cupom para a base encolher, e a promoção do iFood, que
 * a loja nem paga, ainda derrubava a nossa comissão. O que a loja vendeu foi
 * o pedido inteiro; é sobre isso que o plano cobra (decisão do dono,
 * 06/09/2026).
 *
 * `discountTotal` guarda TODO desconto aplicado (loja + marketplace): o iFood
 * grava desde os benefícios, o 99Food e o cupom do checkout passaram a gravar
 * em 06/09. Pedido antigo sem o campo entra pelo líquido — não há como
 * reconstruir o que não foi guardado.
 */
const CAMPOS_DO_BRUTO = { totalAmount: true, discountTotal: true } as const;
function faturamentoBruto(soma: { totalAmount: number | null; discountTotal: number | null }): number {
  return (soma.totalAmount ?? 0) + (soma.discountTotal ?? 0);
}

/**
 * O lojista usou alguma funcionalidade nossa no mês?
 *
 * A regra do plano é "use first, pay later": quem não usa nada não paga nada.
 * O contrário também vale — quem usa QUALQUER coisa paga pelo menos o mínimo,
 * mesmo sem ter vendido. Sem isto, dava para deixar o robô atendendo no
 * WhatsApp, lançar contas no financeiro e controlar estoque o mês inteiro sem
 * receber um pedido pelo sistema, e não pagar nada.
 *
 * A checagem antiga olhava só três sinais (produto cadastrado, iFood ativo e
 * chatbotConfig.connected). Faltavam 99Food, Jotajá, totem, Meta Ads e o
 * financeiro inteiro. Pior: `connected` do chatbot só é gravado quando alguém
 * abre a tela do QR depois de conectar — quem lia o QR e fechava a aba ficava
 * com o robô atendendo e a cobrança cega. Por isso o consumo de IA registrado
 * no UsageLog entra aqui: é prova de que o robô trabalhou, não promessa.
 *
 * Uso é ATIVIDADE dentro da janela cobrada, não configuração que ficou
 * salva. Regra do dono (12/10/2026): "se saiu do teste e não vendeu nada, nem
 * usou robô nem nenhuma função, não cobrar". Antes contavam robô marcado como
 * conectado, iFood/99/Jotajá ligados, impressora/KDS/fiscal/repasse
 * configurados, produto no cardápio e item de estoque — tudo estado que
 * sobrevive à loja abandonada. Em 12/10 seis lojas que só testaram e pararam
 * (Forno Doro, Vinhedos, Predileta, Nostra, Oii, L&M) iam receber boleto de
 * R$ 100 por isso, sem nenhum pedido e sem o robô responder ninguém.
 *
 * Contam: o robô/IA trabalhou (resposta enviada ou consumo de IA no
 * UsageLog — mensagem só RECEBIDA não conta), conta a pagar, caixa aberto,
 * nota de compra, totem ativo e campanha de Meta Ads cobrada no mês. Integração
 * ligada sem pedido não é uso: pedido que entrasse por ela seria venda.
 *
 * Devolve também o motivo, que fica no `notes` do ciclo — quando o lojista
 * perguntar "por que estou pagando se não vendi?", a resposta está gravada.
 */
export async function detectarUsoDaLoja(
  franchiseeId: string,
  monthStart: Date,
  monthEnd: Date
): Promise<{ usou: boolean; motivos: string[] }> {
  const motivos: string[] = [];
  const noMes = { gte: monthStart, lt: monthEnd };
  const mesDoCiclo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(new Date(monthEnd.getTime() - 1));

  const [robo, ia, contas, caixa, notas, totem, anuncio] = await Promise.all([
    prisma.usageLog.count({
      where: { franchiseeId, createdAt: noMes, category: "WHATSAPP_MSG", metadata: { path: ["direction"], equals: "OUTBOUND" } },
    }),
    prisma.usageLog.count({ where: { franchiseeId, createdAt: noMes, category: { in: ["GEMINI_CHAT", "GEMINI_VISION"] } } }),
    prisma.payable.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.cashSession.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.purchaseInvoice.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.totemLicense.count({ where: { franchiseeId, active: true } }),
    prisma.franchiseeBillingCycle.count({ where: { franchiseeId, yearMonth: mesDoCiclo, metaAdsFee: { gt: 0 } } }),
  ]);

  if (robo > 0) motivos.push(`robô de WhatsApp respondeu (${robo} mensagem(ns))`);
  if (ia > 0) motivos.push(`${ia} uso(s) de IA no mês`);
  if (contas > 0) motivos.push("financeiro (contas a pagar)");
  if (caixa > 0) motivos.push("controle de caixa");
  if (notas > 0) motivos.push("notas de compra");
  if (totem > 0) motivos.push("totem de autoatendimento");
  if (anuncio > 0) motivos.push("campanha de Meta Ads");

  return { usou: motivos.length > 0, motivos };
}

export function isExemptAccount(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.toLowerCase().replace(/\s+/g, "");
  const bypassEmails = (process.env.BYPASS_BILLING_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const exemptList = [
    "contatohakim@gmail.com",
    "viniciusmenezes.ofc@gmail.com",
    // Loja de teste da própria casa (integração Brendi): estava acumulando o
    // mínimo de R$ 100 por mês como se fosse cliente. Dono, 10/09/2026:
    // "tem que isentar, porque somos nós mesmos que estamos fazendo".
    "brendi-sandbox@firehubfood.com.br",
    ...bypassEmails,
  ];
  return exemptList.includes(clean);
}

/**
 * Loja que não paga mensalidade: a lista acima, as lojas Hakim e quem o dono
 * ISENTOU (`planPercent` 0, pelo botão "Isentar" da lista de lojistas no admin
 * — `definirIsencao`).
 *
 * Ser embaixador ou vendedor NÃO isenta mais sozinho. De 01/10 a 17/10/2026 a
 * conta de parceiro ativa ligada à loja (`Ambassador.linkedUserId`) isentava
 * automaticamente; o dono, em 17/10: "às vezes eu quero que o cara revenda, eu
 * faço o link dele de embaixador. Eu que escolho se é isento". As lojas que
 * eram isentas só por isso ficaram com `planPercent` 0 na virada.
 */
export function lojaIsenta(loja?: {
  email?: string | null;
  planPercent?: number | null;
  isFranqueadoHakim?: boolean | null;
} | null): boolean {
  if (!loja) return false;
  return isExemptAccount(loja.email)
    || loja.planPercent === 0
    || loja.isFranqueadoHakim === true;
}

/** O pedaço do `select` do User que `lojaIsenta` precisa. */
const CAMPOS_DA_ISENCAO = {
  email: true,
  planPercent: true,
  isFranqueadoHakim: true,
} as const;

/**
 * O dono isenta (ou volta a cobrar) uma loja — o botão da lista de lojistas.
 *
 * Além do `planPercent`, acerta o ciclo do mês: o ciclo de loja isenta NASCE
 * "PAID" com R$ 0 (`ensureCycle`), e a varredura de hora em hora não mexe em
 * ciclo que não esteja "OPEN". Sem reabrir, quem deixa de ser isento passaria
 * o resto do mês mostrando R$ 0 no admin. Ciclo pago de verdade (com boleto
 * no Asaas) não se reabre.
 *
 * Isenção da casa (lista de e-mails, Hakim) não muda por aqui: volta
 * `{ ok: false }` com o motivo.
 */
export async function definirIsencao(franchiseeId: string, isenta: boolean) {
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ...CAMPOS_DA_ISENCAO, storeTimezone: true },
  });
  if (!loja) return { ok: false as const, motivo: "Loja não encontrada." };
  if (!isenta && (isExemptAccount(loja.email) || loja.isFranqueadoHakim === true)) {
    return { ok: false as const, motivo: "Esta loja é da casa (Hakim ou conta interna): a isenção não muda por aqui." };
  }

  const mes = getCurrentYearMonth(0, loja.storeTimezone || "America/Sao_Paulo");
  await prisma.user.update({
    where: { id: franchiseeId },
    data: { planPercent: isenta ? 0 : percentualDoMes(mes) },
  });
  if (!isenta) {
    await prisma.franchiseeBillingCycle.updateMany({
      where: { franchiseeId, yearMonth: mes, status: "PAID", asaasPaymentId: null },
      data: { status: "OPEN" },
    });
  }
  const ciclo = await recalcularCiclo(franchiseeId, mes);
  return { ok: true as const, isenta, ciclo };
}

export function getCurrentYearMonth(offset = 0, timezone = "America/Sao_Paulo"): string {
  // Usa o fuso horário da loja (ou Brasília) para garantir que
  // o fechamento do mês acontece à meia-noite local, não UTC.
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const ano = Number(partes.find((p) => p.type === "year")!.value);
  const mes = Number(partes.find((p) => p.type === "month")!.value); // 1-12

  // Anda os meses na aritmética, não com setMonth(). `setMonth` estoura quando
  // o dia de hoje não existe no mês de destino: em 31/03, offset -1 caía em
  // 03/03 (31 de fevereiro não existe) e o fechamento lia o mês errado.
  const total = ano * 12 + (mes - 1) + offset;
  const anoFinal = Math.floor(total / 12);
  const mesFinal = (total % 12) + 1;
  return `${anoFinal}-${String(mesFinal).padStart(2, "0")}`;
}

/**
 * Quanto o fuso `timeZone` está deslocado do UTC no instante `data`, em ms.
 */
function offsetDoFuso(data: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const parte of dtf.formatToParts(data)) {
    if (parte.type !== "literal") p[parte.type] = parte.value;
  }
  const comoSeFosseUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return data.getTime() - comoSeFosseUtc;
}

/**
 * Começo e fim do mês de referência COMO INSTANTES, ancorados na meia-noite do
 * fuso da loja.
 *
 * O código antigo fazia `new Date(y, m - 1, 1)`, que usa o fuso do processo — e
 * a Vercel roda em UTC. Na prática o mês virava às 21h de Brasília: toda venda
 * entre 21h e a meia-noite do último dia caía no ciclo do mês seguinte, apesar
 * de os Termos prometerem fechamento no horário de Brasília.
 */
export function intervaloDoMes(yearMonth: string, timeZone = "America/Sao_Paulo") {
  const [ano, mes] = yearMonth.split("-").map(Number);

  const meiaNoiteLocal = (a: number, mIndex: number) => {
    const chute = Date.UTC(a, mIndex, 1, 0, 0, 0);
    // Duas passadas: a primeira acha o offset aproximado, a segunda confirma no
    // instante corrigido (importa só em virada de horário de verão).
    const off1 = offsetDoFuso(new Date(chute), timeZone);
    const off2 = offsetDoFuso(new Date(chute + off1), timeZone);
    return new Date(chute + off2);
  };

  return { monthStart: meiaNoiteLocal(ano, mes - 1), monthEnd: meiaNoiteLocal(ano, mes) };
}

/**
 * A partir de que instante as vendas do mês entram na base da mensalidade.
 *
 * Regra do dono (10/09/2026): "a trial acabou dia 20? do dia 20 ao dia 30
 * contabiliza o faturamento e cobra". Ou seja, o período de teste não é um mês
 * de cortesia: é uma janela em que a venda não conta. Terminou a janela, a
 * venda conta — no mesmo mês.
 *
 * Antes havia duas regras que não eram essa: o fechamento isentava o mês
 * INTEIRO se o teste cobrisse o mês inteiro, e cobrava o mês inteiro (com os
 * dias de teste dentro) se o teste terminasse no meio; e o recálculo a cada
 * venda zerava tudo enquanto o teste durava e depois cobrava o mês inteiro. O
 * Brasa Burguer (teste até 05/09) estava com R$ 4.349,28 vendidos DURANTE o
 * teste dentro da base de setembro.
 *
 * Devolve `null` quando o teste cobre o mês inteiro (não há o que cobrar), o
 * início do mês quando não há teste, e o fim do teste quando ele cai dentro
 * do mês. Um lugar só, porque três funções somam vendas: o recálculo a cada
 * pedido, o fechamento e o painel do lojista — e as três têm que bater.
 */
export function inicioDaCobranca(
  monthStart: Date,
  monthEnd: Date,
  trialEndsAt: Date | string | null | undefined
): Date | null {
  // A leitura do fim do teste é a MESMA da faixa do topo do painel
  // (lib/fim-do-teste.ts): sem `trialEndsAt` válido não há teste e a venda
  // conta desde o começo do mês. O topo inventava 15 dias desde o cadastro.
  const fim = fimDoTeste(trialEndsAt);
  if (!fim) return monthStart;
  if (fim >= monthEnd) return null;
  return fim > monthStart ? fim : monthStart;
}

/**
 * Parte das vendas do mês feita antes de 04/10/2026, que é cobrada a 1% (ver
 * VIRADA_DOS_2_POR_CENTO). Só outubro/2026 tem essa parte; os outros meses
 * nem consultam o banco. Mesma base do resto: VENDAS_QUE_CONTAM e o bruto.
 */
async function vendasAntesDaVirada(franchiseeId: string, yearMonth: string, desde: Date, monthEnd: Date): Promise<number> {
  if (yearMonth !== MES_DOS_2_POR_CENTO) return 0;
  const ate = monthEnd < VIRADA_DOS_2_POR_CENTO ? monthEnd : VIRADA_DOS_2_POR_CENTO;
  if (desde >= ate) return 0;
  const agg = await prisma.customerOrder.aggregate({
    where: { franchiseeId, ...VENDAS_QUE_CONTAM, createdAt: { gte: desde, lt: ate } },
    _sum: CAMPOS_DO_BRUTO,
  });
  return faturamentoBruto(agg._sum);
}

/**
 * Garante que existe um ciclo OPEN para o franqueado no mês atual.
 * Criado automaticamente ao primeiro pedido do mês.
 */
async function ensureCycle(franchiseeId: string, yearMonth: string) {
  const existing = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: CAMPOS_DA_ISENCAO,
  });

  const isExempt = lojaIsenta(user);

  return prisma.franchiseeBillingCycle.create({
    data: {
      franchiseeId,
      yearMonth,
      // Retrato da taxa do mês cobrado (1% até 2026-09, 2% depois), não do
      // `User.planPercent` — que só serve para marcar isenção (0).
      planPercent: isExempt ? 0 : percentualDoMes(yearMonth),
      status: isExempt ? "PAID" : "OPEN",
    },
  });
}

/**
 * Recalcula o ciclo de UM mês de UMA loja lendo os pedidos do banco.
 *
 * Não confia em quem chamou: soma o mês inteiro de novo a cada execução, então
 * pode ser chamada quantas vezes for, em qualquer ordem, sem duplicar nada.
 *
 * `yearMonth` opcional — sem ele usa o mês corrente NO FUSO DA LOJA (é o
 * comportamento de quem chama a cada pedido confirmado). Passar o mês serve
 * para a varredura de fechamento, que precisa reconstruir o mês anterior.
 */
export async function recalcularCiclo(franchiseeId: string, yearMonth?: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ...CAMPOS_DA_ISENCAO, storeTimezone: true, trialEndsAt: true },
  });

  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const mes = yearMonth || getCurrentYearMonth(0, tz);

  const cycle = await ensureCycle(franchiseeId, mes);

  const isExempt = lojaIsenta(user);

  const { monthStart, monthEnd } = intervaloDoMes(mes, tz);

  // Só as vendas DEPOIS do período de teste entram na base (ver
  // inicioDaCobranca). Teste cobrindo o mês inteiro = base zero.
  const inicio = inicioDaCobranca(monthStart, monthEnd, user?.trialEndsAt);
  const agg = inicio
    ? await prisma.customerOrder.aggregate({
        where: {
          franchiseeId,
          ...VENDAS_QUE_CONTAM,
          createdAt: { gte: inicio, lt: monthEnd },
        },
        _sum: CAMPOS_DO_BRUTO,
      })
    : null;

  const totalSales = agg ? faturamentoBruto(agg._sum) : 0;
  const antesDaVirada = inicio ? await vendasAntesDaVirada(franchiseeId, mes, inicio, monthEnd) : 0;
  const { mensalidade: amountDue } = calcMensalidade(totalSales, false, mes, antesDaVirada);

  // As taxas já acumuladas no ciclo (tráfego pago, totem) entram no pendente.
  //
  // Este update SOBRESCREVIA `amountPending` com a mensalidade pura a cada
  // pedido confirmado — apagando, várias vezes por dia, os R$ 50/semana de
  // gestão que o cron do Meta Ads tinha somado ali. O fechamento recalcula tudo
  // e o boleto saía certo, mas as telas de admin que leem esta coluna mostravam
  // um valor menor do que o que a loja ia receber.
  const taxasDoCiclo = (cycle.metaAdsFee ?? 0) + (cycle.totemFee ?? 0);
  // "Em teste" aqui significa: ainda não há nada cobrável neste mês — ou o
  // teste cobre o mês inteiro, ou ainda não terminou (a base começa a contar
  // no fim dele; até lá `totalSales` é zero de qualquer jeito).
  const emTeste = inicio === null || inicio > new Date();
  const pendingVal = (isExempt || emTeste) ? 0 : parseFloat((amountDue + taxasDoCiclo).toFixed(2));

  // Loja isenta tem que gravar `amountDue` ZERO, não a mensalidade que ela
  // teria se pagasse.
  //
  // Só o pendente era zerado aqui. O `amountDue` cheio continuava no ciclo, e o
  // painel de Custos (api/admin/usage-costs) lê exatamente essas duas colunas:
  // mostra `amountDue` como "Receita" e `amountDue - amountPending` como "Pago".
  // Resultado medido em 02/09/2026: a Hakim Centro aparecia com Receita
  // R$ 100,00 e "Pago: R$ 100,00" em verde, dinheiro que nunca foi cobrado de
  // ninguém — e esses R$ 100 ainda entravam no faturamento total da plataforma
  // e no cálculo da margem média.
  //
  // O fechamento SEMPRE soube disso: `closeMonth` grava `amountDue: 0` para
  // loja isenta e para mensalidade perdoada (ver os dois updates abaixo, com o
  // mesmo motivo escrito). Quem divergia era este caminho em tempo real, então
  // o número do admin só ficava certo depois que o mês fechava.
  // Loja em TESTE recebe o mesmo tratamento da isenta: `amountDue` zero.
  //
  // Só o pendente era zerado no teste, e o `amountDue` cheio ficava gravado.
  // O painel de Custos lê `amountDue` como "Receita" e `amountDue -
  // amountPending` como "Pago" — então cada loja em teste aparecia com a
  // mensalidade inteira "paga" em verde. Medido em 10/09/2026: Paulista
  // R$ 380,13, Taurus R$ 320,17, Ragnar R$ 220,77, Nik R$ 114,85 e Lucas
  // R$ 100,00 "pagos", todas em teste, nenhuma cobrada — R$ 1.135,92 de
  // faturamento que não existe, somado na receita total da plataforma. E o
  // Brasa Burguer, a única loja de fato devendo setembro (R$ 104,73
  // pendentes), era a única com "Pago: R$ 0,00", como se fosse ela a
  // inadimplente. O dono leu exatamente isso e achou que a cobrança do Brasa
  // tinha parado.
  //
  // O fechamento já sabe: quem passou o mês em teste tem a mensalidade
  // perdoada lá (isentoPorTeste). Se o teste acaba no meio do mês, a próxima
  // chamada daqui recalcula só com as vendas de depois dele (inicioDaCobranca)
  // e o valor volta — sobre a base certa.
  const devidoGravado = (isExempt || emTeste) ? 0 : amountDue;

  await prisma.franchiseeBillingCycle.update({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth: mes } },
    // `planPercent` regravado: ciclo criado antes da troca para 2% (ou por
    // outro módulo) guardava o 1% antigo.
    data: { totalSales, amountDue: devidoGravado, amountPending: pendingVal, planPercent: isExempt ? 0 : percentualDoMes(mes) },
  });

  console.log(
    `[Billing] ${franchiseeId} ${mes} | Vendas=${totalSales.toFixed(2)} Devido=${devidoGravado.toFixed(2)}${isExempt ? " (isenta)" : emTeste ? " (em teste)" : ""} Pendente=${pendingVal}`
  );

  return { yearMonth: mes, totalSales, amountDue: devidoGravado, amountPending: pendingVal };
}

/**
 * Chamada quando um CustomerOrder é confirmado (ACEITO / ENTREGUE / qualquer
 * status não cancelado). Recalcula o mês corrente da loja em tempo real, para o
 * franqueado ver no painel financeiro quanto deve.
 *
 * ⚠️ Isto NÃO é a garantia de que a loja será cobrada — ver
 * `garantirCiclosDoMes` logo abaixo. Só uma parte dos caminhos que criam pedido
 * chega até aqui.
 */
export async function trackSaleForBilling(franchiseeId: string) {
  return recalcularCiclo(franchiseeId);
}

/**
 * Cria/atualiza o ciclo de TODA loja que vendeu no mês — inclusive quem nunca
 * passou por `trackSaleForBilling`.
 *
 * ── O buraco que isto fecha ──────────────────────────────────────────────────
 *
 * O ciclo de cobrança só nascia quando alguém chamava `trackSaleForBilling`, e
 * ela é chamada em apenas cinco lugares: o checkout do cardápio digital
 * (POST /api/customer-order), a troca de status pelo painel
 * (POST /api/customer-order/status), a baixa do motoboy próprio, o webhook da
 * Pagar.me e a confirmação de pagamento online.
 *
 * Só que `CustomerOrder` é criado em ONZE lugares. Pedido que entra por iFood,
 * 99Food, Jotajá, Brendi, totem, balcão, mesa, pela API pública /v1/orders ou
 * pelo robô do WhatsApp é gravado direto no banco e não encosta em nenhum dos
 * cinco. O iFood ainda troca o status com `updateMany` direto
 * (src/lib/ifood-eventos.ts), então nem pela mudança de estado o cálculo
 * dispara.
 *
 * Consequência medida em 02/09/2026: loja que vende SÓ por integração terminava
 * o mês sem ciclo nenhum. E o cron de fechamento procura ciclos com
 * `status: "OPEN"` — sem ciclo, não há o que fechar, não sai boleto, a loja usa
 * o sistema de graça e no painel de Custos aparece com Receita R$ 0,00 dando
 * prejuízo. Não era erro de tela: era faturamento que ninguém cobrou.
 *
 * A correção NÃO é sair chamando `trackSaleForBilling` nos onze lugares — foi
 * exatamente essa dependência de "cada caminho lembrar de avisar" que criou o
 * buraco, e o décimo segundo caminho ia esquecer de novo. Aqui a pergunta é
 * feita ao contrário: quem vendeu neste mês? Essa lista sai do banco, não da
 * memória de quem escreveu a rota.
 *
 * Roda no cron diário para o mês corrente (mantém o painel do admin vivo) e
 * para o mês anterior antes de fechar (garante que ninguém escapa do boleto).
 */
export async function garantirCiclosDoMes(yearMonth: string) {
  // A janela de busca é a do fuso de Brasília ABERTA em um dia para cada lado.
  // Ela serve só para achar CANDIDATAS: o valor de cada loja é recalculado
  // depois, no fuso dela, por `recalcularCiclo`. Alargar aqui pode trazer uma
  // loja a mais para a conferência — nunca somar venda no mês errado.
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth);
  const buscaInicio = new Date(monthStart.getTime() - 24 * 60 * 60 * 1000);
  const buscaFim = new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000);

  const vendedoras = await prisma.customerOrder.groupBy({
    by: ["franchiseeId"],
    where: {
      ...VENDAS_QUE_CONTAM,
      createdAt: { gte: buscaInicio, lt: buscaFim },
    },
    _count: { id: true },
  });

  let criados = 0;
  let atualizados = 0;
  let jaFechados = 0;
  const erros: string[] = [];

  for (const v of vendedoras) {
    if (!v.franchiseeId) continue;
    try {
      const existente = await prisma.franchiseeBillingCycle.findUnique({
        where: { franchiseeId_yearMonth: { franchiseeId: v.franchiseeId, yearMonth } },
        select: { id: true, status: true },
      });

      // Ciclo já fechado NÃO se mexe.
      //
      // Este cron roda DE HORA EM HORA (scripts/cron-runner.js), e
      // `recalcularCiclo` sobrescreve `amountDue` e `amountPending`. Sem esta
      // guarda, todo mês anterior seria recalculado 24 vezes por dia por cima
      // de ciclo CLOSED — apagando o valor que foi de fato boletado no Asaas e
      // ressuscitando pendência de quem já pagou. Depois de fechado, quem manda
      // é o boleto, não o recálculo.
      if (existente && existente.status !== "OPEN") {
        jaFechados++;
        continue;
      }

      await recalcularCiclo(v.franchiseeId, yearMonth);

      if (existente) atualizados++;
      else {
        criados++;
        console.log(`[Billing] Ciclo ${yearMonth} CRIADO na varredura para ${v.franchiseeId} — vendeu sem nunca ter passado por trackSaleForBilling.`);
      }
    } catch (err: any) {
      erros.push(`${v.franchiseeId}: ${err?.message}`);
    }
  }

  return { yearMonth, lojasComVenda: vendedoras.length, criados, atualizados, jaFechados, erros };
}

/**
 * As lojas ADICIONAIS de marketplace na mesma conta: a primeira loja de cada
 * app (iFood, 99Food) é gratuita e cada adicional custa EXTRA_STORE_FEE por mês.
 *
 * É a conta do fechamento (`closeBillingCycle`), tirada de lá sem mudar nada —
 * a mesma contagem, a mesma ordem das linhas do boleto — para a aba
 * Mensalidade mostrar o que o boleto vai cobrar. A tela ficava sem estes
 * R$ 50 por loja: auditoria de 11/10/2026, Ragnar (3 lojas no iFood) via
 * R$ 400 e recebeu boleto de R$ 500; Frangoso via R$ 400 com R$ 600 previstos;
 * Brazza via R$ 162,65 com R$ 262,65 previstos.
 */
export async function lojasExtrasDeMarketplace(
  franchiseeId: string,
  loja: { ifoodConnected?: boolean | null; food99Connected?: boolean | null } | null | undefined,
): Promise<{ lojasIfood: number; lojas99: number; extraIfood: number; extra99: number; total: number; linhas: string[] }> {
  const linhas: string[] = [];

  const ifoodIntegCount = await prisma.ifoodIntegration.count({
    where: { userId: franchiseeId, active: true },
  });
  const legacyIfood = loja?.ifoodConnected ? 1 : 0;
  const lojasIfood = Math.max(ifoodIntegCount, legacyIfood);
  const extraIfood = Math.max(0, lojasIfood - 1) * FIREHUB_PLAN.EXTRA_STORE_FEE;
  if (extraIfood > 0) linhas.push(`iFood +${lojasIfood - 1} loja(s) R$${extraIfood.toFixed(2)}`);

  // 99Food segue a mesma regra do iFood: a primeira é grátis, cada adicional
  // custa EXTRA_STORE_FEE por mês.
  //
  // Até 26/08/2026 esta conta dava SEMPRE zero: `lojas99` vinha do booleano
  // `food99Connected`, que nunca passa de 1. A regra existia no código e nunca
  // cobrou ninguém. Agora conta as linhas de `Food99Store`.
  //
  // `contarLojas99` cai no booleano antigo quando a tabela está vazia — e
  // isso importa mais aqui do que em qualquer outro lugar: contar 0 numa
  // conta que já é cobrada apagaria a cobrança dela.
  const { contarLojas99 } = await import("@/lib/food99-lojas");
  const lojas99 = await contarLojas99(franchiseeId, !!loja?.food99Connected);
  const extra99 = Math.max(0, lojas99 - 1) * FIREHUB_PLAN.EXTRA_STORE_FEE;
  if (extra99 > 0) linhas.push(`99Food +${lojas99 - 1} loja(s) R$${extra99.toFixed(2)}`);

  return { lojasIfood, lojas99, extraIfood, extra99, total: extraIfood + extra99, linhas };
}

/**
 * Fecha o mês de um franqueado e gera cobrança Asaas pelo valor pendente.
 * Chamado automaticamente no último dia do mês (ou via API de fechamento).
 */
export async function closeBillingCycle(franchiseeId: string, yearMonth: string) {
  const cycle = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    include: {
      franchisee: {
        include: {
          // Dois niveis: quem indicou a loja e quem indicou esse embaixador.
          // Nao sobe mais que isso — o programa para no segundo nivel.
          ambassador: true,
          // O vendedor que o admin pôs para acompanhar a loja (lib/vendedores.ts).
          vendedor: true,
        },
      },
    },
  });

  if (!cycle) throw new Error(`Ciclo ${yearMonth} não encontrado para ${franchiseeId}`);
  if (cycle.status !== "OPEN" && cycle.status !== "PAID") return { charged: false, message: `Ciclo já está ${cycle.status}` };
  // PAID com boleto é mensalidade PAGA no Asaas (lib/pagamento-da-mensalidade.ts).
  // Refechar geraria um segundo boleto do mesmo mês para quem já pagou — o
  // PAID que ainda pode ser refeito é só o "nada a cobrar", que não tem boleto.
  if (cycle.status === "PAID" && cycle.asaasPaymentId) return { charged: false, message: "Ciclo já pago no Asaas" };

  const isSpecialStore = lojaIsenta(cycle.franchisee);

  // Recalcula valores finais (pedidos confirmados do mês)
  const tz = cycle.franchisee?.storeTimezone || "America/Sao_Paulo";
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth, tz);

  // Período de teste: a venda feita DENTRO dele não conta; a de depois conta,
  // no mesmo mês (regra do dono, ver inicioDaCobranca). Teste que cobre o mês
  // inteiro = nada a cobrar.
  //
  // A regra anterior isentava só quem não tinha vendido nada, e isso cobrava
  // exatamente quem estava fazendo o que o teste existe para permitir: a Point
  // Mix vendeu R$ 184,92 experimentando o sistema e recebeu boleto de R$ 100.
  // Depois passou a isentar o mês inteiro quando o teste cobria o mês inteiro
  // — e a cobrar o mês inteiro, dias de teste dentro, quando terminava no meio.
  //
  // O que vale e o teste DURANTE o mes faturado, nao na hora em que o cron
  // roda. Com `new Date()` aqui a SORRISO CAR — teste ate 02/09, agosto inteiro
  // dentro dele — foi cobrada porque o fechamento de agosto rodou em 03/09, um
  // dia depois. O ciclo e sempre de um mes que ja passou: comparar com "agora"
  // cobra justamente quem passou o mes faturado inteiro em teste e so perdeu o
  // beneficio no intervalo entre o fim do mes e a execucao do fechamento.
  const trialAte = cycle.franchisee?.trialEndsAt;
  const inicio = inicioDaCobranca(monthStart, monthEnd, trialAte);
  const emTeste = inicio === null;
  const isentoPorTeste = emTeste;
  const testeAcabouNoMes = !!inicio && !!trialAte && inicio.getTime() === new Date(trialAte).getTime();

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      ...VENDAS_QUE_CONTAM,
      createdAt: { gte: inicio ?? monthStart, lt: monthEnd },
    },
    _sum: CAMPOS_DO_BRUTO,
  });

  // A base cobrável. Com o teste cobrindo o mês inteiro, é a venda do mês
  // inteiro — só para ficar registrada na nota; a mensalidade é perdoada.
  const totalSales = faturamentoBruto(agg._sum);

  // Uso também só conta depois do teste: quem usou o sistema nos dias de
  // teste e nada depois não deve o mínimo.
  let hasUsage = totalSales > 0;
  let motivosUso: string[] = hasUsage ? ["vendas no mês"] : [];
  if (!hasUsage && !isSpecialStore && !emTeste) {
    const uso = await detectarUsoDaLoja(franchiseeId, inicio ?? monthStart, monthEnd);
    hasUsage = uso.usou;
    motivosUso = uso.motivos;
  }

  const antesDaVirada = await vendasAntesDaVirada(franchiseeId, yearMonth, inicio ?? monthStart, monthEnd);
  const { mensalidade: amountDue } = calcMensalidade(totalSales, hasUsage, yearMonth, antesDaVirada);

  // Quem NÃO paga mensalidade: loja isenta, quem não usou nada e quem está em
  // teste sem ter vendido. Isto era decidido lá embaixo, no bloco que zera o
  // ciclo inteiro — e era exatamente por isso que as taxas de serviço prestado
  // iam junto (ver o bloco de taxas extras abaixo).
  //
  // INDIQUE E GANHE (lib/indique-e-ganhe.ts): a loja principal de uma conta
  // com mais de 10 indicados ativos e pagantes não paga a mensalidade dela
  // enquanto a condição durar — conferida a cada fechamento, então cair para
  // 10 volta a cobrar no mês seguinte. Só a MENSALIDADE: tráfego pago, totem,
  // Bill e loja extra continuam no boleto, como no teste.
  const indique = isSpecialStore || isentoPorTeste || !hasUsage
    ? null
    : await indiqueEGanheDaLoja(cycle.franchisee);
  const isentaPorIndicacoes = !!indique?.isenta;
  const mensalidadePerdoada = isSpecialStore || isentoPorTeste || !hasUsage || isentaPorIndicacoes;
  const mensalidadeCheia = mensalidadePerdoada ? 0 : Math.max(0, amountDue - cycle.amountOffset);
  // Os créditos de R$ 100 por indicação paga abatem a mensalidade (nunca as
  // taxas). Mensalidade menor que o crédito: abate até zerar e o resto fica
  // para o mês seguinte. Com a mensalidade isenta ou perdoada não se consome
  // nada — o crédito espera o mês em que houver o que abater. Idempotente por
  // ciclo: refazer este fechamento não usa o crédito de novo.
  const creditoDeIndicacao = mensalidadeCheia > 0 && indique?.principal && indique.saldo > 0
    ? await aplicarCreditosNoCiclo(franchiseeId, { id: cycle.id, yearMonth }, mensalidadeCheia)
    : 0;
  const mensalidadePendente = parseFloat(Math.max(0, mensalidadeCheia - creditoDeIndicacao).toFixed(2));
  const notaDoIndique = [
    isentaPorIndicacoes ? `Mensalidade isenta pelo Indique e Ganhe: ${indique!.ativosPagantes} lojas indicadas ativas e pagantes (a partir de ${INDICADOS_PARA_ISENCAO}).` : null,
    creditoDeIndicacao > 0 ? `Indique e Ganhe: R$ ${creditoDeIndicacao.toFixed(2)} de crédito abatido da mensalidade de R$ ${mensalidadeCheia.toFixed(2)}.` : null,
  ].filter(Boolean).join(" ");

  // Taxas fixas do mês, por fora do percentual sobre as vendas.
  //
  // A primeira loja integrada a cada marketplace é gratuita; cada loja
  // ADICIONAL ligada na mesma conta custa EXTRA_STORE_FEE por mês. Isto já era
  // anunciado no painel e escrito na descrição do boleto, mas nunca entrava no
  // valor: o payload do Asaas mandava só a mensalidade. Quem tinha três lojas
  // no iFood lia "+ iFood Extra R$100,00" num boleto que não cobrava os R$100.
  let taxasExtras = 0;
  const linhasExtras: string[] = [];

  // A conta mora em `lojasExtrasDeMarketplace` (acima), a mesma que a aba
  // Mensalidade usa para mostrar o que este boleto vai cobrar.
  if (!isSpecialStore && !isentoPorTeste) {
    const extras = await lojasExtrasDeMarketplace(franchiseeId, cycle.franchisee);
    taxasExtras += extras.total;
    linhasExtras.push(...extras.linhas);
  }

  // Taxas acumuladas no ciclo por outros módulos (tráfego pago, totens).
  //
  // Ficavam dentro do `if (!isentoPorTeste)` acima, e isso APAGAVA serviço já
  // prestado: loja em teste que rodou campanha o mês inteiro acumulava R$ 50
  // por semana no ciclo, o fechamento pulava o bloco, gravava PAID e o dinheiro
  // sumia — sem adiar, sem recurso, porque nada reprocessa ciclo fechado. O
  // período de teste isenta a mensalidade que nasce do USO sem venda (é o que o
  // comentário acima diz); tráfego pago e totem não são presunção de uso, são
  // serviço entregue, cobrado semana a semana e anunciado na própria tela do
  // módulo ("acumulada e incluída na fatura do mês seguinte").
  if (!isSpecialStore) {
    if (cycle.metaAdsFee > 0) {
      taxasExtras += cycle.metaAdsFee;
      linhasExtras.push(`Tráfego pago R$${cycle.metaAdsFee.toFixed(2)}`);
    }
    if (cycle.totemFee > 0) {
      taxasExtras += cycle.totemFee;
      linhasExtras.push(`Totem R$${cycle.totemFee.toFixed(2)}`);
    }
    // Bill, seu assessor: R$ 49,90 (29,90 no termo antigo) no mês em que ficou ativo depois dos 7 dias
    // grátis da primeira ativação, inteiro (termo
    // aceito ao ligar — lib/assessor/termo.ts). Serviço contratado, como o
    // totem: entra mesmo no mês em teste da mensalidade.
    const { cobrancaDoAssessorNoMes } = await import("@/lib/assessor/assinatura");
    const assessor = await cobrancaDoAssessorNoMes(franchiseeId, monthStart, monthEnd);
    if (assessor > 0) {
      taxasExtras += assessor;
      linhasExtras.push(`Bill Assessor R$${assessor.toFixed(2)}`);
    }
  }

  const ifoodExtraCharge = taxasExtras;
  const amountPending = parseFloat((mensalidadePendente + taxasExtras).toFixed(2));

  // Nada a cobrar ou loja isenta.
  //
  // `!hasUsage` e `isentoPorTeste` saíram desta condição: os dois já zeram a
  // MENSALIDADE em `mensalidadePerdoada`, e mantê-los aqui zerava junto a taxa
  // de serviço já prestado — a única coisa que ainda havia para cobrar nesses
  // casos. Sem taxa acumulada o resultado é idêntico ao de antes.
  if (isSpecialStore || amountPending < 1) {
    await prisma.franchiseeBillingCycle.update({
      where: { id: cycle.id },
      data: {
        totalSales, amountDue: 0, amountPending: 0, status: "PAID", closedAt: new Date(),
        // Fica gravado por que não cobrou. Sem isto, "por que essa loja não foi
        // cobrada?" vira arqueologia toda vez.
        notes: isSpecialStore ? "Isento (loja oficial/própria)."
          : isentoPorTeste ? `Em período de teste até ${trialAte?.toLocaleDateString("pt-BR")} — cobriu o mês inteiro, mensalidade isenta. Vendas no mês: R$ ${totalSales.toFixed(2)}. Uso detectado: ${motivosUso.join(", ") || "nenhum"}.`
          : !hasUsage ? "Não usou nenhuma funcionalidade no mês."
          : notaDoIndique || "Valor abaixo do mínimo de cobrança.",
      },
    });
    return {
      charged: false,
      amountPending: 0,
      message: isSpecialStore ? "Isento (loja oficial / própria)."
        : isentoPorTeste ? "Em período de teste no mês inteiro — mensalidade isenta."
        : isentaPorIndicacoes ? "Mensalidade isenta pelo Indique e Ganhe."
        : creditoDeIndicacao > 0 ? "Mensalidade coberta pelo crédito do Indique e Ganhe."
        : "Nada a cobrar neste mês.",
    };
  }

  // Gera cobrança Asaas pelo valor restante
  const asaasKey = getAsaasKey();
  let asaasPaymentId: string | null = null;
  let asaasBoletoUrl: string | null = null;
  let asaasBoletoCode: string | null = null;

  if (asaasKey && cycle.franchisee.cpfCnpj) {
    const BASE = asaasKey.startsWith("$aact_prod")
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/v3";

    let customerId: string | null = null;

    // Busca cliente pelo CPF/CNPJ
    const sr = await fetch(`${BASE}/customers?cpfCnpj=${encodeURIComponent(cycle.franchisee.cpfCnpj)}`,
      { headers: { access_token: asaasKey } });
    if (sr.ok) {
      const sd = await sr.json();
      if (sd.data?.length > 0) customerId = sd.data[0].id;
    }

    // Cria se não existe
    if (!customerId) {
      const cr = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: asaasKey },
        body: JSON.stringify({
          name: cycle.franchisee.name,
          email: cycle.franchisee.email,
          cpfCnpj: cycle.franchisee.cpfCnpj,
        }),
      });
      if (cr.ok) customerId = (await cr.json()).id;
    }

    if (customerId) {
      // Celular no cliente e WhatsApp só no aviso de criação — antes do
      // POST /payments, que é quando esse aviso sai (lib/aviso-do-boleto.ts).
      await prepararAvisoDoBoleto(BASE, asaasKey, customerId, cycle.franchisee);

      // Vencimento: dia 5 do próximo mês (lib/prazo-da-mensalidade.ts)
      const due = vencimentoDoBoleto(yearMonth).dia;

      // A mensalidade só entra na descrição quando existe: com ela perdoada
      // (teste sem venda) e só a taxa de tráfego a cobrar, o boleto dizia
      // "Mensalidade R$0,00 + ...".
      //
      // Com crédito do Indique e Ganhe, o boleto mostra a mensalidade cheia e o
      // desconto ao lado — o lojista vê que os R$ 100 entraram.
      const linhasDaFatura = [
        ...(creditoDeIndicacao > 0
          ? [`Mensalidade R$${mensalidadeCheia.toFixed(2)} - desconto Indique e Ganhe R$${creditoDeIndicacao.toFixed(2)}`]
          : mensalidadePendente > 0 ? [`Mensalidade R$${mensalidadePendente.toFixed(2)}`] : []),
        ...(isentaPorIndicacoes ? ["Mensalidade isenta (Indique e Ganhe)"] : []),
        ...linhasExtras,
      ];
      const chargeDescription = linhasDaFatura.length > 0
        ? `FireHub ${yearMonth} — ${linhasDaFatura.join(" + ")}`
        : `FireHub ${yearMonth} — Taxa de plataforma (${percentualDoMes(yearMonth)}% · mín R$${FIREHUB_PLAN.MIN_MONTHLY} · máx R$${FIREHUB_PLAN.MAX_MONTHLY})`;

      const payload: any = {
        customer: customerId,
        billingType: "BOLETO",
        value: amountPending,
        dueDate: due,
        description: chargeDescription,
        externalReference: `billing:${cycle.id}`,
        // Juros e multa do FireHub, não o padrão da conta (lib/prazo-da-mensalidade.ts).
        interest: { value: JUROS_AO_MES_PCT },
        fine: { value: MULTA_POR_ATRASO_PCT, type: "PERCENTAGE" },
      };

      // ── Comissão de embaixador: um nível só ──────────────────────────────
      //
      // Quem indicou ESTA loja leva `commissionPercent` (20% de padrão e
      // editável caso a caso no admin). O nível 2 (3% para quem trouxe o
      // embaixador) foi encerrado em 15/10/2026: `parentAmbassadorId` e
      // `level2Percent` ficam no banco, mas não pagam mais nada.
      //
      // O ramo antigo do "Indique e Ganhe" entre lojistas (User.referredById,
      // 20/3/1) saiu daqui. O programa foi encerrado para o cliente comum, mas
      // o código continuava pagando: bastava um lojista gravar o próprio
      // asaasWalletId para começar a receber 20% de quem tivesse o ref dele.
      const splits: { walletId: string; percentualValue: number }[] = [];
      const nivel1 = cycle.franchisee?.ambassador;

      if (nivel1?.active && nivel1.asaasWalletId) {
        splits.push({ walletId: nivel1.asaasWalletId, percentualValue: nivel1.commissionPercent });
      }

      // Vendedor responsável: `sellerPercent` (3%) além do embaixador — só em
      // loja que NÃO é indicação dele. Se ele indicou a loja, já ganha a
      // comissão de embaixador e só acompanha (lib/vendedores.ts,
      // ganhaComoVendedor).
      const vendedor = cycle.franchisee?.vendedor;
      if (
        vendedor?.active && vendedor.isVendedor && vendedor.asaasWalletId && vendedor.sellerPercent > 0 &&
        ganhaComoVendedor(vendedor.id, { ambassadorId: cycle.franchisee?.ambassadorId })
      ) {
        const mesma = splits.find((s) => s.walletId === vendedor.asaasWalletId);
        if (mesma) mesma.percentualValue += vendedor.sellerPercent;
        else splits.push({ walletId: vendedor.asaasWalletId, percentualValue: vendedor.sellerPercent });
      }

      // Freio de mão. `commissionPercent` entra por um input livre no admin —
      // um 300 digitado no lugar de 30 viraria um boleto com split de 300%, que
      // o Asaas recusa e deixa a loja sem cobrança nenhuma no mês. Melhor
      // cobrar sem split e gritar no log do que não cobrar.
      const totalSplit = splits.reduce((acc, s) => acc + s.percentualValue, 0);
      if (totalSplit > TETO_DE_SPLIT) {
        console.error(
          `[Billing] Split de ${totalSplit}% no ciclo ${cycle.id} (loja ${franchiseeId}) acima do teto de ${TETO_DE_SPLIT}% — cobrança emitida SEM split. Revisar comissão do embaixador.`
        );
      } else if (splits.length > 0) {
        payload.split = splits;
      }

      const pr = await fetch(`${BASE}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: asaasKey },
        body: JSON.stringify(payload),
      });

      if (pr.ok) {
        const pd = await pr.json();
        asaasPaymentId = pd.id;
        asaasBoletoUrl = pd.invoiceUrl || pd.bankSlipUrl || null;
        asaasBoletoCode = pd.barCode || null;
      }
    }
  }

  await prisma.franchiseeBillingCycle.update({
    where: { id: cycle.id },
    data: {
      totalSales,
      planPercent: isSpecialStore ? 0 : percentualDoMes(yearMonth),
      // Mensalidade perdoada (teste / sem uso) mas com taxa a cobrar: gravar o
      // `amountDue` cheio faria o painel do admin mostrar uma dívida que não
      // está no boleto.
      amountDue: mensalidadePerdoada ? 0 : amountDue,
      amountPending,
      status: "CLOSED",
      closedAt: new Date(),
      asaasPaymentId,
      asaasBoletoUrl,
      asaasBoletoCode,
      // Prazo do BLOQUEIO (fim do dia 10), não o vencimento do boleto (dia 5).
      // Era o cron que gravava "fechamento + 10 dias" — o fechamento pelo admin
      // ficava sem prazo.
      dueDate: bloqueioDaMensalidade(yearMonth),
      // Teste que acabou no meio do mês: fica escrito de onde a base começou,
      // senão "por que a mensalidade não bate com as vendas do mês?" vira
      // arqueologia toda vez.
      ...((testeAcabouNoMes && inicio) || notaDoIndique
        ? {
            notes: [
              testeAcabouNoMes && inicio ? `Período de teste até ${new Date(trialAte!).toLocaleDateString("pt-BR")}: só as vendas a partir daí entram na base (R$ ${totalSales.toFixed(2)}).` : null,
              notaDoIndique || null,
            ].filter(Boolean).join(" "),
          }
        : {}),
    },
  });

  return { charged: true, amountPending, ifoodExtraCharge, asaasBoletoUrl, message: "Boleto gerado com valor pendente." };
}

/**
 * As faturas de meses FECHADOS que a loja ainda não pagou (boleto emitido,
 * `amountPending` > 0) — a mesma consulta da faixa "Mensalidade de R$ X vence
 * em…" do topo do painel (app/store/layout.tsx). O "Ver Fatura" daquela faixa
 * abria a aba Mensalidade mostrando só o mês em andamento: a loja com o boleto
 * de setembro em aberto (Taurus R$ 400, Brazza R$ 332,99, Pastel R$ 107,46…)
 * não achava a fatura que a faixa mandava pagar.
 */
async function faturasEmAbertoDaLoja(franchiseeId: string) {
  const ciclos = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId, status: "CLOSED", amountPending: { gt: 0 } },
    orderBy: { yearMonth: "asc" },
    select: { yearMonth: true, amountPending: true, asaasBoletoUrl: true, closedAt: true },
  });
  const agora = new Date();
  return ciclos.map((c) => {
    const venc = vencimentoDoBoleto(c.yearMonth);
    return {
      yearMonth: c.yearMonth,
      valor: c.amountPending,
      /** "2026-10-05" — o vencimento impresso no boleto. */
      venceEm: venc.dia,
      vencida: agora >= venc.vencidoDepoisDe,
      /** Quando o painel trava (fim do dia 10), lib/prazo-da-mensalidade.ts. */
      bloqueiaEm: bloqueioDoCiclo(c).toISOString(),
      boletoUrl: c.asaasBoletoUrl,
    };
  });
}

export type FaturaEmAberto = Awaited<ReturnType<typeof faturasEmAbertoDaLoja>>[number];

/**
 * Retorna o ciclo atual do franqueado para exibir no painel.
 * Se não existe, retorna dados zerados (sem criar no banco).
 *
 * É a MESMA conta do fechamento (`closeBillingCycle`): mensalidade sobre as
 * vendas depois do teste (1% no que veio antes de 04/10/2026), as taxas de
 * serviço do ciclo (tráfego pago, totem) e as lojas extras de marketplace
 * (`lojasExtrasDeMarketplace`). Cada parte vem separada para a tela mostrar de
 * onde sai o total — "por que o boleto deu R$ 500 se a tela dizia R$ 400?"
 * tem que ter resposta antes do boleto.
 */
/** O Indique e Ganhe na previsão do painel, quando não há nada (teste, isenta, sem indicação). */
const SEM_INDIQUE = { isenta: false, ativosPagantes: 0, saldo: 0, abate: 0 };

export async function getCurrentCycleView(franchiseeId: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ...CAMPOS_DA_ISENCAO, storeTimezone: true, trialEndsAt: true, ifoodConnected: true, food99Connected: true, accountGroupId: true },
  });

  const isExempt = lojaIsenta(user);
  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const yearMonth = getCurrentYearMonth(0, tz);
  const trialEndsAt = user?.trialEndsAt ? new Date(user.trialEndsAt).toISOString() : null;

  const [cycle, faturasEmAberto] = await Promise.all([
    prisma.franchiseeBillingCycle.findUnique({
      where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    }),
    faturasEmAbertoDaLoja(franchiseeId),
  ]);

  const semLojasExtras = { lojasIfood: 0, lojas99: 0, valor: 0, linhas: [] as string[] };

  if (isExempt) {
    return {
      yearMonth,
      totalSales: cycle?.totalSales || 0,
      vendasA1PorCento: 0,
      amountDue: 0,
      amountOffset: 0,
      amountPending: 0,
      mensalidadePrevista: 0,
      // Mesma forma em todos os retornos, para o painel nunca ter que testar se
      // o campo existe.
      taxas: { trafegoPago: 0, totem: 0, lojasExtras: 0 },
      lojasExtras: semLojasExtras,
      status: "PAID",
      isExempt: true,
      emTeste: false,
      cobrancaPorUso: null as { valor: number; motivos: string[] } | null,
      cobrancaDesde: null as string | null,
      trialEndsAt,
      asaasBoletoUrl: null as string | null,
      asaasBoletoCode: null as string | null,
      faturasEmAberto,
      indiqueEGanhe: SEM_INDIQUE,
    };
  }

  // Indique e Ganhe (lib/indique-e-ganhe.ts): a mesma conta do fechamento —
  // isenta com mais de 10 indicados ativos e pagantes, e o saldo de créditos
  // abatendo a mensalidade (nunca as taxas). Só prevê: quem grava o uso do
  // crédito é o fechamento.
  const loja = { id: franchiseeId, accountGroupId: user?.accountGroupId ?? null };
  const indiqueDoMes = async (mensalidade: number) => {
    try {
      const r = await previsaoDoIndiqueEGanhe(loja, mensalidade);
      return { isenta: r.isenta, ativosPagantes: r.ativosPagantes, saldo: r.saldo, abate: r.isenta ? 0 : r.abate };
    } catch {
      return SEM_INDIQUE;
    }
  };

  // Sem venda no mês, o valor devido só aparecia no fechamento — o lojista via
  // R$ 0,00 o mês inteiro e recebia um boleto do mínimo no fim. Aqui a previsão
  // já mostra o mínimo assim que ele usa alguma funcionalidade, com o motivo,
  // para a cobrança nunca ser surpresa.
  // As vendas são recontadas do banco, não lidas do ciclo. `trackSaleForBilling`
  // só roda nos fluxos próprios (site, totem, pagamento) — nenhuma rota de
  // iFood, 99Food ou Jotajá o chama. O fechamento sempre recalculou, então o
  // BOLETO saía certo, mas o lojista via um valor baixo o mês inteiro e tomava
  // o susto no dia 1. Contando aqui, painel e fatura falam a mesma coisa.
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth, tz);
  // Só as vendas depois do período de teste (inicioDaCobranca) — a mesma
  // janela do recálculo e do fechamento, para o painel bater com o boleto.
  const inicio = inicioDaCobranca(monthStart, monthEnd, user?.trialEndsAt);
  const aggVendas = inicio
    ? await prisma.customerOrder.aggregate({
        where: {
          franchiseeId,
          ...VENDAS_QUE_CONTAM,
          createdAt: { gte: inicio, lt: monthEnd },
        },
        _sum: CAMPOS_DO_BRUTO,
      })
    : null;
  const vendasDoMes = aggVendas ? faturamentoBruto(aggVendas._sum) : 0;
  // A parte das vendas cobrada a 1% (só outubro/2026, de 01 a 03/10). A tela
  // dizia "2% sobre isto" ao lado da base inteira — Brazza, R$ 10.347,84 com
  // R$ 4.430,44 a 1%.
  const vendasA1PorCento = inicio ? await vendasAntesDaVirada(franchiseeId, yearMonth, inicio, monthEnd) : 0;

  // Nada cobrável ainda: teste cobrindo o mês inteiro, ou ainda em curso.
  const emTeste = inicio === null || inicio > new Date();
  const cobrancaDesde = inicio ? inicio.toISOString() : null;
  let previsaoPorUso: { valor: number; motivos: string[] } | null = null;
  if (vendasDoMes === 0 && !emTeste) {
    const uso = await detectarUsoDaLoja(franchiseeId, inicio ?? monthStart, monthEnd);
    if (uso.usou) {
      previsaoPorUso = { valor: calcMensalidade(0, true, yearMonth).mensalidade, motivos: uso.motivos };
    }
  }

  // Mesma conta do fechamento, para o painel bater com o boleto.
  const previsaoPorVendas = (vendasDoMes > 0 && !emTeste)
    ? calcMensalidade(vendasDoMes, true, yearMonth, vendasA1PorCento).mensalidade
    : 0;
  const devidoAgora = emTeste ? 0 : Math.max(previsaoPorVendas, previsaoPorUso?.valor || 0);

  // Lojas extras de marketplace: o fechamento cobra sempre que o teste NÃO
  // cobre o mês inteiro (`isentoPorTeste` lá é `inicio === null`) — inclusive
  // no mês em que o teste termina no meio.
  const extras = inicio !== null ? await lojasExtrasDeMarketplace(franchiseeId, user) : null;
  const lojasExtras = extras
    ? { lojasIfood: extras.lojasIfood, lojas99: extras.lojas99, valor: extras.total, linhas: extras.linhas }
    : semLojasExtras;

  // Loja que só recebe pedido de marketplace nunca passa por `ensureCycle`, e
  // por isso pode não ter linha de ciclo no meio do mês. O valor previsto tem
  // que aparecer do mesmo jeito.
  if (!cycle) {
    const indique = emTeste ? SEM_INDIQUE : await indiqueDoMes(devidoAgora);
    const mensalidadeDoMes = indique.isenta ? 0 : devidoAgora;
    const total = parseFloat((mensalidadeDoMes + lojasExtras.valor).toFixed(2));
    return {
      yearMonth, totalSales: vendasDoMes, vendasA1PorCento,
      amountDue: total,
      amountOffset: 0,
      amountPending: parseFloat(Math.max(0, total - indique.abate).toFixed(2)),
      mensalidadePrevista: mensalidadeDoMes,
      taxas: { trafegoPago: 0, totem: 0, lojasExtras: lojasExtras.valor },
      lojasExtras,
      status: "OPEN", isExempt: false, emTeste,
      cobrancaPorUso: previsaoPorUso,
      cobrancaDesde,
      trialEndsAt,
      asaasBoletoUrl: null as string | null,
      asaasBoletoCode: null as string | null,
      faturasEmAberto,
      indiqueEGanhe: indique,
    };
  }

  // Taxas de serviço já acumuladas no mês (R$ 50 por semana de tráfego pago,
  // R$ 100 por totem).
  //
  // Esta função ignorava as duas: o lojista com campanha ativa via "Pendente
  // R$ 100,00" o mês inteiro e recebia um boleto de R$ 300,00 no dia 1 — a
  // primeira vez que o número aparecia para ele. O fechamento sempre somou as
  // taxas (ver `taxasExtras`), então painel e fatura divergiam por construção,
  // que é justamente o que o comentário acima promete que não acontece mais.
  const trafegoPago = cycle.metaAdsFee ?? 0;
  const totem = cycle.totemFee ?? 0;
  // Bill neste mês (ativo em algum momento = o mês inteiro) — a mesma
  // conta que o fechamento põe no boleto.
  const { cobrancaDoAssessorNoMes } = await import("@/lib/assessor/assinatura");
  const intervaloDoCiclo = intervaloDoMes(cycle.yearMonth, tz);
  const assessor = await cobrancaDoAssessorNoMes(franchiseeId, intervaloDoCiclo.monthStart, intervaloDoCiclo.monthEnd);
  const taxasDoCiclo = trafegoPago + totem + lojasExtras.valor + assessor;

  const calculada = emTeste ? 0 : Math.max(cycle.amountDue, devidoAgora);
  const indique = emTeste ? SEM_INDIQUE : await indiqueDoMes(Math.max(0, calculada - cycle.amountOffset));
  const mensalidadePrevista = indique.isenta ? 0 : calculada;
  // O abatimento de pagamentos online desconta a MENSALIDADE, não as taxas —
  // mesma conta do fechamento, para o painel bater com o boleto. O crédito do
  // Indique e Ganhe também.
  const mensalidadePendente = Math.max(0, mensalidadePrevista - cycle.amountOffset - indique.abate);

  return {
    yearMonth: cycle.yearMonth,
    totalSales: vendasDoMes,
    vendasA1PorCento,
    amountDue: parseFloat((mensalidadePrevista + taxasDoCiclo).toFixed(2)),
    amountOffset: cycle.amountOffset,
    amountPending: parseFloat((mensalidadePendente + taxasDoCiclo).toFixed(2)),
    // Discriminado para o painel poder mostrar a linha em vez de só inflar o
    // total — "por que subiu R$ 200?" tem que ter resposta na tela.
    mensalidadePrevista,
    taxas: { trafegoPago, totem, lojasExtras: lojasExtras.valor, assessor },
    lojasExtras,
    status: cycle.status,
    isExempt: false,
    emTeste,
    asaasBoletoUrl: cycle.asaasBoletoUrl,
    asaasBoletoCode: cycle.asaasBoletoCode,
    cobrancaPorUso: previsaoPorUso,
    // De onde a base começa a contar neste mês (fim do teste, quando ele cai
    // no meio do mês) — para o painel dizer "a partir de dd/mm" em vez de
    // mostrar um valor que não bate com as vendas do mês.
    cobrancaDesde,
    trialEndsAt,
    faturasEmAberto,
    indiqueEGanhe: indique,
  };
}

export type VisaoDoCiclo = Awaited<ReturnType<typeof getCurrentCycleView>>;

/**
 * O que o fechamento de um mês QUE JÁ ACABOU vai cobrar, sem gravar nada — a
 * conta de `closeBillingCycle` (mesma base, mesmo uso, mesmas lojas extras e
 * taxas do ciclo). Serve para o DRE no intervalo entre o fim do mês e o cron
 * de fechamento (madrugada do dia 1): o `amountDue` gravado só é refeito nos
 * fluxos próprios e sem o mínimo por uso, e loja só de marketplace pode nem
 * ter a linha do ciclo ainda.
 */
export async function previsaoDoFechamento(franchiseeId: string, yearMonth: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ...CAMPOS_DA_ISENCAO, storeTimezone: true, trialEndsAt: true, ifoodConnected: true, food99Connected: true },
  });
  const cycle = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    select: { metaAdsFee: true, totemFee: true },
  });
  const nada = { mensalidade: 0, lojasExtras: 0, outrosServicos: 0, custo: 0, isenta: false, totalSales: 0 };
  if (lojaIsenta(user)) return { ...nada, isenta: true };

  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth, tz);
  const inicio = inicioDaCobranca(monthStart, monthEnd, user?.trialEndsAt);
  const { cobrancaDoAssessorNoMes } = await import("@/lib/assessor/assinatura");
  const outrosServicos = (cycle?.metaAdsFee ?? 0) + (cycle?.totemFee ?? 0) + (await cobrancaDoAssessorNoMes(franchiseeId, monthStart, monthEnd));
  if (inicio === null) {
    // Teste no mês inteiro: mensalidade e lojas extras perdoadas; tráfego e
    // totem são serviço prestado e o fechamento cobra.
    return { ...nada, outrosServicos, custo: parseFloat(outrosServicos.toFixed(2)) };
  }
  const agg = await prisma.customerOrder.aggregate({
    where: { franchiseeId, ...VENDAS_QUE_CONTAM, createdAt: { gte: inicio, lt: monthEnd } },
    _sum: CAMPOS_DO_BRUTO,
  });
  const totalSales = faturamentoBruto(agg._sum);
  const hasUsage = totalSales > 0 || (await detectarUsoDaLoja(franchiseeId, inicio, monthEnd)).usou;
  const antes = await vendasAntesDaVirada(franchiseeId, yearMonth, inicio, monthEnd);
  const mensalidade = hasUsage ? calcMensalidade(totalSales, hasUsage, yearMonth, antes).mensalidade : 0;
  const lojasExtras = (await lojasExtrasDeMarketplace(franchiseeId, user)).total;
  const custo = mensalidade + lojasExtras + outrosServicos;
  // Abaixo de R$ 1 o fechamento não emite boleto (ver closeBillingCycle).
  if (custo < 1) return { ...nada, totalSales };
  return { mensalidade, lojasExtras, outrosServicos, custo: parseFloat(custo.toFixed(2)), isenta: false, totalSales };
}

/**
 * Os pedidos que formam a base da mensalidade do mês corrente — a MESMA
 * janela (`inicioDaCobranca` até o fim do mês) e o mesmo filtro
 * (VENDAS_QUE_CONTAM) de `getCurrentCycleView`: somados pelo bruto, dão o
 * `totalSales` que a aba Mensalidade mostra.
 *
 * A janela "Detalhes da Cobrança" listava os pedidos do PERÍODO do DRE e
 * chamava isso de "Vendas registradas no ciclo" (Ragnar, 11/10/2026:
 * R$ 67.904,20 na janela × R$ 128.121,52 no cartão da mesma tela).
 */
export async function pedidosDoCicloAtual(franchiseeId: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeTimezone: true, trialEndsAt: true },
  });
  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const yearMonth = getCurrentYearMonth(0, tz);
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth, tz);
  const inicio = inicioDaCobranca(monthStart, monthEnd, user?.trialEndsAt);
  if (!inicio) return { yearMonth, desde: null as string | null, pedidos: [] };

  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId, ...VENDAS_QUE_CONTAM, createdAt: { gte: inicio, lt: monthEnd } },
    select: {
      id: true, createdAt: true, status: true, totalAmount: true, discountTotal: true,
      customerName: true, paymentMethod: true, dailyOrderNumber: true, ifoodReference: true,
      openDeliveryReference: true, source: true, ifoodOrderId: true, openDeliveryChannel: true, openDeliveryOrderId: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    yearMonth,
    desde: inicio.toISOString() as string | null,
    pedidos: pedidos.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      // A base da mensalidade é o BRUTO (faturamentoBruto, acima).
      bruto: faturamentoBruto(p),
      // 1% antes de 04/10/2026, 2% depois (lib/firehub-billing.ts).
      percentual: percentualDaVenda(p.createdAt),
    })),
  };
}
