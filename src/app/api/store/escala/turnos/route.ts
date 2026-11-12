/**
 * POST /api/store/escala/turnos — cria o turno; com `repetir: { ate, dias }`
 * cria um por dia marcado (0 = domingo … 6 = sábado) até a data.
 */
import { NextResponse } from "next/server";
import { criarTurnos } from "@/lib/escala-da-equipe/banco";
import { datasDaRepeticao, validarTurno } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const corpo = await lerCorpo(req);
    const v = validarTurno(corpo);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    let datas = [v.turno.data];
    const repetir = corpo.repetir as { ate?: unknown; dias?: unknown } | undefined;
    if (repetir && typeof repetir === "object") {
      const r = datasDaRepeticao(v.turno.data, String(repetir.ate ?? ""), Array.isArray(repetir.dias) ? repetir.dias.map(Number) : []);
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
      datas = r.datas;
    }
    const criados = await criarTurnos(s.lojaId, datas.map((data) => ({ ...v.turno, data })), s.quem);
    return NextResponse.json({ ok: true, criados });
  } catch (err) {
    return respostaDoErro(err, "POST turnos");
  }
}
