/**
 * GET /api/totem/tef/pedido?id=<pedidoId>&transacao=<transacaoId>
 *
 * O motor TEF do Assistente pergunta isto ao subir com uma transação pendente
 * em disco (caiu entre o "aprovado" do pinpad e a confirmação): CONFIRMAR só
 * se esta transação é o pagamento gravado do pedido; senão DESFAZER.
 * Bearer da chave do pareamento TEF (lib/tef-do-totem.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { licencaDaChaveTef, situacaoParaPendencia } from "@/lib/tef-do-totem";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const licenca = await licencaDaChaveTef(req.headers.get("authorization"));
    if (!licenca) {
      return NextResponse.json({ error: "Chave do TEF inválida.", code: "CHAVE_TEF_INVALIDA" }, { status: 401 });
    }
    const p = req.nextUrl.searchParams;
    const r = await situacaoParaPendencia(licenca, p.get("id"), p.get("transacao"));
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error("[TEF Pedido] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
