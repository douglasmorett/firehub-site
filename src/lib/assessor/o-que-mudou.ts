/**
 * O QUE MUDOU NA LOJA nas últimas 24 horas — por qualquer pessoa, pelo painel
 * ou pelo Bill. Vai no prompt de cada resposta.
 *
 * Douglas, 14/10/2026: "entender se alguém tá mexendo no painel também… pra
 * não falar informação separada". O gerente pausou a Coca 2L no painel e o
 * dono pergunta ao Bill "por que a Coca sumiu?": o Bill tem de saber, e dizer
 * quem foi quando o sistema sabe.
 *
 * Só leitura. Cada bloco tem teto de linhas: isto entra em toda mensagem.
 */
import { prisma } from "@/lib/prisma";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { PREFIXO_DA_MEIA } from "@/lib/meio-a-meio";

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "").replace(".", ","));

const ROTULO_DO_MOVIMENTO: Record<string, string> = {
  INPUT: "entrada", OUTPUT: "saída", WASTE: "perda", AJUSTE: "ajuste da contagem", ESTORNO: "compra desfeita",
};

export async function oQueMudouNaLoja(franchiseeId: string, timezone?: string | null, agora: Date = new Date()): Promise<string> {
  const tz = timezone || "America/Sao_Paulo";
  const hora = (d: Date) => d.toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const desde = new Date(agora.getTime() - DIA_MS);

  try {
    const [movimentos, compras, despesas, contasPagas, produtos, registrosDoBill] = await Promise.all([
      prisma.stockTransaction.findMany({
        where: { franchiseeId, createdAt: { gte: desde }, type: { in: Object.keys(ROTULO_DO_MOVIMENTO) }, stockInvoiceId: null },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { type: true, quantity: true, notes: true, userId: true, createdAt: true, stockItem: { select: { name: true, unit: true } } },
      }),
      prisma.stockInvoice.findMany({
        where: { franchiseeId, createdAt: { gte: desde } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { supplier: true, totalAmount: true, criadoPor: true, createdAt: true, canceladaEm: true, origem: true },
      }),
      prisma.despesaLancada
        .findMany({ where: { franchiseeId, createdAt: { gte: desde } }, orderBy: { createdAt: "desc" }, take: 8, select: { categoria: true, descricao: true, valor: true, criadoPor: true, createdAt: true } })
        .catch(() => []),
      prisma.payable.findMany({
        where: { franchiseeId, status: "PAID", updatedAt: { gte: desde } },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { supplierName: true, value: true, updatedAt: true },
      }),
      prisma.menuProduct.findMany({
        where: { franchiseeId, updatedAt: { gte: desde }, ...SEM_PRODUTO_DE_INTEGRACAO, NOT: { name: { startsWith: PREFIXO_DA_MEIA } } },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { id: true, name: true, active: true, updatedAt: true },
      }),
      prisma.assessorRegistro
        .findMany({ where: { franchiseeId, criadoEm: { gte: desde } }, select: { tipo: true, refs: true, canal: true, desfeitoEm: true } })
        .catch(() => [] as any[]),
    ]);

    // Nome de quem lançou (o STAFF é um User com ownerId).
    const ids = [...new Set([...movimentos.map((m) => m.userId), ...compras.map((c) => c.criadoPor)].filter(Boolean) as string[])];
    const pessoas = new Map(
      (ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ownerId: true } }) : []).map((u) => [u.id, u.ownerId ? `${u.name || "funcionário"} (equipe)` : `${u.name || "dono"} (dono)`]),
    );
    const quem = (id?: string | null) => (id ? pessoas.get(id) || "alguém da loja" : "alguém da loja");
    const viaBill = (nota?: string | null) => /\(Bill\)|Meu Assessor/.test(nota || "");

    // Produtos pausados/reativados pelo Bill nas últimas 24 h: o resto foi alguém no painel.
    const doBill = new Set<string>();
    for (const r of registrosDoBill) if ((r.tipo === "PAUSADO" || r.tipo === "REATIVADO") && !r.desfeitoEm) for (const id of ((r.refs as any)?.ids || [])) doBill.add(id);

    const linhas: string[] = [];
    for (const m of movimentos) {
      linhas.push(`- ${hora(m.createdAt)} ${ROTULO_DO_MOVIMENTO[m.type] || m.type} de ${qtd(Math.abs(m.quantity))} ${m.stockItem.unit} de ${m.stockItem.name} — ${viaBill(m.notes) ? "pelo Bill" : `por ${quem(m.userId)}, no painel`}`);
    }
    for (const c of compras) {
      linhas.push(`- ${hora(c.createdAt)} compra${c.supplier ? ` (${c.supplier})` : ""} de ${reais(c.totalAmount || 0)} lançada por ${quem(c.criadoPor)}${c.canceladaEm ? " — DESFEITA depois" : ""}`);
    }
    for (const d of despesas) {
      linhas.push(`- ${hora(d.createdAt)} despesa ${d.categoria}${d.descricao ? ` (${d.descricao})` : ""} ${reais(d.valor)} — ${/^Bill|Meu Assessor/.test(d.criadoPor || "") ? "pelo Bill" : `por ${d.criadoPor || "alguém"} no painel`}`);
    }
    for (const p of contasPagas) linhas.push(`- ${hora(p.updatedAt)} conta paga: ${p.supplierName} ${reais(p.value)}`);
    for (const p of produtos) {
      const situacao = p.active ? "à venda" : "PAUSADO";
      linhas.push(`- ${hora(p.updatedAt)} cardápio: "${p.name}" agora ${situacao} — ${doBill.has(p.id) ? "mudado pelo Bill" : "alterado por alguém no painel (o sistema não grava quem)"}`);
    }

    if (!linhas.length) return "O QUE MUDOU NA LOJA NAS ÚLTIMAS 24H: nada lançado no estoque, financeiro ou cardápio fora as vendas.";
    return `O QUE MUDOU NA LOJA NAS ÚLTIMAS 24H (painel, equipe e você mesmo; use para responder "quem mexeu", "por que sumiu" e para não contradizer o painel):\n${linhas.join("\n")}`;
  } catch (err: any) {
    console.error("[Bill] o que mudou falhou:", err?.message);
    return "";
  }
}
