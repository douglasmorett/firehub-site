/**
 * /api/store/estoque/contagens/[id]
 *
 *   GET     a lista para contar, na ordem do local (freezer, geladeira...). Com
 *           a contagem ABERTA, NÃO vem o saldo do sistema: contagem às cegas,
 *           para ninguém "contar" o número que a tela mostra. Fechada, vem a
 *           comparação; R$ só para quem vê dados sensíveis.
 *   PATCH   { itens: [{ stockItemId, contado }] } grava enquanto conta (cada
 *           item, ao sair do campo). `contado: null` apaga. Item fora da lista
 *           entra (alguém contou a mais na contagem rápida).
 *   DELETE  descarta a contagem ABERTA.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirEstoque } from "@/lib/cmv/acesso";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { id } = await params;
  const { lojaId, veDadosSensiveis } = r.acesso;

  const contagem = await prisma.contagemDeEstoque.findFirst({
    where: { id, franchiseeId: lojaId },
    include: { itens: { include: { stockItem: { select: { local: true, contagemDiaria: true, tipo: true, entraNoCmv: true, active: true } } } } },
  });
  if (!contagem) return NextResponse.json({ error: "Contagem não encontrada." }, { status: 404 });

  const fechada = contagem.status === "FECHADA";
  const itens = contagem.itens
    .map((i) => ({
      stockItemId: i.stockItemId,
      nome: i.nome,
      unidade: i.unidade,
      local: i.stockItem.local || "Sem local",
      preparo: String(i.stockItem.tipo || "").toUpperCase() === "PREPARO",
      contado: i.contado,
      ...(fechada
        ? {
            quantidade: i.quantidade,
            origem: i.origem,
            saldoSistema: i.saldoSistema,
            diferenca: i.origem === "CONTADO" && i.quantidade != null && i.saldoSistema != null ? Math.round((i.quantidade - i.saldoSistema) * 1000) / 1000 : null,
            custoUnitario: veDadosSensiveis ? i.custoUnitario : null,
            valor: veDadosSensiveis ? i.valor : null,
            foraDoCmv: i.stockItem.entraNoCmv === false,
          }
        : {}),
    }))
    .sort((a, b) => a.local.localeCompare(b.local, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

  // Para acrescentar um item que não estava na lista.
  const outros = fechada ? [] : await prisma.stockItem.findMany({
    where: { franchiseeId: lojaId, NOT: { active: false }, id: { notIn: contagem.itens.map((i) => i.stockItemId) } },
    select: { id: true, name: true, unit: true, local: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    id: contagem.id,
    dia: contagem.dia,
    tipo: contagem.tipo,
    status: contagem.status,
    valorTotal: veDadosSensiveis ? contagem.valorTotal : null,
    veDadosSensiveis,
    itens,
    outros: outros.map((o) => ({ stockItemId: o.id, nome: o.name, unidade: o.unit, local: o.local || "Sem local" })),
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { id } = await params;
  const { lojaId, usuarioId } = r.acesso;

  const contagem = await prisma.contagemDeEstoque.findFirst({ where: { id, franchiseeId: lojaId }, select: { id: true, status: true } });
  if (!contagem) return NextResponse.json({ error: "Contagem não encontrada." }, { status: 404 });
  if (contagem.status === "FECHADA") return NextResponse.json({ error: "Esta contagem já foi fechada. Reabra para mudar." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const itens: { stockItemId: string; contado: unknown }[] = Array.isArray(body?.itens) ? body.itens : [];
  if (!itens.length) return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });

  const ids = Array.from(new Set(itens.map((i) => String(i.stockItemId || ""))));
  const insumos = await prisma.stockItem.findMany({ where: { id: { in: ids }, franchiseeId: lojaId }, select: { id: true, name: true, unit: true } });
  if (insumos.length !== ids.length) return NextResponse.json({ error: "Um dos itens não é do estoque desta loja." }, { status: 400 });
  const porId = new Map(insumos.map((i) => [i.id, i]));

  for (const it of itens) {
    let contado: number | null = null;
    if (it.contado !== null && it.contado !== undefined && String(it.contado).trim() !== "") {
      const n = Number(String(it.contado).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `Quantidade inválida em "${porId.get(it.stockItemId)?.name}".` }, { status: 400 });
      contado = n;
    }
    const insumo = porId.get(it.stockItemId)!;
    await prisma.contagemItem.upsert({
      where: { contagemId_stockItemId: { contagemId: contagem.id, stockItemId: insumo.id } },
      create: { contagemId: contagem.id, stockItemId: insumo.id, nome: insumo.name, unidade: insumo.unit, contado, atualizadoPor: usuarioId },
      update: { contado, atualizadoPor: usuarioId },
    });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { id } = await params;
  const contagem = await prisma.contagemDeEstoque.findFirst({ where: { id, franchiseeId: r.acesso.lojaId }, select: { id: true, status: true } });
  if (!contagem) return NextResponse.json({ error: "Contagem não encontrada." }, { status: 404 });
  if (contagem.status === "FECHADA") return NextResponse.json({ error: "Contagem fechada não se apaga: reabra se precisar corrigir." }, { status: 400 });
  await prisma.contagemDeEstoque.delete({ where: { id: contagem.id } });
  return NextResponse.json({ success: true });
}
