/**
 * O turno do operador neste computador (lib/caixa-mercado/turno.ts).
 * GET  — o turno aberto (ou nulo) com o resumo: vendas, por forma, movimentos, esperado.
 * POST { acao: "abrir", fundoCentavos }
 *      { acao: "sangria" | "suprimento", valorCentavos, descricao? }
 *      { acao: "fechar", contado: { DINHEIRO: 12345, PIX: null, ... }, obs? }
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { abrirTurno, fecharTurno, movimentarTurno, resumoDoTurno, turnoAberto } from "@/lib/caixa-mercado/turno";
import { marcarUso } from "@/lib/caixa-mercado/terminal";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const turno = await turnoAberto(ctx.terminal!.id);
  return NextResponse.json({ turno, resumo: turno ? await resumoDoTurno(turno) : null });
}

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const terminal = ctx.terminal!;
  const corpo: any = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");
  try {
    if (acao === "abrir") {
      const turno = await abrirTurno(terminal, ctx.quem, Math.round(Number(corpo?.fundoCentavos) || 0));
      await marcarUso(terminal);
      return NextResponse.json({ ok: true, turno, resumo: await resumoDoTurno(turno) });
    }
    const turno = await turnoAberto(terminal.id);
    if (!turno) return NextResponse.json({ error: "Não há turno aberto neste caixa." }, { status: 409 });
    if (acao === "sangria" || acao === "suprimento") {
      const descricao = typeof corpo?.descricao === "string" ? corpo.descricao.trim() || null : null;
      await movimentarTurno(turno, terminal, ctx.quem, acao === "sangria" ? "SANGRIA" : "SUPRIMENTO", Math.round(Number(corpo?.valorCentavos)), descricao);
      return NextResponse.json({ ok: true, resumo: await resumoDoTurno(turno) });
    }
    if (acao === "fechar") {
      const r = await fecharTurno(turno, ctx.quem, corpo?.contado || {}, typeof corpo?.obs === "string" ? corpo.obs : null);
      return NextResponse.json({ ok: true, fechamento: r });
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu certo." }, { status: 400 });
  }
}
