import { NextRequest, NextResponse } from "next/server";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
import { lancarNaMesa } from "@/lib/lancar-na-mesa";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;
    // Mesa aberta ANTES de o caixa fechar continuaria recebendo item a noite
    // toda. O consumo é o que vira dinheiro no fechamento — e o fechamento só
    // soma mesa fechada depois da abertura do caixa (ver lib/caixa-aberto.ts).
    const semCaixa = await recusaSeCaixaFechado(targetFranchiseeId, "lançar o item");
    if (semCaixa) return semCaixa;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { items, notes, customerName } = data;

    // A regra do lançamento — produto, preço do salão, estoque, gravação — é
    // a mesma do pedido pelo QR da mesa: lib/lancar-na-mesa.ts.
    const r = await lancarNaMesa({
      franchiseeId: targetFranchiseeId,
      tableSessionId: id,
      items,
      notes,
      customerName,
      origemDaImpressao: operador.tipo === "loja" && operador.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

    return NextResponse.json({ success: true, order: r.order });
  } catch (error: any) {
    console.error("[Table Sessions Add Order POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
