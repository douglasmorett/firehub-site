/**
 * A TELA DO ESTOQUE no banco: a análise de cada insumo (consumo, cobertura,
 * última contagem, classe, curva ABC), o detalhe de um insumo, a visão geral
 * e o custo das fichas. As contas são de lib/estoque/analise.ts.
 *
 * R$ só sai para quem vê dados sensíveis: quem chama passa `veValor`.
 */
import { prisma } from "@/lib/prisma";
import { janelaDoPeriodo as janelaDeDatas } from "@/lib/relatorios/servidor";
import { diasNoPeriodo, naLoja, somarDias } from "@/lib/relatorios/base";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { entradasComCusto, insumosParaCusto } from "@/lib/cmv/contagem-no-banco";
import { custosNoDia, ehPreparo, explodirPreparo } from "@/lib/cmv/custo-do-insumo";
import { classesDaLoja, montarControlaveis } from "@/lib/cmv/controlaveis-no-banco";
import { classeDoInsumo, TITULO_DA_SECAO, type Classe, type ItemCaro } from "@/lib/cmv/controlaveis";
import { montarPainel } from "@/lib/cmv/painel";
import { lerMeta } from "@/lib/cmv/cmv-real";
import { lerSemanaDoCmv, inicioDaSemanaDoCmv } from "@/lib/cmv/semana-do-cmv";
import { desperdicioLancadoPorDia, prepararCustoDosItens } from "@/lib/financeiro/cmv-do-financeiro";
import {
  coberturaEmDias, consumoMedioPorDia, curvaAbc, diasSemContar, historicoDePreco, margemBaixa, margemDaFicha, nivelDaCobertura,
  type Curva, type NivelDaCobertura, type PrecoNaCompra,
} from "@/lib/estoque/analise";

const r2 = (n: number) => Math.round(n * 100) / 100;
export const DIAS_DO_CONSUMO = 14;

// ── Análise de cada insumo (a tabela de Insumos) ────────────────────────────

export type AnaliseDoInsumo = {
  id: string;
  nome: string;
  unidade: string;
  saldo: number;
  minimo: number | null;
  contagemDiaria: boolean;
  entraNoCmv: boolean;
  consumoDia: number;
  /** De onde veio o consumo: as saídas lançadas, ou a contagem (uso livre, sem baixa). */
  fonteDoConsumo: "saidas" | "contagem" | null;
  preparo: boolean;
  cobertura: number | null;
  nivel: NivelDaCobertura;
  ultimaContagem: string | null;
  diasSemContar: number | null;
  classe: Classe;
  classePalpite: boolean;
  curva: Curva;
  /** Custo de hoje (nulo sem custo ou sem acesso a R$). */
  custoHoje: number | null;
  semCusto: boolean;
  emFicha: boolean;
};

export async function analisarInsumos(lojaId: string, tz: string, veValor: boolean): Promise<{ hoje: string; dias: number; itens: AnaliseDoInsumo[] }> {
  const hoje = naLoja(new Date(), tz).dia;
  const { inicio, fim } = janelaDeDatas(somarDias(hoje, -DIAS_DO_CONSUMO), somarDias(hoje, -1), tz);
  const [insumos, entradas, classes, fichas, movimentos, contados, minimos] = await Promise.all([
    insumosParaCusto(lojaId),
    entradasComCusto(lojaId, tz),
    classesDaLoja(lojaId),
    prisma.productRecipe.findMany({ where: { menuProduct: { franchiseeId: lojaId } }, select: { stockItemId: true }, distinct: ["stockItemId"] }),
    prisma.stockTransaction.findMany({
      where: { stockItem: { franchiseeId: lojaId }, createdAt: { gte: inicio, lt: fim }, type: { in: ["SALE", "WASTE", "OUTPUT", "INPUT"] } },
      select: { stockItemId: true, type: true, quantity: true, notes: true },
    }),
    // A última contagem em que cada insumo foi CONTADO de verdade.
    prisma.contagemItem.findMany({
      where: { origem: "CONTADO", contagem: { franchiseeId: lojaId, status: "FECHADA" } },
      select: { stockItemId: true, contagem: { select: { dia: true } } },
    }),
    prisma.stockItem.findMany({ where: { franchiseeId: lojaId, NOT: { active: false } }, select: { id: true, minQuantity: true } }),
  ]);
  const minimoDe = new Map(minimos.map((m) => [m.id, m.minQuantity]));
  const custos = custosNoDia(insumos, entradas, hoje);
  const emFicha = new Set(fichas.map((f) => f.stockItemId));
  for (const i of insumos) for (const c of i.componentes) emFicha.add(c.insumoId);
  const consumo = consumoMedioPorDia(movimentos.map((m) => ({ stockItemId: m.stockItemId, tipo: m.type, quantidade: m.quantity, notes: m.notes })), DIAS_DO_CONSUMO);
  // O preparo (hambúrguer moldado, recheio) é feito na cozinha sem movimento:
  // o que ele consome desce para os insumos dele (a carne gasta pelo hambúrguer).
  for (const i of insumos) {
    const q = consumo.get(i.id) || 0;
    if (!(q > 0) || !ehPreparo(i)) continue;
    for (const [id, parte] of explodirPreparo(insumos, i.id, q)) {
      if (id !== i.id) consumo.set(id, Math.round(((consumo.get(id) || 0) + parte) * 1000) / 1000);
    }
  }
  // Uso livre (guardanapo, sachê) não tem baixa: o consumo sai das duas últimas
  // contagens completas (abertura + entradas − fechamento ÷ dias).
  const pelaContagem = new Set<string>();
  const completas = await prisma.contagemDeEstoque.findMany({
    where: { franchiseeId: lojaId, status: "FECHADA", tipo: "COMPLETA" }, orderBy: { dia: "desc" }, take: 2,
    select: { id: true, dia: true, fechadaEm: true, itens: { select: { stockItemId: true, quantidade: true, origem: true } } },
  });
  if (completas.length === 2 && completas[0].fechadaEm && completas[1].fechadaEm) {
    const [fe, ab] = completas;
    const dias = Math.max(1, diasNoPeriodo(somarDias(ab.dia, 1), fe.dia));
    // (vale mais que as saídas: a perda lançada de um sachê já está dentro da contagem)
    const livres = insumos.filter((i) => !emFicha.has(i.id) && !ehPreparo(i)).map((i) => i.id);
    if (livres.length) {
      const entradasNoMeio = await prisma.stockTransaction.findMany({
        where: { stockItemId: { in: livres }, type: { in: ["INPUT", "ESTORNO"] }, createdAt: { gt: ab.fechadaEm!, lte: fe.fechadaEm! }, NOT: { notes: { contains: "cancel id:" } } },
        select: { stockItemId: true, quantity: true },
      });
      const ent = new Map<string, number>();
      for (const t of entradasNoMeio) ent.set(t.stockItemId, (ent.get(t.stockItemId) || 0) + t.quantity);
      const qAb = new Map(ab.itens.filter((x) => x.origem === "CONTADO").map((x) => [x.stockItemId, Number(x.quantidade) || 0]));
      const qFe = new Map(fe.itens.filter((x) => x.origem === "CONTADO").map((x) => [x.stockItemId, Number(x.quantidade) || 0]));
      for (const id of livres) {
        if (!qAb.has(id) || !qFe.has(id)) continue;
        const real = qAb.get(id)! + (ent.get(id) || 0) - qFe.get(id)!;
        if (real > 0) { consumo.set(id, Math.round((real / dias) * 1000) / 1000); pelaContagem.add(id); }
      }
    }
  }

  const ultima = new Map<string, string>();
  for (const c of contados) if ((ultima.get(c.stockItemId) || "") < c.contagem.dia) ultima.set(c.stockItemId, c.contagem.dia);
  const curva = curvaAbc(insumos.map((i) => ({ id: i.id, valor: (consumo.get(i.id) || 0) * (custos.get(i.id)?.custo ?? 0) })));

  return {
    hoje,
    dias: DIAS_DO_CONSUMO,
    itens: insumos.map((i) => {
      const dia = consumo.get(i.id) || 0;
      const cob = coberturaEmDias(i.quantidade, dia);
      const { classe, palpite } = classeDoInsumo({ nome: i.nome, emFicha: emFicha.has(i.id), classeGravada: classes.get(i.id) ?? null });
      const custo = custos.get(i.id)?.custo ?? null;
      return {
        id: i.id, nome: i.nome, unidade: i.unidade, saldo: i.quantidade, minimo: minimoDe.get(i.id) ?? null,
        contagemDiaria: i.contagemDiaria, entraNoCmv: i.entraNoCmv, consumoDia: dia,
        fonteDoConsumo: dia > 0 ? (pelaContagem.has(i.id) ? "contagem" : "saidas") : null, preparo: ehPreparo(i), cobertura: cob, nivel: nivelDaCobertura(i.quantidade, cob),
        ultimaContagem: ultima.get(i.id) ?? null, diasSemContar: diasSemContar(ultima.get(i.id) ?? null, hoje),
        classe, classePalpite: palpite, curva: curva.get(i.id) || "C",
        custoHoje: veValor ? custo : null, semCusto: custo == null && i.entraNoCmv, emFicha: emFicha.has(i.id) || ehPreparo(i),
      };
    }),
  };
}

// ── Detalhe de um insumo (a gaveta) ─────────────────────────────────────────

export type DetalheDoInsumo = {
  id: string; nome: string; unidade: string; saldo: number; minimo: number | null; tipo: string | null;
  precos: { compras: PrecoNaCompra[]; ultimaVariacao: number | null; variacaoNoPeriodo: number | null } | null;
  movimentos: { quando: string; tipo: string; quantidade: number; nota: string | null; quem: string | null }[];
  fichas: { produto: string; quantidade: number }[];
  preparos: { preparo: string; quantidade: number }[];
  perdas: { dias: number; quantidade: number; valor: number | null; lancamentos: number };
};

export async function detalharInsumo(lojaId: string, tz: string, insumoId: string, veValor: boolean): Promise<DetalheDoInsumo | null> {
  const i = await prisma.stockItem.findFirst({
    where: { id: insumoId, franchiseeId: lojaId },
    select: {
      id: true, name: true, unit: true, quantity: true, minQuantity: true, tipo: true, unitCost: true,
      recipeItems: { select: { quantityConsumed: true, menuProduct: { select: { name: true, active: true } } } },
      usadoEmPreparos: { select: { quantidade: true, preparo: { select: { name: true } } } },
    },
  });
  if (!i) return null;
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const [entradas, movimentos, perdas] = await Promise.all([
    veValor
      ? prisma.stockTransaction.findMany({
          where: { stockItemId: i.id, type: "INPUT", stockInvoiceId: { not: null }, unitCost: { not: null } },
          select: { unitCost: true, quantity: true, createdAt: true, stockInvoiceId: true },
          orderBy: { createdAt: "desc" }, take: 60,
        })
      : Promise.resolve([]),
    prisma.stockTransaction.findMany({
      where: { stockItemId: i.id }, orderBy: { createdAt: "desc" }, take: 30,
      select: { type: true, quantity: true, notes: true, createdAt: true, userId: true },
    }),
    prisma.stockTransaction.findMany({
      where: { stockItemId: i.id, type: "WASTE", createdAt: { gte: desde } },
      select: { quantity: true, unitCost: true },
    }),
  ]);
  const notas = entradas.length
    ? await prisma.stockInvoice.findMany({ where: { id: { in: [...new Set(entradas.map((e) => e.stockInvoiceId as string))] } }, select: { id: true, dia: true, supplier: true, canceladaEm: true, createdAt: true } })
    : [];
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  const ids = [...new Set(movimentos.map((m) => m.userId).filter(Boolean) as string[])];
  const pessoas = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nomeDe = new Map(pessoas.map((p) => [p.id, p.name || p.email || "—"]));

  const compras = entradas.flatMap((e) => {
    const n = notaPorId.get(e.stockInvoiceId as string);
    if (!n || n.canceladaEm) return [];
    return [{ dia: n.dia || naLoja(n.createdAt, tz).dia, em: e.createdAt.getTime(), custo: Number(e.unitCost), quantidade: e.quantity, fornecedor: n.supplier }];
  });
  const custoDaPerda = perdas.every((p) => p.unitCost != null || i.unitCost != null);
  return {
    id: i.id, nome: i.name, unidade: i.unit, saldo: i.quantity, minimo: i.minQuantity, tipo: i.tipo,
    precos: veValor ? historicoDePreco(compras) : null,
    movimentos: movimentos.map((m) => ({ quando: m.createdAt.toISOString(), tipo: m.type, quantidade: m.quantity, nota: m.notes, quem: m.userId ? nomeDe.get(m.userId) || null : null })),
    fichas: i.recipeItems.filter((r) => r.menuProduct.active !== false).map((r) => ({ produto: r.menuProduct.name, quantidade: r.quantityConsumed })).sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR")),
    preparos: i.usadoEmPreparos.map((p) => ({ preparo: p.preparo.name, quantidade: p.quantidade })),
    perdas: {
      dias: 30,
      quantidade: Math.round(perdas.reduce((s, p) => s + Math.abs(p.quantity), 0) * 1000) / 1000,
      valor: veValor && custoDaPerda ? r2(perdas.reduce((s, p) => s + Math.abs(p.quantity) * (Number(p.unitCost ?? i.unitCost) || 0), 0)) : null,
      lancamentos: perdas.length,
    },
  };
}

// ── Custo e margem das fichas ───────────────────────────────────────────────

export type MargemDoProduto = {
  id: string; nome: string; categoria: string; preco: number;
  custo: number | null; margem: number | null; margemPct: number | null; cmvPct: number | null;
  temFicha: boolean; vendidos30: number; margemBaixa: boolean; falta: string | null;
};

/** Custo da ficha HOJE × preço de venda de cada produto do cardápio, e quanto vendeu em 30 dias. */
export async function margensDasFichas(lojaId: string, tz: string, goals: unknown): Promise<{ teto: number; produtos: MargemDoProduto[] }> {
  // Margem baixa: CMV teórico acima da meta de CMV da loja (Metas), ou 40% sem meta.
  const teto = lerMeta(goals, "cmvPct", 40);
  const hoje = naLoja(new Date(), tz).dia;
  const { inicio, fim } = janelaDeDatas(somarDias(hoje, -30), hoje, tz);
  const [produtos, custo, vendidos] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, NOT: [{ id: { startsWith: "ifood-" } }, { id: { startsWith: "99food_" } }] },
      select: { id: true, name: true, category: true, price: true, isCombo: true, _count: { select: { recipeItems: true } } },
      orderBy: { name: "asc" }, take: 1500,
    }),
    prepararCustoDosItens(lojaId, tz),
    prisma.customerOrderItem.groupBy({
      by: ["menuProductId"],
      where: { menuProductId: { not: null }, order: { franchiseeId: lojaId, createdAt: { gte: inicio, lt: fim }, status: { notIn: [...STATUS_CANCELADOS] } } },
      _sum: { quantity: true },
    }),
  ]);
  const qtd = new Map(vendidos.map((v) => [v.menuProductId as string, v._sum.quantity || 0]));
  return { teto, produtos: produtos.map((p) => {
    const preco = Number(p.price) || 0;
    const c = custo.custoDoItem({ produtoId: p.id, nome: p.name, quantidade: 1, preco, escolhas: null }, hoje);
    const m = margemDaFicha(preco, c.custo);
    const falta = c.custo != null ? null
      : c.faltas[0]?.motivo === "SEM_FICHA" ? "sem ficha técnica"
      : c.faltas[0]?.motivo === "INSUMO_SEM_CUSTO" ? `${c.faltas[0].nome} sem custo`
      : c.faltas[0] ? `${c.faltas[0].nome} sem ficha` : "sem custo";
    return {
      id: p.id, nome: p.name, categoria: p.category || "", preco,
      custo: c.custo == null ? null : r2(c.custo), margem: m?.margem ?? null, margemPct: m?.margemPct ?? null, cmvPct: m?.cmvPct ?? null,
      temFicha: p._count.recipeItems > 0 || p.isCombo, vendidos30: qtd.get(p.id) || 0, margemBaixa: margemBaixa(m, teto), falta,
    };
  }) };
}

// ── Visão geral (a primeira aba) ────────────────────────────────────────────

export type AcaoDoDia = {
  tipo: "comprar" | "contar" | "lote" | "semFicha" | "semCusto" | "diferenca";
  texto: string;
  detalhe?: string;
  /** Tela para abrir, ou aba desta tela. */
  href?: string;
  aba?: "items" | "lotes" | "recipes" | "controlaveis";
  urgente?: boolean;
};

export type VisaoGeral = {
  hoje: string;
  veValor: boolean;
  /** A semana do CMV que já fechou (a dos números de CMV e perdas). */
  semana: { de: string; ate: string };
  insumos: { total: number; abaixoDoMinimo: { nome: string; saldo: number; minimo: number; unidade: string }[]; negativos: number; semCusto: number; fichasPct: number | null };
  valorEmEstoque: number | null;
  cmv: { pct: number | null; meta: number; zona: string; de: string; ate: string } | null;
  perdas: { valor: number; pct: number | null } | null;
  lotes: { vencendo: { nome: string; validoAte: string; quantidade: number; unidade: string }[]; vencidos: number };
  semanas: { de: string; perdas: number | null; estoque: number | null }[];
  ondeEstaODinheiro: (ItemCaro & { rotulo: string })[];
  acoes: AcaoDoDia[];
};

const fmtQ = (q: number) => q.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function visaoGeral(e: { lojaId: string; nomeDaLoja: string; tz: string; goals: unknown; veValor: boolean }): Promise<VisaoGeral> {
  const { lojaId, tz, veValor } = e;
  const analise = await analisarInsumos(lojaId, tz, true);
  const hoje = analise.hoje;
  const semanaDoCmv = lerSemanaDoCmv(e.goals);
  const estaSemana = inicioDaSemanaDoCmv(hoje, semanaDoCmv.comecaEm);
  const semana = { de: somarDias(estaSemana, -7), ate: somarDias(estaSemana, -1) };
  const agora = new Date();
  const em3dias = new Date(agora.getTime() + 3 * 86_400_000);
  const inicio8 = somarDias(estaSemana, -49);
  const { inicio: t8, fim: tFim } = janelaDeDatas(inicio8, hoje, tz);
  const { inicio: t14 } = janelaDeDatas(somarDias(hoje, -14), hoje, tz);

  const [lotes, vencidos, produtos, vendidos, contagens, painel, controlaveis, perdasPorDia] = await Promise.all([
    prisma.stockLot.findMany({
      where: { recebidoPorId: lojaId, active: true, status: "ATIVO", validoAte: { gte: agora, lte: em3dias } },
      select: { productName: true, validoAte: true, quantidadeRestante: true, unit: true }, orderBy: { validoAte: "asc" }, take: 20,
    }),
    prisma.stockLot.count({ where: { recebidoPorId: lojaId, active: true, status: "ATIVO", validoAte: { lt: agora } } }),
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, isCombo: false, NOT: [{ id: { startsWith: "ifood-" } }, { id: { startsWith: "99food_" } }] },
      select: { id: true, name: true, _count: { select: { recipeItems: true } } },
    }),
    prisma.customerOrderItem.groupBy({
      by: ["menuProductId"],
      where: { menuProductId: { not: null }, order: { franchiseeId: lojaId, createdAt: { gte: t14, lt: tFim }, status: { notIn: [...STATUS_CANCELADOS] } } },
      _sum: { quantity: true },
    }),
    veValor
      ? prisma.contagemDeEstoque.findMany({ where: { franchiseeId: lojaId, status: "FECHADA", dia: { gte: inicio8 } }, select: { dia: true, valorTotal: true }, orderBy: { dia: "asc" } })
      : Promise.resolve([] as { dia: string; valorTotal: number | null }[]),
    veValor
      ? montarPainel({ lojaId, nomeDaLoja: e.nomeDaLoja, tz, goals: e.goals, hoje, de: semana.de, ate: semana.ate }).catch((err) => { console.error("[Estoque] visão geral: painel do CMV falhou:", err?.message); return null; })
      : Promise.resolve(null),
    veValor
      ? montarControlaveis({ lojaId, nomeDaLoja: e.nomeDaLoja, tz, de: semana.de, ate: semana.ate, semAnterior: true }).catch((err) => { console.error("[Estoque] visão geral: controláveis falharam:", err?.message); return null; })
      : Promise.resolve(null),
    veValor ? desperdicioLancadoPorDia(lojaId, tz, t8, tFim) : Promise.resolve(new Map<string, number>()),
  ]);

  const ativos = analise.itens;
  const abaixo = ativos
    .filter((i) => i.minimo != null && i.saldo <= i.minimo)
    .map((i) => ({ nome: i.nome, saldo: i.saldo, minimo: i.minimo as number, unidade: i.unidade }))
    .sort((a, b) => a.saldo / (a.minimo || 1) - b.saldo / (b.minimo || 1));
  const valorEmEstoque = veValor ? r2(ativos.filter((i) => i.entraNoCmv).reduce((s, i) => s + Math.max(0, i.saldo) * (i.custoHoje ?? 0), 0)) : null;
  const comFicha = produtos.filter((p) => p._count.recipeItems > 0).length;

  // As 8 semanas do CMV (a atual por último): perdas lançadas e o estoque da última contagem de cada uma.
  const semanas: VisaoGeral["semanas"] = [];
  for (let k = 7; k >= 0; k--) {
    const de = somarDias(estaSemana, -7 * k);
    const ate = somarDias(de, 6);
    let perdas = 0;
    for (const [dia, v] of perdasPorDia) if (dia >= de && dia <= ate) perdas += v;
    const ultima = [...contagens].reverse().find((c) => c.dia >= de && c.dia <= ate);
    semanas.push({ de, perdas: veValor ? r2(perdas) : null, estoque: veValor && ultima ? r2(Number(ultima.valorTotal) || 0) : null });
  }

  // ── O que fazer hoje ───────────────────────────────────────────────────
  const acoes: AcaoDoDia[] = [];
  const acabando = ativos
    .filter((i) => i.entraNoCmv && (i.nivel === "acabou" || i.nivel === "critico" || (i.minimo != null && i.saldo <= i.minimo)))
    .sort((a, b) => (a.cobertura ?? 99) - (b.cobertura ?? 99));
  for (const i of acabando.slice(0, 6)) {
    acoes.push({
      tipo: "comprar", urgente: i.nivel === "acabou" || i.nivel === "critico",
      texto: `${i.preparo ? "Produzir" : "Comprar"} ${i.nome}`,
      detalhe: i.saldo <= 0 ? "acabou" : i.cobertura != null ? `acaba em ~${fmtQ(i.cobertura)} dia(s) (${fmtQ(i.saldo)} ${i.unidade})` : `abaixo do mínimo (${fmtQ(i.saldo)} de ${fmtQ(i.minimo ?? 0)} ${i.unidade})`,
      href: i.preparo ? "/store/estoque/contagem" : "/store/relatorios/sugestao-de-compras",
    });
  }
  for (const l of lotes.slice(0, 4)) {
    acoes.push({ tipo: "lote", urgente: true, texto: `Usar ou descartar ${l.productName}`, detalhe: `vence ${l.validoAte!.toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" })} (${fmtQ(l.quantidadeRestante)} ${l.unit})`, aba: "lotes" });
  }
  const semContar = ativos
    .filter((i) => i.entraNoCmv && i.saldo > 0 && (i.curva === "A" || i.contagemDiaria) && (i.diasSemContar == null || i.diasSemContar > 7))
    .sort((a, b) => (b.diasSemContar ?? 999) - (a.diasSemContar ?? 999));
  for (const i of semContar.slice(0, 4)) {
    acoes.push({ tipo: "contar", texto: `Contar ${i.nome}`, detalhe: i.diasSemContar == null ? "nunca foi contado" : `não é contado há ${i.diasSemContar} dias`, href: "/store/estoque/contagem" });
  }
  const qtdVendida = new Map(vendidos.map((v) => [v.menuProductId as string, v._sum.quantity || 0]));
  const vendidosSemFicha = produtos.filter((p) => p._count.recipeItems === 0 && (qtdVendida.get(p.id) || 0) > 0).sort((a, b) => (qtdVendida.get(b.id) || 0) - (qtdVendida.get(a.id) || 0));
  if (vendidosSemFicha.length) {
    acoes.push({
      tipo: "semFicha", texto: `Montar a ficha de ${vendidosSemFicha.slice(0, 3).map((p) => p.name).join(", ")}${vendidosSemFicha.length > 3 ? ` e mais ${vendidosSemFicha.length - 3}` : ""}`,
      detalhe: "vendidos nos últimos 14 dias sem ficha técnica: o estoque não baixa", aba: "recipes",
    });
  }
  const semCusto = ativos.filter((i) => i.semCusto);
  if (semCusto.length) {
    acoes.push({ tipo: "semCusto", texto: `Lançar a compra de ${semCusto.slice(0, 3).map((i) => i.nome).join(", ")}${semCusto.length > 3 ? ` e mais ${semCusto.length - 3}` : ""}`, detalhe: "insumo sem custo entra com R$ 0 no CMV", href: "/store/estoque/compras" });
  }
  if (controlaveis) {
    const venda = controlaveis.venda;
    const sumiu = [...controlaveis.secoes.inventario.linhas, ...controlaveis.secoes.rendimento.linhas]
      .filter((l) => l.total < 0 && (l.total <= -20 || (venda > 0 && -l.total / venda >= 0.001)))
      .sort((a, b) => a.total - b.total);
    for (const l of sumiu.slice(0, 3)) {
      acoes.push({ tipo: "diferenca", texto: `Ver a diferença de ${l.nome}`, detalhe: `sumiram ${fmtQ(-l.quantidade)} ${l.unidade} (${reais(-l.total)}) na semana`, aba: "controlaveis" });
    }
  }

  return {
    hoje, veValor, semana,
    insumos: { total: ativos.length, abaixoDoMinimo: abaixo.slice(0, 12), negativos: ativos.filter((i) => i.saldo < 0).length, semCusto: semCusto.length, fichasPct: produtos.length ? Math.round((comFicha / produtos.length) * 100) : null },
    valorEmEstoque,
    cmv: painel ? { pct: painel.cmv.resultado?.pct ?? null, meta: painel.metas.cmv, zona: painel.cmv.zona, de: painel.cmv.resultado?.de ?? semana.de, ate: painel.cmv.resultado?.ate ?? semana.ate } : null,
    perdas: controlaveis ? { valor: controlaveis.resumo.totalControlaveis, pct: controlaveis.resumo.pct.totalControlaveis } : null,
    lotes: { vencendo: lotes.map((l) => ({ nome: l.productName, validoAte: l.validoAte!.toISOString(), quantidade: l.quantidadeRestante, unidade: l.unit })), vencidos },
    semanas,
    ondeEstaODinheiro: controlaveis ? controlaveis.ondeEstaODinheiro.slice(0, 5).map((i) => ({ ...i, rotulo: TITULO_DA_SECAO[i.secao] })) : [],
    acoes,
  };
}
