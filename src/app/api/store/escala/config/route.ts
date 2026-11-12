/**
 * PUT  /api/store/escala/config — as opções do link de inscrição (prazos,
 * desistência, funções que aparecem, link ligado).
 * POST /api/store/escala/config — gera link novo: o antigo para de funcionar.
 */
import { NextResponse } from "next/server";
import { salvarConfig, trocarCodigo } from "@/lib/escala-da-equipe/banco";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const config = await salvarConfig(s.lojaId, await lerCorpo(req), s.quem);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return respostaDoErro(err, "PUT config");
  }
}

export async function POST() {
  try {
    const s = await sessaoDaEscala();
    const config = await trocarCodigo(s.lojaId, s.quem);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return respostaDoErro(err, "novo link");
  }
}
