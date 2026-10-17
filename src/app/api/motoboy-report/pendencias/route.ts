/**
 * Pendência do motoboy: um valor que sai do acerto dele, com o motivo.
 *
 *   POST   { motoboyId, dia: "2026-10-15", valor: "50,00", motivo: "Faltou no dinheiro" }
 *   DELETE ?id=…  — tira do acerto (fica no banco marcada como excluída).
 *                   Com a senha do gerente ligada para "Excluir lançamento na
 *                   conferência do motoboy" (Minha Loja → Senha do gerente),
 *                   só passa com ela — pedido do Allan, Delícia de Casa:
 *                   depois de lançada, só o gerente tira (lib/senha-do-gerente.ts).
 *
 * Desconta no relatório que incluir o dia da pendência — na tela Motoboys, no
 * app do entregador e no Acerto de entregadores (lib/relatorio-do-entregador.ts).
 */
import { NextResponse } from "next/server";
import { excluirPendencia, lancarPendencia } from "@/lib/ajustes-do-acerto";
import { validarPendencia } from "@/lib/ajustes-do-acerto-regras";
import { motoboyDaLoja, quemMexeNoAcerto } from "../sessao";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const body = await req.json().catch(() => ({}));
  const mb = await motoboyDaLoja(body?.motoboyId, s.lojaId);
  if (!mb) return NextResponse.json({ error: "Motoboy não encontrado nesta loja." }, { status: 404 });
  const v = validarPendencia(body || {});
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  try {
    const id = await lancarPendencia({ lojaId: s.lojaId, motoboyId: mb.id, dia: v.dia, valor: v.valor, motivo: v.motivo, quem: s.quem });
    return NextResponse.json({ ok: true, id, dia: v.dia, valor: v.valor });
  } catch (err: any) {
    console.error("[Acerto] lançar pendência:", err?.message);
    return NextResponse.json({ error: "Não deu para lançar a pendência agora. Tente de novo." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Pendência não informada." }, { status: 400 });
  const semSenha = await exigirSenhaDoGerente(req, s.lojaId, "excluirPendenciaDoMotoboy");
  if (semSenha) return semSenha;
  try {
    const achou = await excluirPendencia({ lojaId: s.lojaId, id, quem: s.quem });
    if (!achou) return NextResponse.json({ error: "Pendência não encontrada (talvez já excluída)." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Acerto] excluir pendência:", err?.message);
    return NextResponse.json({ error: "Não deu para excluir agora. Tente de novo." }, { status: 500 });
  }
}
