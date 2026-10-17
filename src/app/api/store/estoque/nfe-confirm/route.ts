import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { CompraRecusadaError, lancarCompra, type PagamentoDaCompra } from "@/lib/cmv/lancar-compra";
import { conferirPausaDaCompra } from "@/lib/pausa-pelo-estoque-no-banco";
import { hojeNaLoja } from "@/lib/relatorios/base";

/**
 * Confirma a nota lida por IA na aba "Entrada com IA" do Estoque.
 *
 * Desde 11/10/2026 a nota é a COMPRA inteira (lib/cmv/lancar-compra.ts): entra
 * no estoque com o custo daquela compra, ganha o dia em que a mercadoria
 * chegou (é ele que põe a compra na semana do CMV) e vira conta a pagar — paga
 * na hora ou a prazo. Antes ela só somava no estoque, e o boleto era lançado
 * de novo em Contas a Pagar, sem ligação nenhuma.
 *
 * Corpo: { items, invoiceData: { fornecedor, numeroNF, dataEmissao, valorTotal },
 *          imageUrl, dia?, pagamento? }
 * Sem `pagamento`, nenhuma conta é criada (o comportamento antigo). Sem `dia`,
 * vale hoje no dia operacional da loja.
 */
export async function POST(req: Request) {
  try {
    const r = await exigirEstoque();
    if (!r.ok) return r.resposta;
    const { lojaId: franchiseeId, usuarioId, tz } = r.acesso;

    const { items, invoiceData, imageUrl, dia, pagamento } = await req.json();
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Nenhum item para processar" }, { status: 400 });
    }

    // Os stockItemId vêm crus do body: confere todos de uma vez antes da
    // transação, para recusar a nota inteira com 400 em vez de gravar metade.
    const ids: string[] = Array.from(new Set(
      items.map((i: any) => String(i?.stockItemId || "")).filter((id: string) => id && id !== "NEW" && id !== "IGNORAR"),
    ));
    if (ids.length > 0) {
      const daLoja = await prisma.stockItem.count({ where: { id: { in: ids }, franchiseeId } });
      if (daLoja !== ids.length) {
        return NextResponse.json({ error: "Um dos itens da nota não pertence ao estoque desta loja" }, { status: 400 });
      }
    }

    const result = await prisma.$transaction((tx) =>
      lancarCompra(tx, {
        franchiseeId,
        usuarioId,
        dia: typeof dia === "string" && dia ? dia : hojeNaLoja(tz),
        origem: "NFE",
        fornecedor: invoiceData?.fornecedor,
        numero: invoiceData?.numeroNF,
        dataEmissao: invoiceData?.dataEmissao,
        valorTotal: invoiceData?.valorTotal,
        imageUrl,
        itens: items,
        pagamento: (pagamento as PagamentoDaCompra | null) ?? null,
      }),
    );
    // Chegou o insumo: o que a pausa pelo estoque tirou do ar pode voltar.
    await conferirPausaDaCompra(franchiseeId, result.invoiceId);

    return NextResponse.json({
      success: true,
      message: `${result.entradas} itens lançados no estoque${result.contas ? ` e ${result.contas} conta(s) a pagar criada(s)` : ""}.`,
      transactions: result.entradas,
      createdItems: result.insumosCriados,
      ...result,
    });
  } catch (error: any) {
    if (error instanceof CompraRecusadaError || error?.name === "CompraRecusadaError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[NFe Confirm] Error:", error);
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}
