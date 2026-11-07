import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { comparativoDaLoja, dadosDaLoja } from "@/lib/cotacao/no-banco";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { hojeNaLoja } from "@/lib/relatorios/base";

/**
 * GET — a tela principal: o comparativo (produto × fornecedor), a rodada da
 *       vez (quem foi pedido, quem respondeu, o que está na fila), os preços
 *       que a leitura não teve certeza (para confirmar) e as últimas mensagens
 *       dos fornecedores.
 * GET ?formato=xlsx — a mesma planilha em Excel (lib/planilha-xlsx.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  const { comparativo, rodada, fornecedores, produtos } = await comparativoDaLoja(loja);

  if (req.nextUrl.searchParams.get("formato") === "xlsx") {
    const { nome, tz } = await dadosDaLoja(loja);
    const cols = comparativo.colunas;
    const nomeDe = new Map(cols.map((c) => [c.id, c.nome]));
    const linhas: Array<LinhaDaPlanilha | any[]> = [
      { celulas: [{ v: `Cotação — ${nome} — ${hojeNaLoja(tz).split("-").reverse().join("/")}`, estilo: "titulo" }] },
      { celulas: ["Produto", "Categoria", "Unidade", ...cols.map((c) => c.nome), "Mais barato", "Melhor preço", "Economia"].map((v) => ({ v, estilo: "cabecalho" as const })) },
      ...comparativo.linhas.map((l) => [
        l.produto.nome, l.produto.categoria || "", l.produto.unidade,
        ...cols.map((c) => (l.precos[c.id] ? { v: l.precos[c.id].preco, estilo: l.menor?.fornecedorId === c.id ? ("reaisNegrito" as const) : ("reais" as const) } : "")),
        l.menor ? nomeDe.get(l.menor.fornecedorId) || "" : "",
        l.menor ? { v: l.menor.preco, estilo: "reaisNegrito" as const } : "",
        l.economia ? { v: l.economia, estilo: "reais" as const } : "",
      ]),
    ];
    const buffer = montarPlanilha([{ nome: "Comparativo", linhas, larguras: [34, 16, 9, ...cols.map(() => 14), 22, 13, 11], congelarLinhas: 2 }]);
    return respostaDePlanilha(buffer, `cotacao-${hojeNaLoja(tz)}.xlsx`);
  }

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [pendentes, respostas, fila] = await Promise.all([
    prisma.cotacaoPreco.findMany({
      where: { franchiseeId: loja, status: { in: ["SUGERIDO", "SEM_PRODUTO"] }, criadoEm: { gte: desde } },
      orderBy: { criadoEm: "desc" },
      take: 200,
      select: { id: true, fornecedorId: true, produtoId: true, nomeLido: true, unidadeLida: true, preco: true, validade: true, confianca: true, status: true, criadoEm: true },
    }),
    prisma.cotacaoResposta.findMany({
      where: { franchiseeId: loja, criadaEm: { gte: desde } },
      orderBy: { criadaEm: "desc" },
      take: 15,
      select: { id: true, fornecedorId: true, tipo: true, texto: true, status: true, linhas: true, criadaEm: true },
    }),
    prisma.cotacaoEnvio.groupBy({ by: ["status"], where: { franchiseeId: loja, status: { in: ["FILA", "ENVIANDO"] } }, _count: true }),
  ]);
  return NextResponse.json({
    comparativo,
    rodada,
    pendentes,
    respostas,
    naFila: fila.reduce((s, f) => s + f._count, 0),
    fornecedores: fornecedores.filter((f) => f.ativo).map((f) => ({
      id: f.id, nome: f.nome, contato: f.contato, telefone: f.telefone, pedidoMinimo: f.pedidoMinimo,
      diasDeEntrega: f.diasDeEntrega, prazoEntregaDias: f.prazoEntregaDias, horarioLimite: f.horarioLimite, categorias: f.categorias,
    })),
    categorias: [...new Set(produtos.map((p) => p.categoria).filter((c): c is string => !!c))].sort(),
  });
}
