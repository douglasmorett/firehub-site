/**
 * A COMPRA LANÇADA UMA VEZ SÓ — estoque e contas a pagar juntos.
 *
 * Até 11/10/2026 a mesma compra tinha três lugares que não se falavam: a nota
 * lida por IA no Estoque (punha no estoque, não criava conta), as Notas de
 * compras do Financeiro (só comprovante) e as Contas a Pagar (só o boleto).
 * Nenhum chegava no CMV. Douglas: "o que adianta cair em três lugares que não
 * se falam?".
 *
 * Agora a compra entra por aqui (foto da nota com IA ou compra sem nota) e
 * numa transação só:
 *   1. cada item vira ENTRADA no estoque com o custo daquela compra gravado no
 *      movimento (`unitCost`) e a compra de origem (`stockInvoiceId`);
 *   2. a compra vira um StockInvoice com o DIA em que a mercadoria entrou — é
 *      por ele que ela cai na semana do CMV;
 *   3. o pagamento vira conta a pagar: paga na hora (já baixada) ou a prazo
 *      (uma conta por vencimento), ligadas à compra.
 *
 * O custo por unidade sai do VALOR TOTAL da linha ÷ a quantidade já convertida
 * para a unidade do insumo. Assim Σ (quantidade × custo) das entradas é
 * exatamente o valor da compra no estoque, sem o arredondamento do preço
 * unitário que a IA leu.
 *
 * Linha "IGNORAR" (a nota do atacado com detergente) não entra no estoque nem
 * no CMV, mas entra no valor a pagar.
 */
import type { prisma } from "@/lib/prisma";
import { converter, normalizarUnidade } from "@/lib/unidades";
import { lerNumeroBr } from "@/lib/cmv/numero";

/** O cliente dentro de `prisma.$transaction` (o prisma da casa é estendido; ver lib/order-number.ts). */
export type TxDoPrisma = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class CompraRecusadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CompraRecusadaError";
  }
}

export type ItemDaCompra = {
  /** Id do insumo, "NEW" (cria) ou "IGNORAR" (não é insumo). */
  stockItemId: string;
  nome?: string;
  newItemName?: string;
  newItemUnit?: string;
  quantidade: number | string;
  unidade?: string;
  valorUnitario?: number | string;
  valorTotal?: number | string;
};

export type ParcelaDaCompra = { vencimento: string; valor: number | string };

export type PagamentoDaCompra =
  /** Pago na hora: a conta já nasce baixada. */
  | { forma: "PAGO"; meio?: string; pagoEm?: string }
  /** A prazo: uma conta a pagar por vencimento. */
  | { forma: "A_PRAZO"; meio?: string; parcelas: ParcelaDaCompra[] }
  /** O boleto vai ser lançado à parte em Contas a Pagar. */
  | { forma: "NAO_LANCAR" };

export type EntradaDaCompra = {
  franchiseeId: string;
  usuarioId: string;
  /** Dia operacional em que a mercadoria entrou ("YYYY-MM-DD"). */
  dia: string;
  origem: "NFE" | "SEM_NOTA";
  fornecedor?: string | null;
  numero?: string | null;
  dataEmissao?: string | null;
  /** Total da nota (com itens ignorados). Sem ele, a soma das linhas. */
  valorTotal?: number | string | null;
  imageUrl?: string | null;
  itens: ItemDaCompra[];
  pagamento?: PagamentoDaCompra | null;
};

export type CompraLancada = {
  invoiceId: string;
  entradas: number;
  insumosCriados: number;
  valorNoEstoque: number;
  valorDaCompra: number;
  contas: number;
};

export const CATEGORIA_DA_COMPRA = "Fornecedores e insumos";

const num = lerNumeroBr;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Meio-dia em Brasília: a data "2026-10-15" não vira 14 no fuso de ninguém. */
export const dataDoDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`);

/** Valor da linha: o total da nota; sem ele, quantidade × unitário. */
export function valorDaLinha(it: ItemDaCompra): number {
  const total = num(it.valorTotal);
  if (Number.isFinite(total) && total > 0) return r2(total);
  const q = num(it.quantidade), u = num(it.valorUnitario);
  return Number.isFinite(q) && Number.isFinite(u) && q > 0 && u > 0 ? r2(q * u) : 0;
}

/** Confere o pagamento antes de gravar. Devolve as parcelas normalizadas. */
export function conferirPagamento(p: PagamentoDaCompra | null | undefined, valorDaCompra: number): { forma: string; parcelas: { vencimento: string; valor: number }[]; meio: string | null; pagoEm: string | null } {
  if (!p || p.forma === "NAO_LANCAR") return { forma: "NAO_LANCAR", parcelas: [], meio: null, pagoEm: null };
  if (p.forma === "PAGO") {
    if (p.pagoEm && !DIA_RE.test(p.pagoEm)) throw new CompraRecusadaError("Data do pagamento inválida.");
    return { forma: "PAGO", parcelas: [], meio: p.meio || null, pagoEm: p.pagoEm || null };
  }
  if (p.forma === "A_PRAZO") {
    const parcelas = (p.parcelas || []).map((x) => ({ vencimento: String(x.vencimento || ""), valor: r2(num(x.valor)) }));
    if (!parcelas.length) throw new CompraRecusadaError("Informe pelo menos um vencimento.");
    for (const x of parcelas) {
      if (!DIA_RE.test(x.vencimento)) throw new CompraRecusadaError("Há um vencimento sem data.");
      if (!(x.valor > 0)) throw new CompraRecusadaError("Há um vencimento sem valor.");
    }
    const soma = r2(parcelas.reduce((s, x) => s + x.valor, 0));
    if (valorDaCompra > 0 && Math.abs(soma - valorDaCompra) > 0.05) {
      throw new CompraRecusadaError(
        `Os vencimentos somam R$ ${soma.toFixed(2).replace(".", ",")}, mas a compra é de R$ ${valorDaCompra.toFixed(2).replace(".", ",")}. Ajuste os valores para fechar.`,
      );
    }
    return { forma: "A_PRAZO", parcelas, meio: p.meio || "BOLETO", pagoEm: null };
  }
  throw new CompraRecusadaError("Forma de pagamento desconhecida.");
}

/**
 * Grava a compra. Chame dentro de `prisma.$transaction`: ou entra tudo, ou nada.
 * Os ids de insumo já devem ter sido conferidos como da loja (a rota faz isso
 * antes de abrir a transação, para responder 400 em vez de 500).
 */
export async function lancarCompra(tx: TxDoPrisma, e: EntradaDaCompra): Promise<CompraLancada> {
  if (!DIA_RE.test(e.dia)) throw new CompraRecusadaError("Informe o dia em que a mercadoria chegou.");
  if (!Array.isArray(e.itens) || e.itens.length === 0) throw new CompraRecusadaError("A compra não tem nenhum item.");

  const somaDasLinhas = r2(e.itens.reduce((s, it) => s + valorDaLinha(it), 0));
  const totalInformado = num(e.valorTotal);
  const valorDaCompra = Number.isFinite(totalInformado) && totalInformado > 0 ? r2(totalInformado) : somaDasLinhas;
  const pagamento = conferirPagamento(e.pagamento, valorDaCompra);

  const fornecedor = String(e.fornecedor || "").trim() || null;
  const numero = String(e.numero || "").trim() || null;

  const invoice = await tx.stockInvoice.create({
    data: {
      franchiseeId: e.franchiseeId,
      invoiceNumber: numero,
      supplier: fornecedor,
      totalAmount: valorDaCompra,
      imageUrl: e.imageUrl || null,
      processedData: { itens: e.itens, dataEmissao: e.dataEmissao || null, pagamento: e.pagamento || null } as any,
      dia: e.dia,
      origem: e.origem,
      criadoPor: e.usuarioId,
    },
  });

  const incompativeis: string[] = [];
  let entradas = 0, insumosCriados = 0, valorNoEstoque = 0;
  // O custo que cada insumo tinha ANTES desta compra (ela sobrescreve o
  // cadastro). Serve para desfazer a compra e para valorizar uma contagem de
  // um dia anterior a ela, fechada depois (lib/cmv/custo-do-insumo.ts).
  const custosAnteriores: Record<string, number | null> = {};
  const rotulo = `${e.origem === "NFE" ? "NF-e" : "Compra"}${numero ? ` #${numero}` : ""}${fornecedor ? ` - ${fornecedor}` : ""}`;

  for (const it of e.itens) {
    if (it.stockItemId === "IGNORAR") continue;
    const valor = valorDaLinha(it);
    let stockItemId = it.stockItemId;

    if (!stockItemId || stockItemId === "NEW") {
      const nome = String(it.newItemName || it.nome || "").trim();
      if (!nome) throw new CompraRecusadaError("Há um item novo sem nome.");
      const existente = await tx.stockItem.findFirst({ where: { franchiseeId: e.franchiseeId, name: { equals: nome, mode: "insensitive" } } });
      if (existente) {
        stockItemId = existente.id;
        // Arquivado com o mesmo nome: a compra traz de volta.
        if (existente.active === false) await tx.stockItem.update({ where: { id: existente.id }, data: { active: true } });
      } else {
        const novo = await tx.stockItem.create({
          data: {
            franchiseeId: e.franchiseeId,
            name: nome,
            quantity: 0,
            unit: normalizarUnidade(it.newItemUnit || it.unidade) || "un",
            supplier: fornecedor,
          },
        });
        stockItemId = novo.id;
        insumosCriados++;
      }
    }

    const insumo = await tx.stockItem.findFirst({ where: { id: stockItemId, franchiseeId: e.franchiseeId }, select: { name: true, unit: true, unitCost: true } });
    if (!insumo) throw new CompraRecusadaError("Um dos itens da compra não pertence ao estoque desta loja.");
    if (!(stockItemId in custosAnteriores)) custosAnteriores[stockItemId] = insumo.unitCost ?? null;

    const unidadeDoInsumo = normalizarUnidade(insumo.unit) || String(insumo.unit || "").trim() || "un";
    const unidadeDaLinha = normalizarUnidade(it.unidade || it.newItemUnit) || unidadeDoInsumo;
    const qLinha = num(it.quantidade);
    if (!Number.isFinite(qLinha) || qLinha <= 0) {
      throw new CompraRecusadaError(`A quantidade de "${insumo.name}" está vazia ou ilegível. Confira esse item.`);
    }
    const quantidade = converter(qLinha, unidadeDaLinha, unidadeDoInsumo);
    if (quantidade === null) {
      incompativeis.push(`"${insumo.name}" (compra em ${unidadeDaLinha}, insumo em ${unidadeDoInsumo})`);
      continue;
    }

    const custo = valor > 0 ? Number((valor / quantidade).toFixed(6)) : null;
    const alterados = await tx.stockItem.updateMany({
      where: { id: stockItemId, franchiseeId: e.franchiseeId },
      data: {
        quantity: { increment: quantidade },
        ...(custo ? { unitCost: custo } : {}),
        ...(fornecedor ? { supplier: fornecedor } : {}),
      },
    });
    if (alterados.count === 0) throw new CompraRecusadaError("Um dos itens da compra não pertence ao estoque desta loja.");

    await tx.stockTransaction.create({
      data: {
        stockItemId,
        franchiseeId: e.franchiseeId,
        userId: e.usuarioId,
        quantity: quantidade,
        type: "INPUT",
        unitCost: custo,
        stockInvoiceId: invoice.id,
        notes: `${rotulo} (R$ ${valor.toFixed(2)})${unidadeDaLinha !== unidadeDoInsumo ? ` - na compra: ${qLinha} ${unidadeDaLinha}` : ""}`,
      },
    });
    entradas++;
    valorNoEstoque += valor;
  }

  if (incompativeis.length > 0) {
    throw new CompraRecusadaError(
      `Nada foi lançado. A unidade destes itens não se converte sozinha: ${incompativeis.join("; ")}. ` +
        `Lance a quantidade já na unidade do insumo (ex.: 6 un em vez de 1 cx).`,
    );
  }
  if (entradas === 0) throw new CompraRecusadaError("Nenhum item foi para o estoque: todos estão como \"não é insumo\".");

  valorNoEstoque = r2(valorNoEstoque);
  await tx.stockInvoice.update({
    where: { id: invoice.id },
    data: { valorNoEstoque, processedData: { itens: e.itens, dataEmissao: e.dataEmissao || null, pagamento: e.pagamento || null, custosAnteriores } as any },
  });

  // ── Contas a pagar ──────────────────────────────────────────────────────
  let contas = 0;
  const nomeDaConta = `${fornecedor || (e.origem === "SEM_NOTA" ? "Compra sem nota" : "Fornecedor")}${numero ? ` — NF ${numero}` : ""}`.slice(0, 120);
  if (pagamento.forma === "PAGO" && valorDaCompra > 0) {
    const pagoEm = dataDoDia(pagamento.pagoEm || e.dia);
    await tx.payable.create({
      data: {
        franchiseeId: e.franchiseeId,
        supplierName: nomeDaConta,
        receivedDate: dataDoDia(e.dia),
        dueDate: pagoEm,
        value: valorDaCompra,
        status: "PAID",
        paidDate: pagoEm,
        category: CATEGORIA_DA_COMPRA,
        paymentType: pagamento.meio,
        stockInvoiceId: invoice.id,
      },
    });
    contas++;
  } else if (pagamento.forma === "A_PRAZO") {
    const n = pagamento.parcelas.length;
    for (const [i, p] of pagamento.parcelas.entries()) {
      await tx.payable.create({
        data: {
          franchiseeId: e.franchiseeId,
          supplierName: n > 1 ? `${nomeDaConta} (${i + 1}/${n})`.slice(0, 140) : nomeDaConta,
          receivedDate: dataDoDia(e.dia),
          dueDate: dataDoDia(p.vencimento),
          value: p.valor,
          status: "PENDING",
          category: CATEGORIA_DA_COMPRA,
          paymentType: pagamento.meio,
          stockInvoiceId: invoice.id,
        },
      });
      contas++;
    }
  }

  return { invoiceId: invoice.id, entradas, insumosCriados, valorNoEstoque, valorDaCompra, contas };
}

/**
 * Desfaz uma compra lançada errado: estorna cada entrada (movimento ESTORNO,
 * com o mesmo custo), apaga as contas ainda não pagas e marca a compra como
 * cancelada. Conta já paga fica: o dinheiro saiu, e o acerto é com o fornecedor.
 */
export async function desfazerCompra(tx: TxDoPrisma, e: { franchiseeId: string; usuarioId: string; invoiceId: string }): Promise<{ estornos: number; contasApagadas: number; contasPagasMantidas: number }> {
  const compra = await tx.stockInvoice.findFirst({ where: { id: e.invoiceId, franchiseeId: e.franchiseeId } });
  if (!compra) throw new CompraRecusadaError("Compra não encontrada.");
  if (compra.canceladaEm) throw new CompraRecusadaError("Esta compra já foi desfeita.");

  const entradas = await tx.stockTransaction.findMany({ where: { stockInvoiceId: compra.id, type: "INPUT" } });
  const anteriores = ((compra.processedData as any)?.custosAnteriores || {}) as Record<string, number | null>;
  let estornos = 0;
  for (const t of entradas) {
    // O custo do cadastro volta ao de antes desta compra — se nenhuma compra
    // depois dela já o trocou de novo.
    if (t.stockItemId in anteriores) {
      await tx.stockItem.updateMany({
        where: { id: t.stockItemId, franchiseeId: e.franchiseeId, unitCost: t.unitCost },
        data: { unitCost: anteriores[t.stockItemId] },
      });
    }
    await tx.stockTransaction.create({
      data: {
        stockItemId: t.stockItemId,
        franchiseeId: e.franchiseeId,
        userId: e.usuarioId,
        quantity: -t.quantity,
        type: "ESTORNO",
        unitCost: t.unitCost,
        stockInvoiceId: compra.id,
        notes: `Compra desfeita${compra.invoiceNumber ? ` - NF ${compra.invoiceNumber}` : ""}${compra.supplier ? ` - ${compra.supplier}` : ""}`,
      },
    });
    await tx.stockItem.updateMany({ where: { id: t.stockItemId, franchiseeId: e.franchiseeId }, data: { quantity: { decrement: t.quantity } } });
    estornos++;
  }

  const apagadas = await tx.payable.deleteMany({ where: { stockInvoiceId: compra.id, franchiseeId: e.franchiseeId, status: { not: "PAID" } } });
  const pagas = await tx.payable.count({ where: { stockInvoiceId: compra.id, franchiseeId: e.franchiseeId, status: "PAID" } });
  await tx.stockInvoice.update({ where: { id: compra.id }, data: { canceladaEm: new Date() } });

  return { estornos, contasApagadas: apagadas.count, contasPagasMantidas: pagas };
}
