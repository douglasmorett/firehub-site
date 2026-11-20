/**
 * lib/plano-anual-no-banco.ts — o anual "pague o ano e economize 2
 * mensalidades" com o banco e o Asaas. A regra mora em lib/plano-anual.ts.
 *
 * Estado em `User.onboardingData.planoAnual` (Json que já existe, sem coluna
 * nova), escrito só nessa chave e serializado por loja — o mesmo jeito da
 * Black November (lib/black-november-no-banco.ts).
 *
 * A cobrança do anual é OUTRA cobrança no Asaas ("anual:<ciclo>"), ao lado da
 * fatura do mês, para o lojista poder escolher: pagou o anual, a fatura do mês
 * fica paga por ele e a cobrança mensal é apagada no Asaas; pagou a mensal, a
 * do anual é apagada (lib/pagamento-da-mensalidade.ts chama
 * `cancelarAnualPendente`).
 */
import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";
import { lojaIsenta } from "@/lib/billing";
import { splitDoBoletoNoAsaas, TETO_DE_SPLIT } from "@/lib/parceiro/regras";
import { marcarSplitRecusado } from "@/lib/embaixador-do-curso";
import { diaEmBrasilia, MARCA_DA_ATIVACAO, vencimentoDoCiclo } from "@/lib/prazo-da-mensalidade";
import {
  aplicarPagamentoDoAnual, CHAVE_DO_PLANO_ANUAL, cicloDaReferenciaDoAnual, lerPlanoAnual, MESES_DO_ANUAL, ofertaDoAnual, PREFIXO_DO_ANUAL,
  type CobrancaDoAnual, type EstadoDoPlanoAnual,
} from "@/lib/plano-anual";

async function gravarEstado(lojaId: string, mudar: (e: EstadoDoPlanoAnual) => EstadoDoPlanoAnual | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `plano-anual:${lojaId}`);
    const u = await tx.user.findUnique({ where: { id: lojaId }, select: { onboardingData: true } });
    const novo = mudar(lerPlanoAnual(u?.onboardingData));
    if (!novo) return null;
    await tx.$executeRawUnsafe(
      `UPDATE "User" SET "onboardingData" = COALESCE("onboardingData", '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb) WHERE id = $3`,
      CHAVE_DO_PLANO_ANUAL, JSON.stringify(novo), lojaId,
    );
    return novo;
  });
}

function baseDoAsaas(chave: string) {
  return chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
}

async function asaas(chave: string, caminho: string, init?: { metodo?: string; corpo?: unknown }) {
  const res = await fetch(`${baseDoAsaas(chave)}${caminho}`, {
    method: init?.metodo || "GET",
    headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "firehub/1.0" },
    body: init?.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const dados: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, dados };
}

export class ErroDoPlanoAnual extends Error {}

/** "Pagar o ano" na fatura em aberto: gera (ou reaproveita) a cobrança do anual e devolve o link. */
export async function cobrarAnualDaFatura(lojaId: string, yearMonth: string) {
  const ciclo = await prisma.franchiseeBillingCycle.findUnique({ where: { franchiseeId_yearMonth: { franchiseeId: lojaId, yearMonth } } });
  if (!ciclo || ciclo.status !== "CLOSED" || ciclo.amountPending <= 0) throw new ErroDoPlanoAnual("Esta fatura não está mais em aberto.");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, include: { ambassador: true, vendedor: true } });
  if (!loja) throw new ErroDoPlanoAnual("Loja não encontrada.");
  const oferta = ofertaDoAnual({
    yearMonth, mensalidade: ciclo.amountDue, valorDaFatura: ciclo.amountPending, isenta: lojaIsenta(loja),
    onboardingData: loja.onboardingData, ativacao: !!ciclo.notes?.startsWith(MARCA_DA_ATIVACAO),
  });
  if (!oferta) throw new ErroDoPlanoAnual("O plano anual não está disponível para esta fatura.");

  const chave = getAsaasKey();
  if (!chave) throw new ErroDoPlanoAnual("O pagamento não está configurado no servidor. Fale com a gente no WhatsApp.");

  // Dois cliques não viram duas cobranças: a pendente do mesmo ciclo e mesmo valor volta.
  const pendente = (lerPlanoAnual(loja.onboardingData).cobrancas || []).find((c) => c.cicloId === ciclo.id && c.status === "PENDENTE" && c.valor === oferta.valor);
  if (pendente) {
    const c = await asaas(chave, `/payments/${pendente.asaasPaymentId}`);
    if (c.ok && c.dados?.status === "PENDING" && !c.dados?.deleted) return { invoiceUrl: pendente.invoiceUrl, reaproveitada: true };
  }

  const doc = String(loja.cpfCnpj || "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    throw new ErroDoPlanoAnual("Para gerar a cobrança, cadastre o CPF ou CNPJ da loja em Minha conta — ou fale com a gente no WhatsApp.");
  }
  let cliente: string | null = null;
  const busca = await asaas(chave, `/customers?cpfCnpj=${doc}`);
  if (busca.ok && busca.dados?.data?.length) cliente = busca.dados.data[0].id;
  if (!cliente) {
    const novo = await asaas(chave, "/customers", { metodo: "POST", corpo: { name: loja.storeName || loja.name, email: loja.email, cpfCnpj: doc } });
    if (!novo.ok || !novo.dados?.id) throw new ErroDoPlanoAnual("O Asaas recusou o cadastro para a cobrança. Fale com a gente no WhatsApp.");
    cliente = novo.dados.id as string;
  }

  const hoje = diaEmBrasilia(new Date());
  const venc = vencimentoDoCiclo(ciclo).dia;
  const corpo: any = {
    customer: cliente,
    billingType: "UNDEFINED", // Pix, boleto ou cartão, na página do Asaas
    value: oferta.valor,
    dueDate: venc < hoje ? hoje : venc,
    description: `FireHub — plano anual: ${MESES_DO_ANUAL} meses de mensalidade (${oferta.de} a ${oferta.ate}) pelo preço de 10, mais os itens da fatura de ${yearMonth}`.slice(0, 500),
    externalReference: `${PREFIXO_DO_ANUAL}${ciclo.id}`,
  };
  // Comissão: a mesma regra da mensalidade (lib/parceiro/regras.ts).
  const comissao = splitDoBoletoNoAsaas({ ambassadorId: loja.ambassadorId ?? null, vendedorId: loja.vendedorId ?? null, ambassador: loja.ambassador ?? null, vendedor: loja.vendedor ?? null });
  if (comissao.acimaDoTeto) console.error(`[Plano anual] Split de ${comissao.total}% no ciclo ${ciclo.id} acima do teto de ${TETO_DE_SPLIT}% — cobrança SEM split.`);
  else if (comissao.split.length > 0) corpo.split = comissao.split;

  let r = await asaas(chave, "/payments", { metodo: "POST", corpo });
  if (!r.ok && r.status >= 400 && r.status < 500 && corpo.split) {
    const carteiras: string[] = corpo.split.map((s: any) => s.walletId).filter(Boolean);
    delete corpo.split;
    console.error(`[Plano anual] Asaas recusou o split no ciclo ${ciclo.id} — emitindo SEM split. Recusa: ${JSON.stringify(r.dados?.errors || r.dados).slice(0, 300)}`);
    r = await asaas(chave, "/payments", { metodo: "POST", corpo });
    if (r.ok) await marcarSplitRecusado(carteiras);
  }
  if (!r.ok || !r.dados?.id || !r.dados?.invoiceUrl) {
    console.error(`[Plano anual] Asaas recusou a cobrança do ciclo ${ciclo.id}: ${JSON.stringify(r.dados?.errors || r.dados).slice(0, 300)}`);
    throw new ErroDoPlanoAnual(r.dados?.errors?.[0]?.description || "O Asaas não gerou a cobrança. Fale com a gente no WhatsApp.");
  }
  const cobranca: CobrancaDoAnual = {
    cicloId: ciclo.id, yearMonth, asaasPaymentId: r.dados.id, invoiceUrl: r.dados.invoiceUrl,
    valor: oferta.valor, criadaEm: new Date().toISOString(), status: "PENDENTE",
  };
  await gravarEstado(lojaId, (e) => ({ ...e, cobrancas: [...(e.cobrancas || []), cobranca] }));
  console.log(`[Plano anual] Cobrança ${cobranca.asaasPaymentId} de R$ ${oferta.valor} para a loja ${lojaId} (ciclo ${yearMonth}).`);
  return { invoiceUrl: cobranca.invoiceUrl, reaproveitada: false };
}

/**
 * Webhook ("anual:<ciclo>") e conferência do cron. Pago: grava o anual, dá
 * baixa na fatura do mês (pela mesma função do boleto mensal, com comissão e
 * Indique e Ganhe) e apaga a cobrança mensal no Asaas.
 */
export async function registrarPagamentoDoAnual(
  pagamento: { id?: string; externalReference?: string | null; status?: string; value?: number | null; netValue?: number | null; paymentDate?: string | null; clientPaymentDate?: string | null; confirmedDate?: string | null; invoiceUrl?: string | null },
  evento?: string | null,
) {
  const cicloId = cicloDaReferenciaDoAnual(pagamento.externalReference);
  if (!cicloId || !pagamento.id) return "SEM_COBRANCA" as const;
  const ciclo = await prisma.franchiseeBillingCycle.findUnique({ where: { id: cicloId } });
  if (!ciclo) return "SEM_COBRANCA" as const;
  const jaPagoPorOutra = ciclo.status === "PAID" && !!ciclo.paidAt;

  const feito: { resultado: ReturnType<typeof aplicarPagamentoDoAnual>["resultado"]; apagar: CobrancaDoAnual[] } = { resultado: "SEM_MUDANCA", apagar: [] };
  await gravarEstado(ciclo.franchiseeId, (e) => {
    const r = aplicarPagamentoDoAnual(e, pagamento, evento, { agora: new Date(), cicloJaPagoPorOutra: jaPagoPorOutra });
    feito.resultado = r.resultado;
    if (r.resultado === "PAGO") feito.apagar = (e.cobrancas || []).filter((c) => c.status === "PENDENTE" && c.asaasPaymentId !== pagamento.id);
    return r.estado;
  });
  const { resultado, apagar } = feito;

  const chave = getAsaasKey();
  if (resultado === "PAGO") {
    if (jaPagoPorOutra) {
      console.error(`[Plano anual] Loja ${ciclo.franchiseeId} pagou o anual (${pagamento.id}) com a fatura ${ciclo.yearMonth} JÁ paga pela mensal — o anual começa no mês seguinte. Conferir à mão os itens da fatura cobrados duas vezes.`);
    } else {
      const { registrarCobrancaDaMensalidade } = await import("@/lib/pagamento-da-mensalidade");
      await registrarCobrancaDaMensalidade({ ...pagamento, id: pagamento.id, externalReference: `billing:${ciclo.id}` }, evento);
      await prisma.franchiseeBillingCycle.update({
        where: { id: ciclo.id },
        data: { notes: `${ciclo.notes ? `${ciclo.notes} | ` : ""}Pago no plano anual (${pagamento.id}): ${MESES_DO_ANUAL} meses a partir de ${ciclo.yearMonth}.` },
      });
      if (chave && ciclo.asaasPaymentId && ciclo.asaasPaymentId !== pagamento.id) {
        const d = await asaas(chave, `/payments/${ciclo.asaasPaymentId}`, { metodo: "DELETE" }).catch(() => null);
        if (!d?.ok) console.error(`[Plano anual] Não consegui apagar a cobrança mensal ${ciclo.asaasPaymentId} (ciclo ${ciclo.id}) — apagar no Asaas à mão.`);
      }
    }
    for (const c of apagar) {
      if (!chave) break;
      const d = await asaas(chave, `/payments/${c.asaasPaymentId}`, { metodo: "DELETE" }).catch(() => null);
      if (!d?.ok) console.error(`[Plano anual] Não consegui apagar a cobrança ${c.asaasPaymentId} — apagar no Asaas à mão.`);
    }
    console.log(`[Plano anual] Loja ${ciclo.franchiseeId} PAGOU o anual (${pagamento.id}).`);
  }
  if (resultado === "ESTORNADO") console.warn(`[Plano anual] Anual da loja ${ciclo.franchiseeId} ESTORNADO (${pagamento.id}): a mensalidade volta a ser cobrada a partir do próximo fechamento.`);
  return resultado;
}

/**
 * A fatura do mês foi paga pela cobrança MENSAL: a do anual daquele ciclo não
 * pode ficar aberta no Asaas. Nunca lança.
 */
export async function cancelarAnualPendente(lojaId: string, cicloId: string, pagoPor: string) {
  try {
    const estado = lerPlanoAnual((await prisma.user.findUnique({ where: { id: lojaId }, select: { onboardingData: true } }))?.onboardingData);
    const pendentes = (estado.cobrancas || []).filter((c) => c.cicloId === cicloId && c.status === "PENDENTE" && c.asaasPaymentId !== pagoPor);
    if (pendentes.length === 0) return;
    const chave = getAsaasKey();
    for (const c of pendentes) {
      if (chave) {
        const d = await asaas(chave, `/payments/${c.asaasPaymentId}`, { metodo: "DELETE" }).catch(() => null);
        if (!d?.ok) console.error(`[Plano anual] Não consegui apagar a cobrança do anual ${c.asaasPaymentId} — apagar no Asaas à mão.`);
      }
    }
    const ids = new Set(pendentes.map((c) => c.asaasPaymentId));
    await gravarEstado(lojaId, (e) => ({ ...e, cobrancas: (e.cobrancas || []).map((c) => ids.has(c.asaasPaymentId) && c.status === "PENDENTE" ? { ...c, status: "CANCELADA" } : c) }));
  } catch (e: any) {
    console.error(`[Plano anual] cancelarAnualPendente(${lojaId}, ${cicloId}): ${e?.message}`);
  }
}

/** Rede de segurança do webhook (cron mensalidades-pagas). */
export async function conferirAnuaisNoAsaas() {
  const chave = getAsaasKey();
  if (!chave) return 0;
  const lojas = await prisma.$queryRawUnsafe<{ id: string; estado: EstadoDoPlanoAnual }[]>(
    `SELECT id, "onboardingData"->$1 AS estado FROM "User" WHERE "onboardingData"->$1->'cobrancas' IS NOT NULL LIMIT 200`,
    CHAVE_DO_PLANO_ANUAL,
  );
  let pagos = 0;
  for (const l of lojas) {
    if (l.estado?.anual && !l.estado.anual.estornadoEm) continue;
    for (const c of l.estado?.cobrancas || []) {
      if (c.status !== "PENDENTE") continue;
      const r = await asaas(chave, `/payments/${c.asaasPaymentId}`);
      if (!r.ok) continue;
      const res = await registrarPagamentoDoAnual({ ...r.dados, externalReference: `${PREFIXO_DO_ANUAL}${c.cicloId}` }, r.dados?.deleted ? "PAYMENT_DELETED" : null);
      if (res === "PAGO") { pagos++; break; }
    }
  }
  return pagos;
}
