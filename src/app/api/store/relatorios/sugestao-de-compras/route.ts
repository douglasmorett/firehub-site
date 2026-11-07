/**
 * /api/store/relatorios/sugestao-de-compras — a Lista de compras: por insumo,
 * saldo, mínimo, ideal, consumo médio por dia, quantos dias dura e quanto
 * comprar, agrupado por fornecedor (lib/relatorios/sugestao-de-compras.ts).
 *
 * GET   base=7|14|28|56   dias de vendas para a média (padrão 28, terminando ontem)
 *       modo=ideal|dias   comprar até o ideal (padrão) ou para N dias
 *       dias=N            os dias do modo "dias" (1 a 60, padrão 7)
 *       formato=xlsx      a planilha
 * PATCH { insumoId, ideal }  grava o estoque ideal ("" apaga) — a lista edita na hora.
 *
 * O consumo é das vendas × a ficha técnica de HOJE (lib/relatorios/consumo-
 * pela-ficha.ts): é uma previsão, e a loja que acabou de cadastrar a ficha já
 * tem lista. Hoje fica fora da média (o dia não acabou); o saldo é o de agora.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { consumoDasLojas } from "@/lib/relatorios/consumo-pela-ficha-no-banco";
import { quantidadeLegivel, separarPreparos, totalDosDias } from "@/lib/relatorios/consumo-pela-ficha";
import { chaveDoFornecedor, listaDeCompras, type InsumoDaLista, type LinhaDaLista, type ModoDaLista } from "@/lib/relatorios/sugestao-de-compras";
import { diasNoPeriodo, fmtDia, somarDias } from "@/lib/relatorios/base";
import { gravarIdeal, lerIdeal } from "@/lib/cmv/ideal-no-banco";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const BASES = [7, 14, 28, 56];

const ROTULO_DA_SITUACAO: Record<LinhaDaLista["situacao"], string> = {
  acabou: "Acabou", abaixoDoMinimo: "Abaixo do mínimo", comprar: "Comprar", ok: "Ok", semUso: "Sem uso",
};

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const base = BASES.includes(Number(sp.get("base"))) ? Number(sp.get("base")) : 28;
  const diasDoModo = Math.min(60, Math.max(1, Math.round(Number(sp.get("dias")) || 7)));
  const modo: ModoDaLista = sp.get("modo") === "dias" ? { modo: "dias", dias: diasDoModo } : { modo: "ideal" };
  const de = somarDias(ctx.hoje, -base);
  const ate = somarDias(ctx.hoje, -1);

  const { insumos, consumo, primeiroDiaComVenda, temFicha } = await consumoDasLojas(ctx, janelaDoPeriodo(de, ate, ctx.tz));
  // Loja que começou a vender no FireHub há 10 dias: a média é sobre 10 dias, não 28.
  const inicioReal = primeiroDiaComVenda && primeiroDiaComVenda > de ? primeiroDiaComVenda : de;
  const diasDaBase = diasNoPeriodo(inicioReal, ate);

  const { comprados, preparos } = separarPreparos(totalDosDias(consumo.porDia), insumos);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const loja = cabecalho.lojas.join(" / ");
  const paraLista = (i: (typeof insumos)[number]): InsumoDaLista => ({
    id: i.id, nome: i.nome, unidade: i.unidade, lojaId: i.lojaId, saldo: i.saldo,
    minimo: i.minimo, ideal: i.ideal, custo: i.custoHoje, fornecedor: i.fornecedor,
  });
  const compras = listaDeCompras({ insumos: insumos.filter((i) => !i.preparo).map(paraLista), consumo: comprados, diasDaBase, modo, loja });
  // O fornecedor cadastrado na Cotação automática com o mesmo nome do insumo
  // empresta o WhatsApp: o pedido já abre na conversa dele. Sem a tabela (boot
  // ainda não criou) a lista segue sem número.
  const cadastrados = await prisma.fornecedor.findMany({
    where: { franchiseeId: { in: ctx.lojaIds }, ativo: true, telefone: { not: null } },
    select: { nome: true, telefone: true },
  }).catch(() => []);
  const telefoneDe = new Map(cadastrados.map((f) => [chaveDoFornecedor(f.nome), f.telefone]));
  for (const g of compras.fornecedores) g.telefone = telefoneDe.get(chaveDoFornecedor(g.fornecedor)) ?? null;
  const producao = listaDeCompras({ insumos: insumos.filter((i) => i.preparo).map(paraLista), consumo: preparos, diasDaBase, modo, loja });
  // O valor do estoque é de TUDO o que está na prateleira, preparo pronto incluído.
  const valorDoEstoque = Math.round((compras.totais.valorDoEstoque + producao.totais.valorDoEstoque) * 100) / 100;
  const semFicha = [...consumo.semFicha].map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({
      ...cabecalho,
      base: { de: inicioReal, ate, dias: diasDaBase, pedida: base },
      modo: modo.modo, dias: diasDoModo, temFicha, insumosCadastrados: insumos.length,
      compras, preparos: producao.linhas.filter((l) => l.situacao !== "semUso"),
      valorDoEstoque, insumosSemCusto: compras.totais.insumosSemCusto + producao.totais.insumosSemCusto,
      semFicha: { produtos: semFicha.slice(0, 15), total: semFicha.length }, incompletos: consumo.incompletos,
    });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const regra = modo.modo === "dias" ? `comprar para ${diasDoModo} dia(s) de consumo` : "comprar até o estoque ideal (sem ideal: o consumo de 7 dias)";
  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Lista de compras — ${loja}`, estilo: "titulo" }] },
    { celulas: [{ v: `Gerada em ${fmtDia(ctx.hoje)} · consumo médio de ${fmtDia(inicioReal)} a ${fmtDia(ate)} (${diasDaBase} dias), pela ficha técnica de hoje · ${regra}`, estilo: "suave" }] },
    { celulas: [] },
  ];
  const cab = ["Fornecedor", "Insumo", "Comprar", "Unidade", "Saldo", "Mínimo", "Ideal", "Consumo/dia", "Dura (dias)", "Custo unit.", "Custo da compra", "Situação"];
  const linha = (l: LinhaDaLista): LinhaDaPlanilha => ({
    celulas: [
      l.fornecedor, l.nome, { v: l.comprar, estilo: "qtdNegrito" }, l.unidade, { v: l.saldo, estilo: "qtd" },
      { v: l.minimo, estilo: "qtd" }, l.ideal != null ? { v: l.ideal, estilo: "qtd" } : l.idealSugerido != null ? { v: `${l.idealSugerido} (sugerido)`, estilo: "suave" } : "",
      { v: l.consumoPorDia, estilo: "qtd" }, { v: l.duraDias, estilo: "qtd" }, { v: l.custoUnitario, estilo: "qtd" },
      l.custoDaCompra == null ? { v: "sem custo", estilo: "suave" } : { v: l.custoDaCompra, estilo: "reais" },
      ROTULO_DA_SITUACAO[l.situacao],
    ],
  });
  const aComprar = compras.fornecedores.flatMap((f) => f.itens);
  const buffer = montarPlanilha([
    {
      nome: "Lista de compras",
      congelarLinhas: topo.length + 1,
      larguras: [24, 36, 12, 9, 12, 10, 16, 12, 11, 12, 15, 16],
      linhas: [
        ...topo,
        { celulas: cab, estilo: "cabecalho" },
        ...(aComprar.length ? aComprar.map(linha) : [{ celulas: [{ v: "Nada para comprar agora.", estilo: "suave" as const }] }]),
        { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", "", "", "", "", "", "", "", { v: compras.totais.aComprar, estilo: "reaisNegrito" }] },
        { celulas: [] },
        ...compras.fornecedores.map((f) => ({ celulas: [{ v: `${f.fornecedor}: ${f.itens.map((i) => `${quantidadeLegivel(i.comprar, i.unidade)} ${i.nome}`).join(" · ")}`, estilo: "suave" as const }] })),
      ],
    },
    {
      nome: "Todos os insumos",
      congelarLinhas: topo.length + 1,
      larguras: [24, 36, 12, 9, 12, 10, 16, 12, 11, 12, 15, 16],
      linhas: [...topo, { celulas: cab, estilo: "cabecalho" }, ...compras.linhas.map(linha), ...producao.linhas.map((l) => linha({ ...l, fornecedor: "Preparo (produzir)" }))],
    },
  ]);
  return respostaDePlanilha(buffer, `lista-de-compras_${ctx.hoje}.xlsx`);
}

export async function PATCH(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const corpo = await req.json().catch(() => null);
  const lido = lerIdeal(corpo?.ideal);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const achou = await gravarIdeal(r.valor.lojasDaConta.map((l) => l.id), String(corpo?.insumoId || ""), lido.ideal);
  if (!achou) return NextResponse.json({ error: "Insumo não encontrado nesta loja." }, { status: 404 });
  return NextResponse.json({ ok: true, ideal: lido.ideal });
}
