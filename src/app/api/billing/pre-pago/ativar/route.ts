/**
 * POST /api/billing/pre-pago/ativar — a loja do plano pré-pago pede a cobrança
 * de ativação na hora (botão "Ativar meu plano" da tela de bloqueio e da aba
 * Mensalidade). Gera uma vez (lib/pre-pago/cobranca.ts) e devolve o link da
 * fatura do Asaas; já gerada, devolve o link da que existe.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emitirCobrancaPrePaga } from "@/lib/pre-pago/cobranca";
import { MARCA_DO_PRE_PAGO } from "@/lib/prazo-da-mensalidade";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });
  const conta = await prisma.user.findUnique({ where: { id }, select: { id: true, ownerId: true, role: true } });
  if (!conta || (conta.role !== "FRANCHISEE" && conta.role !== "STAFF")) return NextResponse.json({ error: "Conta sem loja." }, { status: 403 });
  const lojaId = conta.ownerId || conta.id;

  const r = await emitirCobrancaPrePaga(lojaId, { forcar: true });
  if (r.cicloId) {
    const c = await prisma.franchiseeBillingCycle.findUnique({ where: { id: r.cicloId }, select: { asaasBoletoUrl: true, notes: true } });
    if (c?.notes?.startsWith(MARCA_DO_PRE_PAGO)) return NextResponse.json({ ok: true, url: c.asaasBoletoUrl || null });
  }
  return NextResponse.json({ error: `Não deu para gerar a cobrança (${r.motivo}). Fale com o suporte.` }, { status: 400 });
}
