import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  adminDaSessao, estruturaPronta, lojasPorId, numerosDoFireHub, SELECT_DO_RELATORIO,
} from "@/lib/acompanhamento-ifood/servidor";
import { situacaoDoRelatorio, limparNumeros } from "@/lib/acompanhamento-ifood/regras";
import { lerDadosDoCliente } from "@/lib/acompanhamento-ifood/dados-do-cliente";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET: o cliente inteiro — contrato, todos os relatórios (o histórico, sem o
 * arquivo) e, se usa o FireHub, os pedidos dos últimos 6 meses por canal.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { id } = await params;

  const cliente = await prisma.acompanhamentoIfood.findUnique({ where: { id } });
  if (!cliente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const relatorios = await prisma.acompanhamentoRelatorio.findMany({
    where: { clienteId: id },
    orderBy: { mes: "desc" },
    select: SELECT_DO_RELATORIO,
  });

  const loja = cliente.lojaId ? (await lojasPorId([cliente.lojaId])).get(cliente.lojaId) || null : null;
  // Sem o FireHub os números vêm só dos relatórios. Falha aqui não esconde o cliente.
  const fireHub = cliente.lojaId
    ? await numerosDoFireHub(cliente.lojaId).catch((e) => { console.error("[acompanhamento] numerosDoFireHub:", e?.message); return null; })
    : null;

  return NextResponse.json({
    cliente: { ...cliente, loja, situacao: situacaoDoRelatorio(cliente, relatorios) },
    relatorios: relatorios.map((r) => ({ ...r, numeros: limparNumeros(r.numeros) })),
    fireHub,
  });
}

/** PATCH: muda dados, contrato ou situação (ATIVO/PAUSADO/ENCERRADO). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { id } = await params;

  const lido = await lerDadosDoCliente(await req.json().catch(() => ({})), false);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });

  if (lido.dados.lojaId) {
    const ja = await prisma.acompanhamentoIfood.findUnique({ where: { lojaId: lido.dados.lojaId }, select: { id: true, nome: true } });
    if (ja && ja.id !== id) return NextResponse.json({ error: `Essa loja já está no acompanhamento (${ja.nome}).` }, { status: 409 });
  }

  try {
    const cliente = await prisma.acompanhamentoIfood.update({ where: { id }, data: lido.dados });
    return NextResponse.json({ cliente });
  } catch {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }
}

/**
 * DELETE: tira o cliente e TODOS os relatórios dele. Quem só parou de pagar
 * vai para ENCERRADO (PATCH) e o histórico fica; apagar é para cadastro errado.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { id } = await params;
  try {
    await prisma.acompanhamentoIfood.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }
}
