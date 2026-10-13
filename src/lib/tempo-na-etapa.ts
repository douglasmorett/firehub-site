/**
 * HÁ QUANTO TEMPO O PEDIDO ESTÁ NA ETAPA EM QUE ESTÁ — o "(5 min)" ao lado da
 * etapa no cartão do painel de pedidos.
 *
 * Pedido do Lucas (Frangoso, 13/10/2026), aprovado pelo dono: o cartão só
 * contava desde a CHEGADA do pedido, e na correria a equipe perdia a noção de
 * cada passo — "acha que o motoboy saiu há muito tempo ou há pouco". Na Saipos
 * a etapa vem com o tempo entre parênteses, e o relógio zera a cada troca:
 * "Em produção (5 min)" vira "Pronto (0 min)", depois "Saiu para entrega
 * (0 min)", depois "Finalizado (0 min)".
 *
 * ── De onde sai cada relógio ───────────────────────────────────────────────
 *
 * Dos carimbos de lib/order-stages.ts, que a extensão do Prisma grava em todo
 * caminho que muda o status. Sem o carimbo da etapa (pedido de antes de
 * 29/08/2026, status trocado por fora do Prisma) a função devolve null e o
 * cartão não mostra parêntese nenhum: chutar a hora seria pior que não dizer.
 *
 *   • Em produção — `acceptedAt`, a hora do aceite. Com uma exceção: a
 *     primeira baixa de item no KDS passa o pedido de ACEITO para PREPARANDO e
 *     a extensão REGRAVA o aceite ali (ver a nota carimbo-de-aceite-e-reescrito
 *     e lib/relatorios/tempos.ts) — o relógio voltaria a zero com o pedido
 *     ainda na chapa. Depois dessa baixa (`kdsStage` FINISHING) vale a entrada
 *     na cozinha, `kdsProductionAt`, quando ela é mais antiga.
 *     Por que não usar sempre o `kdsProductionAt`: o pedido do site o ganha na
 *     CRIAÇÃO, mesmo NOVO ou agendado (api/customer-order) — contaria a espera
 *     pelo aceite como produção e, no agendado antecipado, horas. Pelo mesmo
 *     motivo ele só vale dentro do teto de operação de lib/order-stages.ts
 *     (4 h antes do aceite); mais velho que isso é a hora do agendamento.
 *   • Pronto — `readyAt`. Vale para o status PRONTO e para o pedido de
 *     entrega com o selo "Pronto Cozinha" (o KDS finaliza sem trocar o status,
 *     api/kds finish_order, mas grava `readyAt`).
 *   • Saiu para entrega — `dispatchedAt`. Na retirada, SAIU_ENTREGA é o
 *     "pronto" que o KDS grava ao finalizar (cliente vem buscar): o carimbo é
 *     o mesmo, muda só o nome da etapa.
 *   • Finalizado — `deliveredAt`: há quanto tempo foi finalizado, como na
 *     Saipos e como o Lucas descreveu ("finalizou, a mesma coisa").
 *
 * Fica sem relógio o que não tem carimbo próprio da etapa: NOVO, rascunho do
 * robô e "aguardando pagamento" (o `createdAt` é o nascimento do pedido, não a
 * entrada nessas etapas — o pago pelo site entra em NOVO só no pagamento), e
 * cancelado/encerrado. O tempo desde a chegada continua no cartão como antes.
 *
 * Duas exceções na produção, onde o carimbo existe mas não mede a cozinha:
 *   • AGENDADO de verdade: o aceite e o `kdsProductionAt` são da hora em que o
 *     cliente agendou (ontem, às vezes), e o pedido só vai para a cozinha
 *     perto da hora. "Em produção (20h)" seria mentira.
 *   • MESA: o pedido fica "em preparo" enquanto a mesa estiver aberta — uma
 *     hora, duas — e isso é gente comendo, não cozinha atrasada (a mesma regra
 *     que tira o prazo do cartão de mesa).
 */
import { MARCO_POR_STATUS, TETO_DE_MINUTOS_MEDIDOS } from "./order-stages";
import { dataDoPedido } from "./pedidos-na-cozinha";

type Instante = Date | string | null | undefined;

export type EtapaDoQuadro = "producao" | "pronto" | "saiu" | "finalizado";

export type PedidoComCarimbos = {
  status: string;
  deliveryType?: string | null;
  kdsStage?: string | null;
  createdAt: Date | string;
  scheduledDatetime?: Instante;
  agendado?: boolean | null;
  acceptedAt?: Instante;
  kdsProductionAt?: Instante;
  readyAt?: Instante;
  dispatchedAt?: Instante;
  deliveredAt?: Instante;
};

export type TempoNaEtapa = {
  etapa: EtapaDoQuadro;
  /** O nome da etapa no cartão completo ("Saiu para entrega"). */
  rotulo: string;
  /** O nome curto, para a linha do painel clean ("Saiu"). */
  curto: string;
  /** Quando o pedido entrou na etapa. */
  desde: Date;
  /** Minutos inteiros desde então (nunca negativo). */
  minutos: number;
};

/**
 * Os campos que mudam o relógio da etapa. O painel compara a lista nova com a
 * antiga campo a campo antes de redesenhar (StoreOrdersDashboard,
 * `areOrdersEqual`); sem estes lá, o carimbo que chega depois do status (o
 * clique já trocou o status na tela) seria descartado como "nada mudou".
 */
export const CARIMBOS_DA_ETAPA = ["kdsProductionAt", "acceptedAt", "readyAt", "dispatchedAt", "deliveredAt"] as const;

function ms(x: Instante): number | null {
  if (!x) return null;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Os dois pedidos têm os mesmos carimbos de etapa? Date e texto ISO se equivalem. */
export function mesmosCarimbos(a: Partial<PedidoComCarimbos> | null | undefined, b: Partial<PedidoComCarimbos> | null | undefined): boolean {
  return CARIMBOS_DA_ETAPA.every((campo) => ms(a?.[campo]) === ms(b?.[campo]));
}

/** O selo "Pronto Cozinha" do cartão — a parte do KDS de `prontoNaCozinha` (lib/pedidos-na-cozinha). */
function prontoNoKds(kdsStage: string | null | undefined): boolean {
  return kdsStage === "FINISHED" || kdsStage === "READY";
}

/** A etapa do pedido no quadro e a hora em que ele entrou nela, ou null. */
function etapaComInicio(o: PedidoComCarimbos): { etapa: EtapaDoQuadro; desde: number | null } | null {
  // O vocabulário de status é o da extensão que carimba: os sinônimos das
  // plataformas (EM_PREPARO, SAIU_PARA_ENTREGA…) caem na mesma etapa.
  const marco = MARCO_POR_STATUS[String(o.status || "").toUpperCase()];
  if (marco === "acceptedAt") {
    // Status de produção com o selo "Pronto Cozinha": no quadro, já é pronto.
    if (prontoNoKds(o.kdsStage)) return { etapa: "pronto", desde: ms(o.readyAt) };
    if (o.deliveryType === "MESA") return null;
    const criado = ms(o.createdAt);
    if (criado !== null && dataDoPedido(o).getTime() !== criado) return null; // agendado de verdade
    const aceite = ms(o.acceptedAt);
    const cozinha = ms(o.kdsProductionAt);
    // Depois da primeira baixa do KDS o aceite foi regravado: vale a entrada
    // na cozinha, se for mais antiga e de hoje (ver o topo).
    const aceiteRegravado = o.kdsStage === "FINISHING" && aceite !== null && cozinha !== null
      && cozinha < aceite && aceite - cozinha <= TETO_DE_MINUTOS_MEDIDOS * 60000;
    return { etapa: "producao", desde: aceiteRegravado ? cozinha : (aceite ?? cozinha) };
  }
  if (marco === "readyAt") return { etapa: "pronto", desde: ms(o.readyAt) };
  if (marco === "dispatchedAt") return { etapa: "saiu", desde: ms(o.dispatchedAt) };
  if (marco === "deliveredAt") return { etapa: "finalizado", desde: ms(o.deliveredAt) };
  return null; // NOVO, rascunho, aguardando pagamento, cancelado, encerrado
}

const ROTULOS: Record<EtapaDoQuadro, [string, string]> = {
  producao: ["Em produção", "Produção"],
  pronto: ["Pronto", "Pronto"],
  saiu: ["Saiu para entrega", "Saiu"],
  finalizado: ["Finalizado", "Finalizado"],
};

/**
 * Há quanto tempo o pedido está na etapa atual, ou null quando a etapa não
 * tem relógio (ver o topo). `agora` é o mesmo relógio que já atualiza o
 * cartão — a conta não lê a hora sozinha, para o teste fixar o instante.
 */
export function tempoNaEtapa(o: PedidoComCarimbos, agora: Date): TempoNaEtapa | null {
  const achado = etapaComInicio(o);
  if (!achado || achado.desde === null) return null;
  // Na retirada, SAIU_ENTREGA é o pronto do KDS: o cliente vem buscar.
  const retiradaPronta = achado.etapa === "saiu" && String(o.deliveryType || "").toUpperCase() !== "DELIVERY";
  const [rotulo, curto] = retiradaPronta ? ROTULOS.pronto : ROTULOS[achado.etapa];
  // Relógio do PC um pouco atrás do servidor dá diferença negativa: vale zero,
  // como o tempo desde a chegada do cartão.
  const minutos = Math.max(0, Math.floor((agora.getTime() - achado.desde) / 60000));
  return { etapa: achado.etapa, rotulo, curto, desde: new Date(achado.desde), minutos };
}

/** "5 min", "1h12min" — o mesmo jeito de escrever horas do cartão. */
export function textoDoTempo(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60}min`;
}
