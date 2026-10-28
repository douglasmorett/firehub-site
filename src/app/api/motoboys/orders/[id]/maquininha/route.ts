import { NextRequest, NextResponse } from "next/server";
import { exigirMotoboy } from "@/lib/motoboy-sessao";
import {
  criarCobrancaDaEntrega, buscarCobrancaDaEntrega, cancelarCobrancaDaEntrega, situacaoDoRecebimento,
} from "@/lib/cobranca-da-entrega-na-maquininha";

export const dynamic = "force-dynamic";

/**
 * Cobrança da entrega na maquininha que o motoboy leva (app FireHub Motoboy).
 *
 * GET                  → { total, naMaquininha, falta, partes } do pedido
 * GET  ?cobranca=<id>  → a situação de uma passada (AGUARDANDO_TERMINAL, NO_TERMINAL, PAGO, RECUSADO...)
 * POST { valor, terminalId } → cria a passada endereçada a esta maquininha
 * DELETE ?cobranca=<id>      → desiste da passada que ainda não foi para o cartão
 *
 * Sessão do motoboy (Bearer), a mesma do app do celular.
 */

const naoEntrou = () =>
  NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mb = await exigirMotoboy(req);
  if (!mb) return naoEntrou();
  const { id } = await params;
  const cobrancaId = req.nextUrl.searchParams.get("cobranca");
  if (cobrancaId) {
    const c = await buscarCobrancaDaEntrega(mb.franchiseeId, mb.id, cobrancaId);
    if (!c || c.orderId !== id) return NextResponse.json({ error: "Cobrança não encontrada" }, { status: 404 });
    return NextResponse.json({
      cobranca: { id: c.id, status: c.status, valorCentavos: c.valorCentavos, motivo: c.dados?.motivo ?? null },
    });
  }
  const s = await situacaoDoRecebimento(mb.franchiseeId, mb.id, id);
  if (!s) return NextResponse.json({ error: "Pedido não encontrado nas suas entregas." }, { status: 404 });
  return NextResponse.json(s);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const mb = await exigirMotoboy(req);
  if (!mb) return naoEntrou();
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const r = await criarCobrancaDaEntrega({
    lojaId: mb.franchiseeId,
    motoboyId: mb.id,
    orderId: id,
    terminalId: String(corpo?.terminalId || ""),
    valorCentavos: Math.round((Number(corpo?.valor) || 0) * 100),
  });
  if (!r.ok) return NextResponse.json({ error: r.mensagem }, { status: r.status });
  return NextResponse.json({ success: true, cobranca: { id: r.cobranca.id, status: r.cobranca.status, valorCentavos: r.cobranca.valorCentavos } });
}

export async function DELETE(req: NextRequest) {
  const mb = await exigirMotoboy(req);
  if (!mb) return naoEntrou();
  const cobrancaId = req.nextUrl.searchParams.get("cobranca") || "";
  const ok = await cancelarCobrancaDaEntrega(mb.franchiseeId, mb.id, cobrancaId);
  return NextResponse.json({ success: ok });
}
