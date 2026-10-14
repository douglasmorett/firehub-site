import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { garantirEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { podeEditarCaixa } from "@/lib/edicao-do-caixa";
import {
  lancadoDepoisDoFechamento,
  lerValorEmReais,
  motivoDoRegistro,
  recalcularComLancamento,
  retratoComEsperado,
  type LancamentoRegistrado,
  type TipoDoLancamento,
} from "@/lib/lancamento-tardio-do-caixa";

/**
 * Entrada ou retirada ESQUECIDA, lançada num caixa JÁ FECHADO (Histórico de
 * caixas). A regra e o porquê estão em lib/lancamento-tardio-do-caixa.ts.
 *
 *   POST   { sessionId, tipo: "ENTRADA" | "SAIDA", valor, motivo }
 *   DELETE { movimentoId, motivo } — só o lançamento feito depois do fechamento
 *
 * Como a correção de contagem (api/cash-session/editar): quem pode, de qual
 * loja é o caixa, e a movimentação, o fechamento recalculado e o registro do
 * antes/depois na MESMA transação — lançamento sem registro não pode existir.
 * O caixa fica travado (FOR UPDATE) durante a conta: dois lançamentos ao mesmo
 * tempo leriam o mesmo esperado e um apagaria o outro.
 */

async function operador() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true, name: true, email: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  if (!podeEditarCaixa(user)) {
    return { erro: NextResponse.json({ error: "Sem permissão para corrigir caixa fechado. Peça ao dono da loja para liberar em Equipe." }, { status: 403 }) };
  }
  // Se for o suporte do FireHub entrando como a loja, a sessão tem o nome da
  // LOJA — o registro diz que foi o suporte.
  const impersonatedBy = (session.user as any).impersonatedBy as string | null | undefined;
  const suporte = impersonatedBy
    ? await prisma.user.findUnique({ where: { id: impersonatedBy }, select: { name: true } }).catch(() => null)
    : null;
  return {
    user,
    lojaId: user.ownerId || user.id,
    quem: user.name || user.email || session.user.email,
    suporte: impersonatedBy ? `Suporte FireHub${suporte?.name ? ` (${suporte.name})` : ""}` : null,
    impersonatedBy: impersonatedBy || null,
  };
}

const brl = (v: number | null) => (v == null ? "—" : `R$ ${v.toFixed(2).replace(".", ",")}`);

export async function POST(req: Request) {
  const op = await operador();
  if ("erro" in op) return op.erro;
  const { user, lojaId } = op;

  const body = await req.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || "");
  const tipo = String(body?.tipo || "").toUpperCase() as TipoDoLancamento;
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 200) : "";
  const valor = lerValorEmReais(body?.valor);
  if (!sessionId) return NextResponse.json({ error: "Caixa não informado." }, { status: 400 });
  if (tipo !== "ENTRADA" && tipo !== "SAIDA") return NextResponse.json({ error: "Diga se é uma retirada ou uma entrada." }, { status: 400 });
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
  if (valor > 1_000_000) return NextResponse.json({ error: "Valor acima do limite. Confira o que foi digitado." }, { status: 400 });
  // Obrigatório aqui (no caixa aberto é opcional): lançar depois é exceção, e
  // quem confere o caixa amanhã precisa saber para que foi o dinheiro.
  if (motivo.length < 3) return NextResponse.json({ error: "Diga o motivo (ex.: \"pagamento do gás, esqueci de lançar\")." }, { status: 400 });

  await garantirEstruturaDeCaixa();

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${sessionId} FOR UPDATE`;
    const caixa = await tx.cashSession.findFirst({ where: { id: sessionId, franchiseeId: lojaId } });
    if (!caixa) return { status: 404, error: "Caixa não encontrado nesta loja." } as const;
    if (caixa.status !== "CLOSED") return { status: 400, error: "Este caixa ainda está aberto: lance a sangria pelo caixa." } as const;

    const valorCerto = Number(Math.abs(valor).toFixed(2));
    const antes = retratoComEsperado(caixa as unknown as Record<string, unknown>);
    const depois = recalcularComLancamento(caixa as unknown as Record<string, unknown>, { tipo, valor: valorCerto }, "LANCAR");

    const mov = await tx.cashMovement.create({
      data: {
        cashSessionId: caixa.id,
        franchiseeId: lojaId,
        tipo,
        valor: valorCerto,
        descricao: motivo,
        // O mesmo e-mail que a sangria do caixa aberto grava: o Histórico
        // mostra o nome de quem lançou.
        criadoPor: user.email || null,
      },
    });
    const lancamento: LancamentoRegistrado = { acao: "LANCOU", movimentoId: mov.id, tipo, valor: valorCerto, descricao: motivo };

    await tx.cashSession.update({
      where: { id: caixa.id },
      data: { expectedCash: depois.expectedCash, expectedTotal: depois.expectedTotal, difference: depois.difference, notes: depois.notes },
    });
    await tx.cashSessionEdicao.create({
      data: {
        cashSessionId: caixa.id,
        franchiseeId: lojaId,
        editadoPor: op.quem,
        editadoPorEmail: user.email,
        suporte: op.suporte,
        motivo: motivoDoRegistro(lancamento),
        antes,
        depois: { ...depois, lancamento },
      },
    });
    return { status: 200, antes, depois } as const;
  });

  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  console.log(
    `[Caixa] ${tipo === "SAIDA" ? "Retirada" : "Entrada"} de ${brl(Number(Math.abs(valor).toFixed(2)))} lançada depois do fechamento no caixa ${sessionId} ` +
    `(loja ${lojaId}) por ${user.email}${op.impersonatedBy ? ` via suporte ${op.impersonatedBy}` : ""} • ` +
    `dinheiro esperado ${brl(resultado.antes.expectedCash)} → ${brl(resultado.depois.expectedCash)} • diferença ${brl(resultado.antes.difference)} → ${brl(resultado.depois.difference)}`,
  );

  return NextResponse.json({
    success: true,
    antes: { expectedCash: resultado.antes.expectedCash, difference: resultado.antes.difference, contouDinheiro: resultado.antes.closingCash != null },
    depois: { expectedCash: resultado.depois.expectedCash, difference: resultado.depois.difference },
  });
}

export async function DELETE(req: Request) {
  const op = await operador();
  if ("erro" in op) return op.erro;
  const { user, lojaId } = op;
  await garantirEstruturaDeCaixa();

  const body = await req.json().catch(() => ({}));
  const movimentoId = String(body?.movimentoId || "");
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 200) : "";
  if (!movimentoId) return NextResponse.json({ error: "Informe qual lançamento excluir." }, { status: 400 });
  if (motivo.length < 3) return NextResponse.json({ error: "Diga por que excluir (ex.: \"lancei duas vezes\")." }, { status: 400 });

  const mov = await prisma.cashMovement.findFirst({ where: { id: movimentoId, franchiseeId: lojaId } });
  if (!mov) return NextResponse.json({ error: "Lançamento não encontrado nesta loja." }, { status: 404 });

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${mov.cashSessionId} FOR UPDATE`;
    const caixa = await tx.cashSession.findFirst({ where: { id: mov.cashSessionId, franchiseeId: lojaId } });
    if (!caixa) return { status: 404, error: "Caixa não encontrado nesta loja." } as const;
    // O lançado com o caixa aberto entrou na conferência que alguém já bateu:
    // esse continua sem exclusão. Só o que foi lançado depois do fechamento.
    if (caixa.status !== "CLOSED" || !lancadoDepoisDoFechamento(mov.createdAt, caixa.closedAt)) {
      return { status: 400, error: "Só dá para excluir o que foi lançado depois do fechamento." } as const;
    }

    const tipo: TipoDoLancamento = mov.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA";
    const antes = retratoComEsperado(caixa as unknown as Record<string, unknown>);
    const depois = recalcularComLancamento(caixa as unknown as Record<string, unknown>, { tipo, valor: mov.valor }, "EXCLUIR");
    const lancamento: LancamentoRegistrado = { acao: "EXCLUIU", movimentoId: mov.id, tipo, valor: mov.valor, descricao: mov.descricao || null };

    // Apaga só se ainda existe: dois cliques no Excluir desfariam o efeito duas vezes.
    const { count } = await tx.cashMovement.deleteMany({ where: { id: mov.id, franchiseeId: lojaId, cashSessionId: caixa.id } });
    if (count === 0) return { status: 404, error: "Este lançamento já foi excluído." } as const;

    await tx.cashSession.update({
      where: { id: caixa.id },
      data: { expectedCash: depois.expectedCash, expectedTotal: depois.expectedTotal, difference: depois.difference, notes: depois.notes },
    });
    await tx.cashSessionEdicao.create({
      data: {
        cashSessionId: caixa.id,
        franchiseeId: lojaId,
        editadoPor: op.quem,
        editadoPorEmail: user.email,
        suporte: op.suporte,
        motivo: motivoDoRegistro(lancamento, motivo),
        antes,
        depois: { ...depois, lancamento: { ...lancamento, criadoPor: mov.criadoPor, criadoEm: mov.createdAt.toISOString() } },
      },
    });
    return { status: 200, antes, depois } as const;
  });

  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  console.log(
    `[Caixa] Excluído o lançamento tardio ${mov.id} (${mov.tipo} ${brl(mov.valor)}) do caixa ${mov.cashSessionId} (loja ${lojaId}) por ${user.email}` +
    `${op.impersonatedBy ? ` via suporte ${op.impersonatedBy}` : ""} • dinheiro esperado ${brl(resultado.antes.expectedCash)} → ${brl(resultado.depois.expectedCash)}` +
    ` • diferença ${brl(resultado.antes.difference)} → ${brl(resultado.depois.difference)}`,
  );

  return NextResponse.json({
    success: true,
    antes: { expectedCash: resultado.antes.expectedCash, difference: resultado.antes.difference, contouDinheiro: resultado.antes.closingCash != null },
    depois: { expectedCash: resultado.depois.expectedCash, difference: resultado.depois.difference },
  });
}
