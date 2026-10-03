/**
 * Editar um pedido JÁ LANÇADO: tirar item, mudar quantidade, acrescentar item.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O cliente liga depois de fechar o pedido: "tira a batata", "manda mais uma
 * Coca". Até aqui a loja só tinha duas saídas, as duas ruins — cancelar o
 * pedido inteiro, ou entregar do jeito errado e acertar na boca do caixa.
 *
 * O painel de MESAS já resolvia isso desde antes (a API em
 * api/store/table-sessions/[id]/orders/[orderId]), e as regras aqui são as
 * mesmas de lá. O que muda no delivery, e é o motivo deste arquivo existir em
 * vez de um import:
 *
 *   1. O TOTAL NÃO É A SOMA DOS ITENS. Na mesa é, porque mesa não tem taxa de
 *      entrega nem cupom. No delivery `totalAmount` nasce de
 *      `itens - desconto + taxa` (api/customer-order/route.ts:444) — copiar a
 *      conta da mesa apagaria a taxa de entrega, que existe em 35,6% dos
 *      pedidos próprios. Ver `recalcularTotal`.
 *
 *   2. EXISTE MARKETPLACE. 80,6% do volume vem de iFood, 99Food, Jotajá,
 *      Brendi e Wabiz, e lá quem manda é o parceiro: o cliente pagou lá e o
 *      repasse é calculado lá. Até 19/09/2026 esses pedidos eram
 *      `SO_ACRESCIMO` — nem tirar item nem mudar quantidade.
 *
 *      A prática derrubou a regra: o cliente liga na loja (não no app) para
 *      tirar dois dos dez itens, e o atendente ficava sem saída — a cozinha
 *      produzia os dez porque a comanda dizia dez. Agora o modo é
 *      `MARKETPLACE`: tira, muda quantidade e acrescenta.
 *
 *      O que NÃO mudou é o dinheiro. Em pedido PAGO NA PLATAFORMA o
 *      `totalAmount` fica intocado mesmo quando some item: é ele que tem que
 *      continuar batendo com o repasse do parceiro no fim do mês. Quem
 *      recebe na porta (dinheiro, cartão na entrega) tem o total recalculado,
 *      porque aí o valor a cobrar mudou de verdade. A tela diz qual dos dois
 *      é, com todas as letras — ver `Avaliacao.avisoDoDinheiro`.
 *
 * ── A regra mora aqui, não nas telas ────────────────────────────────────────
 *
 * Mesmo motivo de lib/canal-do-pedido.ts: cadeia de `?:` copiada em cada tela
 * é como o selo do 99Food virou "Online" no painel. Quem decide se o botão
 * aparece (a tela) e quem decide se a escrita passa (a API) leem a MESMA
 * função — `avaliarEdicao`. Tela e servidor divergirem aqui significa botão
 * que existe e não funciona, ou pior: escrita que a tela não deixaria passar.
 */

import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { ehPagoOnline } from "@/lib/pagamento-na-entrega";
import { lerPartes } from "@/lib/pagamento-dividido";
import { problemaDoDesconto, valorDoDesconto, type DescontoManual } from "@/lib/desconto-manual";
import { ehEntregaEmDomicilio, mercadoriaJaSaiu } from "@/lib/fiscal-momento";

/** A chave da permissão no CSV de `User.permissions` (ver lib/permissions.ts). */
export const PERMISSAO_EDITAR_PEDIDOS = "editar_pedidos";

/**
 * Status em que o pedido ainda aceita edição. WHITELIST de propósito, igual a
 * STATUS_PUXAVEIS: status novo entra FECHADO, não aberto. Um status que
 * aparecer amanhã e ninguém lembrar de classificar vira "não edita" — o lado
 * seguro.
 *
 * ── A decisão do dono mudou (17/09/2026) ────────────────────────────────────
 *
 * Em 15/09 SAIU_ENTREGA e ENTREGUE ficavam de fora: "a comida já saiu, editar
 * ali é acerto de caixa". Dois dias de uso mostraram o contrário: o cliente
 * acrescenta coisa na porta, muda de ideia com o motoboy na rua, e a loja
 * precisa consertar o pedido depois de finalizado quando o que foi lançado
 * não é o que foi entregue. Então entra tudo menos cancelado — inclusive
 * ENTREGUE e ENCERRADO.
 *
 * O custo que o dono aceitou de olhos abertos: a mensalidade do FireHub é
 * calculada sobre o valor dos pedidos (lib/billing.ts), então editar pedido
 * ENTREGUE é poder mexer na própria conta. O contrapeso é o rastro em
 * `editHistory` (quem, quando, o quê, total antes e depois), gravado no
 * pedido — e a permissão por funcionário logo abaixo.
 *
 * AGUARDANDO_PAGAMENTO e CRIANDO_IA continuam fora: pedido que ainda não é
 * pedido não se edita (mesma régua da fila de impressão e do app do motoboy).
 *
 * O status não é a única régua: pedido com NFC-e autorizada trava em qualquer
 * status até a nota ser cancelada (`travaDaNotaFiscal`, logo abaixo) — e a
 * nota que já passou da saída da mercadoria ou dos 30 minutos não cancela
 * mais, então ali a trava é definitiva (o acerto é com o contador).
 */
export const STATUS_EDITAVEIS = [
  "NOVO", "CONFIRMADO", "RECEBIDO", "PENDENTE", "ACEITO",
  "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO",
  "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA",
  "ENTREGUE", "ENCERRADO",
] as const;

export type ModoDeEdicao =
  /** Tira item, muda quantidade e acrescenta. O dinheiro é todo da loja. */
  | "COMPLETO"
  /**
   * Pedido de marketplace: tira, muda quantidade e acrescenta — mas o
   * acréscimo vira pedido colado (o parceiro não cobrou por ele) e o total só
   * cai quando o cliente paga na porta. Ver `avisoDoDinheiro`.
   */
  | "MARKETPLACE"
  /** Não edita aqui. `motivo` diz o que o lojista tem que fazer. */
  | "BLOQUEADO";

export type Avaliacao = {
  modo: ModoDeEdicao;
  /** Frase pronta para a tela. Escrita para o lojista, não para o log. */
  motivo?: string;
  /**
   * O que acontece com o DINHEIRO ao tirar item — a frase que o atendente lê
   * antes de salvar. Só no marketplace, onde a resposta não é óbvia.
   */
  avisoDoDinheiro?: string;
  /**
   * O total do pedido muda quando o item sai? Falso no marketplace pago na
   * plataforma: lá o valor é o que o parceiro vai repassar, e some item sem
   * mudar o total de propósito. A API lê ISTO, não o modo.
   */
  totalMuda?: boolean;
  /** "iFood", "99Food"... para a tela escrever o nome certo. */
  canal?: string;
};

export type PedidoParaEdicao = {
  status?: string | null;
  /** Com o status, diz se a mercadoria já saiu (trava da nota fiscal). */
  deliveryType?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  /** O que decide se o dinheiro já entrou (lib/pagamento-na-entrega.ts). */
  paymentMethod?: string | null;
  gatewayPaymentId?: string | null;
  isPrepaid?: boolean | null;
  prepaid?: boolean | null;
  /** A nota fiscal do pedido — ver `travaDaNotaFiscal`. Ausente = sem trava. */
  fiscalStatus?: string | null;
  fiscalInfo?: unknown;
  /** Pagamento dividido (lib/pagamento-dividido.ts) — trava o desconto, ver `descontoNaEdicao`. */
  paymentMethods?: unknown;
};

type PedidoComNotaFiscal = {
  fiscalStatus?: string | null;
  fiscalInfo?: unknown;
  /** O status e o tipo de entrega dizem se a mercadoria já saiu — ver `cancelamentoDaNota`. */
  status?: string | null;
  deliveryType?: string | null;
};

/**
 * A nota que VALE para este pedido: autorizada, em contingência off-line ou em
 * processamento na SEFAZ. Nota de homologação (fiscalInfo.ambiente = 2) não
 * conta — é teste, sem valor fiscal (ver `travaDaNotaFiscal`). Sem o
 * fiscalInfo, EMITTED basta — o lado seguro para quem só tem o status. O
 * painel de pedidos recebe o recorte de `notaParaTela` justamente para não
 * cair aqui (ver `CAMPOS_DA_NOTA_NA_TELA`).
 */
function notaQueVale(
  pedido: PedidoComNotaFiscal | null | undefined
): { estado: "autorizada" | "contingencia" | "processando"; info: Record<string, any> | null } | null {
  if (!pedido) return null;
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : null;
  if (info && Number(info.ambiente) === 2) return null;
  // Contingência off-line: a emissão automática grava EMITTED (para a tela
  // mostrar o DANFE, que tem de ser impresso) com a marca `contingencia` até a
  // SEFAZ efetivar — lib/fiscal-automatico, `gravarResultado`.
  if (pedido.fiscalStatus === "EMITTED" && info?.contingencia === true && info.nfceKey) return { estado: "contingencia", info };
  if (pedido.fiscalStatus === "EMITTED" && (info === null || Boolean(info.nfceKey))) return { estado: "autorizada", info };
  if (pedido.fiscalStatus !== "EMITTED" && info?.processando === true) {
    return { estado: info.contingencia === true ? "contingencia" : "processando", info };
  }
  return null;
}

/**
 * Os campos do `fiscalInfo` que as regras deste arquivo leem (`notaQueVale`,
 * `travaDaNotaFiscal`, `cancelamentoDaNota`, `registroDaDevolucao`,
 * `avisoDaNotaNaTrocaDePagamento`). scripts/teste-fiscal-momento.ts confere,
 * no código-fonte, que nenhuma leitura de `info.<campo>` fica fora da lista.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O painel de pedidos decide se desenha o lápis e a aba "Editar itens" com
 * `avaliarEdicao`, a mesma função da API — mas o feed dele
 * (api/customer-order/poll) mandava só o `fiscalStatus`. Sem o fiscalInfo,
 * todo EMITTED contava como nota autorizada de produção: a devolução
 * registrada pelo contador (que libera a edição na API) e a nota de
 * homologação (que nunca travou a API) continuavam escondendo o botão. O
 * pedido que voltou da entrega, com a devolução feita e registrada, não tinha
 * como ser editado pela tela.
 *
 * O fiscalInfo inteiro não cabe no feed: são 200 pedidos a cada poucos
 * segundos, e ele carrega as URLs do XML e do DANFE, a lista de pedidos da
 * conta da mesa, as notas anteriores. O feed leva só estes campos — recortados
 * no próprio banco (o poll monta o `jsonb_build_object` com esta lista) e
 * reduzidos por `notaParaTela`.
 */
export const CAMPOS_DA_NOTA_NA_TELA = [
  "ambiente",
  "contingencia",
  "processando",
  "nfceKey",
  "nfceNumber",
  "emittedAt",
  "notaDaConta",
  "devolucao",
  "formaNaNota",
] as const;

/**
 * O recorte do fiscalInfo que vai para a tela: só `CAMPOS_DA_NOTA_NA_TELA`, e
 * o que as regras leem só por existir (a conta da mesa, a devolução
 * registrada) vira `true` — a lista de pedidos da conta e a observação da
 * devolução não precisam viajar. Devolve null quando não sobra nada: o pedido
 * sem nota segue sem o campo.
 */
export function notaParaTela(fiscalInfo: unknown): Record<string, unknown> | null {
  const info =
    fiscalInfo && typeof fiscalInfo === "object" && !Array.isArray(fiscalInfo) ? (fiscalInfo as Record<string, unknown>) : null;
  if (!info) return null;
  const saida: Record<string, unknown> = {};
  for (const campo of CAMPOS_DA_NOTA_NA_TELA) {
    const valor = info[campo];
    if (valor === undefined || valor === null || valor === false) continue;
    saida[campo] = campo === "notaDaConta" || campo === "devolucao" ? true : valor;
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

/**
 * Minutos que a SEFAZ dá, NO MÁXIMO, para cancelar a NFC-e. O Ajuste SINIEF
 * 19/16, cl. 15ª, diz "em prazo não superior a 30 minutos, podendo ser
 * reduzido a critério de cada unidade federada" (conferido no texto do CONFAZ
 * em 24/09/2026): 30 é o teto nacional, não a promessa. O prazo do RJ não foi
 * conferido — por isso nenhuma frase diz "você tem N minutos", só "no máximo".
 */
export const PRAZO_DO_CANCELAMENTO_MIN = 30;

/** O teto, dito do jeito que a lei diz. */
const PRAZO_MAXIMO =
  `em até ${PRAZO_DO_CANCELAMENTO_MIN} minutos depois da autorização (o teto nacional; o seu estado pode ter prazo menor)`;

export type CancelamentoDaNota =
  /**
   * Pode dar para cancelar: a mercadoria não saiu e o teto nacional ainda
   * corre. `restamMin` é quanto falta do TETO — a UF pode ter prazo menor.
   */
  | { cabe: true; restamMin: number }
  /** Não dá: a mercadoria saiu, ou o prazo de 30 minutos passou. */
  | { cabe: false; porque: "saiu" | "prazo" }
  /** Sem a hora da autorização ou sem o status: não se promete nada. */
  | { cabe: "incerto" };

/**
 * A nota autorizada deste pedido ainda pode ser CANCELADA?
 *
 * Ajuste SINIEF 19/16, cláusula décima quinta (redação do Ajuste SINIEF
 * 7/18): "O emitente poderá solicitar o cancelamento da NFC-e, desde que não
 * tenha havido a saída da mercadoria, em prazo não superior a 30 minutos,
 * podendo ser reduzido a critério de cada unidade federada, contado do
 * momento em que foi concedida a Autorização de Uso". As DUAS condições valem
 * juntas, e os 30 minutos são o teto (`PRAZO_DO_CANCELAMENTO_MIN`). O §6º
 * deixa cada estado aceitar, "em casos
 * excepcionais", o pedido de cancelamento extemporâneo — que é decisão do
 * fisco, caso a caso, e nunca algo que a tela possa prometer.
 *
 * A saída vem da mesma régua da emissão (`mercadoriaJaSaiu`,
 * lib/fiscal-momento). No modo padrão ("saida") a nota da entrega é
 * autorizada justamente quando o pedido SAI, e a de retirada, balcão e mesa
 * na conclusão: todas nascem com a mercadoria fora — o cancelamento cabe, na
 * prática, só na nota emitida no ACEITE, antes de o pedido sair.
 */
export function cancelamentoDaNota(pedido: PedidoComNotaFiscal, agora: Date = new Date()): CancelamentoDaNota {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : null;
  // A nota da conta da mesa sai no fechamento: a conta já foi consumida.
  const saiu = info?.notaDaConta ? true : mercadoriaJaSaiu(pedido);
  if (saiu === true) return { cabe: false, porque: "saiu" };
  const autorizadaEm = Date.parse(String(info?.emittedAt || ""));
  if (saiu === null || !Number.isFinite(autorizadaEm)) return { cabe: "incerto" };
  const restamMs = autorizadaEm + PRAZO_DO_CANCELAMENTO_MIN * 60_000 - agora.getTime();
  if (restamMs <= 0) return { cabe: false, porque: "prazo" };
  return { cabe: true, restamMin: Math.max(1, Math.floor(restamMs / 60_000)) };
}

/** O caminho quando a nota não cancela mais: desfazer a venda é com o contador. */
const PELO_CONTADOR =
  "Para desfazer a venda (ou parte dela), fale com o contador: o caminho é a NF-e de devolução/estorno " +
  "referenciando esta NFC-e, não o cancelamento.";

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * A ENTREGA que saiu e VOLTOU sem ser entregue não é devolução: é "retorno de
 * mercadoria não entregue", e o mesmo Ajuste SINIEF 19/16, cláusula 9ª,
 * parágrafo único, manda o emitente "guardar pelo prazo estabelecido na
 * legislação tributária o DANFE NFC-e que acompanhou o retorno de mercadoria
 * não entregue ao destinatário e que contenha o motivo do fato em seu verso"
 * (texto do CONFAZ, conferido em 24/09/2026). É o caso que a trava mais
 * recebe — o cliente recusou na porta e o motoboy voltou com a comida —, e é
 * obrigação da loja NA HORA, com o cupom na mão: a frase antiga só mandava
 * falar com o contador sobre devolução (que pressupõe entrega), e ninguém
 * guardava o DANFE com o motivo. Se o estado pede também uma nota de entrada
 * para o retorno, quem diz é o contador — a frase não promete que o DANFE
 * basta.
 */
const RETORNO_DA_ENTREGA =
  "Se a entrega não aconteceu (o cliente recusou ou não foi encontrado) e a mercadoria voltou, guarde agora o " +
  "DANFE NFC-e que foi com a entrega, com o motivo escrito no verso — é obrigação da loja (Ajuste SINIEF 19/16, " +
  "cláusula 9ª, parágrafo único), e o contador diz se o seu estado pede mais algum documento.";

/**
 * O que fazer quando a nota não cancela mais. Na entrega em domicílio (ou
 * quando o tipo de entrega não veio), o retorno da mercadoria não entregue
 * vem primeiro; retirada, balcão e mesa foram entregues na mão — ali só
 * existe devolução.
 */
function oQueFazerSemCancelamento(pedido: PedidoComNotaFiscal, info: Record<string, any> | null): string {
  const podeTerVoltado = !info?.notaDaConta && (pedido.deliveryType == null || ehEntregaEmDomicilio(pedido.deliveryType));
  if (!podeTerVoltado) return PELO_CONTADOR;
  return `${RETORNO_DA_ENTREGA} Se a mercadoria foi entregue e está sendo devolvida, ${minuscula(PELO_CONTADOR)}`;
}

/**
 * O pedido tem NFC-e que impede mexer nele? Devolve a frase para o lojista, ou
 * null quando pode seguir.
 *
 * ── Por que ─────────────────────────────────────────────────────────────────
 *
 * A nota autorizada é a venda declarada à SEFAZ: itens e valor. Tirar item ou
 * cancelar o pedido por baixo dela deixava o FireHub dizendo uma coisa e a
 * SEFAZ outra — e nada impedia (api/customer-order/status e
 * api/store/orders/[id]/itens aceitavam tudo).
 *
 * ── O que a frase manda fazer depende de a nota ainda cancelar ──────────────
 *
 * A frase antiga mandava sempre "cancele a nota em até 30 minutos". Só que o
 * cancelamento exige também que a mercadoria NÃO tenha saído (Ajuste SINIEF
 * 19/16, cl. 15ª — ver `cancelamentoDaNota`), e no modo padrão a nota da
 * entrega é autorizada no SAIU_ENTREGA. O caso que chega aqui de verdade é o
 * cancelamento do pedido que já saiu (api/customer-order/status: o cliente
 * recusou na porta, o motoboy voltou com a comida) — e a frase prometia um
 * cancelamento que a SEFAZ não aceita. Agora:
 *
 *  - antes da saída e dentro do prazo: cancele a nota, depois o pedido. O
 *    prazo é "no máximo 30 minutos": a cl. 15ª deixa cada UF reduzir, e a
 *    frase não promete um número que o estado pode não dar;
 *  - entrega que saiu e VOLTOU sem ser entregue: guardar o DANFE NFC-e com o
 *    motivo no verso (cl. 9ª, parágrafo único — `RETORNO_DA_ENTREGA`), que é
 *    da loja, na hora;
 *  - depois da saída ou do prazo, com a mercadoria entregue: a nota fica, e
 *    desfazer a venda é NF-e de devolução/estorno com o contador. A
 *    devolução de venda feita com NFC-e é documentada por NF-e modelo 55 de
 *    entrada, com a chave da NFC-e em refNFe (orientação das SEFAZ, p. ex.
 *    SEF/MG, perguntas frequentes da NFC-e) — a NFC-e não serve para
 *    entrada. Quem emite e escolhe o CFOP é o contador; a trava só não
 *    promete o que não existe.
 *
 * O pedido continua travado nos dois casos: sem a nota cancelada, a venda
 * segue declarada, e o pedido fica igual a ela.
 *
 * Nota "processando" também trava: a SEFAZ pode autorizar daqui a um minuto
 * com os itens de antes da edição.
 *
 * ── A forma de pagamento NÃO trava ──────────────────────────────────────────
 *
 * A troca de forma não mexe no valor da nota, e é ela que acerta o caixa e o
 * motoboy. Com a nota saindo na saída do pedido (lib/fiscal-momento), o
 * "Cobrar na Entrega" ganha nota antes de o cliente pagar. Caso real, de
 * 22/09/2026: o pedido cmud649ql00j5mm0137uwhdzd era "Débito (Cobrar na
 * Entrega)", o cliente pagou em dinheiro e o entregador informou na baixa, 63
 * minutos depois da criação. A nota já teria saído em débito e passado dos 30
 * minutos do cancelamento. Com a troca travada, o pedido ficaria para sempre
 * em débito, e o fechamento de caixa e o acerto do motoboy contariam errado a
 * forma daquele dinheiro — o defeito corrigido em 17/09. A troca passa, e o
 * aviso diz que a nota fica como saiu (`avisoDaNotaNaTrocaDePagamento`).
 *
 * ── Homologação não trava ───────────────────────────────────────────────────
 *
 * Nota de homologação (fiscalInfo.ambiente = 2) é teste, sem valor fiscal. A
 * primeira loja liga em homologação COM a operação real rodando; travar o
 * cancelamento de um pedido de verdade por causa de uma nota de teste — que
 * depois de 30 minutos nem cancela mais — pararia o balcão por nada. Nota sem
 * `ambiente` gravado conta como produção (o lado seguro).
 *
 * Pedido sem nota (fiscalStatus PENDING/FAILED/CANCELED, ou os campos nem
 * vieram) devolve null — segue exatamente como antes.
 */
export function travaDaNotaFiscal(
  pedido: PedidoComNotaFiscal | null | undefined,
  acao: string,
  agora: Date = new Date()
): string | null {
  const nota = notaQueVale(pedido);
  if (!nota) return null;
  const { info } = nota;
  // Devolução/ajuste feito pelo contador e registrado na tela fiscal
  // (`registroDaDevolucao`): a venda já foi desfeita no documento certo (a
  // NF-e de devolução/estorno), e o pedido pode voltar a acompanhar o que de
  // fato aconteceu. Sem esta saída o pedido ficava travado para sempre — a
  // nota não cancela mais e a frase só mandava falar com o contador.
  if (nota.estado === "autorizada" && info?.devolucao) return null;
  if (nota.estado === "autorizada") {
    const numero = info?.nfceNumber ? ` nº ${info.nfceNumber}` : "";
    const daConta = info?.notaDaConta ? " (a nota é da conta da mesa inteira)" : "";
    const inicio = `Este pedido tem NFC-e autorizada${numero}${daConta}.`;
    const cancelamento = cancelamentoDaNota(pedido!, agora);
    if (cancelamento.cabe === true) {
      return (
        `${inicio} Cancele a nota em Fiscal → Notas fiscais antes de ${acao}: a SEFAZ só aceita o cancelamento ` +
        `enquanto a mercadoria não saiu e ${PRAZO_MAXIMO} — restam no máximo ${cancelamento.restamMin} min.`
      );
    }
    if (cancelamento.cabe === false && cancelamento.porque === "saiu") {
      return (
        `${inicio} A mercadoria já saiu, e depois da saída a NFC-e não pode mais ser cancelada ` +
        `(Ajuste SINIEF 19/16, cláusula 15ª). Por isso não dá para ${acao} aqui. ${oQueFazerSemCancelamento(pedido!, info)}`
      );
    }
    if (cancelamento.cabe === false) {
      // A mercadoria não saiu (senão seria "saiu"): não há retorno de entrega.
      return (
        `${inicio} Já passaram os ${PRAZO_DO_CANCELAMENTO_MIN} minutos — o prazo máximo — em que a SEFAZ aceita o ` +
        `cancelamento (Ajuste SINIEF 19/16, cláusula 15ª). Por isso não dá para ${acao} aqui. ${PELO_CONTADOR}`
      );
    }
    // Sem a hora da autorização ou sem o status (a tela que só tem o status
    // fiscal): diz a regra inteira e não promete nenhum dos caminhos.
    return (
      `${inicio} A nota só pode ser cancelada enquanto a mercadoria não saiu e ${PRAZO_MAXIMO}. Se ainda ` +
      `der, cancele a nota em Fiscal → Notas fiscais antes de ${acao}. Se não der mais: ` +
      `${minuscula(oQueFazerSemCancelamento(pedido!, info))}`
    );
  }
  if (nota.estado === "contingencia") {
    // Contingência off-line (lib/fiscal-emissao): o cupom já vale para o
    // cliente e a SEFAZ ainda não recebeu. O cancelamento só existe depois de
    // efetivada — e com a mesma regra da saída e do prazo.
    const saiu = info?.notaDaConta ? true : mercadoriaJaSaiu(pedido!);
    if (saiu === true) {
      return (
        `Este pedido tem NFC-e emitida em contingência — o cupom já vale para o cliente — e a mercadoria já ` +
        `saiu: a nota não vai poder ser cancelada (Ajuste SINIEF 19/16, cláusula 15ª). Por isso não dá para ` +
        `${acao} aqui. ${oQueFazerSemCancelamento(pedido!, info)}`
      );
    }
    return (
      `Este pedido tem NFC-e emitida em contingência — o cupom já vale para o cliente. Aguarde a SEFAZ ` +
      `efetivar a nota: o cancelamento só vale enquanto a mercadoria não saiu e ${PRAZO_MAXIMO}. Dentro ` +
      `disso, cancele-a em Fiscal → Notas fiscais antes de ${acao}.`
    );
  }
  return (
    `Este pedido tem NFC-e em processamento na SEFAZ. Aguarde a resposta (Fiscal → Notas fiscais → ` +
    `Consultar situação) antes de ${acao}.`
  );
}

/** O que fica em `fiscalInfo.devolucao`. */
export type DevolucaoRegistrada = { quando: string; quem: string; observacao: string };

/**
 * A saída do pedido travado por uma nota que não cancela mais: registrar que
 * o contador fez a devolução/ajuste (a NF-e de devolução ou de estorno, que é
 * o caminho legal depois da saída da mercadoria ou dos 30 minutos). Devolve
 * o registro, ou a recusa em frase para o lojista.
 *
 * Só para a nota que VALE e já não cancela:
 *  - nota que ainda cancela (mercadoria não saiu, dentro do prazo): o
 *    caminho certo é cancelar a nota — registrar devolução ali seria desfazer
 *    uma venda no FireHub com a nota dela de pé;
 *  - contingência ou processamento: primeiro a SEFAZ decide;
 *  - homologação: não trava nada, não há o que liberar;
 *  - a observação é obrigatória (≥ 10 caracteres): é o que o próximo a
 *    abrir o pedido lê — o número da NF-e de devolução, quem fez, quando.
 */
export function registroDaDevolucao(
  pedido: PedidoComNotaFiscal,
  entrada: { quem: string; observacao: unknown },
  agora: Date = new Date()
): { ok: true; devolucao: DevolucaoRegistrada } | { ok: false; mensagem: string } {
  const nota = notaQueVale(pedido);
  if (!nota) return { ok: false, mensagem: "Este pedido não tem NFC-e de produção autorizada — não há devolução a registrar." };
  if (nota.estado !== "autorizada") {
    return { ok: false, mensagem: "A nota deste pedido ainda está com a SEFAZ (contingência ou processamento). Espere a situação final antes de registrar devolução." };
  }
  if (nota.info?.devolucao) return { ok: false, mensagem: "A devolução desta nota já foi registrada." };
  const cancelamento = cancelamentoDaNota(pedido, agora);
  if (cancelamento.cabe === true) {
    return {
      ok: false,
      mensagem:
        `A nota ainda pode ser cancelada (restam no máximo ${cancelamento.restamMin} min): cancele a nota em Fiscal → ` +
        "Notas fiscais. Devolução é para quando o cancelamento não cabe mais.",
    };
  }
  const observacao = String(entrada.observacao ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (observacao.length < 10) {
    return { ok: false, mensagem: "Descreva a devolução (mínimo 10 caracteres): o número da NF-e de devolução/estorno e quem fez." };
  }
  return { ok: true, devolucao: { quando: agora.toISOString(), quem: String(entrada.quem || "Loja").slice(0, 120), observacao } };
}

/**
 * A forma de pagamento mudou num pedido que já tem nota: a troca VALE (é o
 * que acerta o caixa e o motoboy, ver `travaDaNotaFiscal`), e a nota fica
 * como saiu — NFC-e não tem carta de correção. Devolve o que dizer, ou null
 * quando não há nota que valha.
 *
 *  - `aviso`: a frase para quem trocou, na resposta da rota.
 *  - `rastro`: o complemento da linha do editHistory, para quem conferir o
 *    pedido depois saber que a nota diz outra forma.
 *
 * A forma da nota é a que a emissão automática gravou (`formaNaNota`); nota
 * sem ela (emitida pelo botão) saiu com a forma que o pedido tinha antes da
 * troca.
 */
export function avisoDaNotaNaTrocaDePagamento(
  pedido: (PedidoComNotaFiscal & { paymentMethod?: string | null }) | null | undefined,
  formaNova: string
): { aviso: string; rastro: string } | null {
  const nota = notaQueVale(pedido);
  if (!nota) return null;
  const numero = nota.info?.nfceNumber ? ` nº ${nota.info.nfceNumber}` : "";
  const formaDaNota =
    String(nota.info?.formaNaNota || pedido?.paymentMethod || "").trim() || "a forma de antes";
  const qual =
    nota.estado === "autorizada"
      ? `A NFC-e${numero}`
      : nota.estado === "contingencia"
        ? `A NFC-e${numero} emitida em contingência`
        : "A NFC-e em processamento na SEFAZ";
  return {
    aviso:
      `${qual} saiu com ${formaDaNota} e continua assim: a troca para ${formaNova} vale para o pedido, ` +
      `o caixa e o acerto do entregador, não para a nota (NFC-e não tem carta de correção).`,
    rastro: `NFC-e${numero} continua com ${formaDaNota}`,
  };
}

export type OperadorDaEdicao = {
  role?: string | null;
  /** O CSV cru de `User.permissions`. */
  permissions?: string | null;
};

/**
 * Quem pode editar. O dono da loja sempre pode; o funcionário só com a
 * permissão marcada no cadastro dele (decisão do dono, 15/09/2026 — quem
 * atende o telefone costuma ser o funcionário, mas apagar item de venda mexe
 * no caixa, então é escolha por pessoa).
 *
 * A permissão NASCE DESMARCADA, inclusive para quem já estava cadastrado: o
 * CSV de um funcionário antigo não contém a chave nova, e `includes` devolve
 * false. É de propósito — ligar isso sozinho daria a ~30 lojas em operação um
 * funcionário capaz de apagar venda sem ninguém ter escolhido isso.
 */
export function podeEditarPedidos(operador: OperadorDaEdicao): boolean {
  const role = (operador.role || "").toUpperCase();
  if (role === "ADMIN" || role === "FRANCHISEE") return true;
  return (operador.permissions || "").split(",").includes(PERMISSAO_EDITAR_PEDIDOS);
}

/**
 * A decisão inteira, num lugar só: a tela chama para saber se desenha o botão,
 * a API chama para saber se aceita a escrita.
 */
export function avaliarEdicao(
  pedido: PedidoParaEdicao | null | undefined,
  operador: OperadorDaEdicao
): Avaliacao {
  if (!pedido) return { modo: "BLOQUEADO", motivo: "Pedido não encontrado." };

  if (!podeEditarPedidos(operador)) {
    return {
      modo: "BLOQUEADO",
      motivo: "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe.",
    };
  }

  // Pedido de mesa tem tela própria, com regra própria (a conta é da SESSÃO,
  // não do pedido) e é lá que o estoque e o rateio por pessoa são tratados.
  // Dois lugares editando a mesma coisa com contas diferentes é como a conta
  // da mesa passaria a divergir do que foi lançado.
  if (pedido.tableSessionId) {
    return {
      modo: "BLOQUEADO",
      motivo: "Este pedido é de uma mesa. Edite pelo painel de Mesas, onde fica a conta.",
    };
  }

  const status = (pedido.status || "").toUpperCase();

  if ((STATUS_CANCELADOS as readonly string[]).includes(status)) {
    return { modo: "BLOQUEADO", motivo: "Este pedido já foi cancelado." };
  }
  // Nota autorizada (ou na SEFAZ agora): editar por baixo dela é declarar uma
  // venda e fazer outra. Ver `travaDaNotaFiscal`.
  const trava = travaDaNotaFiscal(pedido, "editar os itens");
  if (trava) return { modo: "BLOQUEADO", motivo: trava };
  if (!(STATUS_EDITAVEIS as readonly string[]).includes(status)) {
    // Cai aqui AGUARDANDO_PAGAMENTO, CRIANDO_IA e qualquer status que apareça
    // depois sem ser classificado.
    return { modo: "BLOQUEADO", motivo: "Este pedido ainda não está pronto para ser editado." };
  }

  const canal = canalDoPedido(pedido as any);
  if (canal.ehMarketplace) {
    // O cliente ligou na LOJA para tirar item — é o caso que existe, e o app
    // do parceiro não está na mão do atendente. Deixa tirar; o que o aviso
    // faz é impedir que ele prometa ao cliente um estorno que não acontece.
    const pagoNaPlataforma = ehPagoOnline(pedido as any);
    return {
      modo: "MARKETPLACE",
      canal: canal.nome,
      totalMuda: !pagoNaPlataforma,
      motivo: `Pedido do ${canal.nome}. A alteração vale no FireHub — comanda, cozinha e estoque. No app do ${canal.nome} o pedido continua como está.`,
      avisoDoDinheiro: pagoNaPlataforma
        ? `O cliente já pagou no ${canal.nome}: tirar item NÃO devolve dinheiro a ele e NÃO muda o repasse. O total do pedido fica em pé aqui para continuar batendo com o que o ${canal.nome} vai depositar. Se o cliente tem direito a diferença, quem resolve é o ${canal.nome}.`
        : `O cliente paga na entrega: o total cai junto com o item, e é o novo valor que o entregador cobra. No app do ${canal.nome} o valor continua o antigo.`,
    };
  }

  return { modo: "COMPLETO", totalMuda: true };
}

/**
 * O total do pedido depois da edição.
 *
 * `itens - desconto + taxa` é a mesma conta que monta `finalTotal` no
 * nascimento do pedido (api/customer-order/route.ts:444), e foi conferida
 * contra 400 pedidos próprios reais em 15/09/2026: bate em 399. O único fora
 * é um pedido antigo sem item nenhum, que não é editável de qualquer forma.
 *
 * O DESCONTO É PRESERVADO EM REAIS, não recalculado. Um cupom de 10% aplicado
 * sobre o pedido original continua valendo os mesmos R$ 4,50 depois de tirar
 * um item — e não os 10% do que sobrou. É a escolha conservadora: recalcular
 * um cupom percentual exigiria revalidar valor mínimo, e um cupom que deixa de
 * valer no meio da edição vira preço que muda sozinho na mão do cliente.
 * Desconto aparece em 0,4% dos pedidos próprios, então o caso é raro; a tela
 * mostra a linha do desconto para o atendente ver que ela ficou de pé.
 */
export function recalcularTotal(entrada: {
  itens: { price: number; quantity: number }[];
  deliveryFee?: number | null;
  discountTotal?: number | null;
}): number {
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const soma = entrada.itens.reduce(
    (acc, i) => acc + Number(i.price || 0) * Number(i.quantity || 0),
    0
  );
  return centavos(
    Math.max(0, soma - Number(entrada.discountTotal || 0) + Number(entrada.deliveryFee || 0))
  );
}

/** Uma linha do rastro gravado em `CustomerOrder.editHistory`. */
export type RegistroDeEdicao = {
  /** ISO. Quem lê é humano, e o servidor roda em UTC (ver lib/fuso.ts). */
  quando: string;
  quem: string;
  /**
   * PAGAMENTO: a forma de pagamento mudou (painel ou app do motoboy); total não muda.
   * TAXA_DE_ENTREGA: a loja corrigiu a taxa de um pedido já feito
   * (api/store/orders/[id]/taxa-de-entrega); o total muda só a diferença.
   * DEVOLUCAO_FISCAL: a loja registrou a devolução/ajuste que o contador fez
   * sobre a NFC-e — é o que libera a trava da nota (`travaDaNotaFiscal`).
   * TIPO: delivery que virou mesa ou balcão (api/store/orders/[id]/tipo,
   * lib/troca-de-tipo.ts); a taxa sai e o total cai junto.
   * DESCONTO: desconto dado na aba Editar itens (`descontoNaEdicao`), sem
   * mexer em item; com item junto, a ação é a do item e o desconto vai na descrição.
   */
  acao: "REMOVEU" | "MUDOU_QTD" | "ACRESCENTOU" | "CANCELOU" | "PAGAMENTO" | "TAXA_DE_ENTREGA" | "DEVOLUCAO_FISCAL" | "TIPO" | "DESCONTO";
  /** O que mudou, em texto pronto: "Coca 2L (2x → 1x)". */
  descricao: string;
  totalAntes: number;
  totalDepois: number;
};

/**
 * Empilha o rastro sem nunca perder o que já estava lá.
 *
 * Auditoria é o contrapeso de deixar a loja apagar item de venda: quando o
 * dono perguntar por que o pedido 47 fechou R$ 12 a menos, a resposta está no
 * pedido, não na memória de quem estava no caixa.
 */
export function empilharEdicao(
  historicoAtual: unknown,
  registro: RegistroDeEdicao
): RegistroDeEdicao[] {
  const anterior = Array.isArray(historicoAtual) ? (historicoAtual as RegistroDeEdicao[]) : [];
  // Teto para o JSONB não crescer sem fim num pedido que alguém edite em loop.
  return [...anterior, registro].slice(-50);
}

/**
 * Dar desconto na edição do pedido — o cliente ligou reclamando do atraso, ou
 * o atendente tirou um item e quer compensar. Pode quem pode editar, mas só
 * quando o desconto chega ao bolso do cliente: ele ainda vai PAGAR.
 *
 *   • Pago no parceiro (`totalMuda` false) ou pago online: o dinheiro já
 *     entrou. Baixar o total aqui não devolve nada a ninguém, só faz o
 *     faturamento divergir do que entrou — e o atendente acharia que deu.
 *   • Pagamento dividido: as partes somam o total antigo. Desconto por cima
 *     deixaria o caixa esperando mais do que o pedido vale; a divisão se
 *     refaz depois do desconto, em "Como o cliente pagou".
 */
export function descontoNaEdicao(
  pedido: PedidoParaEdicao | null | undefined,
  avaliacao: Avaliacao
): { pode: true } | { pode: false; motivo: string } {
  if (!pedido || avaliacao.modo === "BLOQUEADO") {
    return { pode: false, motivo: (pedido && avaliacao.motivo) || "Pedido não encontrado." };
  }
  if (avaliacao.totalMuda === false) {
    const canal = avaliacao.canal || "parceiro";
    return {
      pode: false,
      motivo: `O cliente já pagou no ${canal}: desconto aqui não devolve dinheiro a ele. Quem devolve é o ${canal}.`,
    };
  }
  if (ehPagoOnline(pedido as any)) {
    return { pode: false, motivo: "O cliente já pagou online: desconto agora não devolve o dinheiro a ele." };
  }
  if (lerPartes(pedido.paymentMethods).length > 1) {
    return {
      pode: false,
      motivo: "Pagamento dividido: passe para \"Uma forma só\" em \"Como o cliente pagou\", dê o desconto e divida de novo.",
    };
  }
  return { pode: true };
}

/**
 * A conta do desconto da edição — a tela prevê com ela e a API grava com ela.
 *
 * A porcentagem vale sobre os ITENS que ficam no pedido, já tirado o desconto
 * que ele tinha (cupom, desconto do balcão): "10%" é 10% do que o cliente ia
 * pagar pela comida. A taxa de entrega fica fora, como no balcão. O desconto
 * novo SOMA ao que já existia, e nunca passa do valor dos itens.
 */
export function contaDoDescontoDaEdicao(entrada: {
  itens: { price: number; quantity: number }[];
  discountTotal?: number | null;
  deliveryFee?: number | null;
  desconto: DescontoManual;
}): { base: number; valor: number; discountTotal: number; total: number; problema: string } {
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const soma = entrada.itens.reduce((acc, i) => acc + Number(i.price || 0) * Number(i.quantity || 0), 0);
  const descontoAtual = Number(entrada.discountTotal || 0);
  const base = centavos(Math.max(0, soma - descontoAtual));
  const problema = problemaDoDesconto(entrada.desconto, base);
  const valor = problema ? 0 : valorDoDesconto(entrada.desconto, base);
  const discountTotal = centavos(descontoAtual + valor);
  const total = recalcularTotal({ itens: entrada.itens, deliveryFee: entrada.deliveryFee, discountTotal });
  return { base, valor, discountTotal, total, problema };
}

/**
 * O `discountMerchant` do pedido depois de a loja dar `valor` de desconto na
 * edição. É dele que o fechamento de caixa tira a linha "Desconto" do bloco
 * (produtos + taxa − desconto = total, lib/apuracao-do-turno.ts) e o
 * relatório de descontos tira a parte da loja. Sem ele, o desconto aparecia
 * no fechamento como "outras taxas e ajustes".
 *
 *   • Pedido com as colunas (iFood/99 com desconto, site): soma.
 *   • iFood/99 sem as colunas: o desconto antigo pode ter sido da plataforma,
 *     então só o novo vira da loja — o resto o caixa continua lendo como
 *     cupom da plataforma (discountTotal − discountMerchant).
 *   • Os outros (site antigo, balcão, Wabiz, Brendi, Jotajá): todo desconto é
 *     da loja, o antigo junto — senão a diferença viraria "cupom da plataforma".
 */
export function descontoDaLojaDepoisDaEdicao(
  pedido: {
    discountTotal?: number | null;
    discountMerchant?: number | null;
    discountIfood?: number | null;
    source?: string | null;
    openDeliveryChannel?: string | null;
    openDeliveryOrderId?: string | null;
    ifoodOrderId?: string | null;
  },
  valor: number
): number {
  const centavos = (n: number) => Math.round(n * 100) / 100;
  if (pedido.discountMerchant != null || pedido.discountIfood != null) {
    return centavos(Number(pedido.discountMerchant || 0) + valor);
  }
  const chave = canalDoPedido(pedido as any).chave;
  if (chave === "IFOOD" || chave === "99FOOD") return centavos(valor);
  return centavos(Number(pedido.discountTotal || 0) + valor);
}
