/**
 * O valor da diária por função e por dia (Lucas/Frangoso, 13/11/2026: "valor
 * por dia e por função — hoje todo mundo é igual"). Só o dono: o funcionário
 * não vê o que se paga a ninguém.
 *
 * GET /api/store/escala/valores                       a tabela inteira
 * PUT /api/store/escala/valores { funcao, data?, valor }
 *     data vazia = o valor normal da função; valor vazio = apaga.
 * A conta de qual valor vale em cada turno está em regras.ts (diariaDoTurno).
 */
import { NextResponse } from "next/server";
import { ErroDaEscala, salvarValor, valoresDaLoja } from "@/lib/escala-da-equipe/banco";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

async function sessaoDoDono() {
  const s = await sessaoDaEscala();
  if (!s.ehDono) throw new ErroDaEscala("Só o dono mexe nos valores da diária.", 403);
  return s;
}

export async function GET() {
  try {
    const s = await sessaoDoDono();
    return NextResponse.json({ valores: await valoresDaLoja(s.lojaId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return respostaDoErro(err, "GET valores");
  }
}

export async function PUT(req: Request) {
  try {
    const s = await sessaoDoDono();
    await salvarValor(s.lojaId, await lerCorpo(req), s.quem);
    return NextResponse.json({ ok: true, valores: await valoresDaLoja(s.lojaId) });
  } catch (err) {
    return respostaDoErro(err, "PUT valores");
  }
}
