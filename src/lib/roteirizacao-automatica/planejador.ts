/**
 * Rota 100% automatizada — o PLANEJADOR: olha a foto da loja e diz o que fazer.
 *
 * Puro de propósito: sem banco, sem rede, sem relógio (o `agora` vem na
 * entrada). Quem lê o banco e grava é lib/roteirizacao-automatica/executar.ts;
 * o teste é scripts/teste-roteirizacao-automatica.ts. Mesma entrada → mesma
 * saída, em qualquer ordem que a entrada chegue (tudo é ordenado aqui dentro).
 *
 * ── A heurística é a do botão "Auto-Agrupar" ───────────────────────────────
 *
 * O Douglas já testou o agrupador do navegador (RoteirizacaoModal.tsx,
 * `handleAutoClusterRoutes` + `optimizeRouteSequence`). Ela só muda de lugar
 * (D6 do plano, vault "FireHub - Plano despacho automático"):
 *   - semente = o pedido em que a loja pediu prioridade à mão e, sem nenhum, o
 *     de MENOR PRAZO (no navegador era o mais velho);
 *   - candidato entra se está a até `raioDoGrupoKm` de QUALQUER parada da
 *     rota OU "no caminho" de qualquer parada (desvio ≤ o próprio raio — era
 *     min(1,8; max(1; raio × 0,75)) até 22/10/2026, ver `desvioMaximo` — e
 *     não mais longe da loja que a parada + 1 km); nota = desvio ×
 *     0,6 + distância × 0,4, a melhor entre as paradas (menor primeiro);
 *   - e, novidade daqui, o prazo do candidato cabe na janela: até
 *     `janelaDePrazoMin` de diferença do prazo da SEMENTE (ver `encaixeNaRota`);
 *   - a rota cresce um a um até `maxEntregasPorRota`: quem entrou já serve de
 *     parada para o próximo. Douglas, 22/10/2026 21h15 (Rota da Hakim: #34
 *     perto da loja, #33 na Maria Turri): "o #35 fica no caminho do #33" — e
 *     ficava de fora porque só se comparava com a semente (o #34);
 *   - ordem das paradas = MENOR PERCURSO TOTAL saindo da loja, sem volta
 *     (`ordemDeMenorPercurso`, força bruta até 6 paradas), em linha reta. É a
 *     ordem que a PRÉVIA mostra; ao gravar, executar.ts a refaz pela rua
 *     (ordem-por-rua.ts, `rotaEntre`) e volta a esta quando a rua não
 *     responde. O vizinho mais próximo, guloso, gravou 34 → 33 → 35 na Rota
 *     #11 (22/10, 21h20): do 34 foi ao 33 e teve de voltar ao 35.
 *
 * ── A distância: pela RUA quando há medida, linha reta quando não ─────────
 *
 * Douglas, 22/10/2026 21h15: "o pedido 34 não dá para ir com o 26 — tem um
 * rio, um valão, o motoboy não passa; tem que subir para a pista". Em linha
 * reta os dois estavam a menos de 2 km. Por isso o raio, o desvio e a nota
 * usam km de RUA (`pelaRua` na entrada): uma reta de 1,5 km que dá 4 km de
 * rua não junta. A tabela vem pronta de fora (executar.ts mede pelo
 * `rotaEntre`, com cache de 60 dias e teto de tempo por ciclo) — o planejador
 * continua puro, sem rede. Par sem medida cai em `distanciaKm` (linha reta,
 * lib/ponto-do-pedido.ts — o Haversine de `linhaRetaKm`, num arquivo sem
 * banco), e o "no caminho" nunca mistura as duas réguas: as três pernas
 * (loja→candidato, candidato→parada, loja→parada) são todas de rua, ou todas
 * de reta (par medido pela rua sem as pernas da loja: só o "perto" vale).
 * Sem tabela (testes antigos, roteador fora), é a linha reta de antes.
 *
 * ── A ordem de um ciclo (§4.4) ─────────────────────────────────────────────
 *   1. limpar: pedido cancelado sai da rota; rota que ficou vazia é apagada;
 *   2. chamar (D9/D10): rota com tudo pronto, ou cujo pedido mais urgente
 *      está pronto há `esperaMaxMin` (os não prontos saem e voltam ao bolo);
 *      chamada há mais de 60 min sem ninguém puxar é chamada de novo (D13).
 *      Com `quemPuxa: "qualquer"` a chamada é sempre para todos os livres
 *      (D11) — quem escanear primeiro leva;
 *   3. acrescentar: rota aberta (não chamada) que tem vaga recebe o pedido
 *      novo que cabe nela. D8 revisto em 22/10/2026 (Douglas: "montou rota
 *      com um só, não tinha motoboy na loja, ficou mais algum pronto que dá
 *      para ir junto — reconfigura e avisa; antes do motoboy puxar. Puxou,
 *      acabou"): rota JÁ CHAMADA que ninguém puxou ainda também recebe, mas
 *      só pedido PRONTO (ela espera motoboy; um pedido na chapa a atrasaria),
 *      pelas mesmas regras e o mesmo teto. A ação vem com `rotaChamada` e
 *      quem grava reenvia a chamada ("Rota #1 atualizada · agora 2
 *      entregas"). Rota rechamada neste ciclo (D13) só cresce no seguinte —
 *      um push por vez. Rota com qualquer pedido puxado (com motoboy) ou que
 *      saiu de PENDING segue congelada: "puxou, acabou" — e a gravação
 *      confere isso de novo no banco (executar.ts);
 *   4. criar: do que sobrou, rotas novas. Pedido sem companhia só vira rota
 *      de 1 quando fica pronto — e aí ainda espera `esperaMaxMin` por alguém
 *      antes de ser chamado (passo 2 do ciclo seguinte). UMA ROTA POR VEZ
 *      (Douglas, 22/10/2026 20h50: "seguir a mesma regra que já tem; se não
 *      saiu ainda e dá para incluir, faça; e não sair criando mil rotas — só
 *      cria uma rota depois de sair a que já está pronta"). Revisto às 21h30:
 *      a trava é a VAGA, não a rota aberta. Enquanto alguma rota aberta que
 *      ninguém puxou (chamada ou não) tem menos paradas que
 *      `maxEntregasPorRota` ("se mudar o teto, muda a regra"), não nasce
 *      outra — quem não coube nela espera ("proxima-rota"). Todas no teto, a
 *      próxima já pode nascer, para a cozinha adiantar a segunda com
 *      prioridade. A vaga é contada depois dos passos 2 e 3 (o não pronto
 *      que saiu devolve vaga; quem cresceu pode ter enchido). Nasce no
 *      máximo uma rota por ciclo.
 */
import { distanciaKm, type Ponto } from "@/lib/ponto-do-pedido";
import type { RoteirizacaoAutomaticaConfig } from "./config";

/**
 * Os cortes de D4 que quem monta a entrada já decidiu (executar.ts); aqui só
 * são relatados. "tirado-pela-loja": a loja desfez a rota automática dele ou
 * o tirou dela (`CustomerOrder.semRotaAutomaticaEm`) — sem isto, 20 s depois
 * do Desfazer o cron agrupava tudo de novo. Volta pelo "voltar" da lista.
 */
export type CorteDaEntrada = "agendado" | "parceiro" | "ja-com-motoboy" | "rota-manual" | "tirado-pela-loja";

export type MotivoDoDescarte =
  | "sem-ponto"
  | CorteDaEntrada
  | "fora-do-raio"
  | "prazo-incompativel"
  | "rota-cheia"
  /** Sozinho na loja (não há outro pedido nem rota para comparar) e ainda não pronto. */
  | "esperando-companhia"
  /** Uma rota por vez: não coube na que está aberta e espera ela sair. */
  | "proxima-rota";

export type PedidoParaDespacho = {
  id: string;
  numero: number | null;
  /** Nulo = sem localização confiável: não entra (D3). */
  ponto: Ponto | null;
  prazo: Date;
  criadoEm: Date;
  pronto: boolean;
  prontoEm: Date | null;
  rotaId: string | null;
  /** `prioridadeNaCozinha` ligado pela loja (Fase A): semente preferida. */
  prioridadeManual: boolean;
  /** Corte de D4 decidido na entrada. */
  fora?: CorteDaEntrada | null;
  /** Só para pedido de rota aberta: cancelado sai da rota (D13). */
  cancelado?: boolean;
  /** Só para pedido de rota aberta: entregue/encerrado não espera mais nada. */
  finalizado?: boolean;
};

export type RotaAberta = {
  id: string;
  routeNumber: string;
  pedidos: PedidoParaDespacho[];
  chamadaEm: Date | null;
  /** Quem foi chamado (Fase 2). Ocupa o motoboy: ele não é chamado para outra rota. */
  chamadaMotoboyId?: string | null;
};

export type MotoboyLivre = { id: string; nome: string; naLojaDesde: Date | null; gpsFresco: boolean };

export type Acao =
  /**
   * `porques`: por id de pedido, por que ele está na rota nova — a semente
   * ("#46 abriu a rota (menor prazo)") e cada companhia ("#47 entrou: perto do
   * #48 — 1,2 km pela rua"). Vai para o histórico da rota (historico-da-rota.ts).
   */
  | { tipo: "criar-rota"; pedidos: string[] /* na ordem das paradas */; motivo: string; porques: Record<string, string> }
  /**
   * `ordem` = a rota inteira na nova ordem das paradas (quem grava regrava a
   * sequência de todos). `rotaChamada`: a rota já estava chamada e ninguém
   * tinha puxado (D8 revisto, 22/10) — quem grava avisa o chamado que ela mudou.
   * `porque`: a regra que o fez entrar, com a distância ("#35 entrou: no
   * caminho do #33 — desvio 0,8 km pela rua"), para o histórico da rota.
   */
  | { tipo: "acrescentar"; rotaId: string; pedidoId: string; posicao: number; ordem: string[]; rotaChamada?: true; porque: string }
  | { tipo: "tirar-da-rota"; rotaId: string; pedidoId: string; motivo: "cancelado" | "espera-estourada" }
  | { tipo: "chamar"; rotaId: string; motoboyId: string | null /* null = avisar todos os livres */ }
  | { tipo: "apagar-rota"; rotaId: string }
  /**
   * A rota "terminou sozinha": cada pedido dela foi puxado um a um ("Só
   * este") ou já fechou. Vira DISPATCHED sem efeito nenhum — cada pedido já
   * saiu pelo próprio puxar — e para de contar como aberta.
   */
  | { tipo: "fechar-rota"; rotaId: string };

export type Descartado = { pedidoId: string; motivo: MotivoDoDescarte };

/** O id da loja na tabela de distâncias pela rua (`EntradaDoPlanejador.pelaRua`). */
export const LOJA_NA_TABELA = "loja";

/**
 * Km de RUA entre dois lugares — ids de pedido, ou LOJA_NA_TABELA —, ou
 * null/undefined = sem medida (aí vale a linha reta). Lida como simétrica:
 * quem monta mede cada par uma vez, no sentido de quem sai da loja.
 */
export type KmPelaRua = (a: string, b: string) => number | null | undefined;

export type EntradaDoPlanejador = {
  loja: Ponto;
  config: RoteirizacaoAutomaticaConfig;
  pedidos: PedidoParaDespacho[];
  rotasAbertas: RotaAberta[];
  motoboys: MotoboyLivre[];
  agora: Date;
  /** A tabela de km de rua (executar.ts). Sem ela, tudo em linha reta. */
  pelaRua?: KmPelaRua;
};

/** Chamada sem ninguém puxar por mais que isto é feita de novo (D13). */
export const RECHAMAR_DEPOIS_MIN = 60;

/**
 * A chamada venceu (D13): feita há mais de RECHAMAR_DEPOIS_MIN sem ninguém
 * puxar. O planejador chama de novo; a gravação (executar.ts, `chamarARota`)
 * confere a mesma regra no banco — no máximo um push por hora por rota, mesmo
 * com dois ciclos no ar.
 */
export function chamadaVencida(chamadaEm: Date | null | undefined, agora: Date): boolean {
  return !!chamadaEm && agora.getTime() - chamadaEm.getTime() > RECHAMAR_DEPOIS_MIN * 60_000;
}

/** Como a prévia escreve cada motivo para o lojista. */
export const MOTIVO_EM_PORTUGUES: Record<MotivoDoDescarte, string> = {
  "sem-ponto": "📍 sem localização no mapa — rota manual",
  agendado: "agendado para mais tarde",
  parceiro: "entrega do parceiro (iFood/99 levam)",
  "ja-com-motoboy": "já está com um motoboy",
  "rota-manual": "já está numa rota montada à mão",
  "tirado-pela-loja": "✋ a loja tirou da rota automática — volta pelo \"voltar\" na lista",
  "fora-do-raio": "longe dos outros pedidos — vai sozinho quando ficar pronto",
  "prazo-incompativel": "prazo muito diferente dos vizinhos — espera outra rota",
  "rota-cheia": "a rota que passa perto já está cheia",
  "esperando-companhia": "único pedido de entrega agora — vai sozinho quando ficar pronto",
  "proxima-rota": "vai na próxima rota — uma por vez: a que está aberta ainda tem vaga e não saiu",
};

const porId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Quem vem primeiro para ser semente: priorizado à mão, menor prazo, mais velho, id. */
function antesComoSemente(a: PedidoParaDespacho, b: PedidoParaDespacho): number {
  if (a.prioridadeManual !== b.prioridadeManual) return a.prioridadeManual ? -1 : 1;
  const prazo = a.prazo.getTime() - b.prazo.getTime();
  if (prazo !== 0) return prazo;
  const criado = a.criadoEm.getTime() - b.criadoEm.getTime();
  if (criado !== 0) return criado;
  return porId(a, b);
}

const semente = (membros: PedidoParaDespacho[]) => [...membros].sort(antesComoSemente)[0];

/** Acima disto a força bruta cresce demais (9! = 362 880): vizinho mais próximo. Não acontece: `maxEntregasPorRota` vai até 6. */
const MAX_PARADAS_NA_FORCA_BRUTA = 8;

/**
 * A ordem de MENOR PERCURSO TOTAL saindo da loja, sem a volta: todas as
 * ordens possíveis (até 6 paradas são 720), a de menos km. O vizinho mais
 * próximo era guloso — na Rota #11 da Hakim (22/10/2026) foi do 34 ao 33,
 * "mais perto", e teve de voltar ao 35, que ficava no caminho.
 *
 * `daLoja(id)` e `entre(a, b)` são os km de cada perna (rua ou reta, quem
 * chama decide; `entre` pode não ser simétrica — mão única). As ordens são
 * vistas em ordem alfabética de id e só uma ESTRITAMENTE menor troca a
 * melhor: empate fica com a de menor id, e a mesma entrada dá a mesma ordem.
 */
export function ordemDeMenorPercurso(ids: string[], daLoja: (id: string) => number, entre: (a: string, b: string) => number): string[] {
  const lista = [...ids].sort();
  const n = lista.length;
  if (n <= 1) return lista;
  if (n > MAX_PARADAS_NA_FORCA_BRUTA) {
    const ordem: string[] = [];
    const resto = [...lista];
    let atual: string | null = null;
    while (resto.length > 0) {
      const de = atual;
      const km = (id: string) => (de == null ? daLoja(id) : entre(de, id));
      let melhor = 0;
      for (let i = 1; i < resto.length; i++) if (km(resto[i]) < km(resto[melhor])) melhor = i;
      atual = resto.splice(melhor, 1)[0];
      ordem.push(atual);
    }
    return ordem;
  }
  const L = lista.map((id) => daLoja(id));
  const D = lista.map((a) => lista.map((b) => (a === b ? 0 : entre(a, b))));
  let melhorSoma = Infinity;
  let melhorOrdem: number[] = lista.map((_, i) => i);
  const usado = new Array<boolean>(n).fill(false);
  const atual: number[] = [];
  const visitar = (ultimo: number, soma: number) => {
    // Corta o ramo que já não ganha (empate também: a primeira ordem fica).
    if (soma >= melhorSoma - 1e-9) return;
    if (atual.length === n) { melhorSoma = soma; melhorOrdem = [...atual]; return; }
    for (let i = 0; i < n; i++) {
      if (usado[i]) continue;
      usado[i] = true;
      atual.push(i);
      visitar(i, soma + (ultimo < 0 ? L[i] : D[ultimo][i]));
      atual.pop();
      usado[i] = false;
    }
  };
  visitar(-1, 0);
  return melhorOrdem.map((i) => lista[i]);
}

/**
 * A ordem das paradas em LINHA RETA: menor percurso total a partir da loja
 * (`ordemDeMenorPercurso`). Pedido sem ponto vai para o fim. É a da prévia;
 * a gravada sai pela rua quando dá (ordem-por-rua.ts, que cai nesta como
 * reserva).
 */
export function ordenarParadas(loja: Ponto, pedidos: { id: string; ponto: Ponto | null }[]): string[] {
  const ponto = new Map(pedidos.filter((p) => p.ponto).map((p) => [p.id, p.ponto as Ponto]));
  const semPonto = pedidos.filter((p) => !p.ponto).sort(porId);
  const ordem = ordemDeMenorPercurso(
    [...ponto.keys()],
    (id) => distanciaKm(loja, ponto.get(id) as Ponto),
    (a, b) => distanciaKm(ponto.get(a) as Ponto, ponto.get(b) as Ponto),
  );
  return [...ordem, ...semPonto.map((p) => p.id)];
}

const rotulo = (p: { id: string; numero: number | null }) => `#${p.numero ?? p.id.slice(-4)}`;

/**
 * POR QUE o candidato coube: a parada que deu a melhor nota, se foi "perto"
 * dela (km entre os dois) ou "no caminho" dela (km de desvio), e se a medida
 * foi pela rua ou em linha reta. Douglas, 22/10/2026 22h20: o #47 apareceu na
 * Rota #15 da Hakim e não havia como saber se foi a regra ou alguém pelo
 * ✏️ Editar — daqui pra frente o histórico da rota guarda isto.
 */
export type PorqueDoEncaixe = { paradaId: string; parada: string; tipo: "perto" | "no caminho"; km: number; fonte: "rua" | "reta" };

type Encaixe =
  | { ok: true; nota: number; porque: PorqueDoEncaixe }
  | { ok: false; motivo: "fora-do-raio" | "prazo-incompativel" };

/** "1,2" — km com uma casa, vírgula decimal (desvio de rua pode dar -0,1: vira 0). */
const km1 = (km: number) => Math.max(0, km).toFixed(1).replace(".", ",");

/** "perto do #48 — 1,2 km pela rua" / "no caminho do #33 — desvio 0,8 km em linha reta". */
export function textoDoPorque(p: PorqueDoEncaixe): string {
  const regua = p.fonte === "rua" ? "pela rua" : "em linha reta";
  return p.tipo === "perto"
    ? `perto do ${p.parada} — ${km1(p.km)} km ${regua}`
    : `no caminho do ${p.parada} — desvio ${km1(p.km)} km ${regua}`;
}

/** Km de rua da tabela, nos dois sentidos; null = sem medida. */
function kmDaRua(rua: KmPelaRua | undefined, a: string, b: string): number | null {
  if (!rua) return null;
  const km = rua(a, b) ?? rua(b, a);
  return km != null && Number.isFinite(km) && km >= 0 ? km : null;
}

/**
 * O "no caminho" aceita até o próprio raio de desvio. Era o do Auto-Agrupar,
 * min(1,8; max(1; raio × 0,75)) = 1,5 km com raio 2 — e barrava o #39
 * (Costazul) a caminho do #36/#37 pela orla: ~2 km de desvio. Douglas,
 * 22/10/2026 21h35: "a regra é 2 km" — a mesma do "perto", agora pela rua.
 */
const desvioMaximo = (raio: number) => raio;

/**
 * O candidato cabe junto DESTA parada? Perto (a até o raio, pela rua quando
 * há medida) ou no caminho dela. A nota é a do Auto-Agrupar; null = não cabe.
 * O porquê diz "perto" quando o perto vale (é o mais fácil de conferir no
 * mapa), senão "no caminho" — cada um com a régua que decidiu.
 */
function encaixeNaParada(
  loja: Ponto, parada: PedidoParaDespacho, cand: PedidoParaDespacho, raio: number, rua?: KmPelaRua,
): { nota: number; porque: PorqueDoEncaixe } | null {
  if (!parada.ponto || !cand.ponto) return null;
  const ruaLC = kmDaRua(rua, LOJA_NA_TABELA, cand.id);
  const ruaCP = kmDaRua(rua, cand.id, parada.id);
  const ruaLP = kmDaRua(rua, LOJA_NA_TABELA, parada.id);
  const retaCP = distanciaKm(cand.ponto, parada.ponto);
  // Perto é uma perna só: a de rua, quando medida, decide sozinha (o rio).
  const perto = (ruaCP ?? retaCP) <= raio;
  // O desvio compara três pernas: ou todas de rua, ou todas de reta — km de
  // rua menos km de reta não mede desvio nenhum. Se o par já foi medido pela
  // rua e falta uma perna da loja, o "no caminho" não vale: a rua já
  // desmentiu a reta entre os dois (o rio), e só o "perto" decide.
  const tudoPelaRua = ruaLC != null && ruaCP != null && ruaLP != null;
  const lc = tudoPelaRua ? (ruaLC as number) : distanciaKm(loja, cand.ponto);
  const cp = tudoPelaRua ? (ruaCP as number) : retaCP;
  const lp = tudoPelaRua ? (ruaLP as number) : distanciaKm(loja, parada.ponto);
  const desvio = lc + cp - lp;
  const noCaminho = (tudoPelaRua || ruaCP == null) && desvio <= desvioMaximo(raio) && lc <= lp + 1;
  if (!perto && !noCaminho) return null;
  const porque: PorqueDoEncaixe = perto
    ? { paradaId: parada.id, parada: rotulo(parada), tipo: "perto", km: ruaCP ?? retaCP, fonte: ruaCP != null ? "rua" : "reta" }
    : { paradaId: parada.id, parada: rotulo(parada), tipo: "no caminho", km: desvio, fonte: tudoPelaRua ? "rua" : "reta" };
  return { nota: desvio * 0.6 + (ruaCP ?? cp) * 0.4, porque };
}

/**
 * O candidato cabe nesta rota? Perto de, ou no caminho de, QUALQUER parada
 * (a melhor nota entre elas), e o prazo dentro da janela da `ancora` — a
 * semente, o mais urgente (a regra do Auto-Agrupar + a janela de prazo).
 */
export function encaixeNaRota(
  loja: Ponto,
  ancora: PedidoParaDespacho,
  paradas: PedidoParaDespacho[],
  cand: PedidoParaDespacho,
  config: RoteirizacaoAutomaticaConfig,
  rua?: KmPelaRua,
): Encaixe {
  let melhor: { nota: number; porque: PorqueDoEncaixe } | null = null;
  for (const parada of paradas) {
    if (parada.id === cand.id) continue;
    const e = encaixeNaParada(loja, parada, cand, config.raioDoGrupoKm, rua);
    if (e && (melhor == null || e.nota < melhor.nota)) melhor = e;
  }
  if (melhor == null) return { ok: false, motivo: "fora-do-raio" };
  // A janela vale para os dois lados. Com a semente sendo o mais urgente é o
  // "até X min depois" do plano; mas o pedido que não achou companhia como
  // semente vira candidato da semente seguinte (menos urgente), e só "depois"
  // deixaria o #1 (prazo 20) entrar na rota do #2 (prazo 40) com janela de 15.
  if (Math.abs(cand.prazo.getTime() - ancora.prazo.getTime()) > config.janelaDePrazoMin * 60_000) {
    return { ok: false, motivo: "prazo-incompativel" };
  }
  return { ok: true, nota: melhor.nota, porque: melhor.porque };
}

/** O candidato cabe na rota desta semente sozinha? (`encaixeNaRota` com uma parada só) */
export function encaixe(loja: Ponto, sem: PedidoParaDespacho, cand: PedidoParaDespacho, config: RoteirizacaoAutomaticaConfig, rua?: KmPelaRua): Encaixe {
  return encaixeNaRota(loja, sem, [sem], cand, config, rua);
}

/** Os candidatos que cabem na rota, do melhor para o pior (nota, depois prazo, depois id), com o porquê de cada um. */
function candidatosQueCabem(
  loja: Ponto, ancora: PedidoParaDespacho, paradas: PedidoParaDespacho[], lista: PedidoParaDespacho[],
  config: RoteirizacaoAutomaticaConfig, rua?: KmPelaRua,
) {
  const naRota = new Set(paradas.map((p) => p.id));
  const bons: { p: PedidoParaDespacho; nota: number; porque: PorqueDoEncaixe }[] = [];
  for (const p of lista) {
    if (naRota.has(p.id)) continue;
    const e = encaixeNaRota(loja, ancora, paradas, p, config, rua);
    if (e.ok) bons.push({ p, nota: e.nota, porque: e.porque });
  }
  return bons.sort((a, b) => a.nota - b.nota || a.p.prazo.getTime() - b.p.prazo.getTime() || porId(a.p, b.p));
}

/**
 * Os pares que o encaixe pode precisar medir PELA RUA neste ciclo, do mais
 * importante para o menos — quem monta a tabela (executar.ts) mede na ordem
 * até acabar o tempo, e o resto fica em linha reta.
 *
 * Primeiro a loja → cada pedido (entra em todo "no caminho" e quase sempre
 * já está no cache da cotação de frete). Depois os pares que PODEM caber
 * juntos, do mais perto ao mais longe:
 *   - ao menos um dos dois fora de rota: rota não se junta com rota, e as
 *     paradas de uma mesma rota não se comparam no encaixe;
 *   - prazos a até 2 × a janela (os dois têm de caber na janela da semente);
 *   - em linha reta a até o raio, ou "no caminho" um do outro com folga de
 *     1,5 × no desvio. O que fica de fora não cabe nem em linha reta (a rua
 *     é sempre ≥ a reta para o "perto"), e a reta o recusa do mesmo jeito.
 * Rota já puxada (algum pedido com motoboy) não cresce: não entra.
 */
export function paresParaMedirPelaRua(entrada: Pick<EntradaDoPlanejador, "loja" | "config" | "pedidos" | "rotasAbertas">): [string, string][] {
  const { loja, config } = entrada;
  type Lugar = { id: string; ponto: Ponto; prazo: number; rotaId: string | null; daLoja: number };
  const lugares: Lugar[] = [];
  const vistos = new Set<string>();
  const lugar = (p: PedidoParaDespacho, rotaId: string | null) => {
    if (!p.ponto || vistos.has(p.id)) return;
    vistos.add(p.id);
    lugares.push({ id: p.id, ponto: p.ponto, prazo: p.prazo.getTime(), rotaId, daLoja: distanciaKm(loja, p.ponto) });
  };
  for (const r of [...entrada.rotasAbertas].sort(porId)) {
    if (r.pedidos.some((p) => !p.cancelado && p.fora === "ja-com-motoboy")) continue;
    for (const p of [...r.pedidos].sort(porId)) if (!p.cancelado && !p.finalizado) lugar(p, r.id);
  }
  const idsEmRota = new Set(entrada.rotasAbertas.flatMap((r) => r.pedidos.map((p) => p.id)));
  for (const p of [...entrada.pedidos].sort(porId)) {
    if (!idsEmRota.has(p.id) && !p.cancelado && !p.fora) lugar(p, null);
  }

  const daLoja: [string, string][] = [...lugares]
    .sort((a, b) => a.daLoja - b.daLoja || porId(a, b))
    .map((l) => [LOJA_NA_TABELA, l.id]);
  const raio = config.raioDoGrupoKm;
  const folgaDoDesvio = desvioMaximo(raio) * 1.5;
  const janelaMs = 2 * config.janelaDePrazoMin * 60_000;
  const pares: { par: [string, string]; reta: number }[] = [];
  for (let i = 0; i < lugares.length; i++) {
    for (let j = i + 1; j < lugares.length; j++) {
      const a = lugares[i], b = lugares[j];
      if (a.rotaId && b.rotaId) continue;
      if (Math.abs(a.prazo - b.prazo) > janelaMs) continue;
      const reta = distanciaKm(a.ponto, b.ponto);
      const noCaminho = Math.min(a.daLoja + reta - b.daLoja, b.daLoja + reta - a.daLoja) <= folgaDoDesvio;
      if (reta > raio && !noCaminho) continue;
      pares.push({ par: a.id < b.id ? [a.id, b.id] : [b.id, a.id], reta });
    }
  }
  pares.sort((x, y) => x.reta - y.reta || (x.par.join() < y.par.join() ? -1 : 1));
  return [...daLoja, ...pares.map((p) => p.par)];
}

export function planejar(entrada: EntradaDoPlanejador): { acoes: Acao[]; descartados: Descartado[] } {
  const { loja, config, agora, pelaRua: rua } = entrada;
  const max = Math.max(1, config.maxEntregasPorRota);
  const esperaMs = config.esperaMaxMin * 60_000;
  const acoes: Acao[] = [];
  const descartados: Descartado[] = [];

  const rotas = [...entrada.rotasAbertas].sort(porId);
  const idsEmRota = new Set(rotas.flatMap((r) => r.pedidos.map((p) => p.id)));

  // ── O bolo: pedidos fora de rota automática que podem entrar ────────────
  const bolo: PedidoParaDespacho[] = [];
  for (const p of [...entrada.pedidos].sort(porId)) {
    if (idsEmRota.has(p.id) || p.cancelado) continue;
    if (p.fora) { descartados.push({ pedidoId: p.id, motivo: p.fora }); continue; }
    if (!p.ponto) { descartados.push({ pedidoId: p.id, motivo: "sem-ponto" }); continue; }
    bolo.push(p);
  }
  const voltarAoBolo = (p: PedidoParaDespacho) => {
    if (!p.fora && p.ponto) bolo.push({ ...p, rotaId: null });
  };

  // ── 1. Limpar ────────────────────────────────────────────────────────────
  type RotaViva = { rota: RotaAberta; membros: PedidoParaDespacho[] };
  const vivas: RotaViva[] = [];
  for (const rota of rotas) {
    const membros = [...rota.pedidos].sort(porId);
    for (const p of membros) {
      if (p.cancelado) acoes.push({ tipo: "tirar-da-rota", rotaId: rota.id, pedidoId: p.id, motivo: "cancelado" });
    }
    const restantes = membros.filter((p) => !p.cancelado);
    if (restantes.length === 0) { acoes.push({ tipo: "apagar-rota", rotaId: rota.id }); continue; }
    // Ninguém mais espera nada: puxados um a um ou já entregues. A rota
    // terminou sozinha — fecha, senão ficava "aberta" para sempre no card.
    const esperando = restantes.filter((p) => p.fora !== "ja-com-motoboy" && !p.finalizado);
    if (esperando.length === 0) { acoes.push({ tipo: "fechar-rota", rotaId: rota.id }); continue; }
    // Um pedido da rota já foi puxado (está com motoboy): a rota está saindo.
    // Não cresce, não é chamada, não perde ninguém — quem puxar o resto leva.
    if (restantes.some((p) => p.fora === "ja-com-motoboy")) continue;
    vivas.push({ rota, membros: esperando });
  }
  vivas.sort((a, b) => antesComoSemente(semente(a.membros), semente(b.membros)));

  // ── 2. Chamar ────────────────────────────────────────────────────────────
  const rechamar = (r: RotaAberta) => chamadaVencida(r.chamadaEm, agora);
  // Motoboy já chamado para uma rota que ainda vale está ocupado com ela.
  const ocupados = new Set(
    vivas.filter((v) => v.rota.chamadaEm && !rechamar(v.rota)).map((v) => v.rota.chamadaMotoboyId).filter(Boolean) as string[],
  );
  // D10: na loja (carimbo de chegada + GPS fresco), quem chegou primeiro na frente.
  const fila = entrada.motoboys
    .filter((m) => m.naLojaDesde && m.gpsFresco && !ocupados.has(m.id))
    .sort((a, b) => (a.naLojaDesde as Date).getTime() - (b.naLojaDesde as Date).getTime() || porId(a, b));
  // D11: com "quem escanear primeiro", a chamada é sempre para todos os livres.
  const proximoMotoboy = () => (config.quemPuxa === "qualquer" ? null : fila.shift()?.id ?? null);

  // As que podem crescer no passo 3, na ordem das sementes. `chamada`: já
  // chamada e ninguém puxou (as puxadas nem chegam aqui) — só pedido pronto.
  const crescem: { v: RotaViva; chamada: boolean }[] = [];
  // Quantas paradas cada rota viva tem depois dos passos 2 e 3 (a vaga do
  // "uma rota por vez", no passo 4).
  const paradasDaRota = new Map(vivas.map((v) => [v.rota.id, v.membros.length]));
  for (const v of vivas) {
    if (v.rota.chamadaEm) {
      // Rechamada (D13) agora: só cresce no ciclo seguinte, um push por vez.
      if (rechamar(v.rota)) acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
      else crescem.push({ v, chamada: true });
      continue;
    }
    const sem = semente(v.membros);
    const todosProntos = v.membros.every((p) => p.pronto);
    // Pronto sem a hora do pronto: não dá para saber há quanto tempo espera —
    // conta como estourado, senão o pedido esperaria companhia para sempre.
    const estourou = sem.pronto && (!sem.prontoEm || agora.getTime() - sem.prontoEm.getTime() >= esperaMs);
    if (todosProntos && (v.membros.length >= 2 || v.membros.length >= max || estourou)) {
      acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
    } else if (estourou && !todosProntos) {
      for (const p of v.membros) {
        if (p.pronto) continue;
        acoes.push({ tipo: "tirar-da-rota", rotaId: v.rota.id, pedidoId: p.id, motivo: "espera-estourada" });
        voltarAoBolo(p);
      }
      // Os não prontos saíram: ela volta a ter vaga.
      paradasDaRota.set(v.rota.id, v.membros.filter((p) => p.pronto).length);
      acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
    } else {
      crescem.push({ v, chamada: false });
    }
  }
  bolo.sort(porId);

  // Os grupos desta rodada, para explicar depois por que um pedido ficou de fora.
  const grupos: { semente: PedidoParaDespacho; membros: PedidoParaDespacho[]; cheio: boolean }[] = [];
  const naRota = new Set<string>();

  // ── 3. Acrescentar em rota aberta (e na chamada que ninguém puxou) ──────
  for (const { v, chamada } of crescem) {
    const membros = [...v.membros];
    while (membros.length < max) {
      // Qualquer parada da rota serve de vizinha; a janela é a da semente.
      const sem = semente(membros);
      const [bom] = candidatosQueCabem(loja, sem, membros, bolo.filter((p) => !naRota.has(p.id) && (!chamada || p.pronto)), config, rua);
      if (!bom) break;
      const melhor = bom.p;
      naRota.add(melhor.id);
      membros.push(melhor);
      const ordem = ordenarParadas(loja, membros);
      acoes.push({
        tipo: "acrescentar", rotaId: v.rota.id, pedidoId: melhor.id, posicao: ordem.indexOf(melhor.id) + 1, ordem,
        ...(chamada ? { rotaChamada: true as const } : {}),
        porque: `${rotulo(melhor)} entrou: ${textoDoPorque(bom.porque)}`,
      });
    }
    paradasDaRota.set(v.rota.id, membros.length);
    // A chamada não conta como grupo para o motivo de quem sobrou: ela só
    // aceita pronto, e "rota cheia"/"longe" do não pronto viria dela à toa.
    if (!chamada) grupos.push({ semente: semente(membros), membros, cheio: membros.length >= max });
  }

  // ── 4. Criar rota nova: só quando a que está aberta saiu, uma por vez ───
  const restantes = bolo.filter((p) => !naRota.has(p.id)).sort(antesComoSemente);
  // Uma rota por vez: trava enquanto alguma rota aberta (que ninguém puxou,
  // chamada ou não) ainda tem VAGA. Todas no teto: a próxima já pode nascer.
  const umaPorVez = [...paradasDaRota.values()].some((n) => n < max);
  let criou = false;
  for (const sem of restantes) {
    if (umaPorVez || criou) break;
    const livres = restantes.filter((p) => !naRota.has(p.id));
    // O grupo cresce um a um, como a rota aberta do passo 3: quem entrou já
    // serve de parada para o próximo (o #35 no caminho do #33, não do #34).
    // A janela de prazo fica ancorada na semente.
    const grupo = [sem];
    const porqueDe = new Map<string, PorqueDoEncaixe>();
    while (grupo.length < max) {
      const [bom] = candidatosQueCabem(loja, sem, grupo, livres, config, rua);
      if (!bom) break;
      grupo.push(bom.p);
      porqueDe.set(bom.p.id, bom.porque);
    }
    const companhia = grupo.slice(1);
    // Sozinho e ainda na cozinha: espera companhia (ou ficar pronto).
    if (companhia.length === 0 && !sem.pronto) continue;
    for (const p of grupo) naRota.add(p.id);
    const ordem = ordenarParadas(loja, grupo);
    const porque = sem.prioridadeManual ? "prioridade pedida pela loja" : "menor prazo";
    const motivo = companhia.length > 0
      ? `${rotulo(sem)} (${porque}) + ${companhia.map(rotulo).join(", ")}`
      : `${rotulo(sem)} sozinho e pronto (${porque})`;
    const porques: Record<string, string> = {
      [sem.id]: companhia.length > 0 ? `${rotulo(sem)} abriu a rota (${porque})` : `${rotulo(sem)} abriu a rota sozinho e pronto (${porque})`,
    };
    for (const p of companhia) porques[p.id] = `${rotulo(p)} entrou: ${textoDoPorque(porqueDe.get(p.id) as PorqueDoEncaixe)}`;
    acoes.push({ tipo: "criar-rota", pedidos: ordem, motivo, porques });
    grupos.push({ semente: sem, membros: grupo, cheio: grupo.length >= max });
    criou = true;
  }

  // ── Quem ficou no bolo, e por quê ────────────────────────────────────────
  const sobraram = restantes.filter((p) => !naRota.has(p.id));
  for (const p of sobraram) {
    let motivo: MotivoDoDescarte | null = null;
    for (const g of grupos) {
      const e = encaixeNaRota(loja, g.semente, g.membros, p, config, rua);
      if (e.ok && g.cheio) { motivo = "rota-cheia"; break; }
      if (!e.ok && e.motivo === "prazo-incompativel") motivo = "prazo-incompativel";
    }
    if (!motivo) {
      for (const q of sobraram) {
        if (q.id === p.id) continue;
        const e1 = encaixe(loja, q, p, config, rua);
        const e2 = encaixe(loja, p, q, config, rua);
        if ((!e1.ok && e1.motivo === "prazo-incompativel") || (!e2.ok && e2.motivo === "prazo-incompativel")) { motivo = "prazo-incompativel"; break; }
      }
    }
    if (!motivo) motivo = grupos.length > 0 || sobraram.length > 1 ? "fora-do-raio" : "esperando-companhia";
    // Não coube na rota que está aberta: vai na próxima, quando essa sair.
    if ((umaPorVez || criou) && motivo !== "prazo-incompativel") motivo = "proxima-rota";
    descartados.push({ pedidoId: p.id, motivo });
  }

  return { acoes, descartados };
}
