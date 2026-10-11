/**
 * O PAINEL DE DADOS SENSÍVEIS — CMV real, CMO e custo primário de um período.
 *
 * Junta, para a loja e o período pedidos:
 *   - as contagens fechadas → a janela do CMV (lib/cmv/cmv-real.ts);
 *   - as compras lançadas no estoque, pelo DIA em que a mercadoria entrou e só
 *     dos insumos que entram no CMV;
 *   - as vendas pela régua única (lib/relatorios/regua-da-venda.ts), sem a taxa
 *     de entrega: CMV % é sobre o que se vende de comida, não de frete;
 *   - a folha e as diárias → CMO (lib/cmv/cmo.ts);
 *   - o consumo real por insumo entre as duas contagens (onde está o dinheiro);
 *   - os avisos do que deixa o número errado (compra lançada fora do estoque,
 *     entrada sem compra, item contado sem custo).
 */
import { prisma } from "@/lib/prisma";
import { STATUS_FORA_DA_VENDA, naLoja, somarDias } from "@/lib/relatorios/base";
import { entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import { janelaDoPeriodo as janelaDeDatas } from "@/lib/relatorios/servidor";
import {
  FAIXA_DE_ATENCAO, META_PADRAO_DO_CMV, META_PADRAO_DO_CMO, cmvEntre, janelaDoPeriodo, lerMeta, trechosDaJanela, zonaDoCmv,
  type CmvDoTrecho, type ContagemFechada, type DiaDoCmv, type ZonaDoCmv,
} from "@/lib/cmv/cmv-real";
import { cmoDoPeriodo, ehMaoDeObra, type CmoDoPeriodo } from "@/lib/cmv/cmo";
import { NOMES_DOS_DIAS_DA_SEMANA, lerSemanaDoCmv, type SemanaDoCmv } from "@/lib/cmv/semana-do-cmv";
import { entradasComCusto, insumosParaCusto } from "@/lib/cmv/contagem-no-banco";
import { custosNoDia } from "@/lib/cmv/custo-do-insumo";
import { lerComissoesDosApps } from "@/lib/financeiro/dre";

export { segundaDaSemana } from "@/lib/cmv/cmv-real";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (parte: number, todo: number) => (todo > 0 ? r1((parte / todo) * 100) : null);

export type Aviso = { tipo: "erro" | "atencao" | "info"; texto: string };

/**
 * O que falta preencher para os números da loja serem reais. A tela mostra no
 * topo, com o botão que leva direto ao lugar de preencher.
 */
export type Pendencia = {
  chave: string;
  ok: boolean;
  titulo: string;
  detalhe: string;
  /** Tela para abrir, ou aba desta tela. */
  href?: string;
  aba?: "equipe" | "custofixo" | "metas";
  rotulo: string;
};

export type Painel = {
  loja: string;
  hoje: string;
  periodo: { de: string; ate: string };
  metas: { cmv: number; cmo: number; faixa: number };
  /** A semana do CMV da loja (segue o dia da contagem completa). */
  semana: SemanaDoCmv;
  cmv: {
    abertura: { dia: string; tipo: string } | null;
    fechamento: { dia: string; tipo: string } | null;
    parcial: boolean;
    falta: null | "NENHUMA_CONTAGEM" | "SO_UMA_CONTAGEM";
    resultado: CmvDoTrecho | null;
    zona: ZonaDoCmv;
    trechos: CmvDoTrecho[];
  };
  vendas: { total: number; porDia: { dia: string; vendas: number; compras: number }[] };
  compras: { total: number; porFornecedor: { fornecedor: string; valor: number; compras: number }[]; foraDoCmv: number };
  cmo: CmoDoPeriodo & { pct: number | null; zona: ZonaDoCmv };
  custoPrimario: { valor: number; pct: number | null; de: string; ate: string } | null;
  consumo: { nome: string; unidade: string; quantidade: number; valor: number }[];
  perdas: { valor: number; itens: { nome: string; unidade: string; quantidade: number; valor: number }[] };
  contagens: { ultima: { dia: string; tipo: string } | null; total: number; marcadosNoDia: number };
  avisos: Aviso[];
  pendencias: Pendencia[];
};

export async function montarPainel(e: { lojaId: string; nomeDaLoja: string; tz: string; goals: unknown; hoje: string; de: string; ate: string }): Promise<Painel> {
  const { lojaId, tz, de, ate } = e;
  const metaCmv = lerMeta(e.goals, "cmvPct", META_PADRAO_DO_CMV);
  const metaCmo = lerMeta(e.goals, "cmoPct", META_PADRAO_DO_CMO);
  const avisos: Aviso[] = [];

  // ── Contagens e janela ─────────────────────────────────────────────────
  const fechadas = await prisma.contagemDeEstoque.findMany({
    where: { franchiseeId: lojaId, status: "FECHADA" },
    select: { id: true, dia: true, tipo: true, valorTotal: true },
    orderBy: { dia: "asc" },
  });
  const contagens: ContagemFechada[] = fechadas.map((c) => ({ id: c.id, dia: c.dia, tipo: c.tipo, valorTotal: Number(c.valorTotal) || 0 }));
  const janela = janelaDoPeriodo(contagens.filter((c) => c.dia <= ate), de, ate);

  // Os dias que precisam de compra e venda: o período e, se a janela começa
  // antes (a contagem da véspera), desde o dia seguinte à abertura.
  const inicio = janela.abertura && somarDias(janela.abertura.dia, 1) < de ? somarDias(janela.abertura.dia, 1) : de;
  const fim = ate;

  // ── Compras ────────────────────────────────────────────────────────────
  const notas = await prisma.stockInvoice.findMany({
    where: { franchiseeId: lojaId, canceladaEm: null, dia: { gte: inicio, lte: fim } },
    select: { id: true, dia: true, supplier: true },
  });
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  const entradas = notas.length
    ? await prisma.stockTransaction.findMany({
        where: { stockInvoiceId: { in: notas.map((n) => n.id) }, type: "INPUT" },
        select: { stockInvoiceId: true, quantity: true, unitCost: true, stockItem: { select: { entraNoCmv: true } } },
      })
    : [];
  const comprasPorDia = new Map<string, number>();
  const porFornecedor = new Map<string, { valor: number; notas: Set<string> }>();
  let foraDoCmv = 0;
  for (const t of entradas) {
    const n = notaPorId.get(t.stockInvoiceId as string)!;
    const valor = (Number(t.unitCost) || 0) * t.quantity;
    if (t.stockItem.entraNoCmv === false) { foraDoCmv += valor; continue; }
    comprasPorDia.set(n.dia!, (comprasPorDia.get(n.dia!) || 0) + valor);
    if (n.dia! >= de && n.dia! <= ate) {
      const f = (n.supplier || "Sem fornecedor").trim();
      const atual = porFornecedor.get(f) || { valor: 0, notas: new Set<string>() };
      atual.valor += valor;
      atual.notas.add(n.id);
      porFornecedor.set(f, atual);
    }
  }

  // ── Vendas (régua única, sem taxa de entrega) ──────────────────────────
  const { inicio: t0, fim: t1 } = janelaDeDatas(inicio, fim, tz);
  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId: lojaId, createdAt: { gte: t0, lt: t1 }, status: { notIn: [...STATUS_FORA_DA_VENDA] } },
    select: { createdAt: true, status: true, totalAmount: true, deliveryFee: true, items: { select: { quantity: true, price: true } } },
  });
  const vendasPorDia = new Map<string, number>();
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    const dia = naLoja(p.createdAt, tz).dia;
    const valor = (Number(p.totalAmount) || 0) - (Number(p.deliveryFee) || 0);
    vendasPorDia.set(dia, (vendasPorDia.get(dia) || 0) + valor);
  }

  const dias: DiaDoCmv[] = [];
  for (let d = inicio, guarda = 0; d <= fim && guarda < 800; d = somarDias(d, 1), guarda++) {
    dias.push({ dia: d, compras: r2(comprasPorDia.get(d) || 0), vendas: r2(vendasPorDia.get(d) || 0) });
  }
  const doPeriodo = dias.filter((d) => d.dia >= de && d.dia <= ate);
  const vendasDoPeriodo = r2(doPeriodo.reduce((s, d) => s + d.vendas, 0));

  // ── CMV ────────────────────────────────────────────────────────────────
  const resultado = janela.abertura && janela.fechamento ? cmvEntre(janela.abertura, janela.fechamento, dias) : null;
  const trechos = trechosDaJanela(contagens, janela, dias);
  if (resultado && resultado.cmv < 0) {
    avisos.push({ tipo: "erro", texto: "O CMV deu negativo: o estoque final vale mais que o inicial mais as compras. Quase sempre é compra que entrou no estoque sem ser lançada em Compras, ou contagem com quantidade errada." });
  }

  // ── CMO ────────────────────────────────────────────────────────────────
  const [pessoas, despesas] = await Promise.all([
    prisma.pessoaDaFolha.findMany({ where: { franchiseeId: lojaId }, orderBy: { nome: "asc" } }),
    prisma.despesaLancada.findMany({ where: { franchiseeId: lojaId, dia: { gte: inicio, lte: fim } }, select: { dia: true, valor: true, categoria: true, descricao: true } }),
  ]);
  const cmoPeriodo = cmoDoPeriodo(pessoas, despesas, de, ate);
  const cmoPct = pct(cmoPeriodo.total, vendasDoPeriodo);
  if (pessoas.length === 0) avisos.push({ tipo: "atencao", texto: "Ninguém cadastrado na folha: o CMO está só com as diárias lançadas. Cadastre a equipe na aba Equipe." });

  let custoPrimario: Painel["custoPrimario"] = null;
  if (resultado) {
    const cmoJanela = cmoDoPeriodo(pessoas, despesas, resultado.de, resultado.ate);
    const valor = r2(resultado.cmv + cmoJanela.total);
    custoPrimario = { valor, pct: pct(valor, resultado.vendas), de: resultado.de, ate: resultado.ate };
  }

  // Compra lançada como despesa não entra no CMV: fica de fora do número.
  const compraComoDespesa = despesas
    .filter((d) => d.dia >= de && d.dia <= ate && /insumo|embalage/i.test(d.categoria) && !ehMaoDeObra(d.categoria))
    .reduce((s, d) => s + d.valor, 0);
  if (compraComoDespesa > 0) {
    avisos.push({ tipo: "atencao", texto: `R$ ${fmt(compraComoDespesa)} de compras foram lançados como despesa (Financeiro › Despesas) neste período. Despesa não entra no estoque nem no CMV: compra de insumo e embalagem se lança em Estoque › Compras.` });
  }

  // ── Consumo real por insumo e itens sem custo (entre as duas contagens) ─
  let consumo: Painel["consumo"] = [];
  if (janela.abertura && janela.fechamento) {
    const linhas = await prisma.contagemItem.findMany({
      where: { contagemId: { in: [janela.abertura.id, janela.fechamento.id] } },
      select: { contagemId: true, stockItemId: true, nome: true, unidade: true, quantidade: true, custoUnitario: true, valor: true, stockItem: { select: { entraNoCmv: true } } },
    });
    const abre = new Map(linhas.filter((l) => l.contagemId === janela.abertura!.id).map((l) => [l.stockItemId, l]));
    const fecha = linhas.filter((l) => l.contagemId === janela.fechamento!.id);
    const compradoNoTrecho = new Map<string, number>();
    const notasDoTrecho = notas.filter((n) => n.dia! > janela.abertura!.dia && n.dia! <= janela.fechamento!.dia).map((n) => n.id);
    if (notasDoTrecho.length) {
      const ts = await prisma.stockTransaction.findMany({ where: { stockInvoiceId: { in: notasDoTrecho }, type: "INPUT" }, select: { stockItemId: true, quantity: true } });
      for (const t of ts) compradoNoTrecho.set(t.stockItemId, (compradoNoTrecho.get(t.stockItemId) || 0) + t.quantity);
    }
    const semCusto: string[] = [];
    for (const f of fecha) {
      if (f.stockItem.entraNoCmv === false) continue;
      const q = (Number(abre.get(f.stockItemId)?.quantidade) || 0) + (compradoNoTrecho.get(f.stockItemId) || 0) - (Number(f.quantidade) || 0);
      const custo = f.custoUnitario ?? abre.get(f.stockItemId)?.custoUnitario ?? null;
      if (custo == null && (Number(f.quantidade) || 0) > 0) semCusto.push(f.nome);
      if (q > 0 && custo != null) consumo.push({ nome: f.nome, unidade: f.unidade, quantidade: Math.round(q * 1000) / 1000, valor: r2(q * custo) });
    }
    consumo = consumo.sort((a, b) => b.valor - a.valor).slice(0, 15);
    if (semCusto.length) {
      avisos.push({ tipo: "atencao", texto: `Contados sem custo (entram com R$ 0 no estoque): ${semCusto.slice(0, 8).join(", ")}${semCusto.length > 8 ? ` e mais ${semCusto.length - 8}` : ""}. Lance uma compra deles ou ponha o custo no cadastro do insumo.` });
    }

    // Entrada à mão sem compra no meio da janela baixa o CMV sem ninguém ver.
    const fechaInfo = await prisma.contagemDeEstoque.findMany({ where: { id: { in: [janela.abertura.id, janela.fechamento.id] } }, select: { id: true, fechadaEm: true } });
    const desde = fechaInfo.find((c) => c.id === janela.abertura!.id)?.fechadaEm;
    const ate2 = fechaInfo.find((c) => c.id === janela.fechamento!.id)?.fechadaEm;
    if (desde && ate2) {
      const manuais = await prisma.stockTransaction.findMany({
        where: { franchiseeId: lojaId, type: "INPUT", stockInvoiceId: null, createdAt: { gt: desde, lte: ate2 }, NOT: { notes: { contains: "cancel id:" } } },
        select: { quantity: true, stockItem: { select: { unitCost: true, name: true } } },
      });
      const valorManual = manuais.reduce((s, t) => s + t.quantity * (Number(t.stockItem.unitCost) || 0), 0);
      if (valorManual > 1) {
        avisos.push({ tipo: "atencao", texto: `R$ ${fmt(valorManual)} entraram no estoque à mão (Movimentar › Entrada), sem compra lançada. Se foi compra, lance em Compras; se não, o CMV deste período está mais baixo do que o real.` });
      }
    }
  }

  // ── Perdas registradas no período ──────────────────────────────────────
  const { inicio: p0, fim: p1 } = janelaDeDatas(de, ate, tz);
  const perdasTs = await prisma.stockTransaction.findMany({
    where: { franchiseeId: lojaId, type: "WASTE", createdAt: { gte: p0, lt: p1 } },
    select: { quantity: true, unitCost: true, stockItem: { select: { name: true, unit: true, unitCost: true } } },
  });
  const perdasPorItem = new Map<string, { nome: string; unidade: string; quantidade: number; valor: number }>();
  for (const t of perdasTs) {
    const q = Math.abs(t.quantity);
    const v = q * (Number(t.unitCost ?? t.stockItem.unitCost) || 0);
    const atual = perdasPorItem.get(t.stockItem.name) || { nome: t.stockItem.name, unidade: t.stockItem.unit, quantidade: 0, valor: 0 };
    atual.quantidade += q;
    atual.valor += v;
    perdasPorItem.set(t.stockItem.name, atual);
  }
  const perdasItens = [...perdasPorItem.values()].map((p) => ({ ...p, quantidade: Math.round(p.quantidade * 1000) / 1000, valor: r2(p.valor) })).sort((a, b) => b.valor - a.valor);

  const marcadosNoDia = await prisma.stockItem.count({ where: { franchiseeId: lojaId, NOT: { active: false }, contagemDiaria: true } });
  if (janela.falta === "NENHUMA_CONTAGEM") {
    avisos.unshift({ tipo: "info", texto: "Ainda não há contagem fechada. Faça a primeira contagem completa em Estoque › Contagem: ela é o estoque inicial, e o CMV real aparece a partir da contagem seguinte." });
  } else if (janela.falta === "SO_UMA_CONTAGEM") {
    avisos.unshift({ tipo: "info", texto: `A contagem de ${br(janela.abertura!.dia)} abre o período. Falta a próxima contagem para fechar o CMV — com a contagem rápida no fim do dia, o ponteiro anda todo dia.` });
  }
  if (marcadosNoDia === 0 && contagens.length > 0) {
    avisos.push({ tipo: "info", texto: "Nenhum insumo marcado para a contagem do dia. Marque os 10 a 20 que mais pesam (queijo, carne, calabresa, farinha, caixas): com eles contados no fechamento, o CMV da semana atualiza a cada dia." });
  }

  const semana = lerSemanaDoCmv(e.goals);
  const ultimaCompleta = [...contagens].reverse().find((c) => c.tipo === "COMPLETA");
  if (contagens.length > 0 && (!ultimaCompleta || ultimaCompleta.dia < somarDias(e.hoje, -8))) {
    avisos.push({ tipo: "atencao", texto: `${ultimaCompleta ? `A última contagem completa foi em ${br(ultimaCompleta.dia)}.` : "Ainda não houve contagem completa."} Ela é toda ${NOMES_DOS_DIAS_DA_SEMANA[semana.diaDaContagem]}: é ela que acerta os itens que não entram na contagem do dia.` });
  }

  const ultima = contagens.length ? contagens[contagens.length - 1] : null;
  const pendencias = await pendenciasDaLoja({
    lojaId, tz, hoje: e.hoje, goals: e.goals, semana, contagens, marcadosNoDia, pessoas: pessoas.length,
    inicioDoPeriodo: t0, fimDoPeriodo: t1,
  });
  return {
    loja: e.nomeDaLoja,
    hoje: e.hoje,
    periodo: { de, ate },
    metas: { cmv: metaCmv, cmo: metaCmo, faixa: FAIXA_DE_ATENCAO },
    semana,
    cmv: {
      abertura: janela.abertura ? { dia: janela.abertura.dia, tipo: janela.abertura.tipo } : null,
      fechamento: janela.fechamento ? { dia: janela.fechamento.dia, tipo: janela.fechamento.tipo } : null,
      parcial: janela.parcial,
      falta: janela.falta,
      resultado,
      zona: zonaDoCmv(resultado?.pct ?? null, metaCmv),
      trechos,
    },
    vendas: { total: vendasDoPeriodo, porDia: doPeriodo.map((d) => ({ dia: d.dia, vendas: d.vendas, compras: d.compras })) },
    compras: {
      total: r2(doPeriodo.reduce((s, d) => s + d.compras, 0)),
      porFornecedor: [...porFornecedor].map(([fornecedor, v]) => ({ fornecedor, valor: r2(v.valor), compras: v.notas.size })).sort((a, b) => b.valor - a.valor),
      foraDoCmv: r2(foraDoCmv),
    },
    cmo: { ...cmoPeriodo, pct: cmoPct, zona: zonaDoCmv(cmoPct, metaCmo) },
    custoPrimario,
    consumo,
    perdas: { valor: r2(perdasItens.reduce((s, p) => s + p.valor, 0)), itens: perdasItens.slice(0, 10) },
    contagens: { ultima: ultima ? { dia: ultima.dia, tipo: ultima.tipo } : null, total: contagens.length, marcadosNoDia },
    avisos,
    pendencias,
  };
}

async function pendenciasDaLoja(e: {
  lojaId: string; tz: string; hoje: string; goals: unknown; semana: SemanaDoCmv; contagens: ContagemFechada[];
  marcadosNoDia: number; pessoas: number; inicioDoPeriodo: Date; fimDoPeriodo: Date;
}): Promise<Pendencia[]> {
  const { lojaId, hoje } = e;
  const nomeDoDia = NOMES_DOS_DIAS_DA_SEMANA[e.semana.diaDaContagem];
  const lista = (nomes: string[], n = 4) => nomes.slice(0, n).join(", ") + (nomes.length > n ? ` e mais ${nomes.length - n}` : "");

  const [loja, comprasRecentes, produtos, pedidosDeApp, insumos, entradas] = await Promise.all([
    prisma.user.findUnique({ where: { id: lojaId }, select: { fixedCosts: true } }),
    prisma.stockInvoice.count({ where: { franchiseeId: lojaId, canceladaEm: null, dia: { gte: somarDias(hoje, -7) } } }),
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, isCombo: false, recipeItems: { none: {} } },
      select: { name: true }, orderBy: { name: "asc" }, take: 200,
    }),
    prisma.customerOrder.count({
      where: { franchiseeId: lojaId, createdAt: { gte: e.inicioDoPeriodo, lt: e.fimDoPeriodo }, OR: [{ ifoodOrderId: { not: null } }, { openDeliveryOrderId: { not: null } }] },
    }),
    insumosParaCusto(lojaId),
    entradasComCusto(lojaId, e.tz),
  ]);

  const custos = custosNoDia(insumos, entradas, hoje);
  const semCusto = insumos.filter((i) => i.entraNoCmv && custos.get(i.id)?.custo == null).map((i) => i.nome);
  const ultimaCompleta = [...e.contagens].reverse().find((c) => c.tipo === "COMPLETA");
  const contouOntem = e.contagens.some((c) => c.dia >= somarDias(hoje, -1));
  const fixos = Array.isArray(loja?.fixedCosts) ? (loja!.fixedCosts as any[]).length : 0;
  const comissoes = Object.keys(lerComissoesDosApps(e.goals)).length;
  const goals = e.goals && typeof e.goals === "object" ? (e.goals as Record<string, unknown>) : {};

  return [
    {
      chave: "completa", ok: Boolean(ultimaCompleta && ultimaCompleta.dia >= somarDias(hoje, -8)),
      titulo: `Contagem completa (toda ${nomeDoDia})`,
      detalhe: ultimaCompleta ? `Última em ${br(ultimaCompleta.dia)}.` : "Ainda não foi feita: é o estoque que abre e fecha a semana do CMV.",
      href: "/store/estoque/contagem", rotulo: "Contar",
    },
    {
      chave: "diaria", ok: e.marcadosNoDia > 0 && contouOntem,
      titulo: "Contagem do fim do dia",
      detalhe: e.marcadosNoDia === 0 ? "Nenhum insumo marcado para contar todo dia." : contouOntem ? `${e.marcadosNoDia} itens no fechamento de cada dia.` : `${e.marcadosNoDia} itens marcados, mas ontem não teve contagem: o ponteiro só anda com ela.`,
      href: "/store/estoque/contagem", rotulo: "Contar",
    },
    {
      chave: "compras", ok: comprasRecentes > 0,
      titulo: "Compras lançadas",
      detalhe: comprasRecentes > 0 ? `${comprasRecentes} compra(s) nos últimos 7 dias.` : "Nenhuma compra lançada nos últimos 7 dias. Sem compra, o CMV sai menor do que é.",
      href: "/store/estoque/compras", rotulo: "Lançar",
    },
    {
      chave: "custos", ok: semCusto.length === 0,
      titulo: "Custo de cada insumo",
      detalhe: semCusto.length === 0 ? "Todos os insumos têm custo." : `${semCusto.length} sem custo (entram com R$ 0 na contagem): ${lista(semCusto)}. Lance uma compra deles.`,
      href: "/store/estoque/compras", rotulo: "Lançar compra",
    },
    {
      chave: "fichas", ok: produtos.length === 0,
      titulo: "Ficha técnica dos produtos",
      detalhe: produtos.length === 0 ? "Todos os produtos têm ficha." : `${produtos.length} produto(s) sem ficha: ${lista(produtos.map((p) => p.name))}. A ficha não muda o CMV real; ela mostra onde está a perda.`,
      href: "/store/estoque", rotulo: "Fichas",
    },
    {
      chave: "equipe", ok: e.pessoas > 0,
      titulo: "Equipe (CMO)",
      detalhe: e.pessoas > 0 ? `${e.pessoas} pessoa(s) na folha.` : "Ninguém cadastrado: sem isso não há CMO.",
      aba: "equipe", rotulo: "Cadastrar",
    },
    {
      chave: "custofixo", ok: fixos > 0,
      titulo: "Custos fixos",
      detalhe: fixos > 0 ? `${fixos} custo(s) fixo(s) lançado(s).` : "Aluguel, energia, gás, internet, contador: sem eles não dá para saber o lucro.",
      aba: "custofixo", rotulo: "Lançar",
    },
    ...(pedidosDeApp > 0 ? [{
      chave: "comissao", ok: comissoes > 0,
      titulo: "Comissão dos apps",
      detalhe: comissoes > 0 ? "Comissão dos apps cadastrada." : "Tem venda de iFood/99 no período e a comissão (com taxas e antecipação) não está cadastrada.",
      href: "/store/financeiro?tab=configuracoes", rotulo: "Cadastrar",
    }] : []),
    {
      chave: "metas", ok: goals.cmvPct != null,
      titulo: "Meta de CMV",
      detalhe: goals.cmvPct != null ? `Meta de ${goals.cmvPct}%.` : "Sem meta, o ponteiro usa 33% (a planilha do Hakim).",
      aba: "metas", rotulo: "Definir",
    },
  ];
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function br(dia: string) {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}
