/**
 * /src/lib/resumo-do-entregador.ts
 *
 * A SOMA das entregas de um motoboy — quantas, km, dias, o dinheiro de cada
 * forma de pagamento e o que ele ganhou — sem banco, para rodar no servidor e
 * na tela.
 *
 * ── Por que mora separada ───────────────────────────────────────────────────
 * O relatório (lib/relatorio-do-entregador.ts) somava tudo no servidor. Com o
 * filtro de integrações dentro do cartão de cada motoboy ("só iFood", "só 99",
 * pedido do Douglas, 02/10/2026), a tela precisa refazer a mesma soma com só
 * parte das entregas. Duas somas escritas em dois lugares é como nasce o "no
 * filtro dá um valor, sem filtro dá outro" — então os dois chamam esta.
 *
 * A diária fica de fora: ela é por DIA trabalhado, não se divide por canal.
 *
 * ── Em que caixa cai cada entrega ───────────────────────────────────────────
 * A forma de pagamento sai da régua do FECHAMENTO DE CAIXA
 * (lib/relatorios/formas-de-pagamento.ts, `formaDoPedido`), não de uma leitura
 * própria. A leitura antiga daqui procurava pedaços de palavra na ordem
 * dinheiro → débito → vale → cartão, e o resto virava "Pago Online":
 *   • "Cartão (Pago Online)", "Débito (Pago Online)", "Vale Refeição (Pago
 *     Online)" — pagos no app — iam para a MAQUININHA;
 *   • o Pix pago na porta ("Pix" trocado na entrega, "PIX_ENTREGA" do site),
 *     "A combinar (Cobrar na Entrega)" e o pedido sem forma iam para o PAGO
 *     ONLINE.
 * A Delícia de Casa somou as notas pagas online de um motoboy e o quadrado
 * "Pago Online" dava outro valor, "mais de uma nota" de diferença, sem ter
 * como achar quais (Fellipe, 10/10/2026). Agora cada entrega cai na caixa que
 * o caixa daria a ela, e a tela marca a caixa na linha de cada entrega
 * (`partesDaEntrega`) — a soma das linhas marcadas é o quadrado.
 */
import { toLocalISODate } from "@/lib/timezone";
import { HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";
import { formaDoPedido, formaDoTexto, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { lerTrocoNoPix, type QuemFezOPix } from "@/lib/troco-no-pix";

const VIRADA_MS = HORA_DE_VIRADA_DO_EXPEDIENTE * 60 * 60 * 1000;

export const ehCancelado = (status: string | null | undefined) => String(status || "").toUpperCase().includes("CANCEL");

/** Chegou ao cliente: ENTREGUE ou ENCERRADO (lib/status-pedido.ts, STATUS_FINALIZADOS). */
export const foiEntregue = (status: string | null | undefined) => {
  const s = String(status || "").toUpperCase();
  return s === "ENTREGUE" || s === "ENCERRADO";
};

// ── CANCELADO SÓ É CORRIDA SE O MOTOBOY SAIU ──────────────────────────────────
//
// Até 11/10/2026 o acerto contava TODO pedido cancelado com o motoboy como
// corrida (cancelado-com-motoboy-conta), e o fechamento de caixa não contava
// nenhum: o mesmo entregador, no mesmo turno, com dois números (77 cancelados
// com motoboy em 60 dias; na Delícia de Casa, em 30 dias, Ian 8, Jobson 6,
// guilherme 5). A regra única é a frase do Douglas (02/10/2026), "se ele puxou
// o pedido, vai ficar na conta": SAIU com o pedido (`dispatchedAt`, o carimbo de
// SAIU_ENTREGA) antes do cancelamento → a corrida conta. Cancelado antes de
// sair → não houve corrida. Das 77, 57 tinham saído; nenhuma saiu depois de
// cancelada. Pedido anterior a 29/08/2026 não tem o carimbo e fica sem corrida.

type PedidoDaCorrida = { status?: string | null; dispatchedAt?: Date | string | null; cancelledAt?: Date | string | null };

/** Cancelado DEPOIS de o motoboy sair com ele: a corrida conta (e o dinheiro não). */
export function canceladoComCorrida(o: PedidoDaCorrida): boolean {
  if (!ehCancelado(o.status) || !o.dispatchedAt) return false;
  const saiu = new Date(o.dispatchedAt).getTime();
  const cancelou = o.cancelledAt ? new Date(o.cancelledAt).getTime() : NaN;
  return !Number.isFinite(cancelou) || saiu <= cancelou;
}

/** A entrega vira corrida do motoboy: não cancelada, ou cancelada depois de sair. */
export const contaComoCorrida = (o: PedidoDaCorrida) => !ehCancelado(o.status) || canceladoComCorrida(o);

// ── É ENTREGA DA LOJA? ────────────────────────────────────────────────────────
//
// Uma régua para o acerto do motoboy e o fechamento de caixa. O caixa olhava
// só `deliveryBy` ("tem e não é MERCHANT" = parceira), o acerto não olhava nada
// e a tela de Áreas usa `infoDaEntrega` (lib/entrega-parceira.ts) — a régua do
// painel e da comanda, que é a base daqui.
//
// Uma exceção, de dado velho: até 17/09/2026 o app do motoboy da loja carimbava
// `ifoodDriverStatus = "DELIVERED"` ao conferir o código da entrega PRÓPRIA (ver
// o comentário de ESTADOS_DE_ENTREGADOR_IFOOD). Em 60 dias são 15 pedidos da
// Frangoso, todos com o motoboy da loja e sem `deliveryBy` — dois deles
// "Crédito (Cobrar na Entrega)", cobrados na porta pelo motoboy da loja. Pela
// régua do painel eles viram "entregador do iFood" e sumiriam do acerto de
// setembro. Com motoboy da loja atribuído, "DELIVERED" sozinho (sem `deliveryBy`
// de parceiro) não prova entrega parceira. Desde 18/09 não há nenhum caso assim.
export function ehEntregaDaLoja(o: {
  motoboyId?: string | null;
  deliveryBy?: string | null;
  ifoodDriverStatus?: string | null;
  ifoodDriverName?: string | null;
  [k: string]: unknown;
}): boolean {
  const info = infoDaEntrega(o);
  if (!info.parceira) return true;
  const por = String(o.deliveryBy || "").toUpperCase().trim();
  const soOCarimboDoApp =
    Boolean(o.motoboyId) && !por && !o.ifoodDriverName && String(o.ifoodDriverStatus || "").toUpperCase() === "DELIVERED";
  return soOCarimboDoApp;
}

type PedidoDoDinheiro = {
  paymentMethod?: string | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  notes?: string | null;
};

/**
 * "Troco para quanto": o `changeAmount` gravado ou, sem ele, o que estiver
 * escrito na observação ("Troco para 100", "Troco p/ R$ 50,00", "Troco: 100").
 * Só vale acima do total — abaixo dele não é troco, é erro de digitação.
 */
export function trocoParaDoPedido(o: PedidoDoDinheiro): number | null {
  const orderTotal = Number(o.totalAmount || 0);
  if (typeof o.changeAmount === "number" && o.changeAmount > orderTotal) return o.changeAmount;
  if (!o.notes) return null;
  const notesUpper = String(o.notes).toUpperCase();
  const match =
    notesUpper.match(/TROCO\s*(?:PARA|P\/|DE|PRA)?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i) ||
    notesUpper.match(/TROCO\s*[:=]?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (match && match[1]) {
    const parsed = parseFloat(match[1].replace(",", "."));
    if (!isNaN(parsed) && parsed > orderTotal) return parsed;
  }
  return null;
}

/** O que a régua do caixa lê para decidir a forma de uma entrega. */
export type EntregaParaCaixa = PedidoDoDinheiro & {
  source?: string | null;
  paymentPaidAt?: Date | string | null;
  gatewayProvider?: string | null;
  openDeliveryChannel?: string | null;
  /** Pagamento dividido (troca de pagamento na loja ou no app): manda no texto. */
  paymentMethods?: unknown;
  /** Troco feito pelo Pix (lib/troco-no-pix.ts): o troco da nota não saiu em cédula. */
  trocoNoPix?: unknown;
};

/** As caixas do acerto, na ordem da tela. As três últimas só aparecem com valor. */
export const CAIXAS_DO_ACERTO: { chave: ChaveDaForma; rotulo: string; curto: string }[] = [
  { chave: "DINHEIRO", rotulo: "💵 Dinheiro (em mãos)", curto: "💵 Dinheiro" },
  { chave: "DEBITO", rotulo: "💳 Débito (Máquina)", curto: "💳 Débito" },
  { chave: "CREDITO", rotulo: "💳 Crédito (Máquina)", curto: "💳 Crédito" },
  { chave: "VALE", rotulo: "🎟️ Voucher (Vale)", curto: "🎟️ Vale" },
  { chave: "PIX", rotulo: "📲 Pix na entrega", curto: "📲 Pix na entrega" },
  { chave: "ONLINE", rotulo: "⚡ Pago Online", curto: "⚡ Pago Online" },
  { chave: "FIADO", rotulo: "📒 Fiado", curto: "📒 Fiado" },
  { chave: "OUTROS", rotulo: "❓ Forma não identificada", curto: "❓ Não identificada" },
];

/** Um pedaço do pagamento de uma entrega: em que caixa cai e quanto. */
export type ParteDaEntrega = {
  caixa: ChaveDaForma;
  valor: number;
  /** Só no dinheiro: a nota com que o cliente pagou ("troco para 100"). */
  trocoPara: number | null;
  /**
   * Só no dinheiro com nota: o troco voltou ao cliente por Pix, e de quem
   * (lib/troco-no-pix.ts). null = o troco saiu em cédula, levado da loja.
   * Opcional para quem monta a parte à mão (testes, telas antigas).
   */
  trocoNoPix?: QuemFezOPix | null;
};

/**
 * Em que caixa do acerto cai cada real desta entrega. Pagamento dividido vai
 * parte por parte (cada uma pela forma escrita nela, como o caixa faz); o
 * resto é UMA parte, pela cascata do caixa. No dinheiro dividido, o troco é o
 * `changeAmount` — a observação "troco para 50" fala do pedido inteiro, não
 * da parte.
 */
export function partesDaEntrega(o: EntregaParaCaixa): ParteDaEntrega[] {
  const pixDoTroco = lerTrocoNoPix(o.trocoNoPix)?.por ?? null;
  const divisao = lerPagamentos(o.paymentMethods);
  if (divisao.length > 0) {
    return divisao.map((p) => {
      const caixa = formaDoTexto(p.method);
      const nota = Number(o.changeAmount || 0);
      const trocoPara = caixa === "DINHEIRO" && nota > p.amount ? nota : null;
      return { caixa, valor: p.amount, trocoPara, trocoNoPix: trocoPara ? pixDoTroco : null };
    });
  }
  const caixa = formaDoPedido(o);
  const trocoPara = caixa === "DINHEIRO" ? trocoParaDoPedido(o) : null;
  return [{ caixa, valor: Number(o.totalAmount || 0), trocoPara, trocoNoPix: trocoPara ? pixDoTroco : null }];
}

// ── O DINHEIRO DE UMA PARTE, COM E SEM TROCO NO PIX ─────────────────────────
//
// Três leituras da mesma parte em dinheiro, e as três moram aqui para o acerto
// (resumo, linha de cada entrega, tela), o papel do caixa e o app do motoboy
// fazerem a MESMA conta. Pedido de R$ 40 pago com nota de R$ 50:
//
//                        entrega à loja   troco levado   troco no Pix
//   troco em cédula           R$ 50           R$ 10            —
//   Pix da loja               R$ 50             —            R$ 10
//   Pix do motoboy            R$ 40             —            R$ 10
//
// No Pix do motoboy ele fica com os R$ 10 da nota: é o reembolso do Pix que ele
// fez do bolso dele. Ver lib/troco-no-pix.ts.

const c2 = (v: number) => Math.round(v * 100) / 100;

/** O dinheiro que o motoboy entrega à loja por esta parte (fora do dinheiro, o valor dela). */
export function dinheiroDaParte(p: ParteDaEntrega): number {
  if (p.caixa !== "DINHEIRO" || !p.trocoPara) return p.valor;
  return p.trocoNoPix === "MOTOBOY" ? p.valor : p.trocoPara;
}

/** O troco que saiu em cédula da gaveta com o motoboy (e volta junto com a nota). */
export function trocoLevadoDaParte(p: ParteDaEntrega): number {
  if (p.caixa !== "DINHEIRO" || !p.trocoPara || p.trocoNoPix) return 0;
  return c2(p.trocoPara - p.valor);
}

/** O troco que voltou ao cliente por Pix nesta parte (0 sem a marca). */
export function trocoNoPixDaParte(p: ParteDaEntrega): number {
  if (p.caixa !== "DINHEIRO" || !p.trocoPara || !p.trocoNoPix) return 0;
  return c2(p.trocoPara - p.valor);
}

export type EntregaDoResumo = EntregaParaCaixa & {
  status?: string | null;
  createdAt: Date | string;
  deliveryDistance?: number | null;
  deliveryFee?: number | null;
  motoboyFee?: number | null;
  /** Saiu para a entrega (SAIU_ENTREGA) e foi cancelado: o cancelado só é corrida se saiu antes. */
  dispatchedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  /** O que o motoboy ganha nesta entrega (lib/ganho-do-entregador). Só conta se for corrida. */
  ganho: number;
};

/**
 * O dia do EXPEDIENTE de um instante ("2026-10-15"), no fuso da loja: vira às
 * 5h, então a entrega da 1h é do dia anterior. É o dia que paga a diária — e o
 * dia em que a loja ajusta a diária (lib/ajustes-do-acerto-regras.ts).
 */
export const diaDoExpediente = (instante: Date | string, tz: string) =>
  toLocalISODate(new Date(new Date(instante).getTime() - VIRADA_MS), tz);

export function resumoDasEntregas(orders: EntregaDoResumo[], tz: string) {
  // ── AS CORRIDAS ───────────────────────────────────────────────────────────
  // Entrega não cancelada, ou cancelada DEPOIS de o motoboy sair com ela
  // (canceladoComCorrida). O cancelado antes de sair não é corrida: não conta
  // entrega, km, dia nem ganho — a mesma regra do fechamento de caixa.
  const corridas = orders.filter(contaComoCorrida);
  const totalDeliveries = corridas.length;
  const totalDistance = corridas.reduce((s, o) => s + (o.deliveryDistance || 0), 0);

  // Dias trabalhados = EXPEDIENTES, no fuso da loja. É o que paga a diária:
  // pelo calendário, o turno das 18h às 2h contava dois dias.
  const diasTrabalhados = [...new Set(corridas.map((o) => diaDoExpediente(o.createdAt, tz)))].sort();
  const uniqueDays = diasTrabalhados.length;

  // Soma das taxas dos pedidos
  const deliveryFeeSum = corridas.reduce((s, o) => s + (o.deliveryFee || o.motoboyFee || 0), 0);
  const motoboyFeeSum = corridas.reduce((s, o) => s + (o.motoboyFee || 0), 0);

  // Classificação de pagamentos recebidos pelo motoboy na entrega vs online
  let cashCollectedSum = 0, cashOrdersCount = 0, changeGivenSum = 0, cashOrdersValueSum = 0;
  // Troco feito pelo Pix (lib/troco-no-pix.ts), separado por quem fez o Pix.
  let trocoNoPixDaLojaSum = 0, trocoNoPixDoMotoboySum = 0, trocoNoPixCount = 0;
  let debitTotal = 0, debitCount = 0;
  let creditTotal = 0, creditCount = 0;
  let voucherTotal = 0, voucherCount = 0;
  let onlineTotal = 0, onlineCount = 0;
  // Pix na porta não está no bolso do motoboy nem na maquininha: caiu na
  // conta da loja. Fiado e forma não identificada: ninguém recebeu na hora.
  let pixTotal = 0, pixCount = 0;
  let fiadoTotal = 0, fiadoCount = 0;
  let naoIdentificadoTotal = 0, naoIdentificadoCount = 0;

  // ── ENTREGUES, NA RUA, CANCELADAS E O VALOR DOS PEDIDOS ───────────────────
  // "Jobson 30 notas, e o valor dos pedidos das 30 do lado" (Delícia de Casa,
  // 09/10/2026). "Entregues" são as que CHEGARAM (ENTREGUE/ENCERRADO): antes
  // era "todas menos as canceladas", e o pedido ainda na rua ou em preparo
  // aparecia como entregue. O valor dos pedidos é o das não canceladas, em
  // qualquer forma de pagamento — ninguém pagou o cancelado.
  let entreguesCount = 0, emAndamentoCount = 0;
  let canceladasCount = 0, canceladasValor = 0;
  let canceladasComCorridaCount = 0, canceladasSemCorridaCount = 0;
  let valorDosPedidos = 0;

  for (const o of orders) {
    const total = Number(o.totalAmount || 0);
    if (ehCancelado(o.status)) { // Pedido cancelado: não cobrar prestação de contas do motoboy
      canceladasCount++;
      canceladasValor += total;
      if (canceladoComCorrida(o)) canceladasComCorridaCount++;
      else canceladasSemCorridaCount++;
      continue;
    }
    if (foiEntregue(o.status)) entreguesCount++;
    else emAndamentoCount++;
    valorDosPedidos += total;

    for (const parte of partesDaEntrega(o)) {
      const v = parte.valor;
      switch (parte.caixa) {
        case "DINHEIRO":
          // O valor que o motoboy recebe fisicamente do cliente e entrega
          // para a loja: a nota inteira. Ele saiu com o troco DA LOJA (a nota
          // menos o pedido) e o devolve junto — por isso o "entregar" é
          // pedidos + troco levado, e os dois aparecem separados na tela.
          // Com o troco feito pelo Pix não houve troco levado: no Pix da loja
          // ele entrega a nota inteira; no Pix dele, só o pedido (fica com a
          // diferença da nota, que reembolsa o Pix que ele fez).
          cashCollectedSum += dinheiroDaParte(parte);
          cashOrdersCount++;
          changeGivenSum += trocoLevadoDaParte(parte);
          cashOrdersValueSum += v;
          {
            const pix = trocoNoPixDaParte(parte);
            if (pix > 0) {
              trocoNoPixCount++;
              if (parte.trocoNoPix === "MOTOBOY") trocoNoPixDoMotoboySum += pix;
              else trocoNoPixDaLojaSum += pix;
            }
          }
          break;
        case "DEBITO": debitTotal += v; debitCount++; break;
        case "CREDITO": creditTotal += v; creditCount++; break;
        case "VALE": voucherTotal += v; voucherCount++; break;
        case "PIX": pixTotal += v; pixCount++; break;
        case "ONLINE": onlineTotal += v; onlineCount++; break;
        case "FIADO": fiadoTotal += v; fiadoCount++; break;
        default: naoIdentificadoTotal += v; naoIdentificadoCount++;
      }
    }
  }

  const centavos = (v: number) => Math.round(v * 100) / 100;

  return {
    /** Corridas: as não canceladas + as canceladas depois de o motoboy sair. */
    totalDeliveries,
    /** Chegaram ao cliente (ENTREGUE/ENCERRADO). */
    entreguesCount,
    /** Ainda na rua ou em preparo, sem cancelamento. */
    emAndamentoCount,
    canceladasCount,
    /** Das canceladas, as que ele já tinha levado (a corrida conta). */
    canceladasComCorridaCount,
    /** Das canceladas, as que nem saíram (sem corrida). */
    canceladasSemCorridaCount,
    canceladasValor: centavos(canceladasValor),
    /** Soma do total das entregas que não foram canceladas, de todas as formas. */
    valorDosPedidos: centavos(valorDosPedidos),
    totalDistance,
    uniqueDays,
    /** Os expedientes com corrida ("2026-10-15"), em ordem: um por diária. */
    diasTrabalhados,
    deliveryFeeSum,
    motoboyFeeSum,
    /** O dinheiro a entregar: pedidos em dinheiro + o troco que ele levou da loja. */
    cashCollectedSum: centavos(cashCollectedSum),
    cashOrdersCount,
    /** Dos pedidos em dinheiro, o valor deles (sem o troco). */
    cashOrdersValueSum: centavos(cashOrdersValueSum),
    /** O troco levado da loja (a nota do cliente menos o pedido), que volta junto. */
    changeGivenSum: centavos(changeGivenSum),
    /**
     * Troco feito pelo Pix da LOJA: a parte da nota que passa do pedido. Já
     * está dentro de `cashCollectedSum` (ele entrega a nota inteira), mas não é
     * troco levado — nenhuma cédula saiu da gaveta.
     */
    trocoNoPixDaLojaSum: centavos(trocoNoPixDaLojaSum),
    /**
     * Troco feito pelo Pix do MOTOBOY: ele ficou com essa diferença da nota (o
     * reembolso do Pix dele). FORA de `cashCollectedSum` e fora do a pagar.
     */
    trocoNoPixDoMotoboySum: centavos(trocoNoPixDoMotoboySum),
    trocoNoPixCount,
    cardPosTotal: centavos(debitTotal + creditTotal + voucherTotal),
    cardPosCount: debitCount + creditCount + voucherCount,
    debitTotal: centavos(debitTotal),
    debitCount,
    creditTotal: centavos(creditTotal),
    creditCount,
    voucherTotal: centavos(voucherTotal),
    voucherCount,
    onlineTotal: centavos(onlineTotal),
    onlineCount,
    pixTotal: centavos(pixTotal),
    pixCount,
    fiadoTotal: centavos(fiadoTotal),
    fiadoCount,
    naoIdentificadoTotal: centavos(naoIdentificadoTotal),
    naoIdentificadoCount,
    feeTotal: Math.round(corridas.reduce((s, o) => s + o.ganho, 0) * 100) / 100,
  };
}

/**
 * A "Composição do pagamento" do acerto: uma linha por ORIGEM do valor
 * (lib/ganho-do-entregador.ts, `origemDoGanho`), com a conta que fecha.
 *
 * O rótulo saía do TIPO do motoboy: "Por entrega: R$ 0,00 × 10 entregas =
 * R$ 40,00" num "Diária + Entrega" sem valor por entrega cadastrado, cujo
 * ganho tinha vindo da tabela da loja. Pela origem, cada linha diz de onde
 * veio o dinheiro — e "R$ X × N" só aparece quando todas valem o mesmo.
 */
export function composicaoDoGanho(entregas: { origemDoGanho?: string | null; ganhoDoMotoboy?: number | null; deliveryDistance?: number | null; corrida?: boolean }[]) {
  const ROTULO: Record<string, string> = {
    GRAVADO: "Valor gravado na venda",
    FAIXA_DELE: "Faixa de km do entregador",
    POR_KM: "Km rodado",
    POR_ENTREGA: "Valor por entrega",
    REGRA_DA_LOJA: "Tabela de repasse da loja",
    TAXA_DO_CLIENTE: "Taxa de entrega do pedido",
    SO_DIARIA: "Só diária (sem valor por entrega)",
    SEM_DISTANCIA: "Sem distância medida (R$ 0,00)",
  };
  const ORDEM = ["POR_ENTREGA", "FAIXA_DELE", "POR_KM", "REGRA_DA_LOJA", "TAXA_DO_CLIENTE", "GRAVADO", "SEM_DISTANCIA", "SO_DIARIA"];
  const grupos = new Map<string, { qtd: number; c: number; km: number; valores: Set<number> }>();
  for (const e of entregas) {
    if (e.corrida === false) continue;
    const origem = e.origemDoGanho || "GRAVADO";
    const g = grupos.get(origem) || { qtd: 0, c: 0, km: 0, valores: new Set<number>() };
    const c = Math.round((Number(e.ganhoDoMotoboy) || 0) * 100);
    g.qtd += 1;
    g.c += c;
    g.km += Number(e.deliveryDistance) || 0;
    g.valores.add(c);
    grupos.set(origem, g);
  }
  return [...grupos.entries()]
    .sort((a, b) => ORDEM.indexOf(a[0]) - ORDEM.indexOf(b[0]))
    .map(([origem, g]) => ({
      origem,
      rotulo: ROTULO[origem] || origem,
      qtd: g.qtd,
      valor: g.c / 100,
      km: Math.round(g.km * 10) / 10,
      /** Todas valem o mesmo: a linha pode dizer "R$ X × N". */
      cadaUma: g.valores.size === 1 ? [...g.valores][0] / 100 : null,
    }));
}
