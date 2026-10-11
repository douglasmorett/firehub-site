import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { garantirEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { aplicarCorrecao, formasAlteradas, podeEditarCaixa, retratoDoContado } from "@/lib/edicao-do-caixa";
import type { ChaveDaConferencia } from "@/lib/conferencia-do-caixa";

/**
 * POST — corrige a contagem de um caixa JÁ FECHADO (Histórico de caixas).
 * Body: { sessionId, contado: { cash, debit, credit, pix, voucher }, motivo }
 * Forma em branco (null/"") = não conferida, como no fechamento.
 *
 * A regra e o porquê estão em lib/edicao-do-caixa.ts. Aqui: quem pode, de qual
 * loja é o caixa, e gravar a correção e o antes/depois na MESMA transação —
 * correção sem registro é exatamente o que não pode existir.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true, name: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (!podeEditarCaixa(user)) {
    return NextResponse.json({ error: "Sem permissão para corrigir caixa fechado. Peça ao dono da loja para liberar em Equipe." }, { status: 403 });
  }
  const lojaId = user.ownerId || user.id;

  const body = await req.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || "");
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
  if (!sessionId) return NextResponse.json({ error: "Caixa não informado." }, { status: 400 });
  if (motivo.length < 3) return NextResponse.json({ error: "Diga o que estava errado (ex.: \"crédito digitado errado\")." }, { status: 400 });

  const caixa = await prisma.cashSession.findFirst({ where: { id: sessionId, franchiseeId: lojaId } });
  if (!caixa) return NextResponse.json({ error: "Caixa não encontrado nesta loja." }, { status: 404 });
  if (caixa.status !== "CLOSED") return NextResponse.json({ error: "Este caixa ainda está aberto: corrija no fechamento." }, { status: 400 });

  const novo = (body?.contado || {}) as Record<ChaveDaConferencia, unknown>;
  const antes = retratoDoContado(caixa as unknown as Record<string, unknown>);
  const depois = aplicarCorrecao(caixa as unknown as Record<string, unknown>, novo, null);
  const alteradas = formasAlteradas(antes, depois);
  if (alteradas.length === 0) return NextResponse.json({ error: "Nenhum valor mudou." }, { status: 400 });

  // Quem corrigiu. Se for o suporte do FireHub entrando como a loja, a sessão
  // tem o nome da LOJA — o registro diz que foi o suporte.
  const impersonatedBy = (session.user as any).impersonatedBy as string | null | undefined;
  const suporte = impersonatedBy
    ? await prisma.user.findUnique({ where: { id: impersonatedBy }, select: { name: true, email: true } }).catch(() => null)
    : null;

  await garantirEstruturaDeCaixa();
  await prisma.$transaction([
    prisma.cashSession.update({
      where: { id: caixa.id },
      data: {
        closingCash: depois.closingCash,
        closingDebit: depois.closingDebit,
        closingCredit: depois.closingCredit,
        closingPix: depois.closingPix,
        closingVoucher: depois.closingVoucher,
        difference: depois.difference,
        notes: depois.notes,
      },
    }),
    prisma.cashSessionEdicao.create({
      data: {
        cashSessionId: caixa.id,
        franchiseeId: lojaId,
        editadoPor: user.name || user.email || session.user.email,
        editadoPorEmail: user.email,
        suporte: impersonatedBy ? `Suporte FireHub${suporte?.name ? ` (${suporte.name})` : ""}` : null,
        motivo,
        antes,
        depois,
      },
    }),
  ]);

  console.log(
    `[Caixa] Correção do caixa ${caixa.id} (loja ${lojaId}) por ${user.email}${impersonatedBy ? ` via suporte ${impersonatedBy}` : ""}: ` +
    alteradas.map((l) => `${l.nome} ${l.antes ?? "—"} → ${l.depois ?? "—"}`).join(", ") +
    ` • diferença ${antes.difference ?? "—"} → ${depois.difference ?? "—"}`,
  );

  return NextResponse.json({ success: true, difference: depois.difference });
}
