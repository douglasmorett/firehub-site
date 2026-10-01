/**
 * O BOLETO DA MENSALIDADE PAGO — o elo que faltava entre o Asaas e o FireHub.
 *
 * O fechamento (lib/billing.ts) emite o boleto com `externalReference:
 * "billing:<id do ciclo>"`, mas o webhook do Asaas só procurava pedido de
 * insumos: a mensalidade paga nunca era registrada. O ciclo ficava CLOSED para
 * sempre e três telas liam isso como dívida — o painel da loja, que TRAVA
 * depois do prazo (app/store/layout.tsx); o portal do parceiro, que chamava de
 * inadimplente quem pagou e não contava a comissão recebida; e o admin.
 * Levantamento de 30/09/2026, véspera do primeiro fechamento com boleto para
 * várias lojas.
 *
 * Dois caminhos gravam, pela mesma função:
 *   • o webhook (app/api/webhooks/asaas), na hora do pagamento;
 *   • a conferência (cron mensalidades-pagas), que pergunta ao Asaas por cada
 *     boleto ainda em aberto — webhook falha, e o Asaas pausa a fila depois de
 *     erros seguidos.
 *
 * Pago = ciclo PAID, `amountPending` 0 (é "o que ainda falta"), e o que entrou
 * em `paidAt` / `paidValue` / `paidNetValue`. Nunca desfaz um pagamento: se o
 * Asaas estornar, o status fica gravado e a decisão é de gente.
 */
import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";
import { cicloDaReferencia, statusDePago } from "@/lib/parceiro/regras";

export { cicloDaReferencia };

/** O pedaço da cobrança do Asaas que interessa (payload do webhook ou GET /payments/{id}). */
export type CobrancaDoAsaas = {
  id: string;
  status?: string | null;
  deleted?: boolean | null;
  value?: number | null;
  netValue?: number | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
};

/**
 * O dia do pagamento chega como "2026-10-03", sem hora. Meio-dia de Brasília
 * segura o dia certo em qualquer fuso de quem ler depois.
 */
function quandoPagou(c: CobrancaDoAsaas): Date {
  const dia = c.clientPaymentDate || c.paymentDate || c.confirmedDate;
  if (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia)) return new Date(`${dia}T12:00:00-03:00`);
  return new Date();
}

function statusDaCobranca(c: CobrancaDoAsaas, evento?: string | null): string {
  if (c.deleted === true || evento === "PAYMENT_DELETED") return "DELETED";
  return String(c.status || "").toUpperCase() || "PENDING";
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null; // Number(null) é 0
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type ResultadoDoRegistro = "PAGO" | "ATUALIZADO" | "SEM_MUDANCA" | "SEM_CICLO";

/**
 * Grava no ciclo o que o Asaas diz desta cobrança. Idempotente: o Asaas manda
 * o mesmo evento mais de uma vez, e a conferência repete o que o webhook fez.
 */
export async function registrarCobrancaDaMensalidade(c: CobrancaDoAsaas, evento?: string | null): Promise<ResultadoDoRegistro> {
  if (!c?.id) return "SEM_CICLO";
  const idDoCiclo = cicloDaReferencia(c.externalReference);
  const ciclo =
    (await prisma.franchiseeBillingCycle.findFirst({ where: { asaasPaymentId: c.id } })) ||
    (idDoCiclo ? await prisma.franchiseeBillingCycle.findUnique({ where: { id: idDoCiclo } }) : null);
  if (!ciclo) {
    if (idDoCiclo) console.warn(`[Mensalidade] Cobrança ${c.id} aponta para o ciclo ${idDoCiclo}, que não existe mais.`);
    return "SEM_CICLO";
  }

  const status = statusDaCobranca(c, evento);
  // Outro boleto do MESMO ciclo (o fechamento caiu e reemitiu, ou o boleto foi
  // apagado e refeito). Pago vale — a loja pagou aquele mês e não pode ficar
  // travada; qualquer outro evento dele não manda no ciclo.
  const outroBoleto = !!ciclo.asaasPaymentId && ciclo.asaasPaymentId !== c.id;
  if (outroBoleto && !statusDePago(status)) return "SEM_MUDANCA";
  if (outroBoleto) console.warn(`[Mensalidade] Ciclo ${ciclo.id} pago pelo boleto ${c.id}, não pelo ${ciclo.asaasPaymentId} gravado — conferir se há boleto duplicado.`);
  const boleto = ciclo.asaasBoletoUrl ? {} : c.invoiceUrl || c.bankSlipUrl ? { asaasBoletoUrl: c.invoiceUrl || c.bankSlipUrl } : {};

  if (statusDePago(status)) {
    if (ciclo.status === "PAID" && ciclo.paidAt) {
      if (ciclo.asaasStatus === status) return "SEM_MUDANCA";
      await prisma.franchiseeBillingCycle.update({ where: { id: ciclo.id }, data: { asaasStatus: status } });
      return "ATUALIZADO";
    }
    const valor = numero(c.value) ?? (ciclo.amountPending > 0 ? ciclo.amountPending : null);
    await prisma.franchiseeBillingCycle.update({
      where: { id: ciclo.id },
      data: {
        status: "PAID",
        amountPending: 0,
        paidAt: quandoPagou(c),
        paidValue: valor,
        paidNetValue: numero(c.netValue),
        asaasStatus: status,
        // Ciclo que ficou sem o id do boleto (o fechamento caiu entre criar a
        // cobrança e gravar o ciclo): gravar agora impede um segundo boleto.
        ...(ciclo.asaasPaymentId ? {} : { asaasPaymentId: c.id }),
        ...boleto,
      },
    });
    console.log(`[Mensalidade] Ciclo ${ciclo.yearMonth} da loja ${ciclo.franchiseeId} PAGO no Asaas (${c.id}, R$ ${valor ?? "?"}).`);
    return "PAGO";
  }

  if (ciclo.status === "PAID" && ciclo.paidAt) {
    // Estorno ou cobrança apagada DEPOIS de paga: fica registrado, sem reabrir
    // a dívida nem voltar a travar o painel da loja.
    if (ciclo.asaasStatus === status) return "SEM_MUDANCA";
    console.warn(`[Mensalidade] Ciclo ${ciclo.id} já pago agora está ${status} no Asaas — conferir à mão.`);
    await prisma.franchiseeBillingCycle.update({ where: { id: ciclo.id }, data: { asaasStatus: status } });
    return "ATUALIZADO";
  }

  // Ciclo ainda sem o id (o fechamento caiu entre criar a cobrança e gravar o
  // ciclo): guardar o id deixa a conferência acompanhar este boleto.
  const semId = ciclo.asaasPaymentId ? {} : { asaasPaymentId: c.id };
  if (ciclo.asaasStatus === status && Object.keys(boleto).length === 0 && Object.keys(semId).length === 0) return "SEM_MUDANCA";
  await prisma.franchiseeBillingCycle.update({ where: { id: ciclo.id }, data: { asaasStatus: status, ...boleto, ...semId } });
  return "ATUALIZADO";
}

function baseDoAsaas(chave: string): string {
  return chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
}

/**
 * Pergunta ao Asaas por cada boleto de mensalidade que o FireHub ainda não
 * viu pago. Só lê no Asaas — não cria, não cancela, não mexe em cobrança.
 */
export async function conferirMensalidadesNoAsaas(limite = 120): Promise<{
  semChave?: boolean;
  conferidos: number;
  pagos: number;
  atualizados: number;
  erros: string[];
}> {
  const chave = getAsaasKey();
  if (!chave) return { semChave: true, conferidos: 0, pagos: 0, atualizados: 0, erros: [] };
  const base = baseDoAsaas(chave);

  const ciclos = await prisma.franchiseeBillingCycle.findMany({
    where: {
      asaasPaymentId: { not: null },
      AND: [
        // CLOSED em aberto; PAID sem data de pagamento só dos últimos 90 dias
        // (o "franqueado Hakim" marca PAID com um boleto antigo que nunca será
        // pago — sem o corte, seria perguntado ao Asaas para sempre).
        { OR: [{ status: "CLOSED" }, { status: "PAID", paidAt: null, closedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }] },
        // Boleto apagado/estornado não volta a ser pago. `notIn` sozinho deixa
        // o NULL de fora (SQL), daí o OR.
        { OR: [{ asaasStatus: null }, { asaasStatus: { notIn: ["DELETED", "REFUNDED"] } }] },
      ],
    },
    orderBy: { closedAt: "desc" },
    take: limite,
    select: { id: true, asaasPaymentId: true },
  });

  let pagos = 0;
  let atualizados = 0;
  const erros: string[] = [];
  for (const ciclo of ciclos) {
    try {
      const r = await fetch(`${base}/payments/${encodeURIComponent(ciclo.asaasPaymentId!)}`, {
        headers: { access_token: chave, "User-Agent": "firehub/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        erros.push(`${ciclo.id}: Asaas respondeu ${r.status}`);
        continue;
      }
      const cobranca = (await r.json()) as CobrancaDoAsaas;
      const resultado = await registrarCobrancaDaMensalidade(cobranca);
      if (resultado === "PAGO") pagos++;
      else if (resultado === "ATUALIZADO") atualizados++;
    } catch (e: any) {
      erros.push(`${ciclo.id}: ${e?.message || e}`);
    }
    // O Asaas limita as consultas por minuto; a conferência não tem pressa.
    await new Promise((ok) => setTimeout(ok, 150));
  }
  return { conferidos: ciclos.length, pagos, atualizados, erros };
}
