/**
 * POST /api/store/escala/copiar-semana { semana: "YYYY-MM-DD" } — copia os
 * turnos da semana ANTERIOR para a semana desta data (sem as pessoas). O que
 * já existe igual não é criado de novo (lib/escala-da-equipe/regras.ts, copiarSemana).
 */
import { NextResponse } from "next/server";
import { criarTurnos, turnosDoPeriodo } from "@/lib/escala-da-equipe/banco";
import { copiarSemana, dataValida, inicioDaSemana, somarDias } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const { semana } = await lerCorpo(req);
    if (!dataValida(semana)) return NextResponse.json({ error: "Semana inválida." }, { status: 400 });
    const destino = inicioDaSemana(semana);
    const origem = somarDias(destino, -7);
    const [daOrigem, doDestino] = await Promise.all([
      turnosDoPeriodo(s.lojaId, origem, somarDias(origem, 6)),
      turnosDoPeriodo(s.lojaId, destino, somarDias(destino, 6)),
    ]);
    if (!daOrigem.length) return NextResponse.json({ error: "A semana anterior não tem turnos para copiar." }, { status: 400 });
    const novos = copiarSemana(daOrigem, origem, destino, doDestino);
    const criados = await criarTurnos(s.lojaId, novos, s.quem);
    return NextResponse.json({ ok: true, criados, jaExistiam: daOrigem.length - criados });
  } catch (err) {
    return respostaDoErro(err, "copiar semana");
  }
}
