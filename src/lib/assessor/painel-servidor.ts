/**
 * O PAINEL DO BILL LIGADO — as leituras no banco (as regras puras estão em
 * ./painel.ts). Tudo filtrado pela loja da sessão; só leitura.
 *
 * - `resumoDoBill`: o que o Bill fez no período (dia de operação da loja), o
 *   que ele pausou e segue pausado, e os últimos lançamentos.
 * - `historicoDoBill`: o histórico com filtros e "carregar mais" (cursor).
 */
import { prisma } from "@/lib/prisma";
import { hojeNaLoja, naLoja } from "@/lib/relatorios/base";
import { janelaDosDias } from "@/lib/numeros-do-inicio";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { garantirEstruturaDoAssessor } from "./estrutura-no-banco";
import {
  codificarCursor, diasDoResumo, pausadosPeloBill, podeDesfazer, quemMandou, resumirRegistros,
  type FiltrosDoHistorico, type PeriodoDoResumo, type ResumoDoBill,
} from "./painel";

/** Quanto tempo para trás procurar "pausado pelo Bill" (produto pausado há mais tempo que isso já é decisão do cardápio). */
const DIAS_DOS_PAUSADOS = 120;
const DIA_MS = 24 * 60 * 60 * 1000;

export type LinhaDoHistorico = {
  id: string;
  tipo: string;
  resumo: string;
  canal: string;
  quem: string;
  criadoEm: string;
  /** Dia de operação da loja (vira às 5h): a tela agrupa por ele. */
  dia: string;
  desfeitoEm: string | null;
  podeDesfazer: boolean;
};

export type PausadoPeloBill = { id: string; nome: string; categoria: string | null; pausadoEm: string; canal: string };

export type ResumoDaTela = {
  /** O dia de operação de hoje na loja. */
  hoje: string;
  periodo: { chave: PeriodoDoResumo; de: string; ate: string };
  resumo: ResumoDoBill;
  /** Mensagens que o dono (e quem mais estiver nos números dele) mandou ao Bill no período. */
  mensagensDoDono: number;
  pausadosAgora: PausadoPeloBill[];
  ultimos: LinhaDoHistorico[];
  /** O registro mais novo ainda não desfeito: o único que o "desfaz" alcança. */
  ultimoDesfazivelId: string | null;
};

type RegistroDoBanco = { id: string; tipo: string; resumo: string; refs: unknown; canal: string; telefone: string | null; criadoEm: Date; desfeitoEm: Date | null };

const CAMPOS = { id: true, tipo: true, resumo: true, refs: true, canal: true, telefone: true, criadoEm: true, desfeitoEm: true } as const;

export async function ultimoDesfazivel(franchiseeId: string): Promise<string | null> {
  const r = await prisma.assessorRegistro.findFirst({
    where: { franchiseeId, desfeitoEm: null },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return r?.id ?? null;
}

function paraLinha(r: RegistroDoBanco, ultimoId: string | null, tz: string | null | undefined): LinhaDoHistorico {
  const autor = typeof (r.refs as any)?.autor === "string" ? (r.refs as any).autor : null;
  return {
    id: r.id,
    tipo: r.tipo,
    resumo: r.resumo,
    canal: r.canal,
    quem: quemMandou({ canal: r.canal, telefone: r.telefone, autor }),
    criadoEm: r.criadoEm.toISOString(),
    dia: naLoja(r.criadoEm, tz).dia,
    desfeitoEm: r.desfeitoEm ? r.desfeitoEm.toISOString() : null,
    podeDesfazer: podeDesfazer(r, ultimoId),
  };
}

/**
 * O valor de cada registro, lido do lançamento de verdade: a compra
 * (StockInvoice.totalAmount, fora as desfeitas), a despesa e a conta. O texto
 * do resumo nunca vira número.
 */
async function valoresDosRegistros(franchiseeId: string, regs: RegistroDoBanco[]): Promise<Map<string, number>> {
  const ids = (tipo: string[], chave: string) =>
    [...new Set(regs.filter((r) => tipo.includes(r.tipo) && !r.desfeitoEm).map((r) => String((r.refs as any)?.[chave] || "")).filter(Boolean))];
  const invoiceIds = ids(["COMPRA"], "invoiceId");
  const despesaIds = ids(["DESPESA"], "despesaId");
  const payableIds = ids(["CONTA", "CONTA_PAGA"], "payableId");
  const [compras, despesas, contas] = await Promise.all([
    invoiceIds.length
      ? prisma.stockInvoice.findMany({ where: { id: { in: invoiceIds }, franchiseeId, canceladaEm: null }, select: { id: true, totalAmount: true } })
      : [],
    despesaIds.length
      ? prisma.despesaLancada.findMany({ where: { id: { in: despesaIds }, franchiseeId }, select: { id: true, valor: true } }).catch(() => [])
      : [],
    payableIds.length
      ? prisma.payable.findMany({ where: { id: { in: payableIds }, franchiseeId }, select: { id: true, value: true } })
      : [],
  ]);
  const valor = new Map<string, number>();
  for (const c of compras) valor.set(`invoiceId:${c.id}`, Number(c.totalAmount) || 0);
  for (const d of despesas) valor.set(`despesaId:${d.id}`, Number(d.valor) || 0);
  for (const p of contas) valor.set(`payableId:${p.id}`, Number(p.value) || 0);
  return valor;
}

function valorDoRegistro(r: RegistroDoBanco, valores: Map<string, number>): number | null {
  const refs = (r.refs || {}) as any;
  const chave = r.tipo === "COMPRA" ? "invoiceId" : r.tipo === "DESPESA" ? "despesaId" : r.tipo === "CONTA" || r.tipo === "CONTA_PAGA" ? "payableId" : null;
  if (!chave || !refs[chave]) return null;
  return valores.get(`${chave}:${refs[chave]}`) ?? null;
}

async function pausadosAgora(franchiseeId: string, agora: Date): Promise<PausadoPeloBill[]> {
  const registros = await prisma.assessorRegistro.findMany({
    where: { franchiseeId, tipo: { in: ["PAUSADO", "REATIVADO"] }, criadoEm: { gte: new Date(agora.getTime() - DIAS_DOS_PAUSADOS * DIA_MS) } },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: 500,
    select: { tipo: true, refs: true, criadoEm: true, desfeitoEm: true, canal: true },
  });
  const candidatos = pausadosPeloBill(registros);
  if (!candidatos.size) return [];
  // Confere no cardápio: só o que está pausado AGORA (alguém pode ter reativado pela tela do cardápio).
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId, id: { in: [...candidatos.keys()] }, active: false, AND: [SEM_PRODUTO_DE_INTEGRACAO] },
    select: { id: true, name: true, category: true },
  });
  return produtos
    .map((p) => ({ id: p.id, nome: p.name, categoria: p.category ?? null, ...candidatos.get(p.id)! }))
    .sort((a, b) => b.pausadoEm.localeCompare(a.pausadoEm));
}

export async function resumoDoBill(franchiseeId: string, tz: string | null | undefined, periodo: PeriodoDoResumo, agora: Date = new Date()): Promise<ResumoDaTela> {
  const hoje = hojeNaLoja(tz, agora);
  const { de, ate } = diasDoResumo(periodo, hoje);
  const vazio: ResumoDaTela = { hoje, periodo: { chave: periodo, de, ate }, resumo: resumirRegistros([]), mensagensDoDono: 0, pausadosAgora: [], ultimos: [], ultimoDesfazivelId: null };
  if (!(await garantirEstruturaDoAssessor())) return vazio;
  const janela = janelaDosDias(de, ate, tz);

  const [regs, mensagensDoDono, pausados, ultimos, ultimoId] = await Promise.all([
    prisma.assessorRegistro.findMany({
      where: { franchiseeId, criadoEm: { gte: janela.inicio, lt: janela.fim } },
      orderBy: { criadoEm: "desc" },
      take: 3000,
      select: CAMPOS,
    }),
    prisma.assessorMensagem.count({ where: { franchiseeId, papel: "DONO", criadoEm: { gte: janela.inicio, lt: janela.fim } } }).catch(() => 0),
    pausadosAgora(franchiseeId, agora),
    prisma.assessorRegistro.findMany({ where: { franchiseeId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 5, select: CAMPOS }),
    ultimoDesfazivel(franchiseeId),
  ]);
  const valores = await valoresDosRegistros(franchiseeId, regs);
  return {
    hoje,
    periodo: { chave: periodo, de, ate },
    resumo: resumirRegistros(regs.map((r) => ({ tipo: r.tipo, desfeitoEm: r.desfeitoEm, valor: valorDoRegistro(r, valores) }))),
    mensagensDoDono,
    pausadosAgora: pausados,
    ultimos: ultimos.map((r) => paraLinha(r, ultimoId, tz)),
    ultimoDesfazivelId: ultimoId,
  };
}

export async function historicoDoBill(
  franchiseeId: string,
  tz: string | null | undefined,
  f: FiltrosDoHistorico,
): Promise<{ hoje: string; filtros: { de: string | null; ate: string | null }; registros: LinhaDoHistorico[]; proximo: string | null; ultimoDesfazivelId: string | null }> {
  const hoje = hojeNaLoja(tz);
  if (!(await garantirEstruturaDoAssessor())) return { hoje, filtros: { de: f.de, ate: f.ate }, registros: [], proximo: null, ultimoDesfazivelId: null };
  const criadoEm: { gte?: Date; lt?: Date } = {};
  if (f.de) criadoEm.gte = janelaDosDias(f.de, f.de, tz).inicio;
  if (f.ate) criadoEm.lt = janelaDosDias(f.ate, f.ate, tz).fim;

  const where: any = {
    franchiseeId,
    ...(f.tipos.length ? { tipo: { in: f.tipos } } : {}),
    ...(f.canal ? { canal: f.canal } : {}),
    ...(f.comDesfeitos ? {} : { desfeitoEm: null }),
    ...(f.busca ? { resumo: { contains: f.busca, mode: "insensitive" } } : {}),
    ...(criadoEm.gte || criadoEm.lt ? { criadoEm } : {}),
  };
  if (f.cursor) {
    where.AND = [{ OR: [{ criadoEm: { lt: f.cursor.criadoEm } }, { criadoEm: f.cursor.criadoEm, id: { lt: f.cursor.id } }] }];
  }

  const [linhas, ultimoId] = await Promise.all([
    prisma.assessorRegistro.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: f.limite + 1, select: CAMPOS }),
    ultimoDesfazivel(franchiseeId),
  ]);
  const temMais = linhas.length > f.limite;
  const pagina = linhas.slice(0, f.limite);
  return {
    hoje,
    filtros: { de: f.de, ate: f.ate },
    registros: pagina.map((r) => paraLinha(r, ultimoId, tz)),
    proximo: temMais && pagina.length ? codificarCursor(pagina[pagina.length - 1]) : null,
    ultimoDesfazivelId: ultimoId,
  };
}
