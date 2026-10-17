/**
 * lib/ganho-do-entregador.ts — quanto UM pedido rende para o entregador.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * A mesma conta estava escrita em três lugares: no relatório de pagamentos
 * (api/motoboy-report), no cartão "Hoje: R$ X" da lista de cadastro e no
 * formulário, que decide quais campos mostrar. Elas já discordavam — o cartão
 * ignorava a escada de km e pagava `perDeliveryRate × entregas`, enquanto o
 * relatório tentava a escada primeiro. Dois números para o mesmo dia é o tipo
 * de coisa que o lojista descobre discutindo com o entregador.
 *
 * Hoje quem usa: o relatório de pagamentos, o papel do fechamento de caixa
 * (lib/esperado-do-turno.ts) e o formulário. O cartão do cadastro saiu em
 * 23/09/2026 — cadastro mostra o acerto, não o dia.
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
import {
  lerPedidoDeAppDoEntregador, repasseDoPedido, type PedidoDeAppDoEntregador, type RegraDeRepasse,
} from "./repasse-do-entregador";
import { lerEntregaGratis } from "./entrega-gratis";
import { bairroPeloEndereco } from "./bairro-pelo-endereco";

/** De onde saiu o valor deste pedido — para a tela explicar em vez de o lojista adivinhar. */
export type OrigemDoGanho =
  | "GRAVADO"
  | "FAIXA_DELE"
  | "POR_KM"
  | "POR_ENTREGA"
  | "REGRA_DA_LOJA"
  | "TAXA_DO_CLIENTE"
  | "SO_DIARIA"
  | "SEM_DISTANCIA"
  | "VALOR_DO_APP"
  | "FIXO_NO_APP";

export const ROTULO_DA_ORIGEM: Record<OrigemDoGanho, string> = {
  GRAVADO: "valor gravado na venda",
  FAIXA_DELE: "faixa de km do entregador",
  POR_KM: "km rodado",
  POR_ENTREGA: "valor por entrega",
  REGRA_DA_LOJA: "tabela de repasse da loja",
  TAXA_DO_CLIENTE: "taxa que o cliente pagou",
  SO_DIARIA: "só diária",
  SEM_DISTANCIA: "sem distância medida",
  VALOR_DO_APP: "taxa que veio do app",
  FIXO_NO_APP: "valor fixo por entrega de app",
};

/**
 * Quais campos o tipo de pagamento escolhido realmente usa.
 *
 * `FAIXA_KM` entra na diária de propósito, e isso é o INTUITO da opção, não
 * uma inferência: "o Lucas paga diária + a escala cadastrada, esse foi o
 * intuito dessa funcionalidade nova" (o dono, 15/09/2026). Por isso ela se
 * chama "Diária + taxa por distância percorrida" na tela. Quem paga só a
 * escada deixa o campo da diária vazio.
 */
export const usaDiaria = (t?: string | null) =>
  t === "DAILY_RATE" || t === "BOTH" || t === "DAILY_PLUS_FEE" || t === "FAIXA_KM";
export const usaPorEntrega = (t?: string | null) => t === "PER_DELIVERY" || t === "BOTH";
// BOTH é "Diária + Por Entrega" (o rótulo do cadastro, a validação de
// modelos-de-pagamento.ts e o que o lojista combinou). Até 11/10/2026 ele
// também entrava aqui, e o R$/km passava na frente do valor por entrega: na
// Brazza Burguer 34 entregas de diária + R$ 5 saíram a R$ 0,00 (sem R$/km
// cadastrado = SEM_DISTANCIA), e na R&D Pizzaria um "R$ 60/km" digitado no
// campo que o formulário mostrava indevidamente virou R$ 1.166,40 em 13
// entregas de R$ 5. Regressão do 1da55c6a (15/09).
export const usaPorKm = (t?: string | null) => t === "PER_KM";

export type AcertoDoEntregador = {
  paymentType?: string | null;
  dailyRate?: number | null;
  perDeliveryRate?: number | null;
  perKmRate?: number | null;
  faixasDeKm?: unknown;
  /** Como ele recebe nos pedidos de app (Motoboy.pedidoDeApp). */
  pedidoDeApp?: unknown;
};

export type AcertoLimpo = {
  tipo: string;
  dailyRate: number;
  perDeliveryRate: number;
  perKmRate: number;
  faixas: FaixaDoMotoboy[];
  /** Pago por distância: escada dele ou R$/km. */
  pagoPorDistancia: boolean;
  /** A escolha dele para pedido de app; nulo = nunca escolheu (vale a regra antiga da loja). */
  pedidoDeApp: PedidoDeAppDoEntregador | null;
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
    pedidoDeApp: lerPedidoDeAppDoEntregador(mb.pedidoDeApp),
  };
}

export type PedidoParaGanho = {
  motoboyFee?: number | null;
  deliveryFee?: number | null;
  deliveryDistance?: number | null;
  /** {valor, motivo} da entrega que o cliente não pagou (lib/entrega-gratis.ts). */
  entregaGratis?: unknown;
  /** O endereço em texto: no pedido de app, é dele que sai o bairro da tabela (bairroDoPedidoDeApp). */
  customerAddress?: string | null;
  [k: string]: any;
};

/**
 * A taxa da entrega para a conta do entregador.
 *
 * Entrega grátis (pedido acima do mínimo, cupom de frete, prêmio da Trilha)
 * grava `deliveryFee: 0` — quem deixou de pagar foi o CLIENTE; o motoboy rodou
 * do mesmo jeito. Hakim Centro #72 (12/10/2026): Pix pelo site com entrega
 * grátis, e o acerto pela taxa do pedido pagou R$ 0,00. O valor cheio fica em
 * `entregaGratis` justamente para isso.
 */
export function taxaDaCorrida(pedido: PedidoParaGanho): number {
  const cobrada = Number(pedido.deliveryFee || 0);
  if (cobrada > 0) return cobrada;
  return lerEntregaGratis(pedido.entregaGratis)?.valor ?? 0;
}

/**
 * Quanto ESTE pedido rende, e por quê.
 *
 * A ordem vai da mais específica para a mais genérica:
 *   0. pedido de app com "pagar diferente nos pedidos de app" no cadastro
 *      DELE: o valor do app ou o valor fixo dele (depois só do gravado)
 *   1. o que ficou gravado NO PEDIDO (`motoboyFee`) — é história, não regra
 *   2. o acerto individual deste entregador (faixa dele / km / por entrega)
 *   3. a REGRA da loja: faixa ou bairro cadastrado, ou — em pedido de app — o
 *      valor que veio do app, quando foi isso que a loja escolheu. No app pela
 *      tabela, o bairro sai do texto do endereço (bairroDoPedidoDeApp)
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
  const { acerto, pedido, zonas, ehMarketplace } = args;
  const centavos = (n: number) => Math.round(n * 100) / 100;

  // ── A ESCOLHA DO ENTREGADOR VENCE A DA LOJA ──────────────────────────
  //
  // Em pedido de app, quem escolheu no cadastro dele "pagar diferente nos
  // pedidos de app" recebe por ESSA escolha — antes da faixa, do km, do valor
  // por entrega e da diária: é justamente o "diferente" do site. Vem antes do
  // `DAILY_RATE` de propósito: "só diária no site e R$ 3,00 por entrega de
  // app" é um acerto que existe. O gravado no pedido continua vencendo (é
  // história: a correção de taxa feita à mão).
  //
  // Tendo escolha própria — qualquer uma, inclusive "igual aos pedidos do
  // site" —, a regra antiga da loja para app sai da conta dele: no passo 3 a
  // tabela da loja vale como vale no pedido do site.
  const escolha = ehMarketplace ? acerto.pedidoDeApp : null;
  const regraDaLoja: RegraDeRepasse | null | undefined =
    escolha && args.regraDaLoja ? { ...args.regraDaLoja, marketplace: "TABELA" } : args.regraDaLoja;
  if (escolha && escolha.modo !== "IGUAL") {
    const gravadoNoApp = numeroGravado(pedido.motoboyFee);
    if (gravadoNoApp != null) return { valor: centavos(gravadoNoApp), origem: "GRAVADO" };
    if (escolha.modo === "FIXO") return { valor: centavos(escolha.valor), origem: "FIXO_NO_APP" };
    // "O valor que veio do app" num pedido em que o app não pagou entrega
    // nenhuma: segue o acerto normal dele, como a regra antiga da loja fazia
    // (repasseDoPedido devolve nulo e a conta continua).
    const doApp = taxaDaCorrida(pedido);
    if (doApp > 0) return { valor: centavos(doApp), origem: "VALOR_DO_APP" };
  }

  if (acerto.tipo === "DAILY_RATE") return { valor: 0, origem: "SO_DIARIA" };

  // ── ZERO GRAVADO É RESPOSTA ───────────────────────────────────────────
  //
  // `motoboyFee` só é gravado quando a loja separa o repasse, e a faixa com
  // R$ 0,00 é escolha dela (R6, 25/09/2026). Ler `|| 0 > 0` tratava esse zero
  // como "não gravado" e pagava o acordo do entregador no lugar. Nulo continua
  // sendo "não gravado".
  const gravado = numeroGravado(pedido.motoboyFee);
  if (gravado != null) return { valor: centavos(gravado), origem: "GRAVADO" };

  // Distância 0 é medida (cliente na porta da loja); nulo é "não medida".
  const km = numeroGravado(pedido.deliveryDistance);

  // A faixa do entregador vem ANTES do km e do valor por entrega: quem
  // cadastrou faixa quis faixa, e ela é o combinado individual dele.
  const daFaixaDele =
    km == null ? null : km === 0 ? (acerto.faixas[0]?.valor ?? null) : valorDaFaixa(acerto.faixas, km);
  if (daFaixaDele != null) return { valor: centavos(daFaixaDele), origem: "FAIXA_DELE" };

  if (usaPorKm(acerto.tipo) && km != null && km > 0) return { valor: centavos(km * acerto.perKmRate), origem: "POR_KM" };

  if (acerto.perDeliveryRate > 0) return { valor: centavos(acerto.perDeliveryRate), origem: "POR_ENTREGA" };

  if (regraDaLoja) {
    const daRegra = repasseDoPedido({
      regra: regraDaLoja,
      zonas,
      km: pedido.deliveryDistance,
      bairro: bairroDoPedidoDeApp(pedido, regraDaLoja, zonas, ehMarketplace),
      taxaDaEntrega: taxaDaCorrida(pedido),
      ehMarketplace,
    });
    if (daRegra != null) return { valor: centavos(daRegra), origem: "REGRA_DA_LOJA" };
  }

  // Entregador pago por distância num pedido cuja distância não foi medida.
  // A taxa do cliente NÃO é resposta aqui: em pedido de app ela é dinheiro do
  // marketplace, e foi justamente o "Taxa R$ 6,94" numa entrega de R$ 3,00 que
  // originou esta regra. Zero declarado, com a contagem na tela, é honesto —
  // um número inventado passa batido no fechamento.
  if (acerto.pagoPorDistancia) {
    // Distância medida em 0 km: R$/km × 0 é a resposta — não "falta
    // distância", que mandaria a loja procurar um defeito que não existe.
    return km === 0 ? { valor: 0, origem: "POR_KM" } : { valor: 0, origem: "SEM_DISTANCIA" };
  }

  return { valor: centavos(taxaDaCorrida(pedido)), origem: "TAXA_DO_CLIENTE" };
}

/**
 * O bairro cadastrado do pedido de APP, quando a loja cobra por bairro e paga
 * o motoboy pela TABELA também no app.
 *
 * O pedido do site grava o repasse na venda (`motoboyFee`, passo 1). O de
 * iFood/99Food/Wabiz chega com o endereço num texto livre e sem bairro da
 * loja, e o repasse era procurado só pela distância — que loja por bairro não
 * tem —, caindo na taxa que o app cobrou do cliente. Na NIK (15/10/2026) o
 * acerto pagava R$ 6,99 do iFood numa entrega da Quadra 3 que a tabela paga
 * R$ 5,00. Aqui o bairro sai do texto (lib/bairro-pelo-endereco.ts); não
 * achou = null, e o acerto segue como antes.
 *
 * Só no app com "pagar pela tabela": no "valor do app" e no "valor fixo" a
 * tabela não entra, e no pedido próprio o que vale é o gravado na venda.
 */
function bairroDoPedidoDeApp(
  pedido: PedidoParaGanho,
  regra: RegraDeRepasse,
  zonas: unknown,
  ehMarketplace: boolean | undefined,
): string | null {
  if (!ehMarketplace || !regra.separado || regra.marketplace !== "TABELA") return null;
  const endereco = typeof pedido.customerAddress === "string" ? pedido.customerAddress : null;
  if (!endereco) return null;
  return bairroPeloEndereco(endereco, zonas)?.name ?? null;
}

/** Número >= 0 gravado no pedido, ou null. Vazio, texto e negativo são "não gravado". */
function numeroGravado(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * O que vale para ESTE entregador nos pedidos de app — para a tela dele dizer
 * a verdade, e não só o que está gravado.
 *
 * Com escolha própria, é ela. Sem escolha, é a regra antiga da loja — mas só
 * quando ela chega a ser usada: a regra da loja vem DEPOIS do acerto dele
 * (`ganhoDoPedido`, passo 3), então quem tem valor por entrega, faixa ou R$/km
 * não recebia o "fixo da loja" no app mesmo com ele ligado, e mostrar "R$ 4,00
 * fixo" ali seria mentir. (Entregador pago por distância só cai na regra da
 * loja no pedido de app sem distância medida — o caso raro fica de fora da
 * frase.)
 *
 * `daLoja` = a resposta veio da regra antiga da loja, não do cadastro dele.
 */
export function oQueValeNoApp(args: {
  acerto: AcertoLimpo;
  regraDaLoja?: RegraDeRepasse | null;
}): { modo: "IGUAL" | "APP" | "FIXO"; valor: number | null; daLoja: boolean } {
  const { acerto, regraDaLoja } = args;
  const dele = acerto.pedidoDeApp;
  if (dele) return { modo: dele.modo, valor: dele.modo === "FIXO" ? dele.valor : null, daLoja: false };
  const igual = { modo: "IGUAL" as const, valor: null, daLoja: false };
  if (!regraDaLoja || regraDaLoja.marketplace === "TABELA") return igual;
  // A regra da loja só é lida quando o acerto dele não respondeu antes: nem
  // "só diária" (devolve zero antes), nem valor por entrega, nem distância.
  const chega = acerto.tipo !== "DAILY_RATE" && acerto.perDeliveryRate <= 0 && !acerto.pagoPorDistancia;
  if (!chega) return igual;
  if (regraDaLoja.marketplace === "APP") return { modo: "APP", valor: null, daLoja: true };
  // FIXO sem valor preenchido nunca respondeu (repasseDoPedido → nulo).
  return regraDaLoja.valorFixoApp != null ? { modo: "FIXO", valor: regraDaLoja.valorFixoApp, daLoja: true } : igual;
}
