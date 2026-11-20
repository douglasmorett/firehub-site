/**
 * POST /api/billing/anual { yearMonth, forma: "cartao" | "pix" } — "Pagar o ano" na fatura em aberto
 * (aba Mensalidade). Gera a cobrança do plano anual (lib/plano-anual-no-banco.ts)
 * e devolve o link da fatura do Asaas.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cobrarAnualDaFatura, ErroDoPlanoAnual } from "@/lib/plano-anual-no-banco";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });
  const conta = await prisma.user.findUnique({ where: { id }, select: { id: true, ownerId: true, role: true } });
  if (!conta || (conta.role !== "FRANCHISEE" && conta.role !== "STAFF")) return NextResponse.json({ error: "Conta sem loja." }, { status: 403 });
  const { yearMonth, forma } = await req.json().catch(() => ({}));
  if (typeof yearMonth !== "string" || !/^\d{4}-\d{2}$/.test(yearMonth)) return NextResponse.json({ error: "Fatura inválida." }, { status: 400 });
  if (forma !== "cartao" && forma !== "pix") return NextResponse.json({ error: "Escolha cartão ou Pix." }, { status: 400 });

  try {
    const r = await cobrarAnualDaFatura(conta.ownerId || conta.id, yearMonth, forma);
    return NextResponse.json({ ok: true, url: r.invoiceUrl });
  } catch (e: any) {
    if (e instanceof ErroDoPlanoAnual) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(`[Plano anual] Rota: ${e?.message}`);
    return NextResponse.json({ error: "Não deu para gerar a cobrança agora. Tente de novo ou fale com o suporte." }, { status: 500 });
  }
}
