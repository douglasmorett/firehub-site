/**
 * /api/store/estoque/compras — as compras lançadas no estoque.
 *
 *   GET     ?de=YYYY-MM-DD&ate=YYYY-MM-DD  lista (padrão: últimos 30 dias), com
 *           o que foi pago e o que falta. R$ só para quem vê dados sensíveis?
 *           Não: quem lança a compra vê o valor da compra (está na nota). O que
 *           é sensível é o CMV, não o preço do queijo.
 *   POST    compra SEM NOTA (mercado, feira): { dia, fornecedor, itens, pagamento }
 *   DELETE  ?id=  desfaz a compra (estorna as entradas, apaga as contas não pagas)
 *
 * A compra com nota (foto + IA) entra por api/store/estoque/nfe-confirm, pela
 * mesma lib/cmv/lancar-compra.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { CompraRecusadaError, desfazerCompra, lancarCompra, type PagamentoDaCompra } from "@/lib/cmv/lancar-compra";
import { hojeNaLoja, naLoja, somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz } = r.acesso;

  const hoje = hojeNaLoja(tz);
  const sp = req.nextUrl.searchParams;
  const ate = DIA_RE.test(sp.get("ate") || "") ? sp.get("ate")! : hoje;
  const de = DIA_RE.test(sp.get("de") || "") ? sp.get("de")! : somarDias(ate, -29);

  // As antigas (antes de 11/10) não têm `dia`: entram pela data de criação.
  const desde = new Date(`${somarDias(de, -1)}T00:00:00-03:00`);
  const compras = await prisma.stockInvoice.findMany({
    where: { franchiseeId: lojaId, OR: [{ dia: { gte: de, lte: ate } }, { dia: null, createdAt: { gte: desde } }] },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  const ids = compras.map((c) => c.id);
  const [contas, entradas] = await Promise.all([
    ids.length ? prisma.payable.findMany({ where: { stockInvoiceId: { in: ids } }, select: { stockInvoiceId: true, value: true, status: true, dueDate: true } }) : [],
    ids.length ? prisma.stockTransaction.findMany({
      where: { stockInvoiceId: { in: ids }, type: "INPUT" },
      select: { stockInvoiceId: true, quantity: true, unitCost: true, stockItem: { select: { name: true, unit: true } } },
    }) : [],
  ]);

  const lista = compras
    .map((c) => {
      const dia = c.dia || naLoja(c.createdAt, tz).dia;
      const minhas = contas.filter((p) => p.stockInvoiceId === c.id);
      const pago = minhas.filter((p) => p.status === "PAID").reduce((s, p) => s + p.value, 0);
      const aPagar = minhas.filter((p) => p.status !== "PAID").reduce((s, p) => s + p.value, 0);
      const proximo = minhas.filter((p) => p.status !== "PAID").map((p) => p.dueDate).sort((a, b) => +a - +b)[0] || null;
      return {
        id: c.id,
        dia,
        origem: c.origem || "NFE",
        fornecedor: c.supplier,
        numero: c.invoiceNumber,
        valor: c.totalAmount ?? null,
        valorNoEstoque: c.valorNoEstoque ?? null,
        imagem: c.imageUrl,
        cancelada: Boolean(c.canceladaEm),
        antiga: !c.dia,
        contas: { quantidade: minhas.length, pago, aPagar, proximoVencimento: proximo ? naLoja(proximo, tz).dia : null },
        itens: entradas.filter((t) => t.stockInvoiceId === c.id).map((t) => ({
          nome: t.stockItem.name, unidade: t.stockItem.unit, quantidade: t.quantity,
          valor: t.unitCost != null ? Math.round(t.quantity * t.unitCost * 100) / 100 : null,
        })),
      };
    })
    .filter((c) => c.dia >= de && c.dia <= ate);

  const valer = lista.filter((c) => !c.cancelada);
  return NextResponse.json({
    de, ate, hoje,
    compras: lista,
    total: Math.round(valer.reduce((s, c) => s + (c.valorNoEstoque ?? 0), 0) * 100) / 100,
  });
}

export async function POST(req: NextRequest) {
  try {
    const r = await exigirEstoque();
    if (!r.ok) return r.resposta;
    const { lojaId, usuarioId, tz } = r.acesso;

    const body = await req.json();
    const itens = Array.isArray(body?.itens) ? body.itens : [];
    const ids: string[] = Array.from(new Set(
      itens.map((i: any) => String(i?.stockItemId || "")).filter((id: string) => id && id !== "NEW" && id !== "IGNORAR"),
    ));
    if (ids.length) {
      const daLoja = await prisma.stockItem.count({ where: { id: { in: ids }, franchiseeId: lojaId } });
      if (daLoja !== ids.length) return NextResponse.json({ error: "Um dos itens não pertence ao estoque desta loja" }, { status: 400 });
    }

    const result = await prisma.$transaction((tx) =>
      lancarCompra(tx, {
        franchiseeId: lojaId,
        usuarioId,
        dia: typeof body?.dia === "string" && body.dia ? body.dia : hojeNaLoja(tz),
        origem: "SEM_NOTA",
        fornecedor: body?.fornecedor,
        numero: body?.numero,
        valorTotal: body?.valorTotal,
        itens,
        pagamento: (body?.pagamento as PagamentoDaCompra | null) ?? null,
      }),
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CompraRecusadaError || error?.name === "CompraRecusadaError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[Compras POST]", error);
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const r = await exigirEstoque();
    if (!r.ok) return r.resposta;
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe a compra." }, { status: 400 });

    const result = await prisma.$transaction((tx) => desfazerCompra(tx, { franchiseeId: r.acesso.lojaId, usuarioId: r.acesso.usuarioId, invoiceId: id }));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CompraRecusadaError || error?.name === "CompraRecusadaError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[Compras DELETE]", error);
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}
