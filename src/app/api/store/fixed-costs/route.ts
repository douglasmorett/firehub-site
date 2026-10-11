import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import { lerValorEmReais } from "@/lib/lote-de-saldo";

/**
 * Os custos fixos mensais da LOJA ([{ id, label, value }]), que o DRE rateia
 * mês a mês.
 *
 * Gravava e lia na linha de quem estava logado (`where: { email }`): o
 * funcionário com "Financeiro" salvava os custos fixos na conta DELE, e a tela
 * — que lê os da loja (lib/financeiro/contexto.ts) — não mostrava nada. Agora
 * é sempre a loja do dono.
 */
export async function PUT(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });

  const corpo = await req.json().catch(() => null);
  if (!Array.isArray(corpo?.fixedCosts)) return NextResponse.json({ error: "Lista de custos inválida." }, { status: 400 });

  // Valor em reais do jeito que vier ("1.200,00" é mil e duzentos — lib/lote-de-saldo.ts).
  const fixedCosts = corpo.fixedCosts
    .map((c: any) => ({ id: String(c?.id || Date.now()), label: String(c?.label || "").trim().slice(0, 80), value: lerValorEmReais(c?.value) }))
    .filter((c: { label: string; value: number }) => c.label && Number.isFinite(c.value) && c.value > 0);

  await prisma.user.update({ where: { id: r.valor.donoId }, data: { fixedCosts } });
  return NextResponse.json({ ok: true, fixedCosts });
}

export async function GET(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  return NextResponse.json(Array.isArray(r.valor.dono.fixedCosts) ? r.valor.dono.fixedCosts : []);
}
