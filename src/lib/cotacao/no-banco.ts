/**
 * A cotação lida do banco: fornecedores, produtos (com o saldo do insumo
 * ligado), preços e a rodada da vez — o que a tela, a planilha e o resumo do
 * comprador usam. A conta mesmo é pura (./comparativo.ts).
 */
import { prisma } from "@/lib/prisma";
import { montarComparativo, type Comparativo, type FornecedorDoComparativo, type ProdutoDoComparativo } from "./comparativo";

/** Uma rodada vale por isso: resposta que chega depois já é atualização avulsa. */
export const VIDA_DA_RODADA_MS = 4 * 24 * 60 * 60 * 1000;

export const listaDeTexto = (bruto: unknown): string[] =>
  Array.isArray(bruto) ? bruto.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
export const listaDeDias = (bruto: unknown): number[] =>
  Array.isArray(bruto) ? [...new Set(bruto.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];

export async function dadosDaLoja(franchiseeId: string) {
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeName: true, name: true, storeTimezone: true, notificationPhone: true },
  });
  return {
    nome: loja?.storeName || loja?.name || "nossa loja",
    tz: loja?.storeTimezone || "America/Sao_Paulo",
    telefoneDoDono: loja?.notificationPhone || null,
  };
}

export async function fornecedoresDaLoja(franchiseeId: string, soAtivos = false) {
  const lista = await prisma.fornecedor.findMany({
    where: { franchiseeId, ...(soAtivos ? { ativo: true } : {}) },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
  return lista.map((f) => ({ ...f, categorias: listaDeTexto(f.categorias), diasDeEntrega: listaDeDias(f.diasDeEntrega) }));
}

export async function produtosDaLoja(franchiseeId: string, soAtivos = false) {
  const lista = await prisma.produtoDeCompra.findMany({
    where: { franchiseeId, ...(soAtivos ? { ativo: true } : {}) },
    orderBy: [{ categoria: "asc" }, { nome: "asc" }],
  });
  const ids = [...new Set(lista.map((p) => p.stockItemId).filter((x): x is string => !!x))];
  const insumos = ids.length
    ? await prisma.stockItem.findMany({ where: { id: { in: ids }, franchiseeId }, select: { id: true, name: true, quantity: true, minQuantity: true, unit: true, unitCost: true } })
    : [];
  const porId = new Map(insumos.map((i) => [i.id, i]));
  return lista.map((p) => ({ ...p, apelidos: listaDeTexto(p.apelidos), insumo: p.stockItemId ? porId.get(p.stockItemId) || null : null }));
}

/** A rodada mais recente ainda viva, com quem foi pedido e quem já mandou preço. */
export async function rodadaDaVez(franchiseeId: string, agora: Date = new Date()) {
  const rodada = await prisma.cotacaoRodada.findFirst({
    where: { franchiseeId, criadaEm: { gte: new Date(agora.getTime() - VIDA_DA_RODADA_MS) } },
    orderBy: { criadaEm: "desc" },
  });
  if (!rodada) return null;
  const [envios, respostas] = await Promise.all([
    prisma.cotacaoEnvio.findMany({ where: { rodadaId: rodada.id, tipo: "PRECOS" }, select: { fornecedorId: true, status: true } }),
    prisma.cotacaoResposta.findMany({ where: { rodadaId: rodada.id, status: "LIDA" }, select: { fornecedorId: true } }),
  ]);
  const pedidosA = [...new Set(envios.filter((e) => e.status !== "CANCELADO" && e.fornecedorId).map((e) => e.fornecedorId!))];
  const responderam = [...new Set(respostas.map((r) => r.fornecedorId))];
  return {
    ...rodada,
    pedidosA,
    responderam,
    naFila: envios.filter((e) => e.status === "FILA" || e.status === "ENVIANDO").length,
    falharam: envios.filter((e) => e.status === "FALHOU").length,
  };
}

/** O comparativo inteiro da loja (preços confirmados dos últimos 120 dias). */
export async function comparativoDaLoja(franchiseeId: string, agora: Date = new Date()): Promise<{
  comparativo: Comparativo;
  rodada: Awaited<ReturnType<typeof rodadaDaVez>>;
  produtos: Awaited<ReturnType<typeof produtosDaLoja>>;
  fornecedores: Awaited<ReturnType<typeof fornecedoresDaLoja>>;
}> {
  const [produtos, fornecedores, rodada] = await Promise.all([
    produtosDaLoja(franchiseeId, true),
    fornecedoresDaLoja(franchiseeId, true),
    rodadaDaVez(franchiseeId, agora),
  ]);
  const precos = await prisma.cotacaoPreco.findMany({
    where: { franchiseeId, status: "CONFIRMADO", produtoId: { not: null }, criadoEm: { gte: new Date(agora.getTime() - 120 * 24 * 60 * 60 * 1000) } },
    orderBy: { criadoEm: "desc" },
    take: 8000,
    select: { fornecedorId: true, produtoId: true, preco: true, criadoEm: true, validade: true },
  });
  const ps: ProdutoDoComparativo[] = produtos.map((p) => ({
    id: p.id, nome: p.nome, categoria: p.categoria, unidade: p.unidade, quantidadePadrao: p.quantidadePadrao,
    saldo: p.insumo ? p.insumo.quantity : null, minimo: p.insumo?.minQuantity ?? null, unidadeDoInsumo: p.insumo?.unit ?? null,
  }));
  const fs: FornecedorDoComparativo[] = fornecedores.map((f) => ({ id: f.id, nome: f.nome, categorias: f.categorias }));
  const comparativo = montarComparativo(
    ps, fs,
    precos.map((p) => ({ fornecedorId: p.fornecedorId, produtoId: p.produtoId!, preco: p.preco, em: p.criadoEm.toISOString(), validade: p.validade })),
    rodada ? { pedidosA: rodada.pedidosA, responderam: rodada.responderam } : null,
    agora,
  );
  return { comparativo, rodada, produtos, fornecedores };
}
