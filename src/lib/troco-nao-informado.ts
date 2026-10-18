/**
 * "TROCO NAO INFORMADO": entrega em dinheiro sem a nota do cliente.
 *
 * Delícia de Casa (18/10/2026): "não está saindo o troco nas notas, o motoboy
 * chega no endereço e tem que ligar pra loja". O iFood mandou `cash.changeFor:
 * 0` — o cliente escolheu dinheiro e não disse para quanto —, e a comanda só
 * imprime "Troco para: R$ X (Levar R$ Y de troco)" com `changeAmount > 0`. Sem
 * nota nenhuma, o papel não dizia nada sobre troco e o motoboy saía sem.
 *
 * Agora a comanda avisa, em tarja, que o troco não foi informado e que é para
 * levar troco. Vale para qualquer canal: o critério é ENTREGA da loja com
 * DINHEIRO a receber na porta e sem `changeAmount`.
 *
 * ── QUEM DECIDE "DINHEIRO NA PORTA" ────────────────────────────────────────
 *
 * As regras de sempre (lib/pagamento-na-entrega.ts): `cobrancaNaEntrega` diz
 * se há o que receber na porta (pago online, fiado e mesa ficam de fora) e
 * `formaCanonica` se é dinheiro — inclusive o misto "Dinheiro + Pix (Cobrar na
 * Entrega)", que tem a parte em dinheiro para receber. Entrega PARCEIRA
 * (lib/entrega-parceira.ts) não leva: o motoboy é do app, não da loja. Recado
 * do cliente falando de troco ("troco para 50", "não precisa de troco") também
 * não: a observação já está no papel, e o aviso a contradiria.
 *
 * ── POR QUE É UM BLOCO DO MODELO ───────────────────────────────────────────
 *
 * O mesmo caminho do "TAMBEM NESTE PEDIDO" (lib/outros-setores-na-comanda.ts):
 * o Assistente 1.2.18+ já imprime `textoRico` e `separador` do `blocos`, então
 * o aviso sai sem versão nova do Assistente. Loja que nunca personalizou a
 * comanda passa a mandar, NESTE pedido, o modelo de fábrica — que desenha o
 * mesmo papel do layout embutido. O aviso entra logo depois do pagamento
 * (onde está o "COBRAR DO CLIENTE NA ENTREGA"); modelo sem pagamento (a via da
 * cozinha) leva no fim.
 */
import { blocosParaOAssistente, modeloPadrao, type Bloco } from "./comanda-modelo";
import { infoDaEntrega } from "./entrega-parceira";
import { cobrancaNaEntrega, formaCanonica } from "./pagamento-na-entrega";

type PedidoDoTroco = Parameters<typeof cobrancaNaEntrega>[0] & {
  notes?: string | null;
  gatewayPaymentId?: string | null;
};

/** Entrega da loja, dinheiro a receber na porta e nenhuma nota informada? */
export function trocoNaoInformado(pedido: PedidoDoTroco | null | undefined): boolean {
  if (!pedido) return false;
  if (String(pedido.deliveryType || "").toUpperCase() !== "DELIVERY") return false;
  if (Number(pedido.changeAmount || 0) > 0) return false;
  if (/troco/i.test(String(pedido.notes || ""))) return false;
  if (formaCanonica(pedido.paymentMethod) !== "Dinheiro") return false;
  if (infoDaEntrega(pedido).parceira) return false;
  return cobrancaNaEntrega(pedido).cobrar;
}

/** O aviso no formato de blocos do modelo (separador + texto rico + separador). */
export function blocosDoAvisoDoTroco(): Bloco[] {
  return [
    { tipo: "espaco", ligado: true },
    { tipo: "separador", ligado: true },
    {
      tipo: "textoRico",
      ligado: true,
      linhas: [
        { partes: [{ texto: "** TROCO NAO INFORMADO **" }], negrito: true, invertido: true, alinhamento: "centro", tamanho: 1.5 },
        { partes: [{ texto: "Cliente paga em dinheiro e nao disse para quanto. Levar troco." }], negrito: true, alinhamento: "centro" },
      ],
    },
    { tipo: "separador", ligado: true },
  ];
}

/**
 * Os blocos deste papel com o aviso do troco, ou `undefined` quando o pedido
 * não precisa dele — quem chama segue mandando exatamente o que mandava.
 *
 * `base` é o que o papel já levaria (modelo da impressora, o padrão da loja, a
 * via do entregador); sem modelo, o de fábrica — a via da cozinha quando o
 * papel sai sem valores.
 */
export function blocosComAvisoDoTroco(
  base: Bloco[] | null | undefined,
  pedido: PedidoDoTroco | null | undefined,
  opcoes: { semValores?: boolean } = {}
): Bloco[] | undefined {
  if (!trocoNaoInformado(pedido)) return undefined;
  const lista = Array.isArray(base) && base.length > 0
    ? base
    : blocosParaOAssistente(opcoes.semValores ? modeloPadrao().cozinha : modeloPadrao().completo);
  const aviso = blocosDoAvisoDoTroco();
  const posPagamento = lista.findIndex((b) => b && b.tipo === "pagamento" && b.ligado !== false);
  if (posPagamento < 0) return [...lista, ...aviso];
  return [...lista.slice(0, posPagamento + 1), ...aviso, ...lista.slice(posPagamento + 1)];
}
