/**
 * GET /api/store/lanche-da-equipe?de=YYYY-MM-DD&ate=YYYY-MM-DD — o painel do
 * lanche dos motoboys: a configuração e os lanches do período, de todos.
 * PUT { ativo, limite } — grava a configuração (só dono/gerente).
 *
 * Só existe para as lojas de LOJAS_COM_LANCHE_DA_EQUIPE (lib/lanche-da-equipe.ts).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { configDaLoja, lanchesDoPeriodo, salvarConfigDoLanche } from "@/lib/lanche-da-equipe";
import { periodoDoRelatorio } from "@/lib/relatorio-do-entregador";
import { fusoDaLoja } from "@/lib/fuso-da-loja";

export const dynamic = "force-dynamic";

async function sessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, name: true, email: true, role: true } });
  if (!u) return null;
  return { lojaId: u.ownerId || u.id, quem: u.name || u.email, papel: String(u.role || "") };
}

export async function GET(req: Request) {
  const s = await sessao();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const cfg = await configDaLoja(s.lojaId);
  if (!cfg.disponivel) return NextResponse.json({ disponivel: false });
  const url = new URL(req.url);
  const fuso = await fusoDaLoja(s.lojaId);
  const { fromDate, toDate } = periodoDoRelatorio(url.searchParams.get("de"), url.searchParams.get("ate"), fuso);
  const lanches = await lanchesDoPeriodo({ lojaId: s.lojaId, de: fromDate, ate: toDate });
  return NextResponse.json({ ...cfg, fuso, lanches }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const s = await sessao();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (s.papel === "STAFF") return NextResponse.json({ error: "Só o dono muda o combinado do lanche." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const cfg = await salvarConfigDoLanche(s.lojaId, body, s.quem);
    return NextResponse.json({ ok: true, ...cfg });
  } catch (err: any) {
    return NextResponse.json({ error: "Não deu para salvar agora." }, { status: 400 });
  }
}
