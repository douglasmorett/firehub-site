/**
 * O computador do caixa (lib/caixa-mercado/terminal.ts).
 * GET    — este computador é caixa? (cookie) + o TEF dele (segredo local para o Assistente).
 * POST   { nome? } — registra ESTE computador como caixa (só o dono; módulo ligado).
 * DELETE { terminalId } — desativa um computador (só o dono).
 */
import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { caixaEstaLigado } from "@/lib/caixa-mercado/assinatura";
import { COOKIE_DO_CAIXA, VALIDADE_DO_COOKIE_S, desativarTerminal, licencaTefDoTerminal, registrarTerminal } from "@/lib/caixa-mercado/terminal";
import { tefDaLicenca } from "@/lib/tef-do-totem";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await contextoDoCaixa();
  if (ehResposta(ctx)) return ctx;
  let tef: { ligado: boolean; segredoLocal: string | null } = { ligado: false, segredoLocal: null };
  if (ctx.terminal) {
    const t = await tefDaLicenca(licencaTefDoTerminal(ctx.terminal.id)).catch(() => null);
    tef = { ligado: Boolean(t), segredoLocal: t?.segredoLocal ?? null };
  }
  return NextResponse.json({ terminal: ctx.terminal, tef, quem: { nome: ctx.quem.nome, dono: ctx.quem.dono } });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja registra um computador como caixa." }, { status: 403 });
  if (!(await caixaEstaLigado(s.franchiseeId))) return NextResponse.json({ error: "Ative o Caixa de mercado antes de registrar o computador." }, { status: 409 });
  const corpo: any = await req.json().catch(() => ({}));
  try {
    const { terminal, token } = await registrarTerminal(s.franchiseeId, typeof corpo?.nome === "string" ? corpo.nome : null, s.nome || null);
    const res = NextResponse.json({ ok: true, terminal });
    res.cookies.set(COOKIE_DO_CAIXA, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: VALIDADE_DO_COOKIE_S });
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu para registrar." }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja desativa um caixa." }, { status: 403 });
  const corpo: any = await req.json().catch(() => ({}));
  const ok = await desativarTerminal(s.franchiseeId, String(corpo?.terminalId || ""));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Caixa não encontrado." }, { status: 404 });
}
