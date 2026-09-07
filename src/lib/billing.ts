/**
 * lib/billing.ts
 *
 * Motor de faturamento "Use First, Pay Later" — 100% automático.
 *
 * Regra:
 *   Taxa = 1% do faturamento mensal do franqueado
 *   Mínimo: R$100 · Máximo: R$400
 *
 * Base de cálculo: soma do valor BRUTO (totalAmount + discountTotal, ver
 * faturamentoBruto abaixo) do mês dos pedidos que são
 * venda de verdade (ver VENDAS_QUE_CONTAM abaixo). Isso inclui TODA origem
 * gravada como CustomerOrder —
 * cardápio digital, chatbot de WhatsApp, mesa, balcão, totem e os pedidos
 * importados das integrações de iFood, 99Food e Jotajá. Não existe filtro por
 * `source` aqui, e é intencional: o trato é 1% de tudo que passa pelo sistema.
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
import { calcMensalidade, FIREHUB_PLAN } from "@/lib/firehub-billing";
import { getAsaasKey } from "@/lib/asaas";

/**
 * Teto de comissão que pode sair de uma mensalidade, somando os dois níveis do
 * programa de embaixadores. O padrão do programa é 20% + 3% = 23%; a folga até
 * 40% existe para os casos negociados à mão (o Victor está em 30% + 3%). Acima
 * disso o boleto sai sem split e o erro vai para o log — é quase certo que
 * alguém errou o número no admin.
 */
const TETO_DE_SPLIT = 40;

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
const VENDAS_QUE_CONTAM = {
  status: { notIn: ["CANCELADO", "CRIANDO_IA"] as string[] },
  NOT: { status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
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
 * Devolve também o motivo, que fica no `notes` do ciclo — quando o lojista
 * perguntar "por que estou pagando se não vendi?", a resposta está gravada.
 */
export async function detectarUsoDaLoja(
  franchiseeId: string,
  monthStart: Date,
  monthEnd: Date
): Promise<{ usou: boolean; motivos: string[] }> {
  const motivos: string[] = [];

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: {
      chatbotConfig: true, ifoodConnected: true, jotajaConnected: true,
      food99Connected: true, metaAdsEnabled: true, fiscalConfig: true,
      printerConfig: true, kdsScreens: true, repasseConfig: true,
    },
  });

  const chatbot = (user?.chatbotConfig as any) || {};
  // `active !== false` porque o robô responde nesse estado — é o mesmo critério
  // que o webhook usa para decidir se atende. Cobrança e atendimento não podem
  // discordar sobre o que é "estar ligado".
  if (chatbot.connected === true || (chatbot.instanceName && chatbot.active !== false)) {
    motivos.push("robô de WhatsApp conectado");
  }
  if (user?.ifoodConnected) motivos.push("integração iFood");
  if (user?.jotajaConnected) motivos.push("integração Jotajá");
  if (user?.food99Connected) motivos.push("integração 99Food");
  if (user?.metaAdsEnabled) motivos.push("Meta Ads");
  if (user?.fiscalConfig) motivos.push("módulo fiscal");
  if (user?.printerConfig || user?.kdsScreens) motivos.push("impressão/KDS");
  if (user?.repasseConfig) motivos.push("repasse automático");

  const noMes = { gte: monthStart, lt: monthEnd };

  const [produtos, consumoIA, contas, caixa, notas, estoque, totem] = await Promise.all([
    prisma.menuProduct.count({ where: { franchiseeId } }),
    prisma.usageLog.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.payable.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.cashSession.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.purchaseInvoice.count({ where: { franchiseeId, createdAt: noMes } }),
    prisma.stockItem.count({ where: { franchiseeId } }),
    prisma.totemLicense.count({ where: { franchiseeId, active: true } }),
  ]);

  if (produtos > 0) motivos.push(`${produtos} produto(s) no cardápio`);
  if (consumoIA > 0) motivos.push(`${consumoIA} uso(s) de IA no mês`);
  if (contas > 0) motivos.push("financeiro (contas a pagar)");
  if (caixa > 0) motivos.push("controle de caixa");
  if (notas > 0) motivos.push("notas de compra");
  if (estoque > 0) motivos.push("controle de estoque");
  if (totem > 0) motivos.push("totem de autoatendimento");

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
    ...bypassEmails,
  ];
  return exemptList.includes(clean);
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
    select: { email: true, planPercent: true },
  });

  const isExempt = isExemptAccount(user?.email) || user?.planPercent === 0;

  return prisma.franchiseeBillingCycle.create({
    data: {
      franchiseeId,
      yearMonth,
      planPercent: isExempt ? 0 : (user?.planPercent ?? 1), // default 1%
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
    select: { email: true, planPercent: true, storeTimezone: true, isFranqueadoHakim: true, trialEndsAt: true },
  });

  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const mes = yearMonth || getCurrentYearMonth(0, tz);

  const cycle = await ensureCycle(franchiseeId, mes);

  const isExempt = isExemptAccount(user?.email) || user?.planPercent === 0 || user?.isFranqueadoHakim === true || user?.email?.toLowerCase() === "contatohakim@gmail.com";

  const { monthStart, monthEnd } = intervaloDoMes(mes, tz);

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      ...VENDAS_QUE_CONTAM,
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: CAMPOS_DO_BRUTO,
  });

  const totalSales = faturamentoBruto(agg._sum);
  const { mensalidade: amountDue } = calcMensalidade(totalSales);

  // As taxas já acumuladas no ciclo (tráfego pago, totem) entram no pendente.
  //
  // Este update SOBRESCREVIA `amountPending` com a mensalidade pura a cada
  // pedido confirmado — apagando, várias vezes por dia, os R$ 50/semana de
  // gestão que o cron do Meta Ads tinha somado ali. O fechamento recalcula tudo
  // e o boleto saía certo, mas as telas de admin que leem esta coluna mostravam
  // um valor menor do que o que a loja ia receber.
  const taxasDoCiclo = (cycle.metaAdsFee ?? 0) + (cycle.totemFee ?? 0);
  const emTeste = !!user?.trialEndsAt && new Date(user.trialEndsAt) > new Date();
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
  const devidoGravado = isExempt ? 0 : amountDue;

  await prisma.franchiseeBillingCycle.update({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth: mes } },
    data: { totalSales, amountDue: devidoGravado, amountPending: pendingVal },
  });

  console.log(
    `[Billing] ${franchiseeId} ${mes} | Vendas=${totalSales.toFixed(2)} Devido=${devidoGravado.toFixed(2)}${isExempt ? " (isenta)" : ""} Pendente=${pendingVal}`
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
          ambassador: { include: { parentAmbassador: true } },
        },
      },
    },
  });

  if (!cycle) throw new Error(`Ciclo ${yearMonth} não encontrado para ${franchiseeId}`);
  if (cycle.status !== "OPEN" && cycle.status !== "PAID") return { charged: false, message: `Ciclo já está ${cycle.status}` };

  const userEmailClean = cycle.franchisee?.email?.toLowerCase().replace(/\s+/g, "");
  const isSpecialStore = isExemptAccount(cycle.franchisee?.email) || cycle.franchisee?.planPercent === 0 || cycle.franchisee?.isFranqueadoHakim === true || userEmailClean === "contatohakim@gmail.com";

  // Recalcula valores finais (pedidos confirmados do mês)
  const [y, m] = yearMonth.split("-").map(Number);
  const tz = cycle.franchisee?.storeTimezone || "America/Sao_Paulo";
  const { monthStart, monthEnd } = intervaloDoMes(yearMonth, tz);

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      ...VENDAS_QUE_CONTAM,
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: CAMPOS_DO_BRUTO,
  });

  const totalSales = faturamentoBruto(agg._sum);

  let hasUsage = totalSales > 0;
  let motivosUso: string[] = hasUsage ? ["vendas no mês"] : [];
  if (!hasUsage && !isSpecialStore) {
    const uso = await detectarUsoDaLoja(franchiseeId, monthStart, monthEnd);
    hasUsage = uso.usou;
    motivosUso = uso.motivos;
  }

  // Período de teste isenta a mensalidade inteira — com venda ou sem.
  //
  // A regra anterior isentava só quem não tinha vendido nada, e isso cobrava
  // exatamente quem estava fazendo o que o teste existe para permitir: a Point
  // Mix vendeu R$ 184,92 experimentando o sistema e recebeu boleto de R$ 100.
  // Pior, o painel do lojista (`getCurrentCycleView`) mostra R$ 0,00 o teste
  // inteiro — o valor só aparecia no boleto. Quem está em teste não recebe
  // fatura; a cobrança começa quando o teste acaba, e aí vale a regra do uso.
  const trialAte = cycle.franchisee?.trialEndsAt;
  // O que vale e o teste DURANTE o mes faturado, nao na hora em que o cron
  // roda. Com `new Date()` aqui a SORRISO CAR — teste ate 02/09, agosto inteiro
  // dentro dele — foi cobrada porque o fechamento de agosto rodou em 03/09, um
  // dia depois. O ciclo e sempre de um mes que ja passou: comparar com "agora"
  // cobra justamente quem passou o mes faturado inteiro em teste e so perdeu o
  // beneficio no intervalo entre o fim do mes e a execucao do fechamento.
  const emTeste = !!trialAte && trialAte >= monthEnd;
  const isentoPorTeste = emTeste;

  const { mensalidade: amountDue } = calcMensalidade(totalSales, hasUsage);

  // Quem NÃO paga mensalidade: loja isenta, quem não usou nada e quem está em
  // teste sem ter vendido. Isto era decidido lá embaixo, no bloco que zera o
  // ciclo inteiro — e era exatamente por isso que as taxas de serviço prestado
  // iam junto (ver o bloco de taxas extras abaixo).
  const mensalidadePerdoada = isSpecialStore || isentoPorTeste || !hasUsage;
  const mensalidadePendente = mensalidadePerdoada ? 0 : Math.max(0, amountDue - cycle.amountOffset);

  // Taxas fixas do mês, por fora do 1% sobre as vendas.
  //
  // A primeira loja integrada a cada marketplace é gratuita; cada loja
  // ADICIONAL ligada na mesma conta custa EXTRA_STORE_FEE por mês. Isto já era
  // anunciado no painel e escrito na descrição do boleto, mas nunca entrava no
  // valor: o payload do Asaas mandava só a mensalidade. Quem tinha três lojas
  // no iFood lia "+ iFood Extra R$100,00" num boleto que não cobrava os R$100.
  let taxasExtras = 0;
  const linhasExtras: string[] = [];

  if (!isSpecialStore && !isentoPorTeste) {
    const ifoodIntegCount = await prisma.ifoodIntegration.count({
      where: { userId: franchiseeId, active: true },
    });
    const legacyIfood = cycle.franchisee?.ifoodConnected ? 1 : 0;
    const lojasIfood = Math.max(ifoodIntegCount, legacyIfood);
    const extraIfood = Math.max(0, lojasIfood - 1) * FIREHUB_PLAN.EXTRA_STORE_FEE;
    if (extraIfood > 0) {
      taxasExtras += extraIfood;
      linhasExtras.push(`iFood +${lojasIfood - 1} loja(s) R$${extraIfood.toFixed(2)}`);
    }

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
    const lojas99 = await contarLojas99(franchiseeId, !!cycle.franchisee?.food99Connected);
    const extra99 = Math.max(0, lojas99 - 1) * FIREHUB_PLAN.EXTRA_STORE_FEE;
    if (extra99 > 0) {
      taxasExtras += extra99;
      linhasExtras.push(`99Food +${lojas99 - 1} loja(s) R$${extra99.toFixed(2)}`);
    }
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
          : "Valor abaixo do mínimo de cobrança.",
      },
    });
    return {
      charged: false,
      amountPending: 0,
      message: isSpecialStore ? "Isento (loja oficial / própria)."
        : isentoPorTeste ? "Em período de teste no mês inteiro — mensalidade isenta."
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
      // Vencimento: dia 5 do próximo mês
      const due = new Date(y, m, 5).toISOString().split("T")[0];

      // A mensalidade só entra na descrição quando existe: com ela perdoada
      // (teste sem venda) e só a taxa de tráfego a cobrar, o boleto dizia
      // "Mensalidade R$0,00 + ...".
      const linhasDaFatura = [
        ...(mensalidadePendente > 0 ? [`Mensalidade R$${mensalidadePendente.toFixed(2)}`] : []),
        ...linhasExtras,
      ];
      const chargeDescription = linhasDaFatura.length > 0
        ? `FireHub ${yearMonth} — ${linhasDaFatura.join(" + ")}`
        : `FireHub ${yearMonth} — Taxa de plataforma (1% · mín R$100 · máx R$400)`;

      const payload: any = {
        customer: customerId,
        billingType: "BOLETO",
        value: amountPending,
        dueDate: due,
        description: chargeDescription,
        externalReference: `billing:${cycle.id}`,
      };

      // ── Comissão de embaixador: dois níveis, nunca mais ──────────────────
      //
      // Nível 1 é quem indicou ESTA loja (`commissionPercent`, 20% de padrão e
      // editável caso a caso no admin). Nível 2 é quem trouxe esse embaixador
      // para o programa (`level2Percent`, 3%). O terceiro nível não existe: a
      // corrente para no `parentAmbassador` de propósito, sem recursão.
      //
      // Os dois percentuais saem do bolo da FireHub, não um do outro: uma loja
      // com rede completa devolve 23% da mensalidade.
      //
      // O ramo antigo do "Indique e Ganhe" entre lojistas (User.referredById,
      // 20/3/1) saiu daqui. O programa foi encerrado para o cliente comum, mas
      // o código continuava pagando: bastava um lojista gravar o próprio
      // asaasWalletId para começar a receber 20% de quem tivesse o ref dele.
      const splits: { walletId: string; percentualValue: number }[] = [];
      const nivel1 = cycle.franchisee?.ambassador;

      if (nivel1?.active && nivel1.asaasWalletId) {
        splits.push({ walletId: nivel1.asaasWalletId, percentualValue: nivel1.commissionPercent });

        const nivel2 = nivel1.parentAmbassador;
        if (nivel2?.active && nivel2.asaasWalletId && nivel2.id !== nivel1.id) {
          splits.push({ walletId: nivel2.asaasWalletId, percentualValue: nivel2.level2Percent ?? 3 });
        }
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
    },
  });

  return { charged: true, amountPending, ifoodExtraCharge, asaasBoletoUrl, message: "Boleto gerado com valor pendente." };
}

/**
 * Retorna o ciclo atual do franqueado para exibir no painel.
 * Se não existe, retorna dados zerados (sem criar no banco).
 */
export async function getCurrentCycleView(franchiseeId: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { email: true, planPercent: true, storeTimezone: true, trialEndsAt: true },
  });

  const isExempt = isExemptAccount(user?.email) || user?.planPercent === 0;
  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const yearMonth = getCurrentYearMonth(0, tz);

  const cycle = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
  });

  if (isExempt) {
    return {
      yearMonth,
      totalSales: cycle?.totalSales || 0,
      amountDue: 0,
      amountOffset: 0,
      amountPending: 0,
      // Mesma forma em todos os retornos, para o painel nunca ter que testar se
      // o campo existe.
      taxas: { trafegoPago: 0, totem: 0 },
      status: "PAID",
      isExempt: true,
    };
  }

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
  const aggVendas = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      ...VENDAS_QUE_CONTAM,
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: CAMPOS_DO_BRUTO,
  });
  const vendasDoMes = faturamentoBruto(aggVendas._sum);

  const emTeste = !!user?.trialEndsAt && user.trialEndsAt > new Date();
  let previsaoPorUso: { valor: number; motivos: string[] } | null = null;
  if (vendasDoMes === 0 && !emTeste) {
    const uso = await detectarUsoDaLoja(franchiseeId, monthStart, monthEnd);
    if (uso.usou) {
      previsaoPorUso = { valor: calcMensalidade(0, true).mensalidade, motivos: uso.motivos };
    }
  }

  // Mesma conta do fechamento, para o painel bater com o boleto.
  const previsaoPorVendas = (vendasDoMes > 0 && !emTeste) ? calcMensalidade(vendasDoMes, true).mensalidade : 0;
  const devidoAgora = emTeste ? 0 : Math.max(previsaoPorVendas, previsaoPorUso?.valor || 0);

  // Loja que só recebe pedido de marketplace nunca passa por `ensureCycle`, e
  // por isso pode não ter linha de ciclo no meio do mês. O valor previsto tem
  // que aparecer do mesmo jeito.
  if (!cycle) {
    return {
      yearMonth, totalSales: vendasDoMes,
      amountDue: devidoAgora,
      amountOffset: 0,
      amountPending: devidoAgora,
      taxas: { trafegoPago: 0, totem: 0 },
      status: "OPEN", isExempt: false,
      cobrancaPorUso: previsaoPorUso,
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
  const taxasDoCiclo = trafegoPago + totem;

  const mensalidadePrevista = emTeste ? 0 : Math.max(cycle.amountDue, devidoAgora);
  // O abatimento de pagamentos online desconta a MENSALIDADE, não as taxas —
  // mesma conta do fechamento, para o painel bater com o boleto.
  const mensalidadePendente = Math.max(0, mensalidadePrevista - cycle.amountOffset);

  return {
    yearMonth: cycle.yearMonth,
    totalSales: vendasDoMes,
    amountDue: parseFloat((mensalidadePrevista + taxasDoCiclo).toFixed(2)),
    amountOffset: cycle.amountOffset,
    amountPending: parseFloat((mensalidadePendente + taxasDoCiclo).toFixed(2)),
    // Discriminado para o painel poder mostrar a linha em vez de só inflar o
    // total — "por que subiu R$ 200?" tem que ter resposta na tela.
    mensalidadePrevista,
    taxas: { trafegoPago, totem },
    status: cycle.status,
    isExempt: false,
    asaasBoletoUrl: cycle.asaasBoletoUrl,
    asaasBoletoCode: cycle.asaasBoletoCode,
    cobrancaPorUso: previsaoPorUso,
  };
}
