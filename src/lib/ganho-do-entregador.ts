/**
 * lib/ganho-do-entregador.ts — quanto UM pedido rende para o entregador.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * A mesma conta estava escrita em três lugares: no fechamento
 * (api/motoboy-report), no cartão "Hoje: R$ X" da lista (api/motoboys) e no
 * formulário, que decide quais campos mostrar. Elas já discordavam — o cartão
 * ignorava a escada de km e pagava `perDeliveryRate × entregas`, enquanto o
 * fechamento tentava a escada primeiro. Dois números para o mesmo dia é o tipo
 * de coisa que o lojista descobre discutindo com o entregador.
 *
 * ── A regra dos campos: só vale o que o tipo escolhido usa ──────────────────
 *
 * O formulário mostra apenas os campos do tipo selecionado. Quem troca de tipo
 * deixa para trás o valor do anterior, que continua gravado na linha e invisível
 * na tela. Em 15/09/2026, no Frangoso, os três entregadores estavam em FAIXA_KM
 * com a escada cadastrada e o fechamento somava "Diária R$ 60,00 × 3 dias" mais
 * "Por entrega R$ 2,00 × 17" — R$ 214,00 de valores que o Lucas não tinha onde
 * ver nem como apagar. Ler campo que a tela não oferece é pagar por um acerto
 * que ninguém combinou.
 */

import { lerFaixasDoMotoboy, valorDaFaixa, type FaixaDoMotoboy } from "./faixas-do-motoboy";
import { repasseDoPedido, type RegraDeRepasse } from "./repasse-do-entregador";

/** De onde saiu o valor deste pedido — para a tela explicar em vez de o lojista adivinhar. */
export type OrigemDoGanho =
  | "GRAVADO"
  | "FAIXA_DELE"
  | "POR_KM"
  | "POR_ENTREGA"
  | "REGRA_DA_LOJA"
  | "TAXA_DO_CLIENTE"
  | "SO_DIARIA"
  | "SEM_DISTANCIA";

export const ROTULO_DA_ORIGEM: Record<OrigemDoGanho, string> = {
  GRAVADO: "valor gravado na venda",
  FAIXA_DELE: "faixa de km do entregador",
  POR_KM: "km rodado",
  POR_ENTREGA: "valor por entrega",
  REGRA_DA_LOJA: "tabela de repasse da loja",
  TAXA_DO_CLIENTE: "taxa que o cliente pagou",
  SO_DIARIA: "só diária",
  SEM_DISTANCIA: "sem distância medida",
};

/**
 * Quais campos o tipo de pagamento escolhido realmente usa.
 *
 * `FAIXA_KM` entra na diária de propósito: quem paga por faixa costuma pagar
 * também o dia trabalhado, e os três entregadores do Frangoso já tinham
 * R$ 60,00 de diária gravados quando a escada foi cadastrada. No relatório que
 * o Lucas mandou em 15/09/2026 a diária aparecia — e ele questionou só o
 * "R$ 2,00 por entrega", não ela. Deixar de pagar R$ 660,00 calado seria
 * trocar um erro por outro pior; o campo passou a aparecer no formulário para
 * quem não quiser apagar.
 */
export const usaDiaria = (t?: string | null) =>
  t === "DAILY_RATE" || t === "BOTH" || t === "DAILY_PLUS_FEE" || t === "FAIXA_KM";
export const usaPorEntrega = (t?: string | null) => t === "PER_DELIVERY" || t === "BOTH";
export const usaPorKm = (t?: string | null) => t === "PER_KM" || t === "BOTH";

export type AcertoDoEntregador = {
  paymentType?: string | null;
  dailyRate?: number | null;
  perDeliveryRate?: number | null;
  perKmRate?: number | null;
  faixasDeKm?: unknown;
};

export type AcertoLimpo = {
  tipo: string;
  dailyRate: number;
  perDeliveryRate: number;
  perKmRate: number;
  faixas: FaixaDoMotoboy[];
  /** Pago por distância: escada dele ou R$/km. */
  pagoPorDistancia: boolean;
};

/** O acerto do entregador com os campos que o tipo dele NÃO usa já zerados. */
export function lerAcerto(mb: AcertoDoEntregador): AcertoLimpo {
  const tipo = mb.paymentType || "PER_DELIVERY";
  const faixas = lerFaixasDoMotoboy(mb.faixasDeKm);
  return {
    tipo,
    dailyRate: usaDiaria(tipo) ? Number(mb.dailyRate) || 0 : 0,
    perDeliveryRate: usaPorEntrega(tipo) ? Number(mb.perDeliveryRate) || 0 : 0,
    perKmRate: usaPorKm(tipo) ? Number(mb.perKmRate) || 0 : 0,
    faixas,
    pagoPorDistancia: faixas.length > 0 || usaPorKm(tipo),
  };
}

export type PedidoParaGanho = {
  motoboyFee?: number | null;
  deliveryFee?: number | null;
  deliveryDistance?: number | null;
  [k: string]: any;
};

/**
 * Quanto ESTE pedido rende, e por quê.
 *
 * A ordem vai da mais específica para a mais genérica:
 *   1. o que ficou gravado NO PEDIDO (`motoboyFee`) — é história, não regra
 *   2. o acerto individual deste entregador (faixa dele / km / por entrega)
 *   3. a REGRA da loja: faixa ou bairro cadastrado, ou — em pedido de app — o
 *      valor que veio do app, quando foi isso que a loja escolheu
 *   4. a taxa que o cliente pagou — último recurso, com aviso na tela
 */
export function ganhoDoPedido(args: {
  acerto: AcertoLimpo;
  pedido: PedidoParaGanho;
  /** A regra da loja e as zonas — ausentes, o passo 3 simplesmente não acontece. */
  regraDaLoja?: RegraDeRepasse | null;
  zonas?: unknown;
  ehMarketplace?: boolean;
}): { valor: number; origem: OrigemDoGanho } {
  const { acerto, pedido, regraDaLoja, zonas, ehMarketplace } = args;
  const centavos = (n: number) => Math.round(n * 100) / 100;

  if (acerto.tipo === "DAILY_RATE") return { valor: 0, origem: "SO_DIARIA" };

  const gravado = Number(pedido.motoboyFee || 0);
  if (gravado > 0) return { valor: centavos(gravado), origem: "GRAVADO" };

  // A faixa do entregador vem ANTES do km e do valor por entrega: quem
  // cadastrou faixa quis faixa, e ela é o combinado individual dele.
  const daFaixaDele = valorDaFaixa(acerto.faixas, pedido.deliveryDistance);
  if (daFaixaDele != null) return { valor: centavos(daFaixaDele), origem: "FAIXA_DELE" };

  const km = Number(pedido.deliveryDistance || 0);
  if (usaPorKm(acerto.tipo) && km > 0) return { valor: centavos(km * acerto.perKmRate), origem: "POR_KM" };

  if (acerto.perDeliveryRate > 0) return { valor: centavos(acerto.perDeliveryRate), origem: "POR_ENTREGA" };

  if (regraDaLoja) {
    const daRegra = repasseDoPedido({
      regra: regraDaLoja,
      zonas,
      km: pedido.deliveryDistance,
      taxaDaEntrega: pedido.deliveryFee,
      ehMarketplace,
    });
    if (daRegra != null) return { valor: centavos(daRegra), origem: "REGRA_DA_LOJA" };
  }

  // Entregador pago por distância num pedido cuja distância não foi medida.
  // A taxa do cliente NÃO é resposta aqui: em pedido de app ela é dinheiro do
  // marketplace, e foi justamente o "Taxa R$ 6,94" numa entrega de R$ 3,00 que
  // originou esta regra. Zero declarado, com a contagem na tela, é honesto —
  // um número inventado passa batido no fechamento.
  if (acerto.pagoPorDistancia) return { valor: 0, origem: "SEM_DISTANCIA" };

  return { valor: centavos(Number(pedido.deliveryFee || 0)), origem: "TAXA_DO_CLIENTE" };
}
