/**
 * /api/store/table-sessions/[id]/desconto
 *
 * POST   { tipo: "VALOR" | "PERCENTUAL", valor, motivo } — dá (ou troca) o desconto da mesa.
 * DELETE — tira o desconto.
 *
 * O desconto fica na SESSÃO enquanto a mesa está aberta: a conta, o cupom
 * impresso e o fechamento o leem de lá (lib/conta-da-mesa.ts), e o percentual
 * acompanha pedido que chegar depois. No fechamento ele é espalhado pelos
 * pedidos da mesa, para relatório e DRE somarem o que a loja recebeu.
 *
 * ── Só a loja ───────────────────────────────────────────────────────────────
 *
 * O garçom opera a mesa pelo link próprio e fecha a conta, mas desconto é
 * dinheiro da casa: pelo link do garçom esta rota responde 403. A tela do
 * garçom mostra o desconto que a loja deu, sem o botão.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { validarDesconto } from "@/lib/desconto-manual";

export const dynamic = "force-dynamic";

async function mesaAbertaDaLoja(id: string) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  if (operador.tipo !== "loja") {
    return { erro: NextResponse.json({ error: "Só a loja pode dar desconto. Chame o responsável do caixa." }, { status: 403 }) };
  }
  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: { orders: { select: { status: true, totalAmount: true } } },
  });
  if (!mesa || mesa.franchiseeId !== operador.franchiseeId) {
    return { erro: NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 }) };
  }
  if (mesa.status !== "OPEN") {
    return { erro: NextResponse.json({ error: "Esta mesa já foi fechada." }, { status: 409 }) };
  }
  return { operador, mesa };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await mesaAbertaDaLoja(id);
  if ("erro" in r) return r.erro;
  const { operador, mesa } = r;

  const corpo = await req.json().catch(() => ({} as any));
  // Mesma base do fechamento: pedidos que não foram cancelados.
  const consumo =
    Math.round(
      mesa.orders
        .filter((o) => o.status !== "CANCELADO" && o.status !== "CANCELED" && o.status !== "CANCELLED")
        .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0) * 100
    ) / 100;

  const desconto = validarDesconto({ base: consumo, tipo: corpo?.tipo, valor: corpo?.valor, motivo: corpo?.motivo });
  if (!desconto.ok) return NextResponse.json({ error: desconto.erro }, { status: 400 });

  if (desconto.semDesconto) {
    await prisma.tableSession.update({
      where: { id },
      data: { discountType: null, discountValue: null, discountReason: null, discountBy: null, discountAt: null },
    });
    return NextResponse.json({ ok: true, desconto: null });
  }

  const quem = rotuloDoOperador(operador);
  await prisma.tableSession.update({
    where: { id },
    data: {
      discountType: desconto.tipo,
      discountValue: desconto.informado,
      discountReason: desconto.motivo,
      discountBy: quem,
      discountAt: new Date(),
    },
  });
  console.log(
    `[Mesa] 🏷️ desconto na sessão ${id}: ${desconto.tipo === "PERCENTUAL" ? `${desconto.informado}%` : `R$ ${desconto.valor.toFixed(2)}`}` +
      ` (R$ ${desconto.valor.toFixed(2)} hoje) por ${quem} — ${desconto.motivo}`
  );
  return NextResponse.json({
    ok: true,
    desconto: { tipo: desconto.tipo, informado: desconto.informado, valor: desconto.valor, motivo: desconto.motivo },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await mesaAbertaDaLoja(id);
  if ("erro" in r) return r.erro;
  await prisma.tableSession.update({
    where: { id },
    data: { discountType: null, discountValue: null, discountReason: null, discountBy: null, discountAt: null },
  });
  console.log(`[Mesa] 🏷️ desconto retirado da sessão ${id} por ${rotuloDoOperador(r.operador)}`);
  return NextResponse.json({ ok: true, desconto: null });
}
