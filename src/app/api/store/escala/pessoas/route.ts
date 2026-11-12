/**
 * POST /api/store/escala/pessoas — cadastra um freelancer (nome, telefone,
 * função, CPF, Pix, diária, observação).
 * PUT  /api/store/escala/pessoas { tipo, id, ... } — edita o freelancer (ou
 * desativa: ativo=false); para equipe/motoboy grava só o complemento da
 * escala (telefone, função, diária, observação) — nome e cadastro continuam
 * na tela de origem.
 */
import { NextResponse } from "next/server";
import { salvarComplemento, salvarFreelancer } from "@/lib/escala-da-equipe/banco";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const id = await salvarFreelancer(s.lojaId, await lerCorpo(req), { podeVerDiaria: s.ehDono });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return respostaDoErro(err, "POST pessoa");
  }
}

export async function PUT(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const corpo = await lerCorpo(req);
    const tipo = String(corpo.tipo || ""), id = String(corpo.id || "");
    if (!id) return NextResponse.json({ error: "Pessoa não informada." }, { status: 400 });
    if (tipo === "freelancer") await salvarFreelancer(s.lojaId, corpo, { id, podeVerDiaria: s.ehDono });
    else if (tipo === "equipe" || tipo === "motoboy") await salvarComplemento(s.lojaId, tipo, id, corpo, { podeVerDiaria: s.ehDono });
    else return NextResponse.json({ error: "Tipo de pessoa inválido." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respostaDoErro(err, "PUT pessoa");
  }
}
