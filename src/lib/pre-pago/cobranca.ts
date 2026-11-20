/**
 * A COBRANÇA DO PLANO PRÉ-PAGO (contas criadas a partir de 23/11/2026,
 * lib/modelo-de-cobranca.ts) — ativação no fim do teste e renovação na mesma
 * data todo mês.
 *
 * Cada cobrança é uma linha de FranchiseeBillingCycle, como a mensalidade de
 * sempre, para o resto do sistema funcionar igual: o webhook e a conferência
 * do Asaas dão baixa (lib/pagamento-da-mensalidade.ts, "billing:<id>"), a
 * faixa e a tela de bloqueio do painel leem o ciclo em aberto, o portal do
 * parceiro vê a comissão. O que muda é a data: `dueDate` = vencimento da loja e
 * `notes` começa com a marca do pré-pago (lib/prazo-da-mensalidade.ts decide o
 * bloqueio por eles). `yearMonth` = mês do vencimento em Brasília — a
 * renovação é mensal, então é um por mês.
 *
 * Regras do Douglas (20/11/2026):
 * - ativação = R$ 200 no fim do teste, sem tolerância ("é o start");
 * - renovação = R$ 200 até R$ 10 mil vendidos no período que terminou, R$ 400
 *   acima; a cobrança sai 5 dias antes; venceu, 5 dias de tolerância; pagou
 *   atrasado, a data seguinte NÃO muda (conta sempre da ativação);
 * - módulos pagos, lojas extras de marketplace, tráfego e totem entram na
 *   renovação, pelo que foi usado no período que terminou (os módulos cobram
 *   do jeito de sempre: ligado em algum dia fora do teste = inteiro).
 * - sem multa e sem juros (Termos 4.14).
 */
import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";
import { prepararAvisoDoBoleto } from "@/lib/aviso-do-boleto";
import { splitDoBoletoNoAsaas, TETO_DE_SPLIT } from "@/lib/parceiro/regras";
import { marcarSplitRecusado } from "@/lib/embaixador-do-curso";
import { lojaIsenta, lojasExtrasDeMarketplace, vendasQueContam } from "@/lib/billing";
import { dataDaRenovacao, modeloDaLoja, PRE_PAGO, valorDaRenovacao } from "@/lib/modelo-de-cobranca";
import { anualCobreOMes } from "@/lib/plano-anual";
import { AVISO_ANTES_DO_PRE_PAGO_DIAS, diaEmBrasilia, MARCA_DA_ATIVACAO, MARCA_DA_RENOVACAO, MARCA_DO_PRE_PAGO } from "@/lib/prazo-da-mensalidade";

const DIA = 86_400_000;
const fmt = (v: number) => `R$${v.toFixed(2)}`;

/** "2026-12" do vencimento, em Brasília. */
const mesDoVencimento = (venc: Date) => diaEmBrasilia(venc).slice(0, 7);
const mesAnterior = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

type Proxima = { tipo: "ATIVACAO" | "RENOVACAO"; vencimento: Date; periodoAnterior: { de: Date; ate: Date } | null };

/**
 * A próxima cobrança da loja: sem nenhuma, a ativação vence no fim do teste;
 * com alguma, a renovação vence um mês depois da ATIVAÇÃO × n (a data não anda
 * com pagamento atrasado). Devolve também o período que terminou (para medir
 * a venda e os módulos).
 */
export async function proximaCobranca(lojaId: string, fimDoTeste: Date, tz: string): Promise<Proxima> {
  const ciclos = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId: lojaId, notes: { startsWith: MARCA_DO_PRE_PAGO }, dueDate: { not: null } },
    orderBy: { dueDate: "asc" },
    select: { dueDate: true, notes: true },
  });
  if (ciclos.length === 0) return { tipo: "ATIVACAO", vencimento: fimDoTeste, periodoAnterior: null };
  const ativacao = ciclos.find((c) => c.notes!.startsWith(MARCA_DA_ATIVACAO)) || ciclos[0];
  const base = new Date(ativacao.dueDate!);
  const ultima = new Date(ciclos[ciclos.length - 1].dueDate!);
  let n = 1;
  let venc = dataDaRenovacao(base, n, tz);
  while (venc <= ultima) venc = dataDaRenovacao(base, ++n, tz);
  return { tipo: "RENOVACAO", vencimento: venc, periodoAnterior: { de: ultima, ate: venc } };
}

type Linha = { texto: string; valor: number };

/** O que vai na cobrança. Sem banco do Asaas: dá para simular. */
export async function montarCobranca(lojaId: string, prox: Proxima, loja: { ifoodConnected?: boolean | null; food99Connected?: boolean | null; onboardingData?: unknown }) {
  // Tráfego pago e totem caem no ciclo do mês do calendário (rotas do Meta Ads
  // e o fechamento): cada mês entra UMA vez, na cobrança emitida no mês seguinte.
  const doMesAnterior = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId: lojaId, yearMonth: mesAnterior(mesDoVencimento(prox.vencimento)) } },
    select: { metaAdsFee: true, totemFee: true },
  });
  const taxas: Linha[] = [];
  if ((doMesAnterior?.metaAdsFee || 0) > 0) taxas.push({ texto: "Tráfego pago", valor: doMesAnterior!.metaAdsFee });
  if ((doMesAnterior?.totemFee || 0) > 0) taxas.push({ texto: "Totem", valor: doMesAnterior!.totemFee });

  if (prox.tipo === "ATIVACAO") {
    return { base: 0, mensalidade: PRE_PAGO.VALOR_DA_ATIVACAO, linhas: [{ texto: "Ativação do plano (1º mês)", valor: PRE_PAGO.VALOR_DA_ATIVACAO }, ...taxas] as Linha[] };
  }
  const { de, ate } = prox.periodoAnterior!;
  const base = await vendasQueContam(lojaId, de, ate);
  // Renovação coberta por um plano anual pago (lib/plano-anual.ts): a mensalidade
  // já foi paga; módulos, lojas extras e taxas seguem.
  const noAnual = anualCobreOMes(loja.onboardingData, mesDoVencimento(prox.vencimento));
  const mensalidade = noAnual ? 0 : valorDaRenovacao(base);
  const linhas: Linha[] = [noAnual
    ? { texto: "Mensalidade paga no plano anual", valor: 0 }
    : { texto: `Mensalidade (vendeu ${fmt(base)} no período)`, valor: mensalidade }];

  const modulos: [string, () => Promise<number>][] = [
    ["Bill, seu assessor", async () => (await import("@/lib/assessor/assinatura")).cobrancaDoAssessorNoMes(lojaId, de, ate)],
    ["Aplicativo da loja", async () => (await import("@/lib/app-da-loja/plano")).cobrancaDoAppNoMes(lojaId, de, ate)],
    ["Multimarcas", async () => (await import("@/lib/multimarcas/assinatura")).cobrancaDoMultimarcasNoMes(lojaId, de, ate)],
    ["Rota automática", async () => (await import("@/lib/roteirizacao-automatica/assinatura")).cobrancaDaRotaAutomaticaNoMes(lojaId, de, ate)],
    ["Tablet na mesa", async () => (await import("@/lib/tablet-da-mesa/assinatura")).cobrancaDoTabletNoMes(lojaId, de, ate)],
    ["Balança", async () => (await import("@/lib/balanca/assinatura")).cobrancaDaBalancaNoMes(lojaId, de, ate)],
    ["Caixa de mercado", async () => (await import("@/lib/caixa-mercado/assinatura")).cobrancaDoCaixaNoMes(lojaId, de, ate)],
    ["Cotação automática", async () => (await import("@/lib/cotacao/assinatura")).cobrancaDaCotacaoNoMes(lojaId, de, ate)],
    ["FireCheck", async () => (await import("@/lib/firecheck-modulos/assinatura")).cobrancaDoFirecheckNoMes(lojaId, de, ate)],
    ["Reservas de mesa", async () => (await import("@/lib/reservas/assinatura")).cobrancaDasReservasNoMes(lojaId, de, ate)],
  ];
  for (const [nome, conta] of modulos) {
    const v = await conta().catch((e) => { console.error(`[Pré-pago] ${nome} da loja ${lojaId}: ${e?.message}`); return 0; });
    if (v > 0) linhas.push({ texto: nome, valor: v });
  }

  const extras = await lojasExtrasDeMarketplace(lojaId, loja);
  if (extras.total > 0) linhas.push({ texto: `Lojas extras de marketplace (${extras.linhas.join(", ")})`, valor: extras.total });

  return { base, mensalidade, linhas: [...linhas, ...taxas] };
}

export type ResultadoDaEmissao = { ok: boolean; motivo: string; cicloId?: string; valor?: number; url?: string | null };

/**
 * Emite (uma vez) a próxima cobrança da loja, se já está na janela: 5 dias
 * antes do vencimento. `forcar` = o lojista pediu pelo botão (ativação na hora).
 */
export async function emitirCobrancaPrePaga(lojaId: string, opcoes: { forcar?: boolean; agora?: Date } = {}): Promise<ResultadoDaEmissao> {
  const agora = opcoes.agora || new Date();
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    include: { ambassador: true, vendedor: true, accountGroup: { select: { createdAt: true } } },
  });
  if (!loja) return { ok: false, motivo: "loja não existe" };
  if (modeloDaLoja(loja.createdAt, loja.accountGroup?.createdAt) !== "PRE_PAGO") return { ok: false, motivo: "não é do plano pré-pago" };
  if (lojaIsenta(loja)) return { ok: false, motivo: "isenta" };

  const tz = loja.storeTimezone || "America/Sao_Paulo";
  const fimDoTeste = loja.trialEndsAt ? new Date(loja.trialEndsAt) : new Date(loja.createdAt.getTime() + 15 * DIA);
  let prox = await proximaCobranca(lojaId, fimDoTeste, tz);
  // Ativação depois do fim do teste (a loja não usou e ativou pelo botão, ou a
  // varredura atrasou): o mês começa agora, senão ela pagaria por dias que já
  // passaram. A data das renovações sai daqui.
  if (prox.tipo === "ATIVACAO" && prox.vencimento < agora) prox = { ...prox, vencimento: agora };
  const janela = new Date(prox.vencimento.getTime() - AVISO_ANTES_DO_PRE_PAGO_DIAS * DIA);
  if (!opcoes.forcar && agora < janela) return { ok: false, motivo: `fora da janela (abre em ${janela.toISOString()})` };
  // O lojista só antecipa a ATIVAÇÃO; renovação segue a data.
  if (opcoes.forcar && prox.tipo !== "ATIVACAO" && agora < janela) return { ok: false, motivo: "renovação ainda não abriu" };

  const yearMonth = mesDoVencimento(prox.vencimento);
  const existente = await prisma.franchiseeBillingCycle.findUnique({ where: { franchiseeId_yearMonth: { franchiseeId: lojaId, yearMonth } } });
  if (existente?.notes?.startsWith(MARCA_DO_PRE_PAGO)) return { ok: false, motivo: "já emitida", cicloId: existente.id };

  const { base, mensalidade, linhas } = await montarCobranca(lojaId, prox, loja);
  const total = parseFloat(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2));
  const marca = prox.tipo === "ATIVACAO" ? MARCA_DA_ATIVACAO : MARCA_DA_RENOVACAO;
  const descricao = `FireHub — ${prox.tipo === "ATIVACAO" ? "ativação" : "renovação"} (uso a partir de ${diaEmBrasilia(prox.vencimento).split("-").reverse().join("/")}) — ${linhas.map((l) => `${l.texto} ${fmt(l.valor)}`).join(" + ")}`;

  // Grava ANTES do Asaas (o id vai na referência). Linha do mês criada pelo
  // tráfego/totem (OPEN, sem marca) vira esta cobrança e guarda as taxas dela.
  const dados = {
    totalSales: base, planPercent: 0, amountDue: mensalidade, amountPending: total, amountOffset: 0,
    status: "CLOSED", closedAt: agora, dueDate: prox.vencimento,
    notes: `${marca} | ${linhas.map((l) => `${l.texto} ${fmt(l.valor)}`).join(" + ")}`,
  };
  // Nada a pagar (mensalidade no plano anual e nenhum item à parte): fica a
  // linha da renovação, paga, para a próxima data seguir contando dela.
  if (total < 1) Object.assign(dados, { status: "PAID", amountPending: 0 });
  const ciclo = existente
    ? await prisma.franchiseeBillingCycle.update({ where: { id: existente.id }, data: dados })
    : await prisma.franchiseeBillingCycle.create({ data: { franchiseeId: lojaId, yearMonth, ...dados } });
  if (total < 1) return { ok: true, motivo: "renovação sem nada a pagar (plano anual)", cicloId: ciclo.id, valor: 0, url: null };

  const chave = getAsaasKey();
  if (!chave || !loja.cpfCnpj) {
    console.error(`[Pré-pago] ${loja.storeName || lojaId}: cobrança ${ciclo.id} gravada SEM boleto (${!chave ? "sem chave do Asaas" : "loja sem CPF/CNPJ"}).`);
    return { ok: true, motivo: "gravada sem boleto", cicloId: ciclo.id, valor: total, url: null };
  }
  const BASE = chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
  const h = { "Content-Type": "application/json", access_token: chave };

  let cliente: string | null = null;
  const busca = await fetch(`${BASE}/customers?cpfCnpj=${encodeURIComponent(loja.cpfCnpj)}`, { headers: h });
  if (busca.ok) cliente = (await busca.json()).data?.[0]?.id || null;
  if (!cliente) {
    const cr = await fetch(`${BASE}/customers`, { method: "POST", headers: h, body: JSON.stringify({ name: loja.name, email: loja.email, cpfCnpj: loja.cpfCnpj }) });
    if (cr.ok) cliente = (await cr.json()).id;
  }
  if (!cliente) {
    console.error(`[Pré-pago] ${loja.storeName || lojaId}: não deu para achar/criar o cliente no Asaas — cobrança ${ciclo.id} sem boleto.`);
    return { ok: true, motivo: "gravada sem boleto (cliente Asaas)", cicloId: ciclo.id, valor: total, url: null };
  }
  await prepararAvisoDoBoleto(BASE, chave, cliente, loja);

  // Vencimento no Asaas: o dia (Brasília); já passou (ativação forçada atrasada) = hoje.
  const hoje = diaEmBrasilia(agora);
  const diaDoVencimento = diaEmBrasilia(prox.vencimento) < hoje ? hoje : diaEmBrasilia(prox.vencimento);
  const payload: any = {
    customer: cliente,
    // A loja escolhe na página do Asaas: Pix, boleto ou cartão.
    billingType: "UNDEFINED",
    value: total,
    dueDate: diaDoVencimento,
    description: descricao.slice(0, 500),
    externalReference: `billing:${ciclo.id}`,
  };
  const comissao = splitDoBoletoNoAsaas({ ambassadorId: loja.ambassadorId ?? null, vendedorId: loja.vendedorId ?? null, ambassador: loja.ambassador ?? null, vendedor: loja.vendedor ?? null });
  if (comissao.acimaDoTeto) console.error(`[Pré-pago] Split de ${comissao.total}% na cobrança ${ciclo.id} acima do teto de ${TETO_DE_SPLIT}% — emitida SEM split.`);
  else if (comissao.split.length > 0) payload.split = comissao.split;

  const emitir = () => fetch(`${BASE}/payments`, { method: "POST", headers: h, body: JSON.stringify(payload) });
  let pr = await emitir();
  if (!pr.ok && pr.status >= 400 && pr.status < 500 && payload.split) {
    const recusa = await pr.text().catch(() => "");
    const carteiras: string[] = payload.split.map((s: any) => s.walletId).filter(Boolean);
    delete payload.split;
    pr = await emitir();
    console.error(`[Pré-pago] Asaas recusou o split na cobrança ${ciclo.id} — emitida SEM split. Recusa: ${recusa.slice(0, 300)}`);
    if (pr.ok) await marcarSplitRecusado(carteiras);
  }
  if (!pr.ok) {
    console.error(`[Pré-pago] Asaas recusou a cobrança ${ciclo.id}: ${(await pr.text().catch(() => "")).slice(0, 300)}`);
    return { ok: true, motivo: "gravada sem boleto (Asaas recusou)", cicloId: ciclo.id, valor: total, url: null };
  }
  const pd = await pr.json();
  const url = pd.invoiceUrl || pd.bankSlipUrl || null;
  await prisma.franchiseeBillingCycle.update({ where: { id: ciclo.id }, data: { asaasPaymentId: pd.id, asaasBoletoUrl: url, asaasBoletoCode: pd.barCode || null } });
  console.log(`[Pré-pago] ${loja.storeName || lojaId}: ${prox.tipo} ${fmt(total)} vence ${diaDoVencimento} (${pd.id}).`);
  return { ok: true, motivo: "emitida", cicloId: ciclo.id, valor: total, url };
}

/**
 * A varredura (cron das mensalidades, a cada 30 min): toda conta pré-paga na
 * janela de cobrança. Ativação automática só para quem USOU no teste (tem
 * produto no cardápio ou pedido); quem não usou ativa pelo botão da tela.
 */
export async function emitirCobrancasPrePagas(agora: Date = new Date()): Promise<{ emitidas: number; erros: number; log: string[] }> {
  const { VIRADA_DO_PRE_PAGO } = await import("@/lib/modelo-de-cobranca");
  // Lojas extras de contas antigas (criadas depois da virada, mas seguem a
  // principal) saem em emitirCobrancaPrePaga, pelo modeloDaLoja.
  const lojas = await prisma.user.findMany({
    where: { role: "FRANCHISEE", ownerId: null, createdAt: { gte: VIRADA_DO_PRE_PAGO } },
    select: { id: true, storeName: true },
  });
  const log: string[] = [];
  let emitidas = 0, erros = 0;
  for (const l of lojas) {
    try {
      const jaTem = (await prisma.franchiseeBillingCycle.count({ where: { franchiseeId: l.id, notes: { startsWith: MARCA_DO_PRE_PAGO } } })) > 0;
      if (!jaTem) {
        const usou = (await prisma.menuProduct.count({ where: { franchiseeId: l.id } }).catch(() => 0)) > 0
          || (await prisma.customerOrder.count({ where: { franchiseeId: l.id } })) > 0;
        if (!usou) continue;
      }
      const r = await emitirCobrancaPrePaga(l.id, { agora });
      if (r.motivo.startsWith("emitida") || r.motivo.startsWith("gravada")) { emitidas++; log.push(`${l.storeName || l.id}: ${r.motivo} ${r.valor ?? ""}`); }
    } catch (e: any) {
      erros++;
      log.push(`${l.storeName || l.id}: ERRO ${e?.message}`);
      console.error(`[Pré-pago] Varredura, loja ${l.id}: ${e?.message}`);
    }
  }
  return { emitidas, erros, log };
}
