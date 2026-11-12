/** DELETE /api/store/escala/inscricoes/<id> — o painel tira a pessoa do turno. */
import { NextResponse } from "next/server";
import { tirarInscricao } from "@/lib/escala-da-equipe/banco";
import { respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await sessaoDaEscala();
    const { id } = await params;
    await tirarInscricao(s.lojaId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respostaDoErro(err, "DELETE inscrição");
  }
}
