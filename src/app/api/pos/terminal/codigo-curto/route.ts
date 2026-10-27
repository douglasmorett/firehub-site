import { NextRequest, NextResponse } from "next/server";
import { trocarCodigoCurto, TAMANHO_DO_CODIGO_CURTO } from "@/lib/codigo-curto-da-maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/terminal/codigo-curto  { codigo: "12345678" } → { token }
 *
 * O app da maquininha troca os 8 números do painel pelo token de 64
 * caracteres e segue o pareamento de sempre com ele. Sem sessão: quem chama é
 * o aparelho, e o código curto é a própria prova (vale 10 minutos, uma vez).
 */
export async function POST(req: NextRequest) {
  try {
    const { codigo } = await req.json().catch(() => ({}));
    const limpo = String(codigo ?? "").replace(/\D/g, "");
    if (limpo.length !== TAMANHO_DO_CODIGO_CURTO) {
      return NextResponse.json({ error: `O código tem ${TAMANHO_DO_CODIGO_CURTO} números.` }, { status: 400 });
    }
    const token = await trocarCodigoCurto(limpo);
    if (!token) {
      return NextResponse.json(
        { error: "Código errado, vencido ou já usado. Gere outro no painel, em Maquininhas." },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, token });
  } catch (err) {
    console.error("[POS Código curto]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
