import { NextRequest, NextResponse } from "next/server";
import { autenticarTerminal } from "@/lib/terminal-app";
import { idDoEstorno, registrarResultadoDoEstorno } from "@/lib/estorno-na-maquininha";
import { ehRespostaDoApp } from "@/lib/estorno-na-maquininha-regras";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/terminal/estorno
 * { token, pedidoId: "estorno:<id>", situacao: ESTORNADO|RECUSADO|INCERTO|NAO_ABRIU,
 *   motivoRecusa?, idsDaAdquirente? }
 *
 * O app do totem devolve o que a Cielo disse do estorno que ele levou no
 * pendente (campo `estorno`). O corpo é o mesmo do POST de resultado da
 * cobrança — o app guarda e reenvia pela mesma fila em disco —, com a
 * `situacao` a mais. Responde no contrato daquela rota (aprovado / jaConfirmado),
 * que o app já sabe ler. Repetir o mesmo resultado não muda nada
 * (lib/estorno-na-maquininha.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => ({}));
    const auth = await autenticarTerminal(corpo?.token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }

    const estornoId = idDoEstorno(corpo?.pedidoId) ?? (typeof corpo?.estornoId === "string" ? corpo.estornoId : null);
    if (!estornoId || !ehRespostaDoApp(corpo?.situacao)) {
      return NextResponse.json(
        { error: "Informe pedidoId (estorno:<id>) e situacao (ESTORNADO, RECUSADO, INCERTO ou NAO_ABRIU)." },
        { status: 400 },
      );
    }

    const motivo = typeof corpo?.motivoRecusa === "string" && corpo.motivoRecusa.trim() ? corpo.motivoRecusa.trim().slice(0, 300) : null;
    const ids = corpo?.idsDaAdquirente && typeof corpo.idsDaAdquirente === "object" ? corpo.idsDaAdquirente : null;
    const r = await registrarResultadoDoEstorno({
      terminal: auth.terminal,
      estornoId,
      resposta: corpo.situacao,
      motivo,
      idsDaAdquirente: ids,
    });
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error("[Terminal Estorno] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
