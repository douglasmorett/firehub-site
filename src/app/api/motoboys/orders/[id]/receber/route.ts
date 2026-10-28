import { NextRequest, NextResponse } from "next/server";
import { exigirMotoboy } from "@/lib/motoboy-sessao";
import { receberEntrega } from "@/lib/cobranca-da-entrega-na-maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/motoboys/orders/[id]/receber  { dinheiro?, trocoPara? }
 *
 * Fecha o pagamento da entrega cobrada na maquininha: o que passou no cartão
 * (conferido) + a parte em dinheiro que o motoboy informa. Depois disto o app
 * marca o pedido como entregue pelo PATCH /api/motoboys/orders de sempre, SEM
 * mandar `pagamento` (que apagaria as partes).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mb = await exigirMotoboy(req);
  if (!mb) {
    return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
  }
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const r = await receberEntrega({
    lojaId: mb.franchiseeId,
    motoboy: { id: mb.id, name: mb.name },
    orderId: id,
    dinheiroCentavos: Math.round((Number(corpo?.dinheiro) || 0) * 100),
    trocoPara: corpo?.trocoPara != null ? Number(corpo.trocoPara) : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.mensagem }, { status: r.status });
  return NextResponse.json({ success: true, paymentMethod: r.paymentMethod });
}
