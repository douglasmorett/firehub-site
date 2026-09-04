/**
 * src/lib/qr-puxar.ts
 *
 * O código que o QR da comanda carrega — e NADA além dele.
 *
 * Desenho de propósito: o QR leva `AAAAMMDD-numero` (a data + o número diário
 * que já sai impresso em corpo dobrado no topo da MESMA comanda). Não há token,
 * segredo ou credencial no papel: a via grampeada no saco e a comanda no lixo
 * não valem nada sozinhas — quem puxa o pedido é o MOTOBOY LOGADO no app, e a
 * autorização é a sessão assinada dele (motoboy-sessao.ts), nunca o QR.
 *
 * Um relógio só, nos dois trilhos: o dailyOrderNumber é chaveado em
 * America/Sao_Paulo (order-number.ts, dateKeySP, hardcoded) — então a data do
 * QR TAMBÉM é SP, calculada por este helper compartilhado entre o payload de
 * impressão (servidor) e o app do motoboy (browser). Intl existe nos dois.
 */
import { infoDaEntrega } from "./entrega-parceira";
import { moduloDoPedido } from "./modulo-do-pedido";

/** Data no fuso de São Paulo, AAAAMMDD — o MESMO relógio do dailyOrderNumber. */
export function chaveDoDiaSP(ref: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ref)).replace(/-/g, "");
}

/** Início (UTC) do dia SP para uma chave AAAAMMDD. */
export function inicioDoDiaSP(chave: string): Date {
  const y = chave.slice(0, 4), m = chave.slice(4, 6), d = chave.slice(6, 8);
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

export function codigoDoPedido(createdAt: Date | string, numero: number | string): string {
  return `${chaveDoDiaSP(createdAt)}-${numero}`;
}

export function urlDoPuxar(base: string, slug: string, codigo: string): string {
  return `${String(base).replace(/\/+$/, "")}/loja/${slug}/motoboy?p=${codigo}`;
}

/**
 * ESTA impressora imprime o QR?
 *
 * A marca é POR IMPRESSORA (`qrPuxar`), e ausente significa SIM — regra da
 * casa: nasce ligado em todas, e a loja desliga na impressora onde não quer
 * (a da cozinha, por exemplo). A primeira versão do QR tinha um interruptor
 * único da loja inteira (`printerConfig.qrPuxarPedido`); quem o desligou
 * naquele dia continua sem QR em todas até abrir a tela de Impressoras, que
 * converte o interruptor antigo na marca por impressora ao salvar.
 */
export function qrLigadoNaImpressora(
  impressora: { qrPuxar?: boolean | null } | null | undefined,
  config?: { qrPuxarPedido?: boolean | null } | null
): boolean {
  if (config?.qrPuxarPedido === false) return false;
  return impressora?.qrPuxar !== false;
}

/**
 * Os campos do QR para ESTE pedido — ou `{}` quando não há o que puxar.
 *
 * Só em ENTREGA DA PRÓPRIA LOJA: mesa, balcão, retirada e entrega parceira
 * (iFood/99Food levando) não têm motoboy da loja para puxar. Sem o slug não
 * há URL, e QR com o código pelado não abre o app — então não sai QR nenhum;
 * o rodapé digitável não depende disto. Um lugar só para a regra, porque o
 * navegador (print.ts) e a fila da nuvem (print-queue) imprimem a mesma comanda.
 */
export function camposDoQrPuxar(
  pedido: { deliveryType?: string | null; dailyOrderNumber?: number | string | null; createdAt?: Date | string | null } & Record<string, any>,
  slug: string | null | undefined,
  base = "https://firehubfood.com.br"
): { qrPuxarCodigo?: string; qrPuxarUrl?: string } {
  if (!slug) return {};
  // Duas perguntas, de propósito: o `deliveryType` diz se é entrega (a mesa
  // grava "MESA", o balcão "RETIRADA"), e o `source` diz de que mundo o pedido
  // veio. O campo é texto livre com padrão "DELIVERY" no banco — uma origem
  // nova que esqueça de preenchê-lo passaria na primeira pergunta. O `source`
  // é a segunda trava, a mesma pela qual o roteamento separa salão de delivery.
  const ehEntrega = (pedido?.deliveryType || "DELIVERY") === "DELIVERY"
    && moduloDoPedido(pedido?.source as string | null | undefined) === "delivery";
  const numero = pedido?.dailyOrderNumber;
  if (!ehEntrega || numero === null || numero === undefined || numero === "") return {};
  try {
    if (infoDaEntrega(pedido).parceira) return {};
  } catch {
    return {};
  }
  const codigo = codigoDoPedido(pedido?.createdAt || new Date(), numero);
  return { qrPuxarCodigo: codigo, qrPuxarUrl: urlDoPuxar(base, slug, codigo) };
}
