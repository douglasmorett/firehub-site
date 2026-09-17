/**
 * Os FATOS que a régua de cupons (lib/cupons.ts) precisa e que só o banco sabe:
 * o dia da loja, se este telefone já pediu pelo site, quantas vezes já usou
 * este cupom. Servidor apenas — o site pergunta por /api/validate-coupon.
 *
 * Vivia dentro de api/customer-order/route.ts (só o "já pediu"). Saiu de lá
 * porque agora três lugares precisam da mesma resposta — o checkout, a
 * validação que o site chama ao digitar o código, e a consulta do cliente que
 * decide se o cupom de primeiro pedido aparece — e três cópias da mesma SQL é
 * como uma delas passa a contar diferente.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FONTES_QUE_NAO_SAO_SITE, digitosDoTelefone } from "@/lib/campanha-converter";
import { FUSO_PADRAO } from "@/lib/fuso";
import { type Cupom, type FatosDoCupom } from "@/lib/cupons";

/** "YYYY-MM-DD" de hoje no relógio da loja — é contra isso que a validade é lida. */
export function hojeDaLoja(timeZone: string | null | undefined, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || FUSO_PADRAO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
}

/**
 * Este telefone já fez pedido PELO SITE desta loja?
 *
 * Marketplace e salão não contam (FONTES_QUE_NAO_SAO_SITE): quem só pediu pelo
 * iFood ou comeu na mesa nunca pediu pelo site, e é exatamente essa pessoa que
 * o cupom de primeiro pedido quer trazer. Compara pelos últimos 8 dígitos,
 * porque o mesmo número aparece gravado com e sem DDD/55.
 */
export async function jaPediuPeloSite(franchiseeId: string, telefone: unknown): Promise<boolean> {
  const digitos = digitosDoTelefone(telefone);
  if (digitos.length < 8) return false;
  const ultimos8 = digitos.slice(-8);
  const linhas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND "status" NOT IN ('CANCELADO', 'CANCELLED', 'CANCELED', 'CRIANDO_IA', 'AGUARDANDO_PAGAMENTO')
      AND COALESCE("source", 'ONLINE') NOT IN (${Prisma.join(FONTES_QUE_NAO_SAO_SITE)})
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + ultimos8}
    LIMIT 1`;
  return linhas.length > 0;
}

/**
 * Quantas vezes este telefone já usou este cupom nesta loja.
 *
 * A prova é a marca `[Cupom: CODIGO]` que o checkout grava na observação do
 * pedido quando o desconto foi aplicado — é o único registro estruturado que
 * existe do cupom usado, e é gravado há meses, então os usos antigos contam.
 * Pedido cancelado não conta: o cliente não levou o desconto.
 */
export async function usosDoCupomPeloCliente(franchiseeId: string, telefone: unknown, code: string): Promise<number> {
  const digitos = digitosDoTelefone(telefone);
  if (digitos.length < 8) return 0;
  const ultimos8 = digitos.slice(-8);
  const marca = `%[Cupom: ${String(code).trim().toUpperCase()}]%`;
  const linhas = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND "status" NOT IN ('CANCELADO', 'CANCELLED', 'CANCELED', 'CRIANDO_IA', 'AGUARDANDO_PAGAMENTO')
      AND COALESCE("notes", '') LIKE ${marca}
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + ultimos8}`;
  return Number(linhas[0]?.n ?? 0);
}

/**
 * Monta os fatos para `avaliarCupom`. Só vai ao banco pelo que o cupom exige:
 * cupom sem limite e sem regra de primeiro pedido não gasta consulta nenhuma.
 * Sem telefone, os dois fatos ficam `null` e o veredito diz `dependeDoTelefone`.
 */
export async function fatosDoCupom(
  cupom: Cupom,
  ctx: { franchiseeId: string; telefone: unknown; timeZone: string | null | undefined; subtotal: number; taxa: number }
): Promise<FatosDoCupom> {
  const temTelefone = digitosDoTelefone(ctx.telefone).length >= 8;
  const [usos, jaPediu] = await Promise.all([
    cupom.usosPorCliente > 0 && temTelefone ? usosDoCupomPeloCliente(ctx.franchiseeId, ctx.telefone, cupom.code) : Promise.resolve(null),
    cupom.primeiroPedido && temTelefone ? jaPediuPeloSite(ctx.franchiseeId, ctx.telefone) : Promise.resolve(null),
  ]);
  return {
    subtotal: ctx.subtotal,
    taxa: ctx.taxa,
    hojeDaLoja: hojeDaLoja(ctx.timeZone),
    usosDoCliente: usos,
    jaPediuPeloSite: jaPediu,
  };
}
