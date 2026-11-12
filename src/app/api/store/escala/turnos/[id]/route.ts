/**
 * PUT /api/store/escala/turnos/<id> — edita data, horário, função, vagas e observação.
 * DELETE /api/store/escala/turnos/<id>?confirmar=1 — apaga; com gente inscrita
 * só com `confirmar` (sem ele volta 409 TEM_INSCRITOS e a tela pergunta).
 */
import { NextResponse } from "next/server";
import { apagarTurno, editarTurno } from "@/lib/escala-da-equipe/banco";
import { validarTurno } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await sessaoDaEscala();
    const { id } = await params;
    const v = validarTurno(await lerCorpo(req));
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    await editarTurno(s.lojaId, id, v.turno);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respostaDoErro(err, "PUT turno");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await sessaoDaEscala();
    const { id } = await params;
    await apagarTurno(s.lojaId, id, new URL(req.url).searchParams.get("confirmar") === "1");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respostaDoErro(err, "DELETE turno");
  }
}
