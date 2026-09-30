/**
 * GET /api/store/relatorios/itens-vendidos — o "Itens vendidos" da Saipos.
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   porCategoria=1       agrupar produtos por categoria
 *   opcoesPorProduto=1   agrupar opções por produto (uma tabela só)
 *   apenasProdutos=1     a opção que é produto soma no produto (a Coca do combo)
 *   juntarNome=0         NÃO juntar produtos de mesmo nome (padrão: junta)
 *   pctPor=valor         percentual pelo valor (padrão: quantidade, como a Saipos)
 *   gruposOcultos=a,b    "Filtragem de opções": grupos escondidos
 *   formato=xlsx         baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/itens-vendidos.ts (testada em
 * scripts/teste-itens-vendidos.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { catalogoDoRelatorio } from "@/lib/relatorios/catalogo";
import { itensVendidos, type NoDoRelatorio } from "@/lib/relatorios/itens-vendidos";
import { canalDoRelatorio, fmtDia, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

const sim = (v: string | null) => v === "1" || v === "true";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const cfg = {
    porCategoria: sim(sp.get("porCategoria")),
    opcoesPorProduto: sim(sp.get("opcoesPorProduto")),
    apenasProdutos: sim(sp.get("apenasProdutos")),
    juntarMesmoNome: sp.get("juntarNome") !== "0",
    percentualPor: (sp.get("pctPor") === "valor" ? "valor" : "quantidade") as "valor" | "quantidade",
    categorias: new Set(ctx.filtros.categorias),
    produtos: new Set(ctx.filtros.produtos),
    gruposOcultos: new Set((sp.get("gruposOcultos") || "").split(",").map((s) => s.trim()).filter(Boolean)),
  };
  // Na Saipos "apenas produtos" e "opções por produto" não andam juntos.
  if (cfg.apenasProdutos) cfg.opcoesPorProduto = false;

  const [pedidos, catalogo] = await Promise.all([
    pedidosDoRelatorio(ctx, {
      select: {
        items: {
          select: {
            quantity: true, price: true, productName: true, menuProductId: true, comboSelections: true,
            menuProduct: { select: { id: true, name: true, category: true, active: true } },
          },
        },
      },
    }),
    catalogoDoRelatorio(ctx.lojaIds),
  ]);

  const resultado = itensVendidos(
    pedidos.map((p) => ({ franchiseeId: p.franchiseeId, canal: canalDoRelatorio(p), items: p.items || [] })),
    { mapasDe: catalogo.mapasDe, grupos: catalogo.grupos, vendaveisDe: catalogo.vendaveisDe },
    cfg,
  );
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, pedidos: pedidos.length, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  // A árvore em linhas agrupadas (os "+" do Excel), com uma coluna "Tipo"
  // para filtrar — na Saipos a árvore sai achatada com "- " e não dá para
  // separar produto de opção sem adivinhar.
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const filtrosEmTexto = [
    ctx.filtros.horaDe || ctx.filtros.horaAte ? `Horário ${ctx.filtros.horaDe || "00:00"}–${ctx.filtros.horaAte || "24:00"}` : "",
    ctx.filtros.tipos.length ? `Tipo: ${ctx.filtros.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    ctx.filtros.canais.length ? `Canal: ${ctx.filtros.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    ctx.filtros.categorias.length ? `Categorias: ${ctx.filtros.categorias.join(", ")}` : "",
    ctx.filtros.produtos.length ? `${ctx.filtros.produtos.length} produto(s) marcado(s)` : "",
  ].filter(Boolean).join(" · ");
  const agrupamento = [
    cfg.porCategoria && "por categoria",
    cfg.opcoesPorProduto && "opções por produto",
    cfg.apenasProdutos && "apenas produtos",
    cfg.juntarMesmoNome && "produtos de mesmo nome juntos",
    cfg.percentualPor === "valor" ? "% pelo valor" : "% pela quantidade",
  ].filter(Boolean).join(" · ");

  const ROTULO_TIPO: Record<string, string> = { categoria: "Categoria", produto: "Produto", grupo: "Grupo", opcao: "Opção" };
  const linhasDaArvore = (nos: NoDoRelatorio[], nivel: number, caminho: string[]): LinhaDaPlanilha[] => nos.flatMap((n) => {
    const negrito = n.filhos && n.filhos.length > 0;
    const categoria = n.tipo === "categoria" ? n.nome : caminho[0] || "";
    const produto = n.tipo === "produto" ? n.nome : n.tipo === "opcao" ? caminho[caminho.length - 1] || "" : "";
    const linha: LinhaDaPlanilha = {
      nivel,
      celulas: [
        { v: `${"    ".repeat(nivel)}${n.nome}`, estilo: negrito ? "negrito" : "texto" },
        ROTULO_TIPO[n.tipo],
        n.tipo === "grupo" ? "" : categoria,
        produto,
        { v: n.quantidade, estilo: negrito ? "qtdNegrito" : "qtd" },
        { v: n.valor, estilo: negrito ? "reaisNegrito" : "reais" },
        { v: n.pct / 100, estilo: negrito ? "pctNegrito" : "pct" },
      ],
    };
    return [linha, ...(n.filhos ? linhasDaArvore(n.filhos, nivel + 1, [...caminho, n.nome]) : [])];
  });

  const topo = (titulo: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: `Agrupamento: ${agrupamento}`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: ["Nome", "Tipo", "Categoria", "Produto", "Quantidade", "Valor", "%"], estilo: "cabecalho" },
  ];
  const abas: AbaDaPlanilha[] = [{
    nome: cfg.opcoesPorProduto ? "Itens e opções" : "Itens",
    congelarLinhas: 6,
    larguras: [48, 11, 26, 34, 12, 14, 9],
    linhas: [
      ...topo("Itens vendidos"),
      ...linhasDaArvore(resultado.itens, 0, []),
      { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", "", { v: resultado.total.quantidade, estilo: "qtdNegrito" }, { v: resultado.total.valor, estilo: "reaisNegrito" }, { v: 1, estilo: "pctNegrito" }] },
      { celulas: [] },
      { celulas: [{ v: "O valor do produto já inclui as opções escolhidas nele. Pedidos cancelados não entram. Meia pizza conta 0,5 de cada sabor.", estilo: "suave" }] },
    ],
  }];
  if (resultado.opcoes) {
    abas.push({
      nome: "Opções",
      congelarLinhas: 6,
      larguras: [48, 11, 26, 34, 12, 14, 9],
      linhas: [
        ...topo("Opções escolhidas"),
        ...linhasDaArvore(resultado.opcoes, 0, []),
        { celulas: [] },
        { celulas: [{ v: "As opções não se somam aos itens: o valor delas já está no preço do produto.", estilo: "suave" }] },
      ],
    });
  }
  const buffer = montarPlanilha(abas);
  return respostaDePlanilha(buffer, `itens-vendidos_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
