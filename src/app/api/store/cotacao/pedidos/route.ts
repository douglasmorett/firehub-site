import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { agruparPedido, type ItemEscolhido } from "@/lib/cotacao/pedido";
import { textoDoPedidoDeCompra } from "@/lib/cotacao/mensagens";
import { relogioDaLoja } from "@/lib/cotacao/agenda";
import { itensParaOEstoque, type ItemRecebido } from "@/lib/cotacao/estoque";
import { dadosDaLoja, fornecedoresDaLoja, rodadaDaVez } from "@/lib/cotacao/no-banco";
import { enfileirar, processarFila, proximaHoraLivre, ESPACO_ENTRE_ENVIOS_MS } from "@/lib/cotacao/fila";
import { CompraRecusadaError, lancarCompra } from "@/lib/cmv/lancar-compra";
import { conferirPausaDaCompra } from "@/lib/pausa-pelo-estoque-no-banco";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { paraEnvioWhatsApp } from "@/lib/telefone";

/**
 * Os pedidos de compra.
 *   GET   os últimos pedidos (status, total, itens)
 *   POST  { itens, observacao, textos?, enviar } — `enviar: false` devolve a
 *         prévia (agrupada por fornecedor, com total, mínimo, entrega e o texto
 *         pronto); `enviar: true` grava um pedido por fornecedor e põe o texto
 *         (o da prévia, ou o que o lojista editou) na fila do WhatsApp da loja.
 *   PUT   { id, acao: "recebido" | "cancelar" } — recebido dá entrada no
 *         estoque dos itens ligados a um insumo (lib/cmv/lancar-compra.ts, a
 *         mesma entrada da compra sem nota) e diz quais ficaram de fora.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  const [pedidos, fornecedores] = await Promise.all([
    prisma.pedidoDeCompra.findMany({ where: { franchiseeId: loja }, orderBy: { criadoEm: "desc" }, take: 40 }),
    prisma.fornecedor.findMany({ where: { franchiseeId: loja }, select: { id: true, nome: true } }),
  ]);
  const nome = new Map(fornecedores.map((f) => [f.id, f.nome]));
  return NextResponse.json({
    pedidos: pedidos.map((p) => ({ ...p, fornecedor: nome.get(p.fornecedorId) || "Fornecedor apagado" })),
  });
}

export async function POST(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const escolhidos: ItemEscolhido[] = (Array.isArray(corpo?.itens) ? corpo.itens : []).slice(0, 500).map((i: any) => ({
    produtoId: String(i?.produtoId || ""), fornecedorId: String(i?.fornecedorId || ""),
    quantidade: Number(i?.quantidade), preco: i?.preco === null || i?.preco === undefined || i?.preco === "" ? null : Number(i.preco),
  }));
  const [dados, fornecedores, produtos] = await Promise.all([
    dadosDaLoja(loja),
    fornecedoresDaLoja(loja, true),
    prisma.produtoDeCompra.findMany({ where: { franchiseeId: loja, ativo: true }, select: { id: true, nome: true, unidade: true } }),
  ]);
  const agora = new Date();
  const grupos = agruparPedido(escolhidos, produtos, fornecedores.map((f) => ({
    id: f.id, nome: f.nome, contato: f.contato, pedidoMinimo: f.pedidoMinimo,
    diasDeEntrega: f.diasDeEntrega, prazoEntregaDias: f.prazoEntregaDias, horarioLimite: f.horarioLimite,
  })), agora, dados.tz);
  if (!grupos.length) return NextResponse.json({ error: "Marque pelo menos um item com quantidade." }, { status: 400 });

  const minutos = relogioDaLoja(agora, dados.tz).minutos;
  const observacao = String(corpo?.observacao ?? "").trim().slice(0, 300) || null;
  const editados: Record<string, string> = corpo?.textos && typeof corpo.textos === "object" ? corpo.textos : {};
  const telefone = new Map(fornecedores.map((f) => [f.id, f.telefone]));
  const montados = grupos.map((g) => {
    const editado = String(editados[g.fornecedor.id] ?? "").trim();
    return {
      ...g,
      telefone: telefone.get(g.fornecedor.id) || null,
      texto: editado ? editado.slice(0, 4000) : textoDoPedidoDeCompra({ loja: dados.nome, grupo: g, minutos, observacao }),
    };
  });

  if (corpo?.enviar !== true) return NextResponse.json({ grupos: montados });

  const semWhats = montados.filter((g) => !g.telefone || !paraEnvioWhatsApp(g.telefone));
  if (semWhats.length) {
    return NextResponse.json({ error: `Sem WhatsApp cadastrado: ${semWhats.map((g) => g.fornecedor.nome).join(", ")}. Cadastre o número ou tire esses itens.` }, { status: 400 });
  }
  const rodada = await rodadaDaVez(loja, agora);
  let hora = await proximaHoraLivre(loja, agora);
  const criados: string[] = [];
  for (const g of montados) {
    const pedido = await prisma.pedidoDeCompra.create({
      data: {
        franchiseeId: loja, fornecedorId: g.fornecedor.id, rodadaId: rodada?.id ?? null, total: g.total, texto: g.texto,
        itens: g.itens.map((i) => ({ produtoId: i.produtoId, nome: i.nome, unidade: i.unidade, quantidade: i.quantidade, preco: i.preco })),
        criadoPor: r.s.usuarioId,
      },
    });
    await enfileirar([{ franchiseeId: loja, fornecedorId: g.fornecedor.id, pedidoId: pedido.id, tipo: "PEDIDO", telefone: g.telefone!, texto: g.texto, enviarApos: hora }]);
    hora = new Date(hora.getTime() + ESPACO_ENTRE_ENVIOS_MS);
    criados.push(pedido.id);
  }
  void processarFila({ franchiseeId: loja, tetoMs: Math.min(15 * 60_000, criados.length * ESPACO_ENTRE_ENVIOS_MS + 30_000) });
  return NextResponse.json({ ok: true, pedidos: criados.length });
}

export async function PUT(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const pedido = await prisma.pedidoDeCompra.findFirst({ where: { id: String(corpo?.id || ""), franchiseeId: loja } });
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  if (corpo?.acao === "cancelar") {
    if (pedido.status === "RECEBIDO") return NextResponse.json({ error: "Pedido já recebido: desfaça a compra em Estoque › Compras." }, { status: 400 });
    await prisma.$transaction([
      prisma.pedidoDeCompra.update({ where: { id: pedido.id }, data: { status: "CANCELADO" } }),
      prisma.cotacaoEnvio.updateMany({ where: { pedidoId: pedido.id, status: "FILA" }, data: { status: "CANCELADO", erro: "pedido cancelado" } }),
    ]);
    return NextResponse.json({ ok: true });
  }
  if (corpo?.acao !== "recebido") return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  if (pedido.status === "RECEBIDO") return NextResponse.json({ error: "Esse pedido já foi recebido." }, { status: 400 });

  const itens = (Array.isArray(pedido.itens) ? pedido.itens : []) as ItemRecebido[];
  const ids = [...new Set(itens.map((i) => i.produtoId))];
  const produtos = await prisma.produtoDeCompra.findMany({ where: { id: { in: ids }, franchiseeId: loja }, select: { id: true, stockItemId: true, fatorDoInsumo: true } });
  const insumoIds = [...new Set(produtos.map((p) => p.stockItemId).filter((x): x is string => !!x))];
  const insumos = insumoIds.length ? await prisma.stockItem.findMany({ where: { id: { in: insumoIds }, franchiseeId: loja }, select: { id: true, unit: true } }) : [];
  const { itens: entrada, fora } = itensParaOEstoque(itens, produtos, insumos);
  const fornecedor = await prisma.fornecedor.findFirst({ where: { id: pedido.fornecedorId, franchiseeId: loja }, select: { nome: true } });
  const { tz } = await dadosDaLoja(loja);

  let invoiceId: string | null = null;
  if (entrada.length) {
    try {
      const compra = await prisma.$transaction((tx) => lancarCompra(tx, {
        franchiseeId: loja, usuarioId: r.s.usuarioId, dia: hojeNaLoja(tz), origem: "SEM_NOTA",
        fornecedor: fornecedor?.nome || null, numero: null, itens: entrada,
        // A conta a pagar fica para o lojista (boleto, prazo): o pedido não sabe como ele pagou.
        pagamento: { forma: "NAO_LANCAR" },
      }));
      invoiceId = compra.invoiceId;
      await conferirPausaDaCompra(loja, invoiceId);
    } catch (err: any) {
      if (err instanceof CompraRecusadaError || err?.name === "CompraRecusadaError") return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }
  await prisma.pedidoDeCompra.update({ where: { id: pedido.id }, data: { status: "RECEBIDO", recebidoEm: new Date(), stockInvoiceId: invoiceId } });
  return NextResponse.json({ ok: true, noEstoque: entrada.length, fora });
}
