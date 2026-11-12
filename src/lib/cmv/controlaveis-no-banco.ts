/**
 * O RELATÓRIO DOS CONTROLÁVEIS no banco: busca o que a conta pura
 * (lib/cmv/controlaveis.ts) precisa e grava a classe do insumo.
 *
 *   - venda líquida: a régua única, sem taxa de entrega (vendasLiquidasPorDia,
 *     a mesma do painel do CMV);
 *   - desperdícios do período: lib/cmv/desperdicio.ts (Estoque, FireCheck,
 *     Movimentar › Perda, QR e pedidos cancelados depois de produzidos);
 *   - refeição da equipe: pedidos com source EQUIPE (lib/lanche-da-equipe.ts),
 *     pelo custo da ficha no dia (lib/financeiro/cmv-do-financeiro.ts);
 *   - contagens: a janela entre duas COMPLETAS (janelaCompletaDoPeriodo) e os
 *     movimentos entre os dois fechamentos.
 *
 * Tabela própria, fora do schema.prisma, criada no primeiro uso:
 *   ClasseDoInsumo  (lojaId, stockItemId) → classe (ALIMENTO, EMBALAGEM,
 *                   CONDIMENTO, INDIRETO). Sem linha, vale o palpite pelo nome.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import { janelaDoPeriodo as janelaDeDatas } from "@/lib/relatorios/servidor";
import { diasNoPeriodo, naLoja, periodoAnterior, somarDias } from "@/lib/relatorios/base";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { janelaCompletaDoPeriodo, type ContagemFechada } from "@/lib/cmv/cmv-real";
import { vendasLiquidasPorDia } from "@/lib/cmv/painel";
import { desperdiciosDoPeriodo } from "@/lib/cmv/desperdicio";
import { entradasComCusto, insumosParaCusto } from "@/lib/cmv/contagem-no-banco";
import { custosNoDia } from "@/lib/cmv/custo-do-insumo";
import { prepararCustoDosItens } from "@/lib/financeiro/cmv-do-financeiro";
import { SOURCE_DO_LANCHE } from "@/lib/lanche-da-equipe-regras";
import {
  ORDEM_DAS_SECOES, comparar, ehClasse, ondeEstaODinheiro, pedidoDoMovimento, resumir, secaoDaEquipe, secoesDaContagem, secoesDosDescartes,
  semAcento, type AvisoDoRelatorio, type Classe, type IdDaSecao, type ItemContado, type ItemDaEquipe, type RelatorioDosControlaveis, type Secao,
} from "@/lib/cmv/controlaveis";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── A classe do insumo ──────────────────────────────────────────────────────

let tabelaOk = false;
export async function garantirTabelaDaClasse(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("classe-do-insumo", [
      `CREATE TABLE IF NOT EXISTS "ClasseDoInsumo" (
      "lojaId" TEXT NOT NULL,
      "stockItemId" TEXT NOT NULL,
      "classe" TEXT NOT NULL,
      "atualizadoPor" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClasseDoInsumo_pkey" PRIMARY KEY ("lojaId", "stockItemId")
    )`,
    ]);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Controláveis] Tabela ClasseDoInsumo falhou: ${err?.message}`);
    return false;
  }
}

export async function classesDaLoja(lojaId: string): Promise<Map<string, Classe>> {
  if (!(await garantirTabelaDaClasse())) return new Map();
  const linhas = await prisma.$queryRaw<{ stockItemId: string; classe: string }[]>(
    Prisma.sql`SELECT "stockItemId", "classe" FROM "ClasseDoInsumo" WHERE "lojaId" = ${lojaId}`,
  );
  return new Map(linhas.filter((l) => ehClasse(l.classe)).map((l) => [l.stockItemId, l.classe as Classe]));
}

/** Grava a classe escolhida pela loja; `null` volta ao palpite pelo nome. */
export async function salvarClasse(lojaId: string, stockItemId: string, classe: Classe | null, quem: string): Promise<boolean> {
  const insumo = await prisma.stockItem.findFirst({ where: { id: stockItemId, franchiseeId: lojaId }, select: { id: true } });
  if (!insumo) return false;
  if (!(await garantirTabelaDaClasse())) throw new Error("Não deu para gravar a classe agora.");
  if (classe == null) {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "ClasseDoInsumo" WHERE "lojaId" = ${lojaId} AND "stockItemId" = ${stockItemId}`);
  } else {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ClasseDoInsumo" ("lojaId", "stockItemId", "classe", "atualizadoPor", "updatedAt")
      VALUES (${lojaId}, ${stockItemId}, ${classe}, ${quem.slice(0, 120)}, now())
      ON CONFLICT ("lojaId", "stockItemId") DO UPDATE SET "classe" = EXCLUDED."classe", "atualizadoPor" = EXCLUDED."atualizadoPor", "updatedAt" = now()`);
  }
  return true;
}

// ── O relatório ─────────────────────────────────────────────────────────────

const lista = (nomes: string[], n = 6) => nomes.slice(0, n).join(", ") + (nomes.length > n ? ` e mais ${nomes.length - n}` : "");
const br = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

type Montado = Omit<RelatorioDosControlaveis, "anterior" | "loja" | "geradoEm">;

async function montarPeriodo(lojaId: string, tz: string, de: string, ate: string, comAvisos: boolean): Promise<Montado> {
  const avisos: AvisoDoRelatorio[] = [];

  // ── Contagens: a janela entre duas completas ───────────────────────────
  const fechadas = await prisma.contagemDeEstoque.findMany({
    where: { franchiseeId: lojaId, status: "FECHADA", dia: { lte: ate } },
    select: { id: true, dia: true, tipo: true, valorTotal: true, fechadaEm: true },
    orderBy: { dia: "asc" },
  });
  const contagens: ContagemFechada[] = fechadas.map((c) => ({ id: c.id, dia: c.dia, tipo: c.tipo, valorTotal: Number(c.valorTotal) || 0 }));
  const janela = janelaCompletaDoPeriodo(contagens, de, ate);
  const comJanela = janela.abertura && janela.fechamento ? { abertura: janela.abertura, fechamento: janela.fechamento } : null;
  const janelaDe = comJanela ? somarDias(comJanela.abertura.dia, 1) : de;
  const janelaAte = comJanela ? comJanela.fechamento.dia : ate;

  // ── Vendas (régua única) do período e da janela ────────────────────────
  const inicio = janelaDe < de ? janelaDe : de;
  const vendasPorDia = await vendasLiquidasPorDia(lojaId, tz, inicio, ate);
  const somaVenda = (a: string, b: string) => r2([...vendasPorDia].filter(([d]) => d >= a && d <= b).reduce((s, [, v]) => s + v, 0));
  const venda = somaVenda(de, ate);
  const vendaDaJanela = comJanela ? somaVenda(janelaDe, janelaAte) : venda;

  // ── Insumos, custos e classes ──────────────────────────────────────────
  const [insumos, entradas, classes, fichas] = await Promise.all([
    insumosParaCusto(lojaId),
    entradasComCusto(lojaId, tz),
    classesDaLoja(lojaId),
    prisma.productRecipe.findMany({ where: { menuProduct: { franchiseeId: lojaId } }, select: { stockItemId: true }, distinct: ["stockItemId"] }),
  ]);
  const custos = custosNoDia(insumos, entradas, comJanela ? comJanela.fechamento.dia : ate);
  const emFicha = new Set(fichas.map((f) => f.stockItemId));
  for (const i of insumos) for (const c of i.componentes) emFicha.add(c.insumoId);
  const insumosDoRelatorio = insumos.map((i) => ({
    ...i, custo: custos.get(i.id)?.custo ?? null, emFicha: emFicha.has(i.id), classeGravada: classes.get(i.id) ?? null,
  }));
  const unidadeDoInsumo = new Map(insumos.map((i) => [semAcento(i.nome), i.unidade]));

  // ── 1, 2, 3: desperdícios ──────────────────────────────────────────────
  const desperdicio = await desperdiciosDoPeriodo(lojaId, tz, de, ate);
  const descartes = secoesDosDescartes({ lancados: desperdicio.lancados, cancelados: desperdicio.cancelados, unidadeDoInsumo, venda });

  // ── 5: refeição da equipe ──────────────────────────────────────────────
  const { inicio: p0, fim: p1 } = janelaDeDatas(de, ate, tz);
  const daEquipe = await prisma.customerOrder.findMany({
    where: { franchiseeId: lojaId, source: SOURCE_DO_LANCHE, createdAt: { gte: p0, lt: p1 }, status: { notIn: [...STATUS_CANCELADOS] } },
    select: { id: true, createdAt: true, customerName: true, items: { select: { menuProductId: true, productName: true, quantity: true, price: true, comboSelections: true } } },
  });
  let itensDaEquipe: ItemDaEquipe[] = [];
  if (daEquipe.length) {
    const custo = await prepararCustoDosItens(lojaId, tz);
    itensDaEquipe = daEquipe.flatMap((o) => {
      const dia = naLoja(o.createdAt, tz).dia;
      return o.items.map((it) => {
        const c = custo.custoDoItem({ produtoId: it.menuProductId, nome: it.productName, quantidade: it.quantity, preco: it.price, escolhas: it.comboSelections }, dia);
        return { nome: c.nome || it.productName || "Item", quantidade: it.quantity, custo: c.custo, quando: o.createdAt.toISOString(), quem: o.customerName || null };
      });
    });
  }
  const equipe = secaoDaEquipe(itensDaEquipe, venda);

  // ── 4, 6, 7, 8: entre as contagens ─────────────────────────────────────
  let falta: string | null = null;
  if (janela.falta === "NENHUMA_CONTAGEM") falta = "Sem contagem completa no período. Feche uma contagem completa no início e outra no fim do período (Estoque › Contagem).";
  else if (janela.falta === "SO_UMA_CONTAGEM") falta = `Só a contagem completa de ${br(janela.abertura!.dia)} cai no período. Falta a contagem completa do fim do período para fechar a conta.`;

  const abertura = new Map<string, ItemContado>();
  const fechamento = new Map<string, ItemContado>();
  let movimentos: { stockItemId: string; tipo: string; quantidade: number; notes: string | null; sourceRef: string | null }[] = [];
  const pedidosDaEquipe = new Set<string>();
  if (comJanela) {
    const info = new Map(fechadas.map((c) => [c.id, c]));
    const linhas = await prisma.contagemItem.findMany({
      where: { contagemId: { in: [comJanela.abertura.id, comJanela.fechamento.id] } },
      select: { contagemId: true, stockItemId: true, quantidade: true, unidade: true, origem: true },
    });
    for (const l of linhas) {
      const alvo = l.contagemId === comJanela.abertura.id ? abertura : fechamento;
      alvo.set(l.stockItemId, { quantidade: Number(l.quantidade) || 0, unidade: l.unidade, contado: l.origem === "CONTADO" });
    }
    // Os movimentos entre os dois FECHAMENTOS: o que veio depois da abertura
    // fechar e até a contagem final fechar. Contagem antiga sem a hora do
    // fechamento: o fim do dia operacional dela.
    const desde = info.get(comJanela.abertura.id)?.fechadaEm ?? janelaDeDatas(comJanela.abertura.dia, comJanela.abertura.dia, tz).fim;
    const ateQuando = info.get(comJanela.fechamento.id)?.fechadaEm ?? janelaDeDatas(comJanela.fechamento.dia, comJanela.fechamento.dia, tz).fim;
    const ts = await prisma.stockTransaction.findMany({
      where: { stockItem: { franchiseeId: lojaId }, createdAt: { gt: desde, lte: ateQuando } },
      select: { stockItemId: true, type: true, quantity: true, notes: true, sourceRef: true },
    });
    movimentos = ts.map((t) => ({ stockItemId: t.stockItemId, tipo: t.type, quantidade: t.quantity, notes: t.notes, sourceRef: t.sourceRef }));
    // A baixa de venda que é da refeição da equipe: pelo pedido dela.
    const pedidos = [...new Set(movimentos.filter((m) => m.tipo === "SALE" || m.tipo === "INPUT").map(pedidoDoMovimento).filter(Boolean) as string[])];
    for (let i = 0; i < pedidos.length; i += 1000) {
      const doLote = await prisma.customerOrder.findMany({ where: { id: { in: pedidos.slice(i, i + 1000) }, source: SOURCE_DO_LANCHE }, select: { id: true } });
      for (const p of doLote) pedidosDaEquipe.add(p.id);
    }
  }
  const daContagem = secoesDaContagem({ insumos: insumosDoRelatorio, abertura, fechamento, movimentos, pedidosDaEquipe, venda: vendaDaJanela, falta });

  const secoes: Record<IdDaSecao, Secao> = {
    ...descartes,
    break: equipe,
    condimentos: daContagem.condimentos,
    inventario: daContagem.inventario,
    rendimento: daContagem.rendimento,
    indiretos: daContagem.indiretos,
  };

  // O resumo soma seções de recortes diferentes (período e janela): a % de
  // cada uma é sobre a venda do seu recorte; o total, sobre a venda do período.
  const resumo = resumir(secoes, venda);

  if (comAvisos) {
    if (falta) avisos.push({ tipo: "info", texto: `${falta} Sem isso, Condimentos, Indiretos, Diferença de inventário e Rendimento ficam em branco.` });
    else if (janela.parcial) avisos.push({ tipo: "info", texto: `As seções da contagem valem de ${br(janelaDe)} a ${br(janelaAte)} (as contagens completas mais próximas do período), com a venda desses dias.` });
    if (daContagem.naoContados.length) avisos.push({ tipo: "atencao", texto: `${daContagem.naoContados.length} insumo(s) não foram contados nas duas contagens e ficaram fora da diferença: ${lista(daContagem.naoContados)}.` });
    if (daContagem.semCusto.length) avisos.push({ tipo: "atencao", texto: `Insumo(s) sem custo (entram com R$ 0): ${lista(daContagem.semCusto)}. Lance uma compra deles ou ponha o custo no cadastro.` });
    if (daContagem.alimentosSemFicha.length) avisos.push({ tipo: "info", texto: `Alimento(s) fora de qualquer ficha técnica entraram em Condimentos: ${lista(daContagem.alimentosSemFicha)}. Se são de ficha, monte a ficha; se são embalagem/descartável, troque a classe na linha.` });
    const descartesSemValor = secoes.completo.semValor + secoes.incompleto.semValor + secoes.seguranca.semValor;
    if (descartesSemValor) avisos.push({ tipo: "atencao", texto: `${descartesSemValor} descarte(s) sem valor (produto sem ficha e sem custo, insumo sem custo ou pedido cancelado sem ficha): ficaram fora do total.` });
    if (secoes.break.semValor) avisos.push({ tipo: "atencao", texto: `${secoes.break.semValor} item(ns) da refeição da equipe sem custo (produto sem ficha técnica).` });

    // Produto vendido sem ficha e sem custo: a diferença de inventário dele sai como "sumiu".
    const vendidos = await prisma.customerOrderItem.findMany({
      where: { order: { franchiseeId: lojaId, createdAt: { gte: p0, lt: p1 }, status: { notIn: [...STATUS_CANCELADOS] } }, menuProductId: { not: null } },
      select: { menuProductId: true }, distinct: ["menuProductId"],
    });
    if (vendidos.length) {
      const semFicha = await prisma.menuProduct.findMany({
        where: { id: { in: vendidos.map((v) => v.menuProductId as string) }, isCombo: false, recipeItems: { none: {} }, OR: [{ cost: null }, { cost: { lte: 0 } }] },
        select: { name: true }, orderBy: { name: "asc" },
      });
      if (semFicha.length) avisos.push({ tipo: "atencao", texto: `${semFicha.length} produto(s) vendidos no período sem ficha técnica nem custo: ${lista(semFicha.map((p) => p.name))}. A venda deles não explica o insumo que gastaram — ele aparece como diferença.` });
    }
    if (venda <= 0) avisos.push({ tipo: "info", texto: "Sem venda no período: as porcentagens ficam em branco." });
  }

  return {
    periodo: { de, ate },
    venda,
    contagem: comJanela ? { de: janelaDe, ate: janelaAte, venda: vendaDaJanela, parcial: janela.parcial } : null,
    secoes,
    resumo,
    ondeEstaODinheiro: ondeEstaODinheiro(secoes, 10),
    avisos,
  };
}

export async function montarControlaveis(e: { lojaId: string; nomeDaLoja: string; tz: string; de: string; ate: string }): Promise<RelatorioDosControlaveis> {
  const atual = await montarPeriodo(e.lojaId, e.tz, e.de, e.ate, true);
  let anterior: RelatorioDosControlaveis["anterior"] = null;
  if (diasNoPeriodo(e.de, e.ate) <= 186) {
    const p = periodoAnterior(e.de, e.ate);
    const antes = await montarPeriodo(e.lojaId, e.tz, p.de, p.ate, false);
    anterior = { de: p.de, ate: p.ate, resumo: antes.resumo, comparacao: comparar(atual.resumo, antes.resumo) };
  }
  return { ...atual, loja: e.nomeDaLoja, geradoEm: new Date().toISOString(), anterior };
}

export { ORDEM_DAS_SECOES };
