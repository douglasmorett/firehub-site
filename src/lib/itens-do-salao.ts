/**
 * O item que o GARÇOM (ou o cliente pelo QR) manda, conferido pelo servidor:
 * produto desta loja, ativo e liberado para o salão, dentro do dia e horário
 * de venda, com o PREÇO DO SALÃO recalculado aqui — nunca o preço do corpo.
 *
 * Nasceu dentro de lib/lancar-na-mesa.ts e saiu de lá quando o garçom ganhou
 * o pedido de balcão (api/garcom/balcao, 17/10/2026): o mesmo celular, o
 * mesmo cardápio (/api/garcom/cardapio, canal salão) e a mesma desconfiança
 * — o garçom é o papel de menor confiança do sistema depois do cliente, e uma
 * requisição montada na mão não pode lançar o combo por R$ 0,01 no balcão
 * mais do que pode na mesa.
 *
 * Não confere estoque: quem chama confere, no momento certo do seu fluxo.
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { SEM_PRODUTO_DE_INTEGRACAO, motivoForaDoCardapio, textoDoHorario, textoDosDias } from "@/lib/cardapio-interno";
import { aplicarPrecoDoCanalComCombo } from "@/lib/preco-por-canal";
import { precoUnitarioDoItem, pisoDoPreco } from "@/lib/preco-combo";
import { PESO_MAXIMO_KG, PESO_MINIMO_KG, textoDoPeso, valorDoPeso } from "@/lib/balanca/protocolo-toledo";

export type ItemParaLancar = {
  menuProductId?: unknown;
  quantity?: unknown;
  comboSelections?: unknown;
  tableGuestId?: unknown;
  notes?: unknown;
  /** Só a balança manda (lib/balanca): o peso lido, em kg. */
  pesoKg?: unknown;
};

export type ItemDoSalao = {
  menuProductId: string;
  quantity: number;
  price: number;
  comboSelections: any;
  tableGuestId: string | null;
  notes: string | null;
  /** Item pesado na balança: o peso em kg (quantidade 1, preço = peso × quilo). */
  pesoKg: number | null;
};

export async function validarItensDoSalao(opcoes: {
  franchiseeId: string;
  items: ItemParaLancar[];
  /** Texto do "estes itens não estão no cardápio": o garçom atualiza a tela; o cliente, o cardápio. */
  comoTentarDeNovo: string;
  /** "da mesa" ou "do balcão": onde o item foi recusado, na mensagem. */
  ondeVende?: string;
  /**
   * Os produtos vendidos POR QUILO (lib/balanca/assinatura.ts). Só a rota da
   * balança passa: o item com `pesoKg` precisa ser um deles, e eles ficam fora
   * do cardápio do garçom — pedir um por unidade é recusado como qualquer
   * produto que não está no salão.
   */
  pesaveis?: string[];
}): Promise<{ ok: true; itens: ItemDoSalao[] } | { ok: false; status: number; error: string }> {
  const { franchiseeId: targetFranchiseeId, items } = opcoes;
  const tenteDeNovo = opcoes.comoTentarDeNovo;
  const ondeVende = opcoes.ondeVende || "da mesa";
  const fuso = await fusoDaLoja(targetFranchiseeId);

  // ── PREÇO E PRODUTO SÃO DO SERVIDOR, NÃO DO CORPO ─────────────────────
  // A rota gravava o `price` que a tela mandava e aceitava qualquer
  // menuProductId. Com o módulo aberto ao garçom pelo link — e agora ao
  // cliente pelo QR, o papel de menor confiança do sistema — bastaria uma
  // requisição montada na mão para lançar o combo por R$ 0,01 ou um produto
  // de outra loja. Mesma regra do totem (api/totem/order): produto da loja,
  // ativo e liberado para o salão; preço recalculado pelo canal a partir das
  // escolhas do combo, com o mínimo do produto como piso; quantidade inteira
  // de 1 a 99.
  const idsPedidos = [...new Set(items.map((i) => String(i?.menuProductId ?? "")).filter(Boolean))];
  const produtosDaLoja = await prisma.menuProduct.findMany({
    where: {
      id: { in: idsPedidos },
      franchiseeId: targetFranchiseeId,
      active: true,
      OR: [{ activeGarcom: true }, { id: { in: opcoes.pesaveis ?? [] } }],
      ...SEM_PRODUTO_DE_INTEGRACAO,
    },
    include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
  });
  const porId = new Map(produtosDaLoja.map((p) => [p.id, p]));

  const recusados: string[] = [];
  // Fora do dia/horário é outra conversa: o item ESTÁ no cardápio, só não
  // vende agora. Misturar os dois mandava o lojista cadastrar de novo um
  // produto que já existe (Ragnar Burger, 06/10/2026).
  const foraDaHora: string[] = [];
  const itensValidados: ItemDoSalao[] = [];

  for (const item of items) {
    const produto = porId.get(String(item?.menuProductId ?? ""));
    const pesoKg = item?.pesoKg === undefined || item?.pesoKg === null ? null : Math.round(Number(item.pesoKg) * 1000) / 1000;
    const pesavel = !!produto && (opcoes.pesaveis ?? []).includes(produto.id);
    // Por quilo só com peso, e peso só em produto por quilo: o garçom não lança
    // "1 self-service", e a balança não pesa o refrigerante.
    if (!produto || (pesoKg === null ? !produto.activeGarcom : !pesavel)) {
      recusados.push(String(item?.menuProductId ?? "?"));
      continue;
    }
    if (pesoKg !== null && !(pesoKg >= PESO_MINIMO_KG && pesoKg <= PESO_MAXIMO_KG)) {
      return { ok: false, status: 400, error: `Peso fora do esperado (${item.pesoKg} kg). Pese de novo.` };
    }
    // Produto de dia ou horário específico não sai fora dele; a tela pode
    // estar aberta desde ontem.
    const fora = motivoForaDoCardapio(produto, fuso);
    if (fora) {
      const quando = fora === "horario" ? textoDoHorario(produto.availableHours) : textoDosDias(produto.availableDays);
      foraDaHora.push(quando ? `${produto.name} (só vende ${quando})` : produto.name);
      continue;
    }
    // Mesma conta do cardápio, do modal e do totem (src/lib/preco-combo.ts).
    const noCanal = aplicarPrecoDoCanalComCombo(produto as any, "salao");
    let preco = precoUnitarioDoItem(noCanal as any, item.comboSelections as any);
    // Piso que aceita o desconto da meia pizza mais barata (lib/preco-combo.ts).
    const minimo = pisoDoPreco(noCanal as any);
    if (preco < minimo) preco = minimo;
    if (pesoKg !== null) {
      // O preço do produto (o do salão, com a promoção) é o preço do QUILO.
      // O peso vai escrito na observação: comanda impressa, conta e KDS já a
      // mostram, sem cada tela aprender o que é item pesado.
      itensValidados.push({
        menuProductId: produto.id,
        quantity: 1,
        price: valorDoPeso(pesoKg, preco),
        comboSelections: null,
        tableGuestId: null,
        notes: `${textoDoPeso(pesoKg)} × ${preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/kg`,
        pesoKg,
      });
      continue;
    }
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)));
    itensValidados.push({
      menuProductId: produto.id,
      quantity,
      price: preco,
      comboSelections: item.comboSelections ?? null,
      tableGuestId: item.tableGuestId ? String(item.tableGuestId) : null,
      notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
      pesoKg: null,
    });
  }

  if (foraDaHora.length > 0) {
    // Dizer o motivo CERTO: "não está no cardápio da mesa" manda o lojista
    // procurar um item que está lá — e o caminho do conserto junto, porque
    // quem marcou os dias foi ele, nesta tela.
    return {
      ok: false,
      status: 400,
      error:
        `Fora do dia/horário de venda: ${foraDaHora.join(", ")}. ` +
        "Para vender todo dia, abra Cardápio → o item → 📅 Dias de Disponibilidade → Sempre Ativo.",
    };
  }

  if (recusados.length > 0) {
    // Recusar o pedido inteiro, não o item: lançar MENOS do que o garçom
    // conferiu com o cliente é pior do que pedir para lançar de novo.
    return { ok: false, status: 400, error: `Estes itens não estão no cardápio ${ondeVende}: ${recusados.join(", ")}. ${tenteDeNovo}` };
  }

  return { ok: true, itens: itensValidados };
}
