/** DELETE /api/store/escala/pagamentos/<id> — desfaz o pagamento (só o dono; fica no histórico, marcado). */
import { NextResponse } from "next/server";
import { ErroDaEscala, desfazerPagamento } from "@/lib/escala-da-equipe/banco";
import { respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await sessaoDaEscala();
    if (!s.ehDono) throw new ErroDaEscala("Só o dono mexe nos pagamentos da escala.", 403);
    const { id } = await params;
    await desfazerPagamento(s.lojaId, id, s.quem);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respostaDoErro(err, "DELETE pagamento");
  }
}
