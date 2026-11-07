import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SEM_ESPELHO } from "@/lib/espelho-de-integracao";
import { lojaDoCardapioDaSessao } from "@/lib/loja-do-cardapio";

/**
 * Itens das integrações: os ESPELHOS da loja (`origemIntegracao` preenchida,
 * lib/espelho-de-integracao.ts) e o vínculo deles com o produto real.
 *
 * GET lista os espelhos com quantos pedidos usaram cada um nos últimos 60 dias
 * (os que mais chegam vêm primeiro — é por eles que vale a pena vincular) e
 * os produtos reais da loja para o select. PATCH grava `vinculadoA` e copia a
 * `category` do produto real para o espelho: o KDS e a impressão dos pedidos
 * ANTIGOS continuam lendo a categoria do espelho (lib/categoria-do-item.ts).
 * DELETE desfaz o vínculo. O espelho nunca é apagado: os pedidos apontam para ele.
 */

const DIAS = 60;

export async function GET() {
  const lojaId = await lojaDoCardapioDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);
  const [espelhos, produtos, usos] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, origemIntegracao: { not: null } },
      select: { id: true, name: true, origemIntegracao: true, codigoExterno: true, category: true, vinculadoA: true },
    }),
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, ...SEM_ESPELHO },
      select: { id: true, name: true, category: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.customerOrderItem.groupBy({
      by: ["menuProductId"],
      where: { menuProduct: { franchiseeId: lojaId, origemIntegracao: { not: null } }, order: { createdAt: { gte: desde } } },
      _count: { _all: true },
    }),
  ]);

  const pedidosPorEspelho = new Map(usos.map((u) => [u.menuProductId, u._count._all]));
  const nomeDoProduto = new Map(produtos.map((p) => [p.id, p.name]));

  const itens = espelhos
    .map((e) => ({
      id: e.id,
      name: e.name,
      origemIntegracao: e.origemIntegracao,
      codigoExterno: e.codigoExterno,
      category: e.category,
      vinculadoA: e.vinculadoA,
      nomeVinculado: e.vinculadoA ? nomeDoProduto.get(e.vinculadoA) || null : null,
      pedidos60d: pedidosPorEspelho.get(e.id) || 0,
    }))
    .sort((a, b) => b.pedidos60d - a.pedidos60d || a.name.localeCompare(b.name, "pt-BR"));

  return NextResponse.json({ itens, produtos });
}

async function espelhoDaLoja(lojaId: string, espelhoId: string) {
  if (!espelhoId) return null;
  return prisma.menuProduct.findFirst({
    where: { id: espelhoId, franchiseeId: lojaId, origemIntegracao: { not: null } },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest) {
  const lojaId = await lojaDoCardapioDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const corpo = await req.json().catch(() => null);
  const espelhoId = String(corpo?.espelhoId || "");
  const produtoId = String(corpo?.produtoId || "");
  if (!espelhoId || !produtoId) return NextResponse.json({ error: "Informe o item e o produto" }, { status: 400 });

  const [espelho, produto] = await Promise.all([
    espelhoDaLoja(lojaId, espelhoId),
    prisma.menuProduct.findFirst({
      where: { id: produtoId, franchiseeId: lojaId, ...SEM_ESPELHO },
      select: { id: true, name: true, category: true },
    }),
  ]);
  if (!espelho) return NextResponse.json({ error: "Item de integração não encontrado nesta loja" }, { status: 404 });
  if (!produto) return NextResponse.json({ error: "Escolha um produto do seu cardápio" }, { status: 400 });

  await prisma.menuProduct.update({
    where: { id: espelho.id },
    data: { vinculadoA: produto.id, category: produto.category },
  });
  return NextResponse.json({ ok: true, nomeVinculado: produto.name });
}

export async function DELETE(req: NextRequest) {
  const lojaId = await lojaDoCardapioDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const corpo = await req.json().catch(() => null);
  const espelho = await espelhoDaLoja(lojaId, String(corpo?.espelhoId || ""));
  if (!espelho) return NextResponse.json({ error: "Item de integração não encontrado nesta loja" }, { status: 404 });

  await prisma.menuProduct.update({ where: { id: espelho.id }, data: { vinculadoA: null } });
  return NextResponse.json({ ok: true });
}
