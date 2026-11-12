/**
 * /api/store/estoque/margens — custo da ficha HOJE × preço de venda de cada
 * produto: margem, margem % e CMV teórico, com o que vendeu em 30 dias.
 * Só para quem vê dados sensíveis (é custo em R$).
 */
import { NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { margensDasFichas } from "@/lib/estoque/analise-no-banco";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  try {
    return NextResponse.json(await margensDasFichas(r.acesso.lojaId, r.acesso.tz, r.acesso.goals));
  } catch (err: any) {
    console.error("[Estoque] margens falharam:", err?.message || err);
    return NextResponse.json({ error: "Não deu para calcular as margens agora." }, { status: 500 });
  }
}
