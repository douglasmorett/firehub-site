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
 *   - candidato entra se está a até `raioDoGrupoKm` da semente OU "no caminho"
 *     (desvio ≤ min(1,8; max(1; raio × 0,75)) e não mais longe da loja que a
 *     semente + 1 km); nota = desvio × 0,6 + distância × 0,4 (menor primeiro);
 *   - e, novidade daqui, o prazo do candidato cabe na janela: até
 *     `janelaDePrazoMin` de diferença do prazo da semente (ver `encaixe`);
 *   - até `maxEntregasPorRota`; ordem das paradas = vizinho mais próximo a
 *     partir da loja, em linha reta. É a ordem que a PRÉVIA mostra; ao gravar,
 *     executar.ts a refaz pela rua (ordem-por-rua.ts, `rotaEntre`) e volta a
 *     esta quando a rua não responde — o planejador fica puro, sem rede.
 *
 * A distância é `distanciaKm` de lib/ponto-do-pedido.ts — o mesmo Haversine de
 * `linhaRetaKm` (lib/geocoding.ts), mas de um arquivo sem banco: geocoding.ts
 * importa o Prisma, e o planejador tem de rodar no teste sem DATABASE_URL.
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
 *      antes de ser chamado (passo 2 do ciclo seguinte).
 *
 * ── Uma rota por vez, cheia (Douglas, 22/10/2026 20h45) ────────────────────
 * "Tem quatro rotas montadas, todas com dois pedidos. Você monta só uma rota.
 * Despachou ela, aí você cria outra. Se o limite é três, fazer uma força para
 * que saia com o limite máximo." Então:
 *   - no passo 3, quem não cabe pela regra normal ainda entra com FOLGA
 *     (`FOLGA_PARA_ENCHER`: raio, desvio e janela de prazo multiplicados);
 *   - no passo 4, rota nova só nasce quando nenhuma rota aberta (chamada ou
 *     não, que ninguém puxou) tem vaga — e no máximo UMA por ciclo, também
 *     enchida com folga. Quem sobra espera a próxima ("proxima-rota"). A
 *     exceção é o pedido pronto há `esperaMaxMin` que não coube em nenhuma:
 *     esse abre a dele, para não esfriar esperando a vez.
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
  /** Uma rota por vez: a que está montando ainda não saiu (ou já nasceu uma neste ciclo). */
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
  | { tipo: "criar-rota"; pedidos: string[] /* na ordem das paradas */; motivo: string }
  /**
   * `ordem` = a rota inteira na nova ordem das paradas (quem grava regrava a
   * sequência de todos). `rotaChamada`: a rota já estava chamada e ninguém
   * tinha puxado (D8 revisto, 22/10) — quem grava avisa o chamado que ela mudou.
   */
  | { tipo: "acrescentar"; rotaId: string; pedidoId: string; posicao: number; ordem: string[]; rotaChamada?: true }
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

export type EntradaDoPlanejador = {
  loja: Ponto;
  config: RoteirizacaoAutomaticaConfig;
  pedidos: PedidoParaDespacho[];
  rotasAbertas: RotaAberta[];
  motoboys: MotoboyLivre[];
  agora: Date;
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
  "proxima-rota": "vai na próxima rota — uma por vez: a que está montando ainda não saiu",
};

/**
 * Quanto a regra afrouxa para encher a rota até o máximo (raio, desvio "no
 * caminho" e janela de prazo vezes isto). Só depois que a regra normal não
 * achou ninguém.
 */
export const FOLGA_PARA_ENCHER = 1.5;

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

/**
 * Vizinho mais próximo a partir da loja — porte de `optimizeRouteSequence`
 * (RoteirizacaoModal.tsx). Empate de distância fica com o menor id, para a
 * mesma entrada dar sempre a mesma ordem. Pedido sem ponto vai para o fim.
 * Em linha reta: a prévia mostra esta; a gravada sai pela rua quando dá
 * (ordem-por-rua.ts, que cai nesta como reserva).
 */
export function ordenarParadas(loja: Ponto, pedidos: { id: string; ponto: Ponto | null }[]): string[] {
  const comPonto = pedidos.filter((p) => p.ponto).sort(porId);
  const semPonto = pedidos.filter((p) => !p.ponto).sort(porId);
  const ordem: string[] = [];
  let atual = loja;
  const resto = [...comPonto];
  while (resto.length > 0) {
    let melhor = 0;
    let menor = Infinity;
    for (let i = 0; i < resto.length; i++) {
      const d = distanciaKm(atual, resto[i].ponto as Ponto);
      if (d < menor) { menor = d; melhor = i; }
    }
    const [proximo] = resto.splice(melhor, 1);
    ordem.push(proximo.id);
    atual = proximo.ponto as Ponto;
  }
  return [...ordem, ...semPonto.map((p) => p.id)];
}

type Encaixe =
  | { ok: true; nota: number }
  | { ok: false; motivo: "fora-do-raio" | "prazo-incompativel" };

/** O candidato cabe na rota desta semente? (a regra do Auto-Agrupar + a janela de prazo) */
export function encaixe(loja: Ponto, sem: PedidoParaDespacho, cand: PedidoParaDespacho, config: RoteirizacaoAutomaticaConfig, folga = 1): Encaixe {
  if (!sem.ponto || !cand.ponto) return { ok: false, motivo: "fora-do-raio" };
  const raio = config.raioDoGrupoKm * folga;
  const lojaSemente = distanciaKm(loja, sem.ponto);
  const lojaCand = distanciaKm(loja, cand.ponto);
  const candSemente = distanciaKm(cand.ponto, sem.ponto);
  const desvio = lojaCand + candSemente - lojaSemente;
  const perto = candSemente <= raio;
  const noCaminho = desvio <= Math.min(1.8, Math.max(1, config.raioDoGrupoKm * 0.75)) * folga && lojaCand <= lojaSemente + folga;
  if (!perto && !noCaminho) return { ok: false, motivo: "fora-do-raio" };
  // A janela vale para os dois lados. Com a semente sendo o mais urgente é o
  // "até X min depois" do plano; mas o pedido que não achou companhia como
  // semente vira candidato da semente seguinte (menos urgente), e só "depois"
  // deixaria o #1 (prazo 20) entrar na rota do #2 (prazo 40) com janela de 15.
  if (Math.abs(cand.prazo.getTime() - sem.prazo.getTime()) > config.janelaDePrazoMin * folga * 60_000) {
    return { ok: false, motivo: "prazo-incompativel" };
  }
  return { ok: true, nota: desvio * 0.6 + candSemente * 0.4 };
}

/** Os candidatos que cabem, do melhor para o pior (nota, depois prazo, depois id). */
function candidatosQueCabem(loja: Ponto, sem: PedidoParaDespacho, lista: PedidoParaDespacho[], config: RoteirizacaoAutomaticaConfig, folga = 1) {
  const bons: { p: PedidoParaDespacho; nota: number }[] = [];
  for (const p of lista) {
    if (p.id === sem.id) continue;
    const e = encaixe(loja, sem, p, config, folga);
    if (e.ok) bons.push({ p, nota: e.nota });
  }
  return bons.sort((a, b) => a.nota - b.nota || a.p.prazo.getTime() - b.p.prazo.getTime() || porId(a.p, b.p)).map((b) => b.p);
}

/** Até `vagas` companheiros: primeiro pela regra normal, depois com folga (rota cheia, uma por vez). */
function companhiaParaEncher(loja: Ponto, sem: PedidoParaDespacho, lista: PedidoParaDespacho[], config: RoteirizacaoAutomaticaConfig, vagas: number) {
  const certos = candidatosQueCabem(loja, sem, lista, config).slice(0, vagas);
  if (certos.length >= vagas) return certos;
  const ja = new Set(certos.map((p) => p.id));
  const comFolga = candidatosQueCabem(loja, sem, lista.filter((p) => !ja.has(p.id)), config, FOLGA_PARA_ENCHER);
  return [...certos, ...comFolga].slice(0, vagas);
}

const rotulo = (p: PedidoParaDespacho) => `#${p.numero ?? p.id.slice(-4)}`;

export function planejar(entrada: EntradaDoPlanejador): { acoes: Acao[]; descartados: Descartado[] } {
  const { loja, config, agora } = entrada;
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
  // Uma rota por vez: alguma rota que ninguém puxou ainda tem vaga? Então
  // não nasce outra neste ciclo (passo 4).
  let algumaComVaga = false;
  for (const v of vivas) {
    if (v.rota.chamadaEm) {
      // Rechamada (D13) agora: só cresce no ciclo seguinte, um push por vez.
      if (rechamar(v.rota)) {
        acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
        if (v.membros.length < max) algumaComVaga = true;
      } else crescem.push({ v, chamada: true });
      continue;
    }
    const sem = semente(v.membros);
    const todosProntos = v.membros.every((p) => p.pronto);
    // Pronto sem a hora do pronto: não dá para saber há quanto tempo espera —
    // conta como estourado, senão o pedido esperaria companhia para sempre.
    const estourou = sem.pronto && (!sem.prontoEm || agora.getTime() - sem.prontoEm.getTime() >= esperaMs);
    if (todosProntos && (v.membros.length >= 2 || v.membros.length >= max || estourou)) {
      acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
      if (v.membros.length < max) algumaComVaga = true;
    } else if (estourou && !todosProntos) {
      for (const p of v.membros) {
        if (p.pronto) continue;
        acoes.push({ tipo: "tirar-da-rota", rotaId: v.rota.id, pedidoId: p.id, motivo: "espera-estourada" });
        voltarAoBolo(p);
      }
      acoes.push({ tipo: "chamar", rotaId: v.rota.id, motoboyId: proximoMotoboy() });
      if (v.membros.filter((p) => p.pronto).length < max) algumaComVaga = true;
    } else {
      crescem.push({ v, chamada: false });
    }
  }
  bolo.sort(porId);

  // Os grupos desta rodada, para explicar depois por que um pedido ficou de fora.
  const grupos: { semente: PedidoParaDespacho; cheio: boolean }[] = [];
  const naRota = new Set<string>();

  // ── 3. Acrescentar em rota aberta (e na chamada que ninguém puxou) ──────
  for (const { v, chamada } of crescem) {
    const membros = [...v.membros];
    while (membros.length < max) {
      const sem = semente(membros);
      const [melhor] = companhiaParaEncher(loja, sem, bolo.filter((p) => !naRota.has(p.id) && (!chamada || p.pronto)), config, 1);
      if (!melhor) break;
      naRota.add(melhor.id);
      membros.push(melhor);
      const ordem = ordenarParadas(loja, membros);
      acoes.push({
        tipo: "acrescentar", rotaId: v.rota.id, pedidoId: melhor.id, posicao: ordem.indexOf(melhor.id) + 1, ordem,
        ...(chamada ? { rotaChamada: true as const } : {}),
      });
    }
    if (membros.length < max) algumaComVaga = true;
    // A chamada não conta como grupo para o motivo de quem sobrou: ela só
    // aceita pronto, e "rota cheia"/"longe" do não pronto viria dela à toa.
    if (!chamada) grupos.push({ semente: semente(membros), cheio: membros.length >= max });
  }

  // ── 4. Criar rota nova: só com todas as abertas cheias, uma por ciclo ───
  const restantes = bolo.filter((p) => !naRota.has(p.id)).sort(antesComoSemente);
  let criou = false;
  // Com rota aberta com vaga, só abre outra o pedido PRONTO que não coube em
  // nenhuma e já esperou `esperaMaxMin` — senão esfria esperando a vez.
  const esfriando = (p: PedidoParaDespacho) => p.pronto && (!p.prontoEm || agora.getTime() - p.prontoEm.getTime() >= esperaMs);
  for (const sem of algumaComVaga ? restantes.filter(esfriando) : restantes) {
    const livres = restantes.filter((p) => p.id !== sem.id);
    const companhia = companhiaParaEncher(loja, sem, livres, config, max - 1);
    // Sozinho e ainda na cozinha: espera companhia (ou ficar pronto).
    if (companhia.length === 0 && !sem.pronto) continue;
    const grupo = [sem, ...companhia];
    for (const p of grupo) naRota.add(p.id);
    const ordem = ordenarParadas(loja, grupo);
    const porque = sem.prioridadeManual ? "prioridade pedida pela loja" : "menor prazo";
    const motivo = companhia.length > 0
      ? `${rotulo(sem)} (${porque}) + ${companhia.map(rotulo).join(", ")}`
      : `${rotulo(sem)} sozinho e pronto (${porque})`;
    acoes.push({ tipo: "criar-rota", pedidos: ordem, motivo });
    grupos.push({ semente: sem, cheio: grupo.length >= max });
    criou = true;
    break;
  }
  // Ficou de fora só porque é uma rota por vez: o motivo é esse, não a distância.
  const esperaAProxima = algumaComVaga || criou;

  // ── Quem ficou no bolo, e por quê ────────────────────────────────────────
  const sobraram = restantes.filter((p) => !naRota.has(p.id));
  for (const p of sobraram) {
    let motivo: MotivoDoDescarte | null = null;
    for (const g of grupos) {
      const e = encaixe(loja, g.semente, p, config);
      if (e.ok && g.cheio) { motivo = "rota-cheia"; break; }
      if (!e.ok && e.motivo === "prazo-incompativel") motivo = "prazo-incompativel";
    }
    if (!motivo) {
      for (const q of sobraram) {
        if (q.id === p.id) continue;
        const e1 = encaixe(loja, q, p, config);
        const e2 = encaixe(loja, p, q, config);
        if ((!e1.ok && e1.motivo === "prazo-incompativel") || (!e2.ok && e2.motivo === "prazo-incompativel")) { motivo = "prazo-incompativel"; break; }
      }
    }
    if (!motivo) motivo = grupos.length > 0 || sobraram.length > 1 ? "fora-do-raio" : "esperando-companhia";
    if (esperaAProxima && motivo !== "prazo-incompativel") motivo = "proxima-rota";
    descartados.push({ pedidoId: p.id, motivo });
  }

  return { acoes, descartados };
}
