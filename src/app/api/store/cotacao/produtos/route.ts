import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { conferirProduto, type ProdutoConferido } from "@/lib/cotacao/cadastro";
import { produtosDaLoja } from "@/lib/cotacao/no-banco";
import { normalizarNome } from "@/lib/cotacao/casamento";

/**
 * Os produtos que a loja COMPRA.
 *   GET                       a lista e os insumos do estoque (para ligar)
 *   POST { produto }          cadastra um
 *   POST { lista: [...] }     cadastra vários (colar texto, ou o que a IA leu e o lojista conferiu)
 *   PUT  { id, ...campos }    edita
 *   DELETE ?id=               apaga (os preços dele vão junto)
 *
 * Ligado a um insumo, o saldo e o mínimo de lá dizem "precisa comprar" no
 * comparativo, e o pedido recebido entra no estoque com o custo.
 */
export const dynamic = "force-dynamic";

async function insumosDaLoja(franchiseeId: string) {
  return prisma.stockItem.findMany({
    where: { franchiseeId, active: true },
    orderBy: { name: "asc" },
    take: 1000,
    select: { id: true, name: true, unit: true, quantity: true, minQuantity: true },
  });
}

async function conferirInsumos(franchiseeId: string, lista: ProdutoConferido[]) {
  const ids = [...new Set(lista.map((p) => p.stockItemId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const daLoja = new Set((await prisma.stockItem.findMany({ where: { id: { in: ids }, franchiseeId }, select: { id: true } })).map((i) => i.id));
  // Insumo de outra loja (ou apagado) não liga: fica sem ligação, em vez de recusar a lista inteira.
  for (const p of lista) if (p.stockItemId && !daLoja.has(p.stockItemId)) { p.stockItemId = null; p.fatorDoInsumo = null; }
}

export async function GET() {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const [produtos, insumos] = await Promise.all([produtosDaLoja(r.s.franchiseeId), insumosDaLoja(r.s.franchiseeId)]);
  return NextResponse.json({ produtos, insumos });
}

export async function POST(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const entradas: any[] = Array.isArray(corpo?.lista) ? corpo.lista.slice(0, 300) : [corpo?.produto];

  // O mesmo nome já cadastrado não entra de novo (colar a lista duas vezes não duplica).
  const existentes = new Set((await prisma.produtoDeCompra.findMany({ where: { franchiseeId: loja }, select: { nome: true } })).map((p) => normalizarNome(p.nome)));
  const novos: ProdutoConferido[] = [];
  const repetidos: string[] = [];
  let erro: string | null = null;
  for (const e of entradas) {
    const c = conferirProduto(e);
    if (!c.ok) { erro = erro || c.erro; continue; }
    const chave = normalizarNome(c.dados.nome);
    if (existentes.has(chave)) { repetidos.push(c.dados.nome); continue; }
    existentes.add(chave);
    novos.push(c.dados);
  }
  if (!novos.length) {
    return NextResponse.json({ error: repetidos.length ? `Já estão cadastrados: ${repetidos.slice(0, 5).join(", ")}${repetidos.length > 5 ? "…" : ""}.` : erro || "Nada para cadastrar." }, { status: 400 });
  }
  await conferirInsumos(loja, novos);
  await prisma.produtoDeCompra.createMany({ data: novos.map((d) => ({ ...d, franchiseeId: loja })) });
  return NextResponse.json({ ok: true, cadastrados: novos.length, repetidos, produtos: await produtosDaLoja(loja) });
}

export async function PUT(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const id = String(corpo?.id || "");
  const atual = id ? await prisma.produtoDeCompra.findFirst({ where: { id, franchiseeId: loja }, select: { id: true } }) : null;
  if (!atual) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  const c = conferirProduto(corpo);
  if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 400 });
  await conferirInsumos(loja, [c.dados]);
  await prisma.produtoDeCompra.update({ where: { id }, data: { ...c.dados, atualizadoEm: new Date() } });
  return NextResponse.json({ ok: true, produtos: await produtosDaLoja(loja) });
}

export async function DELETE(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  const id = req.nextUrl.searchParams.get("id") || "";
  const atual = id ? await prisma.produtoDeCompra.findFirst({ where: { id, franchiseeId: loja }, select: { id: true } }) : null;
  if (!atual) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  await prisma.$transaction([
    prisma.cotacaoPreco.deleteMany({ where: { franchiseeId: loja, produtoId: id } }),
    prisma.produtoDeCompra.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true, produtos: await produtosDaLoja(loja) });
}
