import { NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { prisma } from "@/lib/prisma";
import { ehPreparo } from "@/lib/cmv/custo-do-insumo";

/** Edição de custo pela ficha. Auditoria sem movimentar mercadoria ou contas. */
export async function PATCH(req: Request) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  if (!r.acesso.mexeNoEstoque) return NextResponse.json({ error: "Sem permissão para editar o estoque." }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const { id, custo } = body ?? {};
  if (typeof id !== "string" || typeof custo !== "number" || !Number.isFinite(custo) || custo <= 0 || custo > 1_000_000) {
    return NextResponse.json({ error: "Informe um custo maior que zero por unidade do estoque." }, { status: 400 });
  }
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findFirst({ where: { id, franchiseeId: r.acesso.lojaId, NOT: { active: false } } });
      if (!item) return { status: 404, error: "Insumo não encontrado." };
      if (ehPreparo(item)) return { status: 400, error: "O custo do preparo vem dos componentes e do rendimento. Edite a receita do preparo." };
      const alterado = await tx.stockItem.updateMany({ where: { id: item.id, franchiseeId: r.acesso.lojaId, unitCost: item.unitCost }, data: { unitCost: custo } });
      if (alterado.count !== 1) return { status: 409, error: "O custo mudou durante a edição. Atualize a ficha e tente novamente." };
      await tx.stockTransaction.create({ data: {
        stockItemId: item.id, franchiseeId: r.acesso.lojaId, userId: r.acesso.usuarioId,
        type: "CUSTO", quantity: 0, unitCost: custo,
        notes: JSON.stringify({ motivo: "Custo editado na ficha técnica", custoAnterior: item.unitCost }),
      } });
      return { status: 200 };
    });
    return NextResponse.json(resultado.error ? { error: resultado.error } : { success: true }, { status: resultado.status });
  } catch (err) {
    console.error("[Estoque custo]", err);
    return NextResponse.json({ error: "Não foi possível salvar o custo. Tente novamente." }, { status: 500 });
  }
}
