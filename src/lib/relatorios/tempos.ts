/**
 * O relatório "Tempo por status e produção" — o "Tempo por status" da Saipos,
 * com o tempo de preparo por produto que o KDS do FireHub já carimba.
 *
 * Duas partes:
 *
 * 1. TEMPO POR ETAPA do pedido (esperando aceite, na cozinha, pronto esperando
 *    saída, na rua, total da entrega, total na loja), com mínimo, mediana,
 *    média, "9 em cada 10 em até"
 *    e máximo; quantos saíram depois do prazo e quais foram; e a mediana de
 *    cada etapa por dia.
 * 2. TEMPO DE PRODUÇÃO POR PRODUTO: da entrada do pedido na cozinha até o
 *    cozinheiro dar o item por pronto (CustomerOrderItem.prontoEm), por
 *    categoria → produto e por hora do dia.
 *
 * ── A regra que manda em tudo: falta não é zero ─────────────────────────────
 *
 * Cada etapa conta SÓ o pedido que tem os dois carimbos dela. Pedido anterior
 * aos carimbos (29/08/2026; o pronto por item, 22/09/2026), pedido ainda em
 * andamento, pedido que pulou a etapa no painel: fica de fora e aparece como
 * "não medido", com o motivo. Média com zero fantasma é pior que média sobre
 * menos pedidos — a mesma regra do painel antigo (painel/RelatoriosClient.tsx).
 *
 * ── O que os carimbos são DE VERDADE (medido na NIK, 17 a 23/09/2026) ───────
 *
 * Os carimbos (lib/order-stages.ts) guardam a ÚLTIMA vez que o pedido entrou
 * na etapa. Para o aceite isso estraga a conta:
 *
 * - `finish_production` do KDS passa o pedido de ACEITO para PREPARANDO, e a
 *   extensão do Prisma recarimba `acceptedAt` NA HORA DA BAIXA. Em 100% dos
 *   pedidos da NIK com item pronto, `acceptedAt` = o primeiro `prontoEm`.
 * - O iFood devolve o "pronto para retirar" como PREPARANDO
 *   (lib/ifood-eventos.ts) e recarimba de novo: `acceptedAt` fica ~6 s DEPOIS
 *   do `readyAt`. Lido cru, "esperando aceite" dava 8,7 min num pedido que o
 *   FireHub confirmou sozinho em segundos.
 *
 * Por isso o aceite só vale quando vem ANTES da primeira baixa da cozinha;
 * depois dela o carimbo foi reescrito e o pedido sai como "carimbo reescrito".
 * E balcão e mesa não esperam aceite: nascem ACEITO (api/store/orders/
 * presencial, api/store/table-sessions/[id]/add-order).
 *
 * "Antes" quer dizer mais de um minuto antes. A loja que não usa o KDS não tem
 * baixa da cozinha: a primeira baixa dela é a SAÍDA, e despachar o pedido do
 * iFood passa pelo "em preparo" décimos de segundo antes do "saiu" — o aceite
 * é regravado ali. Delícia de Casa, 11/09 a 10/10/2026: 928 dos 2.579 aceites
 * "medidos" estavam a menos de 60 s da saída (833 deles a até 0,2 s), e o
 * "esperando aceite" desses pedidos era o tempo até o motoboy sair (mediana
 * de 41 min; a média da etapa caía de 19,8 para 2,2 min sem eles). O pedido
 * do iFood que espera mais de alguns minutos é cancelado pelo próprio iFood:
 * aceite colado na saída é regravação, não espera.
 *
 * O pedido que a LOJA aceita sozinha também nasce ACEITO: com o aceite
 * automático ligado (User.autoAcceptOrders), o site, a Wabiz, o 99Food e o
 * totem gravam ACEITO na chegada — ou no pagamento, quando ele é online
 * (customer-order, wabiz-traducao, 99food/webhook, order-payment-confirm).
 * Nesse pedido não existe espera por aceite, e qualquer `acceptedAt` depois
 * da chegada é regravação — arrastar para "Em preparo" no painel grava
 * PREPARANDO antes de qualquer baixa, e a regra da primeira baixa não pega.
 * Caso real: NIK, Wabiz #29 de 22/09/2026, aceito pela loja em 0,1 s como
 * os outros Wabiz do dia, aparecia "esperando aceite 15,3 min" (o máximo da
 * semana). Na Hakim Centro os pedidos do site nasceram aceitos (`acceptedAt`
 * 1 ms depois da criação em 04, 11, 13 e 17/09), e os outros 169 "medidos"
 * (mediana 4,5 min) eram todos essa regravação. A coluna só passou a valer
 * em 03/09/2026 (antes o painel não a gravava e ela era false para todo
 * mundo): antes disso o pedido nascia NOVO e a espera era de verdade.
 *
 * A COZINHA começa em `kdsProductionAt` (o pedido apareceu na tela do KDS; é
 * carimbado uma vez só) e, sem ele, em `createdAt` — é exatamente o relógio que
 * o cozinheiro vê no cartão do KDS (store/kds/tela/page.tsx: `kdsProductionAt
 * || createdAt`). Balcão e mesa entram no KDS sem `kdsProductionAt`, na hora
 * em que são lançados.
 *
 * A ENTREGA no cliente (`deliveredAt`) é às vezes a conclusão automática do
 * iFood ou o fechamento do caixa, horas depois. Na base inteira (29/08 a
 * 24/09/2026), saída → entregue: 4.724 pedidos entre 0 e 90 min, um piso de
 * ~20 por faixa de 15 min até 210 min, e ~1.950 amontoados entre 225 e 360 min
 * (pico em 255–270: Hakim Centro, NIK e Pastel da Paulista, que não marcam
 * "entregue"). O teto geral de 4 h (lib/order-stages.ts) cai no meio desse
 * monte; "na rua" tem teto próprio de 2 h.
 *
 * ── O "entregue" dado em lote ───────────────────────────────────────────────
 *
 * O teto de 2 h não pega o "entregue" marcado em LOTE: o operador que, na
 * volta do motoboy ou no fim do turno, marca vários pedidos de uma vez, e o
 * fechamento do caixa (api/cash-session), que dá por entregue tudo o que
 * estava na rua num updateMany só — o mesmo instante, até o milésimo, em
 * todos. A hora é a do clique, não a da entrega. NIK, 05/10/2026: 8 pedidos
 * de 3 motoboys "entregues" entre 19:59:18 e 19:59:34, com "na rua" de 15,9 a
 * 67,3 min; Point da esfiha, 10/10: 11 pedidos em 21 s; Hakim Centro: grupos
 * de até 29 pedidos com o mesmo `deliveredAt`, do fechamento do caixa. Em 30
 * dias (11/09 a 10/10), a mediana "na rua" da NIK caía de 34,8 para 28,0 min
 * sem os lotes, e a da Point da esfiha de 31,8 para 6,0.
 *
 * Lote (`entreguesEmLote`): o mesmo instante em mais de uma entrega da loja,
 * ou 3 ou mais entregas da mesma loja marcadas em até 90 s — um motoboy não
 * entrega em três endereços em um minuto e meio. Conta só ENTREGA (a mesa
 * fechada e o balcão finalizado no mesmo minuto não fazem lote com o
 * motoboy), e a rota calcula sobre TODAS as entregas da loja, não só as do
 * filtro: o lote não pode mudar com o canal escolhido. O entregue em lote sai
 * de "na rua", do "total da entrega" e da chegada no prazo como "marcado em
 * lote". O custo: entregas de verdade confirmadas no mesmo minuto e meio
 * também saem — o iFood que conclui três pedidos na mesma leitura de eventos.
 * Na Hakim Centro, em 30 dias, a regra tirou 51 dos 432 "na rua" medidos: 40
 * do fechamento do caixa (o mesmo instante), 7 com outro "entregue" a menos de
 * 10 s e 4 mais espaçados — estes, com cara de entrega de verdade.
 *
 * ── Dois totais, não um ─────────────────────────────────────────────────────
 *
 * O total da entrega vai até o cliente receber em casa (~45 min); o do
 * balcão, da retirada, do totem e da mesa vai até ficar pronto (~8 min). Uma
 * mediana das duas coisas juntas não responde nenhuma e mexe com a MISTURA do
 * dia: na NIK o "total" caiu de 54,8 min (20/09) para 7,9 min (21/09) — parecia
 * a operação sete vezes mais rápida — só porque o balcão e a mesa passaram a
 * ter pronto no dia 21; a entrega, nesse dia, PIOROU (55,6 min). Por isso são
 * duas etapas: "Total da entrega" e "Total na loja".
 *
 * ── O prazo ─────────────────────────────────────────────────────────────────
 *
 * A MESMA regra que pinta o cartão no painel de pedidos (StoreOrdersDashboard,
 * `isRealScheduled`/`isTakeoutOrder`/`remainingMins`), linha por linha: a hora
 * prometida quando existe (`scheduledDatetime` mais de 2 min depois do pedido
 * — o iFood, a Wabiz e a Brendi mandam a previsão de entrega aí), senão 40 min
 * quando o cartão reconhece retirada (deliveryType RETIRADA/TAKEOUT ou o
 * marcador de retirada na observação) e 45 min no resto. Mesa não tem prazo
 * (gente comendo não é atraso).
 *
 * O prazo é a hora em que o CLIENTE espera ter o pedido: na entrega, a
 * CHEGADA — o iFood grava ali o `delivery.deliveryDateTime`, a Brendi o
 * `deliveryDeadline`, a Wabiz e o JotaJá o pedido + 50 min (ver
 * lib/previsao-da-entrega.ts, que imprime essa hora na comanda) —; na
 * retirada, no balcão e no totem, o pronto. Até 11/10/2026 o relatório
 * comparava a SAÍDA do motoboy com a hora de chegada, e o "saíram no prazo"
 * ficava alto com o cliente recebendo atrasado: em 30 dias, 96% das entregas
 * da NIK saíram antes do prazo, e só 47% das que têm hora de entregue
 * confiável CHEGARAM antes dele (Hakim Centro: 81% e 26%).
 *
 * Então, na entrega, o prazo é cumprido na hora de ENTREGUE — a mesma régua
 * do "total da entrega": sem lote, sem conclusão horas depois. A entrega sem
 * essa hora fica "sem hora de entrega confiável" e não entra na conta, com uma
 * exceção que não depende dela: a que SAIU da loja já depois do prazo chegou
 * atrasada com certeza ("saiu depois do prazo", fora da porcentagem, na lista
 * dos atrasados). A saída de todas as entregas contra o prazo continua à vista
 * (`saidaDasEntregas`): quantas a loja já soltou atrasadas.
 *
 * As faixas de alerta são as do lojista (User.timeAlertConfig, "Alertas de
 * Produção" do painel), comparadas como o cartão compara: os minutos
 * restantes ARREDONDADOS PARA BAIXO (6 min 40 s de folga = "6 min
 * restantes"), na hora em que o prazo foi cumprido.
 *
 * O cartão não reconhece o PICKUP do site como retirada e dá 45 min a ele
 * (62 pedidos desde 29/08/2026, nenhum com hora prometida). O relatório segue
 * o cartão — se dissesse "estourou +3 min" num pedido cujo cartão mostrou "2
 * min restantes", o lojista não teria em qual dos dois acreditar. Se o cartão
 * mudar, `retiradaNoCartao` muda junto.
 *
 * AGENDADO de verdade (prazo mais de 3 h depois do pedido — o corte da lista de
 * Agendamentos do painel; a previsão das plataformas vai de 15 a ~120 min) fica
 * SEPARADO: o pedido espera horas de propósito e o `kdsProductionAt` dele é a
 * hora da criação, então somar nas etapas faria a cozinha "demorar" 6 h.
 *
 * ── Produção e finalização: a montagem e o forno ────────────────────────────
 *
 * A NIK dá baixa duas vezes: na tela de produção (a montagem, que carimba o
 * `prontoEm` do item) e na de finalização (o forno, que finaliza o pedido).
 * "Na cozinha" vai da entrada ao fim; "Na produção" e "Na finalização" são as
 * duas pernas dela, só para quem passou pelo KDS. E a produção por produto
 * mede até onde o lojista escolher (`medirAte`): o pronto da produção, a
 * finalização (o percurso completo do item) ou a baixa de uma tela. Cada
 * baixa guarda a tela e a hora desde 09/10/2026 (`CustomerOrder.kdsBaixas`);
 * antes disso só há o pronto do item e a hora em que o pedido foi finalizado
 * (Danilo, NIK, 09/10/2026: "esses tempos aí está só de montagem e não está a
 * finalização do forno").
 *
 * ── Mesa ────────────────────────────────────────────────────────────────────
 *
 * O dinheiro da mesa mora em TableSession, mas este relatório não soma
 * dinheiro: mede tempo, e o tempo é de cada RODADA — cada lançamento na mesa é
 * um pedido com seus carimbos. A mesa entra na cozinha e no total na loja (até
 * o prato ficar pronto); não entra no aceite, no prazo nem na rua.
 *
 * Puro (sem banco). A rota (api/store/relatorios/tempos) busca os pedidos com
 * a régua comum (lib/relatorios/servidor.ts: sem cancelado, no dia operacional)
 * e resolve a categoria do item pelo cardápio.
 */
import { minutosEntre, TETO_DE_MINUTOS_MEDIDOS } from "@/lib/order-stages";
import { ehCancelado, naLoja, somarDias, TIPOS_DE_VENDA, type TipoDeVenda } from "@/lib/relatorios/base";

// ── AS RÉGUAS ───────────────────────────────────────────────────────────────

/** Desde quando os carimbos de etapa existem (acceptedAt, readyAt…). */
export const DIA_DOS_CARIMBOS = "2026-08-29";
/** Desde quando o KDS carimba o pronto de cada item (CustomerOrderItem.prontoEm). */
export const DIA_DO_PRONTO_POR_ITEM = "2026-09-22";
/** Desde quando cada baixa guarda a tela e a hora (CustomerOrder.kdsBaixas). */
export const DIA_DAS_BAIXAS_POR_TELA = "2026-10-09";

/** Prazo padrão sem hora prometida — o do cartão do painel. */
export const PRAZO_PADRAO_RETIRADA_MIN = 40;
export const PRAZO_PADRAO_ENTREGA_MIN = 45;
/** Hora prometida só vale se for mais de 2 min depois do pedido (a regra do cartão). */
const PROMESSA_MINIMA_MIN = 2;
/** Mais que isso é agendamento de verdade, não previsão de entrega. */
export const AGENDAMENTO_DE_VERDADE_MIN = 180;
/** Entrega de mais de 2 h na rua é pedido encerrado depois, não entrega (ver o topo). */
export const TETO_DA_RUA_MIN = 120;
/** Lote: esta quantidade de entregas da mesma loja com o "entregue" dentro da janela (ver o topo). */
export const ENTREGUES_PARA_LOTE = 3;
export const JANELA_DO_LOTE_S = 90;
/** Aceite a menos disto da primeira baixa (a saída, na loja sem KDS) é regravação (ver o topo). */
export const ACEITE_COLADO_NA_BAIXA_S = 60;

/**
 * Os canais em que o FireHub grava o status de chegada pela coluna
 * `autoAcceptOrders` da loja: o site (customer-order e order-payment-confirm),
 * a Wabiz (wabiz-traducao), o 99Food (99food/webhook) e o totem (que passa
 * pelo order-payment-confirm). O iFood, a Brendi e o Jotajá chegam NOVO e
 * quem aceita é o painel aberto — a espera deles é de verdade.
 */
export const CANAIS_ACEITOS_NA_CHEGADA: ReadonlySet<string> = new Set(["SITE", "WABIZ", "99FOOD", "TOTEM"]);
/**
 * Desde quando a coluna `autoAcceptOrders` vale: o painel passou a gravá-la no
 * commit cdb3215a (03/09/2026 16:21). Os primeiros pedidos nascidos aceitos
 * vieram na mesma noite (Brazza 99Food 19:15, Pastel da Paulista site 19:24).
 */
export const ACEITE_AUTOMATICO_DESDE = "2026-09-03T16:21:07-03:00";

/** Os "Alertas de Produção" do lojista. */
export type LimitesDeAlerta = { amareloAtivo: boolean; amareloMin: number; vermelhoAtivo: boolean; vermelhoMin: number };

/**
 * Lê o User.timeAlertConfig exatamente como o cartão do painel lê: sem
 * configuração salva, o padrão da rota /api/store/time-alert-config (amarelo
 * 10, vermelho 5, os dois ligados); com configuração, a faixa só vale ligada
 * E com minutos acima de zero (`redEnabled && Number(redMinutes) > 0`).
 */
export function limitesDoAlerta(cfg: unknown): LimitesDeAlerta {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return { amareloAtivo: true, amareloMin: 10, vermelhoAtivo: true, vermelhoMin: 5 };
  }
  const c = cfg as Record<string, unknown>;
  const minutos = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const amareloMin = minutos(c.yellowMinutes);
  const vermelhoMin = minutos(c.redMinutes);
  return {
    amareloAtivo: Boolean(c.yellowEnabled) && amareloMin > 0,
    amareloMin,
    vermelhoAtivo: Boolean(c.redEnabled) && vermelhoMin > 0,
    vermelhoMin,
  };
}

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type Instante = Date | string | null | undefined;

export type ItemParaTempos = {
  nome: string;
  /** Categoria de verdade (a do cardápio, também para item de iFood). */
  categoria: string;
  /** "O mesmo produto": categoria + nome normalizado (a rota monta com chaveDoNome). */
  chave: string;
  produtoId: string | null;
  quantidade: number;
  prontoEm: Instante;
  /** Sabores, borda, bebida do combo — para a lista de pedidos da hora ("qual sabor que é"). */
  escolhas?: string;
  /** Id do item (CustomerOrderItem), para casar com a baixa de cada tela. */
  id?: string;
};

/** Uma baixa do KDS, como `CustomerOrder.kdsBaixas` guarda (lib/kds-telas.ts, BaixaDoKds). */
export type BaixaParaTempos = {
  tela: string;
  nome?: string;
  estagio: "production" | "finishing";
  em: Instante;
  /** Os itens que a tela mostrava nessa baixa. */
  itens: string[];
};

/**
 * Até onde a produção por produto mede cada item (ver `prontoDoItem`):
 * - producao: o pronto do item na tela de produção (`prontoEm`) — a montagem, na loja que tem forno depois;
 * - finalizacao: a baixa da tela de finalização que mostra o item — o percurso completo (montagem + forno);
 * - tela: a baixa de UMA tela do KDS, só nos itens que ela mostra.
 */
export type MedirAte =
  | { tipo: "producao" }
  | { tipo: "finalizacao" }
  | { tipo: "tela"; chave: string; nome: string; estagio: "production" | "finishing"; categorias: string[] };

export type PedidoParaTempos = {
  id: string;
  status: string;
  tipo: TipoDeVenda;
  /** Chave do canal (canalDoRelatorio). */
  canal: string;
  /** Número do dia (#12). */
  numero: number | null;
  /** O número do parceiro (iFood #4231, Wabiz…), quando houver. */
  referencia: string | null;
  /** O que o cartão do painel lê para decidir retirada (40 min) ou entrega (45 min). */
  deliveryType?: string | null;
  notes?: string | null;
  /**
   * A loja aceita este pedido sozinha na chegada: não houve espera por aceite
   * (a rota decide com `aceitoNaChegada`).
   */
  aceitoPelaLoja?: boolean;
  /** A loja do pedido (franchiseeId): o lote de "entregue" é por loja. */
  loja?: string;
  /**
   * O "entregue" foi dado em lote (`entreguesEmLote`). A rota calcula sobre
   * todas as entregas da loja; sem o campo, `temposDoRelatorio` calcula sobre
   * os pedidos que recebeu.
   */
  entregueEmLote?: boolean;
  createdAt: Date | string;
  acceptedAt?: Instante;
  readyAt?: Instante;
  dispatchedAt?: Instante;
  deliveredAt?: Instante;
  kdsProductionAt?: Instante;
  kdsFinishingAt?: Instante;
  kdsFinishedAt?: Instante;
  scheduledDatetime?: Instante;
  /** As chaves das telas que já deram baixa (`kdsTelasProntas`). */
  telasProntas?: string[];
  /** Cada baixa com a tela e a hora (`kdsBaixas`, desde 09/10/2026). */
  baixas?: BaixaParaTempos[];
  itens: ItemParaTempos[];
};

export type ConfigDosTempos = {
  tz: string;
  limites: LimitesDeAlerta;
  /** Período pedido, para a tabela por dia ter todos os dias (inclusive os sem pedido). */
  periodo?: { de: string; ate: string };
  /** Categorias e produtos marcados. Na parte 1 contam os pedidos que TÊM um desses itens. */
  categorias?: Set<string>;
  produtos?: Set<string>;
  /** A lista de pedidos só com os que saíram depois do prazo. */
  apenasAtrasados?: boolean;
  /** Quantas linhas a lista devolve no máximo (a tela não precisa de 20 mil). */
  limiteDaLista?: number;
  /** Quantos pedidos cada hora da produção devolve (padrão LIMITE_DE_PEDIDOS_POR_HORA). */
  limitePorHora?: number;
  /** Até onde a produção por produto mede cada item (padrão: o pronto da produção). */
  medirAte?: MedirAte;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type ChaveDaEtapa = "aceite" | "cozinha" | "producao" | "finalizacao" | "esperandoSaida" | "rua" | "totalEntrega" | "totalNaLoja";

export const ETAPAS: { chave: ChaveDaEtapa; titulo: string; legenda: string; aplicaA: string; dentroDaCozinha?: boolean }[] = [
  { chave: "aceite", titulo: "Esperando aceite", legenda: "Da hora do pedido até alguém aceitar.",
    aplicaA: "Pedidos que alguém precisa aceitar (iFood, Brendi, Jotajá; site, Wabiz, 99Food e totem quando o aceite automático está desligado). Balcão, mesa e o que a loja aceita sozinha já nascem aceitos." },
  { chave: "cozinha", titulo: "Na cozinha", legenda: "Da entrada na cozinha (o pedido aparece no KDS) até ficar pronto.",
    aplicaA: "Todos os tipos de venda." },
  // As duas pernas da cozinha, para a loja que dá baixa duas vezes (a montagem
  // e o forno da NIK; a produção e a expedição). Só quem passou pelo KDS.
  { chave: "producao", titulo: "Na produção", legenda: "Da entrada na cozinha até o último item ganhar o pronto na tela de produção (a montagem, na loja que tem forno depois).",
    aplicaA: "Pedidos que passaram pelo KDS com o pronto por item (desde 22/09/2026).", dentroDaCozinha: true },
  { chave: "finalizacao", titulo: "Na finalização", legenda: "Do último pronto da produção até a cozinha finalizar o pedido (a baixa da tela de finalização: o forno, a expedição).",
    aplicaA: "Pedidos que passaram pelo KDS com o pronto por item.", dentroDaCozinha: true },
  { chave: "esperandoSaida", titulo: "Pronto esperando saída", legenda: "Do pronto até o entregador sair.",
    aplicaA: "Entrega." },
  { chave: "rua", titulo: "Na rua", legenda: "Da saída até a entrega no cliente.",
    aplicaA: "Entrega com o \"entregue\" marcado na hora. Mais de 2 h na rua (o pedido encerrado depois) e o \"entregue\" dado em lote (vários de uma vez, ou o fechamento do caixa) não entram." },
  { chave: "totalEntrega", titulo: "Total da entrega", legenda: "Do pedido até o cliente receber em casa (a hora de entregue).",
    aplicaA: "Entrega com o \"entregue\" marcado na hora (a mesma régua de \"na rua\")." },
  { chave: "totalNaLoja", titulo: "Total na loja", legenda: "Do pedido até ficar pronto para o cliente que está na loja ou vem buscar.",
    aplicaA: "Balcão, retirada, totem e mesa." },
];

/** Por que a etapa não foi medida. `emLote`: o "entregue" foi dado em lote (ver o topo). */
export type MotivoDeFora = "semCarimbo" | "foraDaCurva" | "reescrito" | "emLote";

/** Uma etapa de um pedido: não se aplica, medida, ou não medida (com o motivo). */
export type MedidaDaEtapa = { aplica: false } | { aplica: true; minutos: number } | { aplica: true; minutos: null; motivo: MotivoDeFora };

export type Estatistica = { medidos: number; minimo: number | null; mediana: number | null; media: number | null; p90: number | null; maximo: number | null };

export type ResumoDaEtapa = Estatistica & {
  chave: ChaveDaEtapa;
  titulo: string;
  legenda: string;
  aplicaA: string;
  /** Produção e finalização: as duas pernas de "na cozinha", mostradas dentro dela. */
  dentroDaCozinha?: boolean;
  /** Pedidos em que a etapa vale (medidos + não medidos). */
  elegiveis: number;
  semCarimbo: number;
  foraDaCurva: number;
  reescritos: number;
  /** "Entregue" dado em lote (só na rua e no total da entrega). */
  emLote: number;
};

/**
 * Onde o pedido ficou em relação ao prazo, na hora em que o prazo é cumprido
 * (a chegada na entrega, o pronto nos outros — ver o topo).
 *   semEntrega    entrega sem hora de entregue confiável (sem "entregue", em lote, encerrada horas depois)
 *   saiuAtrasado  entrega sem essa hora, mas que SAIU da loja já depois do prazo: atrasou com certeza
 *   semCarimbo    retirada, balcão ou totem sem a hora do pronto
 */
export type FaixaDoPrazo = "noPrazo" | "amarelo" | "vermelho" | "estourado" | "saiuAtrasado" | "semPrazo" | "semCarimbo" | "semEntrega" | "foraDaCurva";

export const ROTULO_DA_FAIXA: Record<FaixaDoPrazo, string> = {
  noPrazo: "No prazo",
  amarelo: "Alerta amarelo",
  vermelho: "Alerta vermelho",
  estourado: "Estourou o prazo",
  saiuAtrasado: "Saiu depois do prazo",
  semPrazo: "Mesa (sem prazo)",
  semCarimbo: "Sem hora de pronto",
  semEntrega: "Sem hora de entrega confiável",
  foraDaCurva: "Fora da curva",
};

export type ResumoDoPrazo = {
  limites: LimitesDeAlerta;
  /** Pedidos com prazo (mesa não tem). */
  comPrazo: number;
  /** Com prazo e com a hora em que ele foi cumprido conhecida (a chegada na entrega, o pronto nos outros). */
  medidos: number;
  noPrazo: number;
  amarelo: number;
  vermelho: number;
  estourados: number;
  /** Retirada, balcão e totem sem a hora do pronto. */
  semCarimbo: number;
  foraDaCurva: number;
  semPrazo: number;
  /** Entregas sem hora de entregue confiável, e por quê (fora dos medidos). */
  semEntrega: number;
  semEntregaPorMotivo: { semCarimbo: number; emLote: number; foraDaCurva: number };
  /** Entregas sem essa hora que saíram da loja já depois do prazo: atrasaram com certeza (fora dos medidos). */
  saiuAtrasado: number;
  /**
   * A SAÍDA de todas as entregas contra o prazo do cliente: quantas tinham a
   * hora de saída e quantas a loja soltou já depois dele (estas chegaram
   * atrasadas, medidas ou não).
   */
  saidaDasEntregas: { medidas: number; depoisDoPrazo: number };
  /** Mediana e máximo de quanto passou do prazo, entre os estourados (min). */
  atrasoMediano: number | null;
  maiorAtraso: number | null;
};

export type LinhaDoPedido = {
  id: string;
  numero: number | null;
  referencia: string | null;
  canal: string;
  tipo: TipoDeVenda;
  /** Dia operacional e hora do pedido, no relógio da loja. */
  dia: string;
  hora: string;
  criadoEm: string;
  agendado: boolean;
  prazo: string | null;
  /** A saída do motoboy na entrega; o pronto nos outros. */
  saida: string | null;
  /** Entrega: a hora de entregue, quando é confiável (é ela que cumpre o prazo). */
  entregue: string | null;
  /** Do pedido até sair (min). No agendado, null: ele espera de propósito. */
  tempoAteSaida: number | null;
  /**
   * Quanto passou do prazo (min, > 0), ou quanto sobrou (< 0), na hora em que
   * ele foi cumprido. Em "saiu depois do prazo", quanto já tinha passado na
   * saída (o atraso foi pelo menos esse). null = não medido.
   */
  excedeu: number | null;
  faixa: FaixaDoPrazo;
  etapas: Record<ChaveDaEtapa, number | null>;
};

export type LinhaDoDia = {
  dia: string;
  diaSemana: number;
  pedidos: number;
  etapas: Record<ChaveDaEtapa, { medidos: number; mediana: number | null }>;
  /** Com prazo medido e, destes, os que saíram depois do prazo. */
  medidosNoPrazo: number;
  estourados: number;
};

/** As etapas por tipo de venda (quanto cada tipo demora em cada etapa). */
export type LinhaDoTipo = Omit<LinhaDoDia, "dia" | "diaSemana"> & { tipo: TipoDeVenda };

export type NoDaProducao = Estatistica & {
  chave: string;
  nome: string;
  tipo: "categoria" | "produto";
  /** Unidades (a linha "3 esfihas" é uma medição e 3 unidades). */
  quantidade: number;
  filhos?: NoDaProducao[];
};

export type ResumoDaProducao = Estatistica & {
  quantidade: number;
  /** Itens de pedido medido que a cozinha não deu por pronto (bebida só na finalização, por exemplo). */
  semPronto: number;
  /** Pronto fora de ordem, a mais de 4 h, ou de pedido cuja cozinha ficou fora da curva. */
  foraDaCurva: number;
  categorias: NoDaProducao[];
  /** Por hora do dia em que o pedido entrou na cozinha, na ordem do expediente (5h → 4h). */
  porHora: HoraDaProducao[];
};

/**
 * Um pedido na produção: da entrada na cozinha até o ÚLTIMO item dele ficar
 * pronto — é quanto a cozinha levou com ele. Com filtro de categoria/produto,
 * só os itens do filtro contam.
 */
export type PedidoDaProducao = {
  id: string;
  numero: number | null;
  referencia: string | null;
  canal: string;
  tipo: TipoDeVenda;
  dia: string;
  /** Hora em que entrou na cozinha ("20:45"). */
  entrada: string;
  minutos: number;
  itens: { nome: string; quantidade: number; escolhas: string; minutos: number }[];
};

/**
 * A hora do expediente, como a Saipos mostrava para a NIK: a média dos
 * pedidos, o mais rápido e o mais demorado — e quais foram, para abrir e ver o
 * sabor e o horário. A estatística por ITEM (mediana, máximo) continua na
 * planilha e na tabela por produto.
 */
export type HoraDaProducao = { hora: number; quantidade: number } & Estatistica & {
  /** Pedidos medidos na hora e a média/mediana do tempo DO PEDIDO. */
  pedidos: number;
  mediaDoPedido: number | null;
  medianaDoPedido: number | null;
  maisRapido: PedidoDaProducao | null;
  maisDemorado: PedidoDaProducao | null;
  /** Os pedidos da hora, o mais demorado primeiro (até LIMITE_DE_PEDIDOS_POR_HORA). */
  lista: PedidoDaProducao[];
};

/** Quantos pedidos cada hora leva para a tela (a planilha não leva a lista: tem a aba Pedidos). */
export const LIMITE_DE_PEDIDOS_POR_HORA = 40;

export type ResultadoDosTempos = {
  /** Pedidos considerados (sem cancelado; com o filtro de categoria/produto). */
  pedidos: number;
  agendados: number;
  etapas: ResumoDaEtapa[];
  prazo: ResumoDoPrazo;
  prazoDosAgendados: ResumoDoPrazo;
  porDia: LinhaDoDia[];
  porTipo: LinhaDoTipo[];
  lista: LinhaDoPedido[];
  /** Quantas linhas a lista teria sem o limite. */
  totalDaLista: number;
  listaCortada: boolean;
  producao: ResumoDaProducao;
};

// ── CONTAS PEQUENAS ─────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10;

function ms(x: Instante): number | null {
  if (!x) return null;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Mínimo, mediana, média, "9 em cada 10 em até" (percentil 90) e máximo, com 1 casa. */
export function estatistica(valores: number[]): Estatistica {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { medidos: 0, minimo: null, mediana: null, media: null, p90: null, maximo: null };
  const mediana = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  // Percentil pela posição (nearest-rank): o tempo em que 90% dos pedidos
  // ficaram — o número que o lojista pode prometer sem mentir.
  const p90 = v[Math.max(0, Math.ceil(0.9 * n) - 1)];
  return {
    medidos: n,
    minimo: r1(v[0]),
    mediana: r1(mediana),
    media: r1(v.reduce((s, x) => s + x, 0) / n),
    p90: r1(p90),
    maximo: r1(v[n - 1]),
  };
}

/** "12 min", "8,5 min", "1h05". Para a tela e a planilha. */
export function fmtMin(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "—";
  const negativo = min < 0;
  const a = Math.abs(min);
  if (a < 60) return `${negativo ? "−" : ""}${a.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
  const total = Math.round(a);
  return `${negativo ? "−" : ""}${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

/** Medida entre dois carimbos: falta um = sem carimbo; negativo ou acima do teto = fora da curva. */
function medir(de: Instante, ate: Instante, teto = TETO_DE_MINUTOS_MEDIDOS): MedidaDaEtapa {
  if (ms(de) === null || ms(ate) === null) return { aplica: true, minutos: null, motivo: "semCarimbo" };
  const m = minutosEntre(de, ate);
  if (m === null || m > teto) return { aplica: true, minutos: null, motivo: "foraDaCurva" };
  return { aplica: true, minutos: m };
}

const NAO_SE_APLICA: MedidaDaEtapa = { aplica: false };

/** A medida que termina no "entregue": se ele foi dado em lote, não é a hora da entrega. */
function medidaDoEntregue(m: MedidaDaEtapa, p: Pick<PedidoParaTempos, "entregueEmLote">): MedidaDaEtapa {
  return m.aplica && m.minutos !== null && p.entregueEmLote ? { aplica: true, minutos: null, motivo: "emLote" } : m;
}

/** Um registro com uma entrada por etapa. */
function porEtapa<T>(f: (k: ChaveDaEtapa) => T): Record<ChaveDaEtapa, T> {
  return Object.fromEntries(ETAPAS.map((e) => [e.chave, f(e.chave)])) as Record<ChaveDaEtapa, T>;
}

// ── O "ENTREGUE" EM LOTE ────────────────────────────────────────────────────

/** Uma entrega com o "entregue" marcado, para achar os lotes. */
export type EntregueParaLote = { id: string; loja?: string | null; entregueEm: Instante };

/**
 * Os pedidos cujo "entregue" foi dado em LOTE (ver o topo): o mesmo instante,
 * até o milésimo, em mais de uma entrega da loja (um updateMany: o fechamento
 * do caixa), ou ENTREGUES_PARA_LOTE entregas da mesma loja marcadas dentro de
 * JANELA_DO_LOTE_S segundos (a baixa em massa no painel). Passe só ENTREGAS —
 * a mesa fechada não faz lote com o motoboy — e todas as da loja, não só as do
 * filtro.
 */
export function entreguesEmLote(entregas: EntregueParaLote[]): Set<string> {
  const porLoja = new Map<string, { id: string; t: number }[]>();
  for (const e of entregas) {
    const t = ms(e.entregueEm);
    if (t === null) continue;
    const loja = String(e.loja ?? "");
    let lista = porLoja.get(loja);
    if (!lista) { lista = []; porLoja.set(loja, lista); }
    lista.push({ id: e.id, t });
  }
  const lote = new Set<string>();
  const janela = JANELA_DO_LOTE_S * 1000;
  for (const lista of porLoja.values()) {
    lista.sort((a, b) => a.t - b.t);
    for (let i = 0; i < lista.length; i++) {
      // O mesmo instante em dois pedidos: gravados juntos.
      if ((i > 0 && lista[i - 1].t === lista[i].t) || (i + 1 < lista.length && lista[i + 1].t === lista[i].t)) lote.add(lista[i].id);
    }
    // Janela deslizante: toda janela de 90 s com 3 ou mais marca todos os dela.
    for (let ini = 0, fim = 0; ini < lista.length; ini++) {
      if (fim < ini) fim = ini;
      while (fim + 1 < lista.length && lista[fim + 1].t - lista[ini].t <= janela) fim++;
      if (fim - ini + 1 >= ENTREGUES_PARA_LOTE) for (let k = ini; k <= fim; k++) lote.add(lista[k].id);
    }
  }
  return lote;
}

// ── UM PEDIDO ───────────────────────────────────────────────────────────────

/**
 * A loja aceita sozinha o pedido deste canal na chegada? Só nos canais em que
 * o FireHub grava ACEITO pela coluna da loja, e só depois que a coluna passou
 * a valer (ver o topo). A coluna é a de HOJE: a loja que desligou o aceite
 * automático no meio do período tem os pedidos de antes contados pela regra
 * de hoje — não há histórico dela.
 */
export function aceitoNaChegada(canal: string, criadoEm: Instante, lojaAceitaSozinha: boolean): boolean {
  const c = ms(criadoEm);
  return lojaAceitaSozinha && CANAIS_ACEITOS_NA_CHEGADA.has(canal) && c !== null && c >= Date.parse(ACEITE_AUTOMATICO_DESDE);
}

/** Balcão, mesa e o que a loja aceita sozinha nascem ACEITO: não esperam aceite. */
function nasceAceito(p: PedidoParaTempos): boolean {
  return p.tipo === "MESA" || p.tipo === "BALCAO" || p.canal === "PDV" || p.canal === "MESA" || p.aceitoPelaLoja === true;
}

/**
 * A hora do pronto. Na entrega, o pronto da cozinha (painel ou KDS). Fora da
 * entrega, SAIU_ENTREGA também é pronto: é o status que o KDS grava na
 * retirada ao finalizar ("Pronto" para o cliente buscar, api/kds finish_order).
 */
function horaDoPronto(p: PedidoParaTempos): Instante {
  const daCozinha = p.readyAt || p.kdsFinishedAt;
  if (p.tipo === "DELIVERY") return daCozinha || null;
  return daCozinha || p.dispatchedAt || null;
}

/** A primeira baixa da cozinha: o primeiro item pronto, a finalização, o pronto, a saída. */
function primeiraBaixa(p: PedidoParaTempos): number | null {
  const tempos = [
    ...p.itens.map((i) => ms(i.prontoEm)),
    ms(p.kdsFinishingAt), ms(p.kdsFinishedAt), ms(p.readyAt), ms(p.dispatchedAt), ms(p.deliveredAt),
  ].filter((t): t is number => t !== null);
  return tempos.length ? Math.min(...tempos) : null;
}

// ── ATÉ ONDE O ITEM É MEDIDO ────────────────────────────────────────────────

const normal = (s: unknown) => String(s ?? "").toLowerCase().trim();

/**
 * A tela mostra o item, pela categoria — a régua de `telaMostraItem`
 * (lib/kds-telas.ts) menos o curinga do item sem categoria: aqui é conta, e o
 * sem categoria não pode ganhar o tempo de toda tela.
 */
function telaMostraPelaCategoria(categorias: string[], item: ItemParaTempos): boolean {
  const filtros = categorias.map(normal).filter(Boolean);
  if (filtros.length === 0) return true;
  return filtros.includes(normal(item.categoria));
}

/** A última baixa da lista (pela hora), ou null. */
function ultimaBaixa(baixas: BaixaParaTempos[]): BaixaParaTempos | null {
  let ultima: BaixaParaTempos | null = null;
  for (const b of baixas) if (ms(b.em) !== null && (!ultima || ms(b.em)! > ms(ultima.em)!)) ultima = b;
  return ultima;
}

/**
 * Até que hora o item é medido na produção por produto, no modo escolhido.
 * null = sem carimbo (o item não passou por ali, ou a hora não existe).
 *
 * As baixas com hora (`CustomerOrder.kdsBaixas`) existem desde 09/10/2026.
 * Antes delas, o que dá para saber: o pronto do item (a produção) e a hora em
 * que o pedido foi finalizado (a finalização do pedido inteiro). Para uma tela
 * de finalização específica, só quando ela foi a única a dar baixa no pedido —
 * aí a finalização do pedido é a dela; com duas telas, não se sabe qual foi a
 * última, e o item fica sem medição em vez de ganhar a hora da outra.
 */
export function prontoDoItem(p: PedidoParaTempos, item: ItemParaTempos, modo: MedirAte | undefined): Instante {
  if (!modo || modo.tipo === "producao") return item.prontoEm;
  const baixas = (p.baixas || []).filter((b) => ms(b.em) !== null);

  if (modo.tipo === "finalizacao") {
    const daFinalizacao = baixas.filter((b) => b.estagio === "finishing");
    // Sem baixa de finalização registrada, a finalização é a do pedido: o
    // pedido de antes do registro, ou o que o painel deu por pronto.
    if (daFinalizacao.length === 0) return horaDoPronto(p);
    // A tela de finalização que mostrava o item; o que nenhuma listou (a
    // bebida, o acompanhamento) fica pronto com a última delas.
    const minhas = item.id ? daFinalizacao.filter((b) => b.itens.includes(item.id!)) : [];
    return (ultimaBaixa(minhas) || ultimaBaixa(daFinalizacao))!.em;
  }

  // Uma tela só.
  const desta = baixas.filter((b) => b.tela === modo.chave && b.estagio === modo.estagio);
  if (desta.length) {
    const b = ultimaBaixa(desta)!;
    return item.id && b.itens.includes(item.id) ? b.em : null;
  }
  // O pedido tem o registro e esta tela não está nele: ela não deu baixa.
  if (baixas.length) return null;
  // Antes do registro (ver acima): o pronto do item vale para a tela de
  // produção que mostra a categoria dele; a finalização do pedido vale para a
  // tela de finalização só quando ela foi a única a dar baixa.
  if (!telaMostraPelaCategoria(modo.categorias, item)) return null;
  if (modo.estagio === "production") return item.prontoEm;
  const prontas = p.telasProntas || [];
  return prontas.length === 1 && prontas[0] === modo.chave ? horaDoPronto(p) : null;
}

/** Para a tela e a planilha: "… até o pronto da produção / a finalização / a baixa da tela «Forno»". */
export function rotuloDoMedirAte(m: MedirAte | undefined): string {
  if (!m || m.tipo === "producao") return "o pronto da produção";
  if (m.tipo === "finalizacao") return "a finalização do pedido (o percurso completo)";
  return `a baixa da tela «${m.nome}»`;
}

/** Agendamento de verdade: a hora prometida está mais de 3 h depois do pedido. */
export function ehAgendado(p: Pick<PedidoParaTempos, "createdAt" | "scheduledDatetime">): boolean {
  const c = ms(p.createdAt), s = ms(p.scheduledDatetime);
  return c !== null && s !== null && s - c > AGENDAMENTO_DE_VERDADE_MIN * 60000;
}

/**
 * O cartão do painel trata o pedido como retirada (prazo de 40 min)? Cópia de
 * `isTakeoutOrder` (StoreOrdersDashboard): o tipo gravado, não o tipo de venda
 * do relatório. O balcão grava RETIRADA e o totem TAKEOUT, então caem aqui; o
 * PICKUP do site não cai, e o cartão dá 45 min a ele (ver o topo).
 */
export function retiradaNoCartao(p: Pick<PedidoParaTempos, "deliveryType" | "notes">): boolean {
  const tipo = String(p.deliveryType || "");
  return tipo === "RETIRADA" || tipo === "TAKEOUT" || tipo.toUpperCase().includes("RETIRADA")
    || /^\s*RETIRADA\b|RETIRADA NO BALC/.test(String(p.notes || "").toUpperCase());
}

/** O prazo do pedido, em ms — a regra do cartão do painel. null = mesa (sem prazo). */
export function prazoDoPedido(p: Pick<PedidoParaTempos, "createdAt" | "scheduledDatetime" | "tipo" | "deliveryType" | "notes">): number | null {
  if (p.tipo === "MESA") return null;
  const c = ms(p.createdAt)!;
  const s = ms(p.scheduledDatetime);
  if (s !== null && s > c + PROMESSA_MINIMA_MIN * 60000) return s;
  return c + (retiradaNoCartao(p) ? PRAZO_PADRAO_RETIRADA_MIN : PRAZO_PADRAO_ENTREGA_MIN) * 60000;
}

/** As etapas de um pedido "para agora" (agendado não passa por aqui). */
export function etapasDoPedido(p: PedidoParaTempos): Record<ChaveDaEtapa, MedidaDaEtapa> {
  const entrega = p.tipo === "DELIVERY";
  const pronto = horaDoPronto(p);

  // Aceite: só o carimbo que veio mais de um minuto ANTES da primeira baixa
  // (ver o topo) — colado nela (na loja sem KDS, a saída) é regravação.
  let aceite: MedidaDaEtapa = NAO_SE_APLICA;
  if (!nasceAceito(p)) {
    const aceito = ms(p.acceptedAt);
    const baixa = primeiraBaixa(p);
    if (aceito === null) aceite = { aplica: true, minutos: null, motivo: "semCarimbo" };
    else if (baixa !== null && aceito > baixa - ACEITE_COLADO_NA_BAIXA_S * 1000) aceite = { aplica: true, minutos: null, motivo: "reescrito" };
    else aceite = medir(p.createdAt, p.acceptedAt);
  }

  const cozinha = medir(p.kdsProductionAt || p.createdAt, pronto);

  // As duas pernas da cozinha, só para quem passou pelo KDS com o pronto por
  // item: até o ÚLTIMO item ganhar o pronto da produção (a montagem) e, daí,
  // até a cozinha finalizar (o forno, a expedição). O pedido arrastado até
  // "pronto" no painel não tem essas pernas e não entra nelas.
  const prontos = p.itens.map((i) => ms(i.prontoEm)).filter((t): t is number => t !== null);
  const ultimoDaProducao = prontos.length ? new Date(Math.max(...prontos)) : null;
  const passouPeloKds = prontos.length > 0 || ms(p.kdsFinishedAt) !== null;
  const producao = passouPeloKds ? medir(p.kdsProductionAt || p.createdAt, ultimoDaProducao) : NAO_SE_APLICA;
  const finalizacao = passouPeloKds ? medir(ultimoDaProducao, pronto) : NAO_SE_APLICA;

  const esperandoSaida = entrega ? medir(p.readyAt || p.kdsFinishedAt, p.dispatchedAt) : NAO_SE_APLICA;
  // O "entregue" dado em lote não é a hora da entrega (ver o topo).
  const rua = entrega ? medidaDoEntregue(medir(p.dispatchedAt, p.deliveredAt, TETO_DA_RUA_MIN), p) : NAO_SE_APLICA;

  // Total da entrega: se a perna da rua é o pedido encerrado horas depois, o
  // total herda o mesmo lixo — fora da curva também. E o lote, como na rua.
  let totalEntrega: MedidaDaEtapa = NAO_SE_APLICA;
  if (entrega) {
    if (rua.aplica && rua.minutos === null && (rua as { motivo: MotivoDeFora }).motivo === "foraDaCurva") {
      totalEntrega = { aplica: true, minutos: null, motivo: "foraDaCurva" };
    } else totalEntrega = medidaDoEntregue(medir(p.createdAt, p.deliveredAt), p);
  }
  const totalNaLoja = entrega ? NAO_SE_APLICA : medir(p.createdAt, pronto);

  return { aceite, cozinha, producao, finalizacao, esperandoSaida, rua, totalEntrega, totalNaLoja };
}

/** Como o pedido ficou diante do prazo (`faixaDoPrazo`). */
export type SituacaoNoPrazo = {
  faixa: FaixaDoPrazo;
  prazo: number | null;
  /** A saída do motoboy (entrega) ou o pronto (os outros), como foi gravada. */
  saida: number | null;
  /** A saída cai a uma distância plausível do pedido (não é o "finalizado" dias depois). */
  saidaPlausivel: boolean;
  /** Entrega: a hora de entregue confiável — é ela que cumpre o prazo. */
  entregue: number | null;
  /** Quanto passou do prazo (> 0) ou sobrou (< 0); em "saiu depois do prazo", quanto já tinha passado na saída. */
  excedeu: number | null;
  /** Entrega com saída plausível: saiu da loja depois do prazo do cliente? null = sem saída. */
  saiuDepoisDoPrazo: boolean | null;
  /** Entrega sem hora de entregue confiável: por quê. */
  semEntregaPor: "semCarimbo" | "emLote" | "foraDaCurva" | null;
};

/**
 * O instante está a uma distância plausível do pedido? O pedido "pronto" ou
 * "entregue" dias depois foi finalizado no painel depois: o mesmo teto das
 * etapas. No agendado a régua é a distância ao horário marcado.
 */
function plausivelNoPrazo(p: PedidoParaTempos, t: number, prazo: number): boolean {
  const agendado = ehAgendado(p);
  const distancia = (t - (agendado ? prazo : ms(p.createdAt)!)) / 60000;
  return !((!agendado && distancia < 0) || Math.abs(distancia) > TETO_DE_MINUTOS_MEDIDOS);
}

/**
 * A hora em que o cliente recebeu, quando dá para confiar nela — a mesma
 * régua de "na rua" e do "total da entrega": existe, a rua fica entre 0 e 2 h,
 * não é a conclusão horas depois e não foi dada em lote.
 */
function chegadaConfiavel(p: PedidoParaTempos, prazo: number): { em: number } | { motivo: "semCarimbo" | "emLote" | "foraDaCurva" } {
  const entregue = ms(p.deliveredAt);
  if (entregue === null) return { motivo: "semCarimbo" };
  const saida = ms(p.dispatchedAt);
  if (saida !== null && (entregue < saida || entregue - saida > TETO_DA_RUA_MIN * 60000)) return { motivo: "foraDaCurva" };
  if (!plausivelNoPrazo(p, entregue, prazo)) return { motivo: "foraDaCurva" };
  if (p.entregueEmLote) return { motivo: "emLote" };
  return { em: entregue };
}

/** A faixa pela folga que sobrava quando o prazo foi cumprido, com os alertas do lojista. */
function faixaDaFolga(prazo: number, quando: number, limites: LimitesDeAlerta): { faixa: FaixaDoPrazo; excedeu: number } {
  const folga = (prazo - quando) / 60000;
  const excedeu = r1(-folga);
  // Como o cartão: os minutos restantes arredondados para baixo. Com 5 min
  // 40 s de folga ele mostra "5 min restantes" e já pinta o vermelho de 5;
  // comparar a folga com fração dava amarelo aqui e vermelho lá.
  const restantes = Math.floor(folga);
  if (restantes < 0) return { faixa: "estourado", excedeu };
  if (limites.vermelhoAtivo && restantes <= limites.vermelhoMin) return { faixa: "vermelho", excedeu };
  if (limites.amareloAtivo && restantes <= limites.amareloMin) return { faixa: "amarelo", excedeu };
  return { faixa: "noPrazo", excedeu };
}

/**
 * Onde o pedido ficou em relação ao prazo do CLIENTE (ver o topo): na entrega,
 * a hora de entregue confiável; na retirada, no balcão e no totem, o pronto.
 */
export function faixaDoPrazo(p: PedidoParaTempos, limites: LimitesDeAlerta): SituacaoNoPrazo {
  const prazo = prazoDoPedido(p);
  const vazio = { saida: null, saidaPlausivel: false, entregue: null, excedeu: null, saiuDepoisDoPrazo: null, semEntregaPor: null };
  if (prazo === null) return { ...vazio, faixa: "semPrazo", prazo: null };

  if (p.tipo !== "DELIVERY") {
    const pronto = ms(horaDoPronto(p));
    if (pronto === null) return { ...vazio, faixa: "semCarimbo", prazo };
    if (!plausivelNoPrazo(p, pronto, prazo)) return { ...vazio, faixa: "foraDaCurva", prazo, saida: pronto };
    return { ...vazio, ...faixaDaFolga(prazo, pronto, limites), prazo, saida: pronto, saidaPlausivel: true };
  }

  // A entrega cumpre o prazo na CHEGADA. A saída fica à vista: sair depois do
  // prazo é atraso certo, com ou sem a hora de entregue.
  const saida = ms(p.dispatchedAt);
  const saidaPlausivel = saida !== null && plausivelNoPrazo(p, saida, prazo);
  const saiuDepoisDoPrazo = saidaPlausivel ? saida! > prazo : null;
  const base = { prazo, saida, saidaPlausivel, saiuDepoisDoPrazo };
  const chegada = chegadaConfiavel(p, prazo);
  if ("em" in chegada) {
    return { ...base, ...faixaDaFolga(prazo, chegada.em, limites), entregue: chegada.em, semEntregaPor: null };
  }
  if (saiuDepoisDoPrazo) {
    return { ...base, faixa: "saiuAtrasado", entregue: null, excedeu: r1((saida! - prazo) / 60000), semEntregaPor: chegada.motivo };
  }
  return { ...base, faixa: "semEntrega", entregue: null, excedeu: null, semEntregaPor: chegada.motivo };
}

// ── O RELATÓRIO ─────────────────────────────────────────────────────────────

function resumoDoPrazo(limites: LimitesDeAlerta, faixas: SituacaoNoPrazo[]): ResumoDoPrazo {
  const conta = (f: FaixaDoPrazo) => faixas.filter((x) => x.faixa === f).length;
  const atrasos = faixas.filter((x) => x.faixa === "estourado").map((x) => x.excedeu!);
  const est = estatistica(atrasos);
  const semPrazo = conta("semPrazo");
  const noPrazo = conta("noPrazo"), amarelo = conta("amarelo"), vermelho = conta("vermelho"), estourados = conta("estourado");
  // A entrega sem hora de entregue confiável — com a que saiu atrasada, que
  // também não tem a chegada medida.
  const semEntrega = faixas.filter((x) => x.faixa === "semEntrega" || x.faixa === "saiuAtrasado");
  const porMotivo = (m: "semCarimbo" | "emLote" | "foraDaCurva") => semEntrega.filter((x) => x.semEntregaPor === m).length;
  const comSaida = faixas.filter((x) => x.saiuDepoisDoPrazo !== null);
  return {
    limites,
    comPrazo: faixas.length - semPrazo,
    medidos: noPrazo + amarelo + vermelho + estourados,
    noPrazo, amarelo, vermelho, estourados,
    semCarimbo: conta("semCarimbo"),
    foraDaCurva: conta("foraDaCurva"),
    semPrazo,
    semEntrega: semEntrega.length,
    semEntregaPorMotivo: { semCarimbo: porMotivo("semCarimbo"), emLote: porMotivo("emLote"), foraDaCurva: porMotivo("foraDaCurva") },
    saiuAtrasado: conta("saiuAtrasado"),
    saidaDasEntregas: { medidas: comSaida.length, depoisDoPrazo: comSaida.filter((x) => x.saiuDepoisDoPrazo).length },
    atrasoMediano: est.mediana,
    maiorAtraso: est.maximo,
  };
}

/** Todos os dias de "de" a "ate" (a tabela por dia mostra também o dia sem pedido). */
function diasDoPeriodo(de: string, ate: string): string[] {
  const saida: string[] = [];
  for (let d = de; d <= ate && saida.length < 500; d = somarDias(d, 1)) saida.push(d);
  return saida;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

/**
 * O relatório. `pedidos` já vêm filtrados por período, tipo, canal, marca e
 * horário (lib/relatorios/servidor.ts), sem cancelados — e, se algum vier,
 * fica de fora aqui também.
 */
export function temposDoRelatorio(pedidosBrutos: PedidoParaTempos[], cfg: ConfigDosTempos): ResultadoDosTempos {
  const categorias = cfg.categorias || new Set<string>();
  const produtos = cfg.produtos || new Set<string>();
  const comFiltroDeItem = categorias.size > 0 || produtos.size > 0;
  const itemPassa = (i: ItemParaTempos) =>
    (!categorias.size || categorias.has(i.categoria)) && (!produtos.size || (i.produtoId !== null && produtos.has(i.produtoId)));

  // O "entregue" em lote: a rota já marca cada pedido (calculado sobre todas
  // as entregas da loja); sem a marca, sai daqui, das entregas recebidas.
  const lote = pedidosBrutos.some((p) => p.entregueEmLote === undefined)
    ? entreguesEmLote(pedidosBrutos.filter((p) => p.tipo === "DELIVERY").map((p) => ({ id: p.id, loja: p.loja, entregueEm: p.deliveredAt })))
    : null;
  const pedidos = pedidosBrutos
    .filter((p) => !ehCancelado(p.status) && (!comFiltroDeItem || p.itens.some(itemPassa)))
    .map((p) => (p.entregueEmLote === undefined ? { ...p, entregueEmLote: lote!.has(p.id) } : p));

  const valores = porEtapa((): number[] => []);
  const naoMedidos = porEtapa((): Record<MotivoDeFora, number> => ({ semCarimbo: 0, foraDaCurva: 0, reescrito: 0, emLote: 0 }));
  const faixasParaAgora: SituacaoNoPrazo[] = [];
  const faixasAgendados: SituacaoNoPrazo[] = [];

  // O mesmo acumulador serve ao dia e ao tipo de venda.
  type AcumGrupo = { pedidos: number; etapas: Record<ChaveDaEtapa, number[]>; medidosNoPrazo: number; estourados: number; diaSemana: number };
  const novoGrupo = (diaSemana = 0): AcumGrupo => ({
    pedidos: 0, etapas: porEtapa((): number[] => []), medidosNoPrazo: 0, estourados: 0, diaSemana,
  });
  const porDia = new Map<string, AcumGrupo>();
  const porTipo = new Map<TipoDeVenda, AcumGrupo>();

  const linhas: LinhaDoPedido[] = [];

  // Produção por produto.
  type AcumProduto = { chave: string; nome: string; quantidade: number; valores: number[] };
  type AcumCategoria = { nome: string; quantidade: number; valores: number[]; produtos: Map<string, AcumProduto> };
  const porCategoria = new Map<string, AcumCategoria>();
  const porHora = new Map<number, { quantidade: number; valores: number[]; pedidos: PedidoDaProducao[] }>();
  const valoresDaProducao: number[] = [];
  let quantidadeProduzida = 0, semPronto = 0, producaoForaDaCurva = 0;

  let agendados = 0;

  for (const p of pedidos) {
    const criado = naLoja(p.createdAt, cfg.tz);
    const agendado = ehAgendado(p);
    const prazo = faixaDoPrazo(p, cfg.limites);
    const hhmm = `${String(criado.hora).padStart(2, "0")}:${String(criado.minutos % 60).padStart(2, "0")}`;

    let etapas: Record<ChaveDaEtapa, MedidaDaEtapa>;
    if (agendado) {
      agendados++;
      faixasAgendados.push(prazo);
      // O agendado não entra nas etapas: espera horas de propósito. Na lista
      // ficam só as pernas que não começam na criação (saída e rua).
      const todas = etapasDoPedido(p);
      etapas = porEtapa((k) => (k === "esperandoSaida" || k === "rua" ? todas[k] : NAO_SE_APLICA));
    } else {
      etapas = etapasDoPedido(p);
      faixasParaAgora.push(prazo);
      let dia = porDia.get(criado.dia);
      if (!dia) { dia = novoGrupo(criado.diaSemana); porDia.set(criado.dia, dia); }
      let doTipo = porTipo.get(p.tipo);
      if (!doTipo) { doTipo = novoGrupo(); porTipo.set(p.tipo, doTipo); }
      for (const g of [dia, doTipo]) {
        g.pedidos++;
        if (prazo.faixa === "estourado") g.estourados++;
        if (["noPrazo", "amarelo", "vermelho", "estourado"].includes(prazo.faixa)) g.medidosNoPrazo++;
      }
      for (const e of ETAPAS) {
        const m = etapas[e.chave];
        if (!m.aplica) continue;
        if (m.minutos !== null) {
          valores[e.chave].push(m.minutos);
          dia.etapas[e.chave].push(m.minutos);
          doTipo.etapas[e.chave].push(m.minutos);
        } else naoMedidos[e.chave][(m as { motivo: MotivoDeFora }).motivo]++;
      }

      // ── Produção por item ──
      // Do mesmo ponto de partida da etapa "na cozinha": o relógio do KDS.
      //
      // Pedido cuja cozinha ficou FORA DA CURVA teve a tela do KDS largada e
      // limpa horas depois, e o pronto dos itens dele é dessa faxina, não do
      // preparo. Caso real: NIK, mesa #14 de 22/09/2026 — a Coca Zero lata
      // ganhou pronto 144 min depois do lançamento e o pedido, 23 h depois;
      // com ela, o "mais demorado" era 2h24 e as Bebidas tinham média de
      // 25,5 min. Na base inteira (até 24/09), todo item acima de 50 min é de
      // pedido assim. O custo: o item que o cozinheiro baixou na hora, num
      // pedido que só foi finalizado no dia seguinte, também sai (4 dos 512).
      const cozinhaLargada = etapas.cozinha.aplica && etapas.cozinha.minutos === null
        && (etapas.cozinha as { motivo: MotivoDeFora }).motivo === "foraDaCurva";
      const entrada = p.kdsProductionAt || p.createdAt;
      const naCozinha = naLoja(entrada, cfg.tz);
      const horaDaEntrada = naCozinha.hora;
      const itensMedidos: PedidoDaProducao["itens"] = [];
      for (const item of p.itens) {
        if (comFiltroDeItem && !itemPassa(item)) continue;
        // Até onde o item é medido: o pronto da produção, a finalização ou a
        // baixa de uma tela (ver `prontoDoItem`).
        const pronto = prontoDoItem(p, item, cfg.medirAte);
        if (!ms(pronto)) { semPronto++; continue; }
        const m = cozinhaLargada ? null : minutosEntre(entrada, pronto);
        if (m === null) { producaoForaDaCurva++; continue; }
        const qtd = Number(item.quantidade) || 0;
        valoresDaProducao.push(m);
        quantidadeProduzida += qtd;
        let cat = porCategoria.get(item.categoria);
        if (!cat) { cat = { nome: item.categoria, quantidade: 0, valores: [], produtos: new Map() }; porCategoria.set(item.categoria, cat); }
        cat.quantidade += qtd;
        cat.valores.push(m);
        let prod = cat.produtos.get(item.chave);
        if (!prod) { prod = { chave: item.chave, nome: item.nome, quantidade: 0, valores: [] }; cat.produtos.set(item.chave, prod); }
        prod.quantidade += qtd;
        prod.valores.push(m);
        let h = porHora.get(horaDaEntrada);
        if (!h) { h = { quantidade: 0, valores: [], pedidos: [] }; porHora.set(horaDaEntrada, h); }
        h.quantidade += qtd;
        h.valores.push(m);
        itensMedidos.push({ nome: item.nome, quantidade: qtd, escolhas: item.escolhas || "", minutos: r1(m) });
      }
      if (itensMedidos.length) {
        porHora.get(horaDaEntrada)!.pedidos.push({
          id: p.id, numero: p.numero, referencia: p.referencia, canal: p.canal, tipo: p.tipo,
          dia: criado.dia,
          entrada: `${String(naCozinha.hora).padStart(2, "0")}:${String(naCozinha.minutos % 60).padStart(2, "0")}`,
          minutos: Math.max(...itensMedidos.map((i) => i.minutos)),
          itens: itensMedidos.sort((a, b) => b.minutos - a.minutos),
        });
      }
    }

    const minutos = (m: MedidaDaEtapa) => (m.aplica && m.minutos !== null ? r1(m.minutos) : null);
    const c = ms(p.createdAt)!;
    linhas.push({
      id: p.id,
      numero: p.numero,
      referencia: p.referencia,
      canal: p.canal,
      tipo: p.tipo,
      dia: criado.dia,
      hora: hhmm,
      criadoEm: new Date(c).toISOString(),
      agendado,
      prazo: iso(prazo.prazo),
      saida: iso(prazo.saida),
      entregue: iso(prazo.entregue),
      tempoAteSaida: !agendado && prazo.saida !== null && prazo.saidaPlausivel ? r1((prazo.saida - c) / 60000) : null,
      excedeu: prazo.excedeu,
      faixa: prazo.faixa,
      etapas: porEtapa((k) => minutos(etapas[k])),
    });
  }

  // ── Resumos ──
  const etapas: ResumoDaEtapa[] = ETAPAS.map((e) => {
    const n = naoMedidos[e.chave];
    const est = estatistica(valores[e.chave]);
    return {
      ...e, ...est,
      elegiveis: est.medidos + n.semCarimbo + n.foraDaCurva + n.reescrito + n.emLote,
      semCarimbo: n.semCarimbo, foraDaCurva: n.foraDaCurva, reescritos: n.reescrito, emLote: n.emLote,
    };
  });

  const dias = cfg.periodo ? diasDoPeriodo(cfg.periodo.de, cfg.periodo.ate) : [];
  for (const d of porDia.keys()) if (!dias.includes(d)) dias.push(d);
  dias.sort();
  const medianas = (a: AcumGrupo): LinhaDoDia["etapas"] =>
    porEtapa((k) => { const s = estatistica(a.etapas[k]); return { medidos: s.medidos, mediana: s.mediana }; });
  const tabelaPorDia: LinhaDoDia[] = dias.map((d) => {
    const a = porDia.get(d) || novoGrupo(new Date(`${d}T12:00:00Z`).getUTCDay());
    return { dia: d, diaSemana: a.diaSemana, pedidos: a.pedidos, etapas: medianas(a), medidosNoPrazo: a.medidosNoPrazo, estourados: a.estourados };
  });
  const tabelaPorTipo: LinhaDoTipo[] = TIPOS_DE_VENDA.filter((t) => porTipo.has(t)).map((t) => {
    const a = porTipo.get(t)!;
    return { tipo: t, pedidos: a.pedidos, etapas: medianas(a), medidosNoPrazo: a.medidosNoPrazo, estourados: a.estourados };
  });

  // ── A lista ──
  // Só atrasados: o pior primeiro. Todos: na ordem em que chegaram. A entrega
  // que saiu da loja depois do prazo atrasou com certeza, mesmo sem a hora de
  // entregue: entra na lista (com o quanto já tinha passado na saída).
  const atrasado = (l: LinhaDoPedido) => l.faixa === "estourado" || l.faixa === "saiuAtrasado";
  const filtrada = cfg.apenasAtrasados ? linhas.filter(atrasado) : linhas;
  const ordenada = cfg.apenasAtrasados
    ? [...filtrada].sort((a, b) => (b.excedeu ?? 0) - (a.excedeu ?? 0) || a.criadoEm.localeCompare(b.criadoEm))
    : [...filtrada].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const limite = cfg.limiteDaLista ?? 1000;

  // ── Produção ──
  const nosDeCategoria: NoDaProducao[] = [...porCategoria.entries()]
    .map(([chave, cat]) => ({
      chave: `c:${chave}`, nome: cat.nome, tipo: "categoria" as const, quantidade: cat.quantidade, ...estatistica(cat.valores),
      filhos: [...cat.produtos.values()]
        .map((pr) => ({ chave: `p:${pr.chave}`, nome: pr.nome, tipo: "produto" as const, quantidade: pr.quantidade, ...estatistica(pr.valores) }))
        .sort((a, b) => b.quantidade - a.quantidade || b.medidos - a.medidos || a.nome.localeCompare(b.nome, "pt-BR")),
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
  // Na ordem do expediente: das 5h (a virada do dia) às 4h da manhã seguinte.
  const ordemDaHora = (h: number) => (h - 5 + 24) % 24;
  const horas = [...porHora.entries()]
    .sort(([a], [b]) => ordemDaHora(a) - ordemDaHora(b))
    .map(([hora, h]): HoraDaProducao => {
      // O mais demorado primeiro; no empate, o que chegou antes.
      const ordem = [...h.pedidos].sort((a, b) => b.minutos - a.minutos || a.dia.localeCompare(b.dia) || a.entrada.localeCompare(b.entrada));
      const doPedido = estatistica(ordem.map((x) => x.minutos));
      return {
        hora, quantidade: h.quantidade, ...estatistica(h.valores),
        pedidos: ordem.length,
        mediaDoPedido: doPedido.media,
        medianaDoPedido: doPedido.mediana,
        maisDemorado: ordem[0] ?? null,
        maisRapido: ordem[ordem.length - 1] ?? null,
        lista: ordem.slice(0, cfg.limitePorHora ?? LIMITE_DE_PEDIDOS_POR_HORA),
      };
    });

  return {
    pedidos: pedidos.length,
    agendados,
    etapas,
    prazo: resumoDoPrazo(cfg.limites, faixasParaAgora),
    prazoDosAgendados: resumoDoPrazo(cfg.limites, faixasAgendados),
    porDia: tabelaPorDia,
    porTipo: tabelaPorTipo,
    lista: ordenada.slice(0, limite),
    totalDaLista: ordenada.length,
    listaCortada: ordenada.length > limite,
    producao: {
      ...estatistica(valoresDaProducao),
      quantidade: quantidadeProduzida,
      semPronto,
      foraDaCurva: producaoForaDaCurva,
      categorias: nosDeCategoria,
      porHora: horas,
    },
  };
}

/** O período começa antes de o dado existir? (para o aviso na tela e na planilha) */
export function antesDoDado(de: string, desde: string): boolean {
  return de < desde;
}
