/**
 * GET /api/motoboy-report/escala?de=YYYY-MM-DD&ate=YYYY-MM-DD — o que a
 * Escala da equipe sabe de cada motoboy, para o cartão do acerto (Motoboys ›
 * Relatório de Pagamentos): o Pix que ele informou na escala e quanto a escala
 * já registrou como pago nos dias (do expediente) do período.
 *
 * Douglas, 12/11/2026: "onde faz com o motoboy? Coloca lá também". Só mostra —
 * a conta do acerto não muda. Quem vê é quem abre o acerto (./sessao.ts).
 */
import { NextResponse } from "next/server";
import { escalaDosMotoboys } from "@/lib/escala-da-equipe/banco";
import { dataValida } from "@/lib/escala-da-equipe/regras";
import { quemMexeNoAcerto } from "../sessao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const url = new URL(req.url);
  const de = url.searchParams.get("de") || "", ate = url.searchParams.get("ate") || "";
  if (!dataValida(de) || !dataValida(ate) || de > ate) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  try {
    return NextResponse.json({ motoboys: await escalaDosMotoboys(s.lojaId, de, ate) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    // Sem a escala (banco fora, tabela não criada), o acerto segue como antes.
    console.error("[Acerto] escala dos motoboys:", err?.message);
    return NextResponse.json({ motoboys: {} });
  }
}
