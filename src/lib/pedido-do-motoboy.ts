/**
 * O "VER PEDIDO" DO APP DO MOTOBOY: o que vai na sacola, para ele conferir sem
 * ligar para a loja. Pedido do dono (27/09/2026): "tem que ter como o motoboy
 * ver o pedido, qual é o lanche e as bebidas".
 *
 * Duas fontes, as mesmas das outras telas:
 *   - as escolhas do combo (sabores, adicionais, a bebida do combo) saem do
 *     leitor único de lib/parse-combo.ts — o da comanda, do KDS e do painel;
 *   - a bebida é a regra de lib/beverage.ts, a mesma do aviso "você entregou
 *     a bebida?" do próprio app. A lista não pode dizer uma coisa e o aviso
 *     outra.
 *
 * Sem preço: o valor que importa na porta já está no cartão (quanto receber),
 * e o preço de cada item é conversa da loja.
 */
import { parseComboSelections } from "@/lib/parse-combo";
import { getBeveragesFromOrder, isBeverageCategory, isBeverageName } from "@/lib/beverage";

export type EscolhaNoPedido = { nome: string; quantidade: number; bebida: boolean };

export type LinhaNoPedido = {
  quantidade: number;
  nome: string;
  /** O item em si é bebida (a lata, o refrigerante 2L). */
  bebida: boolean;
  /** As escolhas de UMA unidade do item (sabores, adicionais, a bebida do combo). */
  escolhas: EscolhaNoPedido[];
  obs: string;
};

export type PedidoParaOMotoboy = {
  linhas: LinhaNoPedido[];
  /** Quantas unidades vão na sacola (2x X-Tudo conta 2). */
  itens: number;
  /** Quantas bebidas, contando as de dentro do combo × a quantidade dele. */
  bebidas: number;
};

const inteiro = (v: unknown) => Math.max(1, Math.round(Number(v) || 1));

export function pedidoParaOMotoboy(order: unknown, palavrasDeBebida?: string | string[]): PedidoParaOMotoboy {
  const o = order && typeof order === "object" ? (order as any) : {};
  const items: any[] = Array.isArray(o.items) ? o.items : [];
  const linhas: LinhaNoPedido[] = items.map((item) => {
    const quantidade = inteiro(item?.quantity);
    const nome = String(item?.menuProduct?.name || item?.productName || item?.name || "Item").trim() || "Item";
    const categoriaDeBebida = isBeverageCategory(String(item?.category || item?.menuProduct?.category || ""));
    const bebida =
      item?.isBeverage === true ||
      item?.menuProduct?.isBeverage === true ||
      categoriaDeBebida ||
      isBeverageName(nome, palavrasDeBebida, categoriaDeBebida);
    let escolhas: EscolhaNoPedido[] = [];
    try {
      escolhas = parseComboSelections(item?.comboSelections, 1)
        .filter((e) => e && String(e.name || "").trim())
        .map((e) => ({
          nome: String(e.name).trim(),
          quantidade: inteiro(e.quantity),
          bebida: isBeverageName(String(e.name), palavrasDeBebida),
        }));
    } catch {
      escolhas = [];
    }
    return { quantidade, nome, bebida, escolhas, obs: String(item?.notes || "").trim() };
  });
  const itens = linhas.reduce((s, l) => s + l.quantidade, 0);
  const bebidas = getBeveragesFromOrder(o, palavrasDeBebida).reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  return { linhas, itens, bebidas };
}

/** "3 itens · 2 bebidas" — o que o botão "Ver pedido" diz antes de abrir. */
export function resumoDoPedido(p: Pick<PedidoParaOMotoboy, "itens" | "bebidas">): string {
  const partes = [`${p.itens} ${p.itens === 1 ? "item" : "itens"}`];
  if (p.bebidas > 0) partes.push(`${p.bebidas} ${p.bebidas === 1 ? "bebida" : "bebidas"}`);
  return partes.join(" · ");
}
