/**
 * lib/billing.ts
 *
 * Motor de faturamento "Use First, Pay Later" — 100% automático.
 *
 * Regra:
 *   Taxa = 1% do faturamento mensal do franqueado
 *   Mínimo: R$50 · Máximo: R$400
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
import { calcMensalidade } from "@/lib/firehub-billing";
import { getAsaasKey } from "@/lib/asaas";

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
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  now.setMonth(now.getMonth() + offset);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
 * Chamada quando um CustomerOrder é confirmado (ACEITO / ENTREGUE / qualquer status não cancelado).
 *
 * Recalcula totalSales do mês inteiro e atualiza amountDue em tempo real.
 * O franqueado vê imediatamente quanto deve no painel financeiro.
 */
export async function trackSaleForBilling(franchiseeId: string) {
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { email: true, planPercent: true, storeTimezone: true, isFranqueadoHakim: true },
  });

  const tz = user?.storeTimezone || "America/Sao_Paulo";
  const yearMonth = getCurrentYearMonth(0, tz);

  await ensureCycle(franchiseeId, yearMonth);

  const isExempt = isExemptAccount(user?.email) || user?.planPercent === 0 || user?.isFranqueadoHakim === true || user?.email?.toLowerCase() === "contatohakim@gmail.com";

  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m, 1);

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      status: { not: "CANCELADO" },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { totalAmount: true },
  });

  const totalSales = agg._sum.totalAmount ?? 0;
  const { mensalidade: amountDue } = calcMensalidade(totalSales);
  const pendingVal = isExempt ? 0 : amountDue;

  await prisma.franchiseeBillingCycle.update({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    data: { totalSales, amountDue, amountPending: pendingVal },
  });

  console.log(
    `[Billing] ${franchiseeId} ${yearMonth} | Vendas=${totalSales.toFixed(2)} Devido=${amountDue.toFixed(2)} Pendente=${pendingVal}`
  );
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
          ambassador: true,
          referredBy: {
            include: {
              referredBy: {
                include: {
                  referredBy: true,
                },
              },
            },
          },
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
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m, 1);

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      status: { not: "CANCELADO" },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { totalAmount: true },
  });

  const totalSales = agg._sum.totalAmount ?? 0;
  
  let hasUsage = totalSales > 0;
  let motivosUso: string[] = hasUsage ? ["vendas no mês"] : [];
  if (!hasUsage && !isSpecialStore) {
    const uso = await detectarUsoDaLoja(franchiseeId, monthStart, monthEnd);
    hasUsage = uso.usou;
    motivosUso = uso.motivos;
  }

  // Período de teste isenta APENAS a cobrança que nasce do uso sem venda.
  //
  // Quem vendeu pelo sistema paga sobre o que vendeu, em teste ou não — é o
  // trato do "use first, pay later", e mexer nisso tiraria do faturamento
  // lojas que já vendem (a Pastel da Paulista faturou R$ 3.782 num mês em que
  // tinha benefício concedido). O teste serve para o lojista experimentar sem
  // levar boleto por ter ligado o robô, não para vender de graça.
  const trialAte = cycle.franchisee?.trialEndsAt;
  const emTeste = !!trialAte && trialAte > new Date();
  const isentoPorTeste = emTeste && totalSales === 0;

  const { mensalidade: amountDue } = calcMensalidade(totalSales, hasUsage);
  const amountPending = isSpecialStore ? 0 : parseFloat(Math.max(0, amountDue - cycle.amountOffset).toFixed(2));

  let ifoodExtraCharge = 0;
  if (!isSpecialStore) {
    const ifoodIntegCount = await prisma.ifoodIntegration.count({
      where: { userId: franchiseeId, active: true },
    });
    const legacyIfood = cycle.franchisee?.ifoodConnected ? 1 : 0;
    const totalIfood = Math.max(ifoodIntegCount, legacyIfood);
    ifoodExtraCharge = Math.max(0, totalIfood - 1) * 50;
  }

  // Nada a cobrar, loja isenta, ou ainda dentro do período de teste
  if (amountPending < 1 || (!hasUsage) || isSpecialStore || isentoPorTeste) {
    await prisma.franchiseeBillingCycle.update({
      where: { id: cycle.id },
      data: {
        totalSales, amountDue: 0, amountPending: 0, status: "PAID", closedAt: new Date(),
        // Fica gravado por que não cobrou. Sem isto, "por que essa loja não foi
        // cobrada?" vira arqueologia toda vez.
        notes: isSpecialStore ? "Isento (loja oficial/própria)."
          : isentoPorTeste ? `Em período de teste até ${trialAte?.toLocaleDateString("pt-BR")}, sem vendas no mês. Uso detectado: ${motivosUso.join(", ") || "nenhum"}.`
          : !hasUsage ? "Não usou nenhuma funcionalidade no mês."
          : "Valor abaixo do mínimo de cobrança.",
      },
    });
    return {
      charged: false,
      amountPending: 0,
      message: isSpecialStore ? "Isento (loja oficial / própria)."
        : isentoPorTeste ? "Em período de teste, sem vendas — nada cobrado."
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

      const chargeDescription = ifoodExtraCharge > 0
        ? `FireHub ${yearMonth} — Mensalidade R$${amountDue.toFixed(2)} + iFood Extra R$${ifoodExtraCharge.toFixed(2)}`
        : `FireHub ${yearMonth} — Taxa de plataforma (1% · mín R$50 · máx R$400)`;

      const payload: any = {
        customer: customerId,
        billingType: "BOLETO",
        value: amountPending,
        dueDate: due,
        description: chargeDescription,
        externalReference: `billing:${cycle.id}`,
      };

      if (cycle.franchisee?.ambassador?.active && cycle.franchisee?.ambassador?.asaasWalletId) {
        payload.split = [
          {
            walletId: cycle.franchisee.ambassador.asaasWalletId,
            percentualValue: cycle.franchisee.ambassador.commissionPercent,
          }
        ];
      } else {
        // Multi-level split for Indique e Ganhe
        const splits = [];
        
        const level1 = cycle.franchisee?.referredBy;
        if (level1?.asaasWalletId) {
          splits.push({ walletId: level1.asaasWalletId, percentualValue: 20 });
        }
        
        const level2 = level1?.referredBy;
        if (level2?.asaasWalletId) {
          splits.push({ walletId: level2.asaasWalletId, percentualValue: 3 });
        }
        
        const level3 = level2?.referredBy;
        if (level3?.asaasWalletId) {
          splits.push({ walletId: level3.asaasWalletId, percentualValue: 1 });
        }
        
        if (splits.length > 0) {
          payload.split = splits;
        }
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
      amountDue,
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
      status: "PAID",
      isExempt: true,
    };
  }

  // Sem venda no mês, o valor devido só aparecia no fechamento — o lojista via
  // R$ 0,00 o mês inteiro e recebia um boleto do mínimo no fim. Aqui a previsão
  // já mostra o mínimo assim que ele usa alguma funcionalidade, com o motivo,
  // para a cobrança nunca ser surpresa.
  const vendasDoMes = cycle?.totalSales || 0;
  const emTeste = !!user?.trialEndsAt && user.trialEndsAt > new Date();
  let previsaoPorUso: { valor: number; motivos: string[] } | null = null;
  if (vendasDoMes === 0 && !emTeste) {
    const [ano, mes] = yearMonth.split("-").map(Number);
    const uso = await detectarUsoDaLoja(franchiseeId, new Date(ano, mes - 1, 1), new Date(ano, mes, 1));
    if (uso.usou) {
      previsaoPorUso = { valor: calcMensalidade(0, true).mensalidade, motivos: uso.motivos };
    }
  }

  if (!cycle) {
    return {
      yearMonth, totalSales: 0,
      amountDue: previsaoPorUso?.valor || 0,
      amountOffset: 0,
      amountPending: previsaoPorUso?.valor || 0,
      status: "OPEN", isExempt: false,
      cobrancaPorUso: previsaoPorUso,
    };
  }

  return {
    yearMonth: cycle.yearMonth,
    totalSales: cycle.totalSales,
    amountDue: Math.max(cycle.amountDue, previsaoPorUso?.valor || 0),
    amountOffset: cycle.amountOffset,
    amountPending: Math.max(cycle.amountPending, previsaoPorUso?.valor || 0),
    status: cycle.status,
    isExempt: false,
    asaasBoletoUrl: cycle.asaasBoletoUrl,
    asaasBoletoCode: cycle.asaasBoletoCode,
    cobrancaPorUso: previsaoPorUso,
  };
}
