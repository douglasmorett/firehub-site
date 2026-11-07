import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { lerPreco, unidadeDeCompra } from "@/lib/cotacao/leitura";
import { listaDeTexto } from "@/lib/cotacao/no-banco";
import { normalizarNome } from "@/lib/cotacao/casamento";

/**
 * Os preços que a leitura não teve certeza, e o preço digitado à mão.
 *   PUT  { id, acao: "confirmar", produtoId }  é este produto — e a loja
 *        aprende: o nome que o fornecedor escreveu vira apelido do produto, e
 *        da próxima vez casa sozinho;
 *   PUT  { id, acao: "criar" }   não tinha o produto: cadastra com o nome lido e confirma;
 *   PUT  { id, acao: "ignorar" } não é da loja (frete, item que ela não compra);
 *   POST { fornecedorId, produtoId, preco }  o fornecedor passou por telefone.
 */
export const dynamic = "force-dynamic";

async function aprenderApelido(produtoId: string, nome: string) {
  const p = await prisma.produtoDeCompra.findUnique({ where: { id: produtoId }, select: { nome: true, apelidos: true } });
  if (!p) return;
  const apelidos = listaDeTexto(p.apelidos);
  const alvo = normalizarNome(nome);
  if (!alvo || normalizarNome(p.nome) === alvo || apelidos.some((a) => normalizarNome(a) === alvo)) return;
  await prisma.produtoDeCompra.update({ where: { id: produtoId }, data: { apelidos: [...apelidos, nome].slice(-30) } });
}

export async function PUT(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const preco = await prisma.cotacaoPreco.findFirst({ where: { id: String(corpo?.id || ""), franchiseeId: loja } });
  if (!preco) return NextResponse.json({ error: "Preço não encontrado." }, { status: 404 });

  if (corpo?.acao === "ignorar") {
    await prisma.cotacaoPreco.update({ where: { id: preco.id }, data: { status: "IGNORADO" } });
    return NextResponse.json({ ok: true });
  }
  let produtoId = String(corpo?.produtoId || "");
  if (corpo?.acao === "criar") {
    const existente = (await prisma.produtoDeCompra.findMany({ where: { franchiseeId: loja }, select: { id: true, nome: true } }))
      .find((p) => normalizarNome(p.nome) === normalizarNome(preco.nomeLido));
    produtoId = existente?.id || (await prisma.produtoDeCompra.create({
      data: { franchiseeId: loja, nome: preco.nomeLido.slice(0, 120), unidade: unidadeDeCompra(preco.unidadeLida) || "un" },
    })).id;
  } else if (corpo?.acao !== "confirmar") {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }
  const produto = produtoId ? await prisma.produtoDeCompra.findFirst({ where: { id: produtoId, franchiseeId: loja }, select: { id: true } }) : null;
  if (!produto) return NextResponse.json({ error: "Escolha o produto." }, { status: 400 });
  await prisma.cotacaoPreco.update({ where: { id: preco.id }, data: { produtoId: produto.id, status: "CONFIRMADO", confianca: 1 } });
  await aprenderApelido(produto.id, preco.nomeLido);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const valor = lerPreco(corpo?.preco);
  if (valor === null) return NextResponse.json({ error: "Digite o preço, por exemplo 42,90." }, { status: 400 });
  const [fornecedor, produto] = await Promise.all([
    prisma.fornecedor.findFirst({ where: { id: String(corpo?.fornecedorId || ""), franchiseeId: loja }, select: { id: true } }),
    prisma.produtoDeCompra.findFirst({ where: { id: String(corpo?.produtoId || ""), franchiseeId: loja }, select: { id: true, nome: true, unidade: true } }),
  ]);
  if (!fornecedor || !produto) return NextResponse.json({ error: "Fornecedor ou produto não encontrado." }, { status: 404 });
  await prisma.cotacaoPreco.create({
    data: { franchiseeId: loja, fornecedorId: fornecedor.id, produtoId: produto.id, nomeLido: produto.nome, unidadeLida: produto.unidade, preco: valor, confianca: 1, status: "CONFIRMADO" },
  });
  return NextResponse.json({ ok: true });
}
