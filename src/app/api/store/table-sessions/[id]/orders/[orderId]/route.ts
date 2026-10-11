/**
 * Edição de um pedido JÁ LANÇADO numa mesa aberta.
 *
 * O garçom lança errado, o cliente muda de ideia, a cozinha avisa que acabou —
 * e até aqui a única saída era fechar a conta com item que ninguém consumiu
 * (ou cancelar a sessão inteira). O painel de mesas mostrava os pedidos como
 * leitura pura.
 *
 * PATCH  { itens: [{ itemId, quantity }], removerItemIds: [...] }
 *        → muda quantidades e/ou remove itens; o total do pedido é RECALCULADO
 *          do que sobrou (nunca editado à mão). Se não sobrar item nenhum, o
 *          pedido inteiro é cancelado — pedido de total zero e zero itens é a
 *          classe de fantasma que o schema já documenta.
 * DELETE → cancela o pedido inteiro e DEVOLVE o estoque baixado (a devolução
 *          usa as baixas registradas, não a ficha técnica de hoje).
 *
 * A regra mora em lib/edicao-na-mesa.ts desde 09/10/2026: o lápis do card de
 * mesa no quadro de Pedidos (api/store/orders/[id]/itens) edita a mesma
 * rodada, e as duas telas têm de fazer a mesma conta. Esta rota só resolve
 * QUEM está operando (painel ou garçom pelo link) e a permissão do garçom.
 *
 * Guardas, nesta ordem: sessão do painel → mesa da MINHA loja → sessão ainda
 * OPEN → pedido DESTA sessão → pedido não cancelado e sem nota fiscal
 * emitida. Mesa fechada não se edita: a conta já virou pagamento; corrigir
 * depois é estorno, outro fluxo.
 *
 * MOTIVO OBRIGATÓRIO (lib/motivo-do-cancelamento.ts, Pizzaria 17, 09/10/2026):
 * tirar item, diminuir quantidade e cancelar o pedido pedem `motivo` no corpo
 * — sem ele, 400. O que saiu fica no rastro do pedido (`editHistory`, com
 * `itensRetirados` e o motivo): antes o item era apagado sem deixar nada, e o
 * fechamento do caixa não tinha como mostrar o que a mesa deixou de pagar.
 *
 * Estoque em edição PARCIAL não é mexido de propósito: a devolução registrada
 * é por PEDIDO, e devolver "proporcional" pela ficha técnica de hoje devolveria
 * a receita atual, que pode ter mudado desde a baixa. Reduzir quantidade não
 * devolve insumo — cancelar o pedido devolve tudo. Está documentado na tela.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { carregarRodadaDaMesa, editarRodadaDaMesa, cancelarRodadaDaMesa } from "@/lib/edicao-na-mesa";
import { motivoDoCorpo } from "@/lib/motivo-do-cancelamento";

async function contexto(params: Promise<{ id: string; orderId: string }>) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts):
  // corrigir o que acabou de lançar na mesa é trabalho do garçom.
  const operador = await resolverOperadorDaMesa();
  if (!operador) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const lojaId = operador.franchiseeId;

  const { id, orderId } = await params;
  const carregado = await carregarRodadaDaMesa(lojaId, orderId, id);
  if ("erro" in carregado) {
    return { erro: NextResponse.json(carregado.erro.corpo, { status: carregado.erro.status }) };
  }

  // Garçom sem "pode remover item" (cadastro): só aumenta quantidade.
  const podeRemoverItem = operador.tipo !== "garcom" || !!operador.garcom.podeRemoverItem;
  return { lojaId, rodada: carregado.rodada, operador, podeRemoverItem };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;

    const body = await req.json().catch(() => ({} as any));
    const r = await editarRodadaDaMesa({
      lojaId: ctx.lojaId,
      rodada: ctx.rodada,
      pedido: { itens: body?.itens, removerItemIds: body?.removerItemIds, motivo: motivoDoCorpo(body) },
      quem: rotuloDoOperador(ctx.operador),
      podeRemoverItem: ctx.podeRemoverItem,
    });
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (error: any) {
    console.error("[Table Session Order PATCH]", error);
    return NextResponse.json({ error: "Erro ao editar o pedido" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    // Cancelar o pedido inteiro é remover todos os itens: mesma permissão.
    if (!ctx.podeRemoverItem) {
      return NextResponse.json({ error: "Este garçom não cancela pedido lançado. Peça ao caixa para ajustar pelo painel." }, { status: 403 });
    }
    // O motivo vem no corpo do DELETE ({ motivo }) ou, para quem não manda
    // corpo em DELETE, em ?motivo=.
    const body = await req.json().catch(() => ({} as any));
    const motivo = motivoDoCorpo(body) || motivoDoCorpo({ motivo: req.nextUrl.searchParams.get("motivo") });
    const r = await cancelarRodadaDaMesa({ rodada: ctx.rodada, quem: rotuloDoOperador(ctx.operador), motivo });
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (error: any) {
    console.error("[Table Session Order DELETE]", error);
    return NextResponse.json({ error: "Erro ao cancelar o pedido" }, { status: 500 });
  }
}
